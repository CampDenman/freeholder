// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { legacyRedirect } from "@/core/seo/legacy-proxy";
import { proxy } from "../../proxy";
import { resetEnvForTests } from "@/core/env";
const originalOrigin = process.env.APP_URL;
afterEach(() => { vi.unstubAllGlobals(); if (originalOrigin === undefined) delete process.env.APP_URL; else process.env.APP_URL = originalOrigin; delete process.env.FREEHOLDER_PREVIEW_KEY; resetEnvForTests(); });

describe("legacy redirect HTTP projection", () => {
  it("resolves query IDs at the trusted origin without forwarding cookies or caller headers", async () => {
    process.env.APP_URL = "https://destination.example.test";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ toPath: "2025/03/original", status: "301" }));
    vi.stubGlobal("fetch", fetcher);
    const response = await legacyRedirect(new NextRequest("https://untrusted.example/?p=20", { headers: { cookie: "session=private", authorization: "Bearer private" } }));
    expect(response?.status).toBe(301);
    expect(response?.headers.get("location")).toBe("https://destination.example.test/2025/03/original");
    const [input, options] = fetcher.mock.calls[0]!;
    const url = input as URL;
    expect(url.origin).toBe("https://destination.example.test");
    expect(url.searchParams.get("path")).toBe("?p=20");
    expect(options!.headers).toEqual({ accept: "application/json" });
    expect(options!.redirect).toBe("error");
  });
  it("collapses slash and old-path moves into one redirect, preserving the locale and pagination target", async () => {
    process.env.APP_URL = "https://destination.example.test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ toPath: "blog/category/new?page=2", status: "301" })));
    const response = await legacyRedirect(new NextRequest("https://destination.example.test/fr/category/old/page/2/"));
    expect(response?.status).toBe(301);
    expect(response?.headers.get("location")).toBe("https://destination.example.test/fr/blog/category/new?page=2");
  });
  it("does not intercept private routes, writes or media, and keeps a page available when the resolver fails", async () => {
    process.env.APP_URL = "https://destination.example.test";
    const fetcher = vi.fn().mockRejectedValue(new Error("offline")); vi.stubGlobal("fetch", fetcher);
    for (const path of ["/admin", "/fr/admin", "/api/v1/cms.resolvePage", "/media/photo.jpg", "/feeds/blog.xml"]) expect(await legacyRedirect(new NextRequest(`https://destination.example.test${path}`))).toBeNull();
    expect(await legacyRedirect(new NextRequest("https://destination.example.test/contact", { method: "POST" }))).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(await legacyRedirect(new NextRequest("https://destination.example.test/about"))).toBeNull();
    expect((await legacyRedirect(new NextRequest("https://destination.example.test/about/?utm_source=old")))?.headers.get("location")).toBe("https://destination.example.test/about?utm_source=old");
  });
  it("checks private-preview access before a redirect lookup", async () => {
    process.env.FREEHOLDER_PREVIEW_KEY = "p".repeat(40);
    resetEnvForTests();
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const response = await proxy(new NextRequest("https://preview.example.test/old/"));
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
