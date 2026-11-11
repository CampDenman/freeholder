// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { NextRequest } from "next/server";
import { legacyRedirect } from "@/core/seo/legacy-proxy";
import { proxy } from "../../proxy";
import { resetEnvForTests } from "@/core/env";
import { internalSiteOrigin } from "@/core/seo/origin";
const originalOrigin = process.env.APP_URL;
const originalPort = process.env.PORT;
const originalHostname = process.env.HOSTNAME;
beforeEach(() => { delete process.env.HOSTNAME; resetEnvForTests(); });
afterEach(() => { vi.unstubAllGlobals(); if (originalOrigin === undefined) delete process.env.APP_URL; else process.env.APP_URL = originalOrigin; if (originalPort === undefined) delete process.env.PORT; else process.env.PORT = originalPort; if (originalHostname === undefined) delete process.env.HOSTNAME; else process.env.HOSTNAME = originalHostname; delete process.env.FREEHOLDER_PREVIEW_KEY; resetEnvForTests(); });

describe("legacy redirect HTTP projection", () => {
  it.each(["127.0.0.1", "::1", "localhost"])("reaches a real local resolver bound to %s", async (hostname) => {
    const server = createServer((request, response) => {
      expect(request.headers.cookie).toBeUndefined();
      expect(request.headers.authorization).toBeUndefined();
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ toPath: "moved", status: "301" }));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, hostname, resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP listener");
      process.env.HOSTNAME = hostname;
      process.env.PORT = String(address.port);
      process.env.APP_URL = "https://destination.example.test";
      resetEnvForTests();
      const response = await legacyRedirect(new NextRequest("https://untrusted.example/old", { headers: { cookie: "private", authorization: "Bearer private" } }));
      expect(response?.status).toBe(301);
      expect(response?.headers.get("location")).toBe("https://destination.example.test/moved");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
  it.each(["0.0.0.0", "container-name", "attacker.example", "127.0.0.1:443/path"])("never uses %s as an outbound host", hostname => {
    process.env.HOSTNAME = hostname;
    process.env.PORT = "3219";
    resetEnvForTests();
    expect(internalSiteOrigin()).toBe("http://127.0.0.1:3219");
  });
  it("uses the default listening port and refuses malformed port configuration", () => {
    delete process.env.PORT;
    resetEnvForTests();
    expect(internalSiteOrigin()).toBe("http://127.0.0.1:3000");
    for (const port of ["0", "65536", "example.test:3000", "3000/path", "1e3", "0xBB8"]) {
      process.env.PORT = port;
      resetEnvForTests();
      expect(() => internalSiteOrigin()).toThrow();
    }
  });
  it("resolves query IDs over loopback when public-origin egress is blocked", async () => {
    process.env.APP_URL = "https://destination.example.test";
    process.env.PORT = "3219";
    resetEnvForTests();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const target = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (target.origin !== "http://127.0.0.1:3219") throw new Error("Network egress blocked");
      return Response.json({ toPath: "2025/03/original", status: "301" });
    });
    vi.stubGlobal("fetch", fetcher);
    const response = await legacyRedirect(new NextRequest("https://untrusted.example/?p=20", { headers: { cookie: "session=private", authorization: "Bearer private" } }));
    expect(response?.status).toBe(301);
    expect(response?.headers.get("location")).toBe("https://destination.example.test/2025/03/original");
    const [input, options] = fetcher.mock.calls[0]!;
    const url = input as URL;
    expect(url.origin).toBe("http://127.0.0.1:3219");
    expect(url.searchParams.get("path")).toBe("?p=20");
    expect(url.searchParams.has("locale")).toBe(false);
    expect(options!.headers).toEqual({ accept: "application/json" });
    expect(options!.redirect).toBe("error");
  });
  it("collapses slash and old-path moves into one redirect, preserving the locale and pagination target", async () => {
    process.env.APP_URL = "https://destination.example.test";
    const fetcher = vi.fn().mockResolvedValue(Response.json({ toPath: "blog/category/new?page=2", status: "301" }));
    vi.stubGlobal("fetch", fetcher);
    const response = await legacyRedirect(new NextRequest("https://destination.example.test/fr/category/old/page/2/"));
    expect(response?.status).toBe(301);
    expect(response?.headers.get("location")).toBe("https://destination.example.test/fr/blog/category/new?page=2");
    expect((fetcher.mock.calls[0]![0] as URL).searchParams.get("locale")).toBe("fr");
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
  it("copies CSP onto a mutable response rather than mutating native redirect headers", async () => {
    process.env.APP_URL = "https://destination.example.test";
    resetEnvForTests();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ toPath: "new-address", status: "301" })));
    const response = await proxy(new NextRequest("https://destination.example.test/old-address/"));
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://destination.example.test/new-address");
    expect(response.headers.get("content-security-policy")).toContain("default-src");
  });
});
