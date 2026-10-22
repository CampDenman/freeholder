// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.38 capacity: only identical, anonymous CMS pages of the public playground
// may be kept by a shared cache, and nothing else changes for other sites.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { resetEnvForTests } from "@/core/env";
import {
  APP_ROUTE_ROOTS,
  PLAYGROUND_SHARED_CACHE_CONTROL,
  playgroundSharedCacheable,
} from "@/core/demo/playground-cache";
import { ANALYTICS_BOOTSTRAP_COOKIE } from "@/modules/analytics/visitor";
import { proxy } from "../../proxy";

const APP = join(__dirname, "..", "..", "app");

/** First path segments Next routes from `app/`, including route groups. */
function routedRoots(dir: string): string[] {
  const roots: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (entry.startsWith("(") && entry.endsWith(")") && statSync(path).isDirectory()) {
      roots.push(...routedRoots(path));
    } else if (statSync(path).isDirectory() && !entry.startsWith("[")) {
      roots.push(entry);
    }
  }
  return roots;
}

function cacheable(path: string, init: { method?: string; search?: string; headers?: Record<string, string> } = {}) {
  return playgroundSharedCacheable({
    method: init.method ?? "GET",
    path,
    search: init.search ?? "",
    headers: new Headers(init.headers),
  });
}

describe("which playground responses a shared cache may keep", () => {
  it("lists every route app/ serves itself, so none is mistaken for a CMS page", () => {
    const missing = routedRoots(APP).filter((root) => !APP_ROUTE_ROOTS.has(root));
    expect(missing).toEqual([]);
  });

  it("allows only anonymous, cookie-less GETs of CMS pages", () => {
    expect(cacheable("/")).toBe(true);
    expect(cacheable("/services/weddings")).toBe(true);
    expect(cacheable("/about", { method: "HEAD" })).toBe(true);

    // Anything that can personalise or carry state is refused.
    expect(cacheable("/", { headers: { cookie: "freeholder_session=x" } })).toBe(false);
    expect(cacheable("/", { headers: { authorization: "Bearer x" } })).toBe(false);
    expect(cacheable("/contact", { search: "?sent=1" })).toBe(false);
    expect(cacheable("/", { method: "POST" })).toBe(false);
    expect(cacheable("/about", { headers: { rsc: "1" } })).toBe(false);
    expect(cacheable("/about", { headers: { "next-router-prefetch": "1" } })).toBe(false);

    // App routes — tokenised files, account pages, the entry page — never.
    for (const path of ["/admin", "/playground", "/cart", "/report-exports/abc", "/ics/bookings/t", "/api/health", "/@someone", "/robots.txt"]) {
      expect(cacheable(path), path).toBe(false);
    }
  });
});

describe("the edge proxy in playground mode", () => {
  afterEach(() => {
    delete process.env.FREEHOLDER_PLAYGROUND;
    resetEnvForTests();
  });

  function playground(): void {
    process.env.FREEHOLDER_PLAYGROUND = "1";
    resetEnvForTests();
  }

  it("mints no analytics cookie and marks an anonymous page shared-cacheable", () => {
    playground();
    const response = proxy(new NextRequest("https://demo.example.test/services"));
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe(PLAYGROUND_SHARED_CACHE_CONTROL);
  });

  it("applies the same rule after a locale prefix is removed", () => {
    playground();
    expect(proxy(new NextRequest("https://demo.example.test/fr/about")).headers.get("cache-control"))
      .toBe(PLAYGROUND_SHARED_CACHE_CONTROL);
    expect(proxy(new NextRequest("https://demo.example.test/fr/cart")).headers.get("cache-control")).toBeNull();
  });

  it("leaves signed-in, admin and query-string requests to Next's private default", () => {
    playground();
    const signedIn = proxy(new NextRequest("https://demo.example.test/services", {
      headers: { cookie: "freeholder_session=visitor" },
    }));
    expect(signedIn.headers.get("cache-control")).toBeNull();
    expect(proxy(new NextRequest("https://demo.example.test/admin")).headers.get("cache-control")).toBeNull();
    expect(proxy(new NextRequest("https://demo.example.test/contact?sent=1")).headers.get("cache-control")).toBeNull();
  });

  it("changes nothing on an ordinary site, which still counts its visitors", () => {
    const response = proxy(new NextRequest("https://example.test/services"));
    expect(response.cookies.get(ANALYTICS_BOOTSTRAP_COOKIE)?.value).toBeTruthy();
    expect(response.headers.get("cache-control")).toBeNull();
  });
});
