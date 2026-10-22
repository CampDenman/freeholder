// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.38 audit follow-up (2026-10-22): the pieces that decide what a refused
// visitor or playground evaluator is told — the public form's reason codes
// and answer cookie, the admin refusal flash, the posting-screen redirect and
// the playground's manage-to-view guard fallback.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/core/service";
import { resetEnvForTests } from "@/core/env";
import {
  decodeFormReturn,
  encodeFormReturn,
  failureFromQuery,
  failureMessageKey,
  publicFailure,
  returnedValues,
} from "@/core/http/public-form-return";

const request = vi.hoisted(() => ({
  headers: new Map<string, string>(),
  cookies: new Map<string, string>(),
  token: undefined as string | undefined,
}));

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (name: string) => request.headers.get(name) ?? null }),
  cookies: async () => ({
    get: (name: string) => (request.cookies.has(name) ? { value: request.cookies.get(name) } : undefined),
    set: (name: string, value: string) => request.cookies.set(name, value),
    delete: (name: string | { name: string }) => request.cookies.delete(typeof name === "string" ? name : name.name),
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`redirect:${to}`), { digest: `NEXT_REDIRECT;${to}` });
  },
}));

const visitor = vi.hoisted(() => ({
  kind: "user" as const,
  userId: "00000000-0000-4000-8000-0000000000aa",
  role: "playground",
  grants: [
    { module: "admin", access: "view" as const },
    { module: "settings", access: "view" as const },
    { module: "crm", access: "view" as const },
  ],
}));

vi.mock("@/core/http/actor", () => ({ actorFromToken: async () => visitor }));
vi.mock("@/core/settings/service", () => ({ setupState: { call: async () => ({ hasOwner: true }) } }));

describe("public form refusals", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvForTests();
  });

  it("classifies a refusal into a coarse reason, never the service's text", () => {
    expect(publicFailure(new ServiceError("validation", "x"))).toBe("invalid");
    expect(publicFailure(new ServiceError("conflict", "x"))).toBe("invalid");
    expect(publicFailure(new ServiceError("rate_limited", "x"))).toBe("busy");
    expect(publicFailure(new ServiceError("permission", "x"))).toBe("unavailable");
    expect(publicFailure(new ServiceError("internal", "x"))).toBe("server");
    expect(publicFailure(new Error("database down"))).toBe("server");
    expect(failureFromQuery("busy")).toBe("busy");
    expect(failureFromQuery("<script>")).toBeUndefined();
    expect(failureFromQuery(["busy"])).toBeUndefined();
  });

  it("names the playground, not the visitor, when the demo is the reason", () => {
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "0"); resetEnvForTests();
    expect(failureMessageKey("unavailable", "forms.public.error")).toBe("public.failure.unavailable");
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "1"); resetEnvForTests();
    expect(failureMessageKey("unavailable", "forms.public.error")).toBe("public.failure.playground");
    expect(failureMessageKey("invalid", "forms.public.error")).toBe("forms.public.error");
    expect(failureMessageKey(undefined, "forms.public.error")).toBe("forms.public.error");
  });

  it("returns answers to the form they came from only, and drops the traps", () => {
    const raw = encodeFormReturn("form:contact", { name: "Ada", consent: true, entry_ref: "bot", n: 3 }, ["entry_ref"]);
    expect(raw).not.toBeNull();
    const back = decodeFormReturn(raw!);
    expect(back).toEqual({ key: "form:contact", values: { name: "Ada", consent: "on" } });
    expect(returnedValues(back, "form:contact")).toEqual({ name: "Ada", consent: "on" });
    // Another form on the same page never inherits them.
    expect(returnedValues(back, "form:newsletter")).toBeUndefined();
    expect(returnedValues(back, "inbound:quote")).toBeUndefined();
  });

  it("refuses to carry answers too large for a cookie rather than truncating the cookie", () => {
    const large = Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`f${index}`, "x".repeat(2_000)]));
    expect(encodeFormReturn("form:contact", large)).toBeNull();
    // Each value is bounded on the way in, too.
    const one = decodeFormReturn(encodeFormReturn("form:contact", { message: "y".repeat(5_000) })!);
    expect(one?.values.message).toHaveLength(2_000);
  });

  it("treats a tampered or foreign cookie as no answers", () => {
    expect(decodeFormReturn(undefined)).toBeNull();
    expect(decodeFormReturn("not base64 json")).toBeNull();
    const odd = Buffer.from(JSON.stringify({ key: "form:contact", values: { a: { nested: true }, b: "ok" } })).toString("base64url");
    expect(decodeFormReturn(odd)).toEqual({ key: "form:contact", values: { b: "ok" } });
  });
});

describe("admin refusal feedback", () => {
  beforeEach(() => {
    request.headers.clear();
    request.cookies.clear();
  });

  it("sends a refusal back to the admin screen that posted it, never elsewhere", async () => {
    const { postedFromPath } = await import("../../app/(admin)/action-helpers");
    request.headers.set("host", "demo.example.test");
    request.headers.set("referer", "https://demo.example.test/admin/promotions?saved=x&error=old&tab=coupons");
    expect(await postedFromPath("/admin/products/new")).toBe("/admin/promotions?tab=coupons");
    request.headers.set("referer", "https://evil.example.test/admin/promotions");
    expect(await postedFromPath("/admin/products/new")).toBe("/admin/products/new");
    request.headers.set("referer", "https://demo.example.test/portal/login");
    expect(await postedFromPath("/admin/products/new")).toBe("/admin/products/new");
    request.headers.delete("referer");
    expect(await postedFromPath("/admin/events")).toBe("/admin/events");
  });

  it("flashes the refusal through an httpOnly cookie, read once, never from the URL", async () => {
    const { flashAdminError, ADMIN_ERROR_COOKIE, decodeAdminError } = await import("../../app/(admin)/action-helpers");
    const { takeAdminError } = await import("../../app/(admin)/admin-flash-actions");
    expect(await takeAdminError()).toBeNull();
    await flashAdminError("This action is unavailable in the public playground.");
    expect(request.cookies.has(ADMIN_ERROR_COOKIE)).toBe(true);
    expect(await takeAdminError()).toBe("This action is unavailable in the public playground.");
    expect(await takeAdminError()).toBeNull();
    expect(decodeAdminError("%%%")).toBeNull();
  });
});

describe("playground admin guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvForTests();
  });

  it("opens a manage-only screen read-only and explains areas the visitor cannot view", async () => {
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "1"); resetEnvForTests();
    const { requireStaffActor, requireOwnerActor } = await import("../../app/(admin)/admin/guard");
    await expect(requireStaffActor("settings", "manage")).resolves.toBe(visitor);
    await expect(requireStaffActor("crm", "manage")).resolves.toBe(visitor);
    await expect(requireStaffActor("platform")).rejects.toThrow("redirect:/admin/unavailable?module=platform");
    await expect(requireOwnerActor("builder")).rejects.toThrow("redirect:/admin/unavailable?module=builder");
  });

  it("keeps the ordinary refusal on a normal install", async () => {
    vi.stubEnv("FREEHOLDER_PLAYGROUND", "0"); resetEnvForTests();
    const { requireStaffActor } = await import("../../app/(admin)/admin/guard");
    await expect(requireStaffActor("settings", "manage")).rejects.toThrow("redirect:/admin?denied=settings");
    await expect(requireStaffActor("platform")).rejects.toThrow("redirect:/admin?denied=platform");
  });
});
