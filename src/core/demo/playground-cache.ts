// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.38: which playground responses a shared cache in front of the demo may
// keep. A leaf module on purpose: the edge proxy imports it, and the edge
// cannot load the platform.
//
// The public playground is the one deploy whose anonymous pages are identical
// for every visitor: it records no analytics (pageview.ts), so the proxy mints
// no identity cookies there, and a request with no cookie at all has no
// session, cart, consent, theme or experiment to personalise with. That makes
// a launch-day spike of first-time visitors cacheable by a CDN — and only that.
//
// It is an allowlist of *pages the CMS renders*, never a denylist of private
// routes. Route handlers (tokenised files, calendars, privacy artifacts) and
// every app route are excluded by their first segment, and
// `tests/core/playground-cache.test.ts` fails if a new top-level route
// appears in `app/` without being listed here.

/** Every first path segment that `app/` routes itself rather than the CMS. */
export const APP_ROUTE_ROOTS: ReadonlySet<string> = new Set([
  // app/
  "ads.txt", "ap", "api", "app-ads.txt", "capture", "embed", "feeds", "g",
  "gift", "go", "ics", "indexnow-key", "llms-full.txt", "llms.txt", "media",
  "member-blobs", "member-files", "newsletters", "og", "playground", "portal",
  "privacy", "registry", "report-exports", "robots.txt", "s", "setup", "share",
  "sitemaps", "sitemap.xml", "source", "unsubscribe", ".well-known", "_next",
  // app/(admin)
  "admin", "forgot", "invite", "login", "reset", "security",
  // app/(preview)
  "preview",
  // app/(public), except the catch-all
  "book", "browse", "buy", "c", "call", "cart", "checkout", "community",
  "contribute", "feed", "gifts", "join", "m", "market", "memberships",
  "messages", "orders", "p", "report", "search", "tags",
]);

/** A CMS slug segment, optionally behind a locale prefix the proxy strips. */
const SLUG_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Short enough that an edit a visitor publishes is public within seconds,
 * long enough that a spike becomes one render per page per few seconds.
 */
export const PLAYGROUND_SHARED_CACHE_CONTROL =
  "public, max-age=0, s-maxage=10, stale-while-revalidate=30";

export interface SharedCacheRequest {
  method: string;
  /** Path after any locale prefix has been removed. */
  path: string;
  search: string;
  headers: Headers;
}

/** True only for an anonymous, cookie-less GET of a CMS-rendered page. */
export function playgroundSharedCacheable(request: SharedCacheRequest): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  // Any cookie may personalise the render (session, cart, theme, consent),
  // and a query string drives form confirmations and facets.
  if (request.headers.has("cookie") || request.headers.has("authorization")) return false;
  if (request.search !== "") return false;
  // Client navigations fetch a different payload for the same URL.
  if (request.headers.has("rsc") || request.headers.has("next-router-prefetch") || request.headers.has("next-action")) {
    return false;
  }
  if (request.path === "/") return true;
  const segments = request.path.replace(/\/$/, "").split("/").slice(1);
  if (segments.length === 0 || APP_ROUTE_ROOTS.has(segments[0]!)) return false;
  return segments.every((segment) => SLUG_SEGMENT.test(segment));
}
