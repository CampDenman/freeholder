// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Private preview mode (MASTER.md §43 C3.35).
//
// The promise is narrow and absolute: without a current signed link nobody
// sees the site's public surface, and nothing the site serves invites a
// crawler. These tests drive the real proxy and the real robots and sitemap
// routes with the key set and unset.
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { requestContextProxy as proxy } from "../../proxy";
import { resetEnvForTests } from "@/core/env";
import {
  PREVIEW_COOKIE,
  PREVIEW_MAX_TTL_SECONDS,
  mintPreviewToken,
  previewGated,
  previewLandingPath,
  verifyPreviewToken,
} from "@/core/preview/private-preview";
import { GET as robots } from "../../app/robots.txt/route";
import { GET as sitemap } from "../../app/sitemap.xml/route";
import { previewRefusal } from "@/core/preview/route-gate";
import { previewLink, previewToken } from "../../scripts/preview-link.mjs";

const KEY = "k".repeat(40);
const NOW = 1_800_000_000;

function withKey(key: string | undefined) {
  if (key === undefined) delete process.env.FREEHOLDER_PREVIEW_KEY;
  else process.env.FREEHOLDER_PREVIEW_KEY = key;
  resetEnvForTests();
}

afterEach(() => withKey(undefined));

describe("preview tokens", () => {
  it("verifies its own token until it expires", () => {
    const token = mintPreviewToken(KEY, NOW + 3600, NOW);
    expect(verifyPreviewToken(KEY, token, NOW)).toBe(NOW + 3600);
    expect(verifyPreviewToken(KEY, token, NOW + 3600)).toBeNull();
  });

  it("refuses a tampered token, another key's token, and a missing key", () => {
    const token = mintPreviewToken(KEY, NOW + 60, NOW);
    const later = token.replace(String(NOW + 60), String(NOW + 120));
    expect(verifyPreviewToken(KEY, later, NOW)).toBeNull();
    expect(verifyPreviewToken("x".repeat(40), token, NOW)).toBeNull();
    expect(verifyPreviewToken(undefined, token, NOW)).toBeNull();
    expect(verifyPreviewToken(KEY, "v1.garbage", NOW)).toBeNull();
  });

  it("never mints a link longer than thirty days or with a short key", () => {
    expect(() => mintPreviewToken(KEY, NOW + PREVIEW_MAX_TTL_SECONDS + 1, NOW)).toThrow();
    expect(() => mintPreviewToken("short", NOW + 60, NOW)).toThrow();
    expect(() => mintPreviewToken(KEY, NOW - 1, NOW)).toThrow();
  });

  it("accepts a link minted by the operator script", () => {
    expect(verifyPreviewToken(KEY, previewToken(KEY, NOW + 90), NOW)).toBe(NOW + 90);
    const { url } = previewLink("https://preview.test/anything", KEY, { days: 7, now: NOW, next: "/status" });
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/preview-access");
    expect(verifyPreviewToken(KEY, parsed.searchParams.get("t"), NOW)).toBe(NOW + 7 * 86_400);
    expect(() => previewLink("https://preview.test", KEY, { days: 31 })).toThrow();
  });

  it("only lands on a same-site path", () => {
    expect(previewLandingPath("/pricing")).toBe("/pricing");
    expect(previewLandingPath("//evil.example")).toBe("/");
    expect(previewLandingPath("https://evil.example")).toBe("/");
    expect(previewLandingPath(null)).toBe("/");
  });

  it("gates the public surface and the anonymous API, not the owner's surfaces", () => {
    for (const path of ["/", "/pricing", "/llms.txt", "/og/home", "/media/x.jpg", "/api/v1/pages", "/fr/about", "/sitemaps/en"]) {
      expect(previewGated(path, false), path).toBe(true);
    }
    for (const path of ["/admin", "/admin/pages", "/login", "/setup", "/api/health", "/_next/static/a.js", "/preview-access"]) {
      expect(previewGated(path, false), path).toBe(false);
    }
    expect(previewGated("/api/mcp", true)).toBe(false);
    expect(previewGated("/pricing", true)).toBe(true);
  });
});

describe("the proxy in private preview", () => {
  const request = (path: string, init: { cookie?: string; authorization?: string } = {}) => {
    const headers = new Headers();
    if (init.cookie) headers.set("cookie", init.cookie);
    if (init.authorization) headers.set("authorization", init.authorization);
    return proxy(new NextRequest(new URL(`https://preview.test${path}`), { headers }));
  };

  it("refuses a visitor without a link, naming nothing about the business", async () => {
    withKey(KEY);
    const response = request("/");
    expect(response.status).toBe(401);
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(await response.text()).toContain("Private preview");
  });

  it("exchanges a valid link for an HttpOnly cookie and lands on the page", () => {
    withKey(KEY);
    const token = mintPreviewToken(KEY, Math.floor(Date.now() / 1000) + 600);
    const response = request(`/preview-access?t=${token}&next=/pricing`);
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/pricing");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${PREVIEW_COOKIE}=${token}`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("secure");
  });

  it("refuses an invalid link", () => {
    withKey(KEY);
    expect(request("/preview-access?t=v1.1234567890.nope").status).toBe(401);
  });

  it("serves a viewer holding the cookie, with noindex on the response", () => {
    withKey(KEY);
    const token = mintPreviewToken(KEY, Math.floor(Date.now() / 1000) + 600);
    const response = request("/pricing", { cookie: `${PREVIEW_COOKIE}=${token}` });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
  });

  it("keeps sign-in, setup and health open so the owner can claim the site", () => {
    withKey(KEY);
    for (const path of ["/login", "/setup", "/api/health", "/admin"]) {
      expect(request(path).status, path).toBe(200);
    }
    expect(request("/api/v1/pages", { authorization: "Bearer test" }).status).toBe(200);
  });

  it("changes nothing when no key is set", () => {
    withKey(undefined);
    const response = request("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBeNull();
  });
});

describe("robots and the sitemap in private preview", () => {
  it("disallows everything and advertises no sitemap", async () => {
    withKey(KEY);
    const response = robots(new Request("https://preview.test/robots.txt"));
    expect(await response.text()).toBe("User-agent: *\nDisallow: /\n");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("refuses the sitemap index without the cookie", async () => {
    withKey(KEY);
    const response = await sitemap(new Request("https://preview.test/sitemap.xml"));
    expect(response.status).toBe(401);
  });

  it("lets a viewer with the cookie through the route gate", () => {
    withKey(KEY);
    const token = mintPreviewToken(KEY, Math.floor(Date.now() / 1000) + 600);
    const allowed = new Request("https://preview.test/sitemap.xml", { headers: { cookie: `a=b; ${PREVIEW_COOKIE}=${token}` } });
    expect(previewRefusal(allowed)).toBeNull();
    withKey(undefined);
    expect(previewRefusal(new Request("https://preview.test/sitemap.xml"))).toBeNull();
  });
});
