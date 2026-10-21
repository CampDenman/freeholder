// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Controlled gallery delivery works for agents without revealing object keys.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as download } from "../../app/g/[slug]/download/[itemId]/route";
import { GET as archive } from "../../app/g/[slug]/archive/route";

const mocks = vi.hoisted(() => ({
  cookie: vi.fn(), item: vi.fn(), archive: vi.fn(), bytes: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookie }) }));
vi.mock("@/adapters/storage", () => ({ storage: () => ({ get: mocks.bytes }) }));
vi.mock("@/modules/galleries/service", () => ({
  downloadGalleryItem: { call: mocks.item },
  downloadGalleryArchive: { call: mocks.archive },
}));

const itemId = "00000000-0000-4000-8000-000000000007";
const nativeToken = "native-session-token-0123456789";
const cookieToken = "browser-session-token-0123456789";
const routes = [
  { name: "single-file", authorize: mocks.item, expected: { itemId, slug: "portraits" },
    get: (request: Request) => download(request, { params: Promise.resolve({ slug: "portraits", itemId }) }) },
  { name: "archive", authorize: mocks.archive, expected: { slug: "portraits" },
    get: (request: Request) => archive(request, { params: Promise.resolve({ slug: "portraits" }) }) },
];

function request(authorization?: string) {
  return new Request("https://example.test/g/portraits/delivery", {
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe("controlled gallery byte routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.cookie.mockReturnValue({ value: cookieToken });
    mocks.bytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
    for (const route of routes) route.authorize.mockResolvedValue({
      storageKey: "private/internal-object-key", filename: "portraits.zip", bytes: 3,
    });
  });

  it.each(routes)("$name accepts Bearer credentials and binds the gallery path", async route => {
    const response = await route.get(request(`Bearer ${nativeToken}`));
    expect(response.status).toBe(200);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie, Authorization");
    expect(route.authorize).toHaveBeenCalledWith({ ...route.expected, sessionToken: nativeToken }, { kind: "anonymous" });
    expect(mocks.cookie).not.toHaveBeenCalled();
  });

  it.each(routes)("$name refuses explicit invalid credentials without cookie fallback", async route => {
    for (const value of ["Basic invalid", "", "Bearer"]) {
      expect((await route.get(request(value))).status).toBe(404);
    }
    expect(route.authorize).not.toHaveBeenCalled();
    route.authorize.mockRejectedValueOnce(new Error("permission"));
    expect((await route.get(request("Bearer invalid"))).status).toBe(404);
    expect(mocks.cookie).not.toHaveBeenCalled();
    expect(mocks.bytes).not.toHaveBeenCalled();
  });

  it.each(routes)("$name retains browser cookie delivery and denies missing credentials", async route => {
    expect((await route.get(request())).status).toBe(200);
    expect(route.authorize).toHaveBeenCalledWith({ ...route.expected, sessionToken: cookieToken }, { kind: "anonymous" });
    mocks.cookie.mockReturnValueOnce(undefined);
    expect((await route.get(request())).status).toBe(404);
    expect(route.authorize).toHaveBeenCalledTimes(1);
  });
});
