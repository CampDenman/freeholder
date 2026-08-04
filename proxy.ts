// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Request preprocessing, at the edge (Next's `proxy` convention — the current
// name for what used to be `middleware`).
//
// Two jobs: forward the request path so server components can read it (see
// PATH_HEADER), and mint the first-party visitor and session identifiers that
// analytics counts with. Cookies can only be *set* on a response, and a server
// component renders without one — so the identifiers are minted here and
// forwarded as headers to whatever renders next.
//
// Deliberately tiny. This runs in the Edge runtime, which cannot load the
// platform — core reaches node:crypto through auth — so nothing here imports
// anything but leaf constants.
//
// This is also where §4.9's URL strategy lands when the public surface goes
// multilingual: non-default locales are path-prefixed, and stripping that
// prefix before the route sees it is exactly this layer's job.
import { NextResponse, type NextRequest } from "next/server";
import { PATH_HEADER } from "@/core/http/headers";
import {
  ANON_COOKIE,
  ANON_HEADER,
  ANON_MAX_AGE,
  newVisitorId,
  SESSION_COOKIE_NAME,
  SESSION_HEADER,
  SESSION_MAX_AGE,
} from "@/modules/analytics/visitor";

/** `/sitemap-fr-CA.xml` — the address crawlers expect for a per-locale map. */
const LOCALE_SITEMAP = /^\/sitemap-([A-Za-z0-9-]+)\.xml$/;

/**
 * Surfaces where a visitor identifier would be pointless or unwelcome.
 *
 * The owner's own admin is not traffic to measure, and a crawler fetching
 * robots.txt is not a visit. Anything here gets no cookie at all rather than a
 * cookie whose events are filtered out later — the cheapest way to be sure a
 * number is honest is to never record it.
 */
const UNCOUNTED = /^\/(admin|login|setup|preview|portal|api|media)(\/|$)|\.(xml|txt|ico|png|jpg|svg|webp|avif)$/;

export function proxy(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  const path = request.nextUrl.pathname;
  headers.set(PATH_HEADER, path);

  // Next matches a dynamic segment, never a dynamic part of one, so the file
  // cannot be named `sitemap-[locale].xml`. The published URL is the one in
  // robots.txt and the sitemap index; the route behind it is an ordinary
  // dynamic segment, and this is the seam between them.
  const sitemap = LOCALE_SITEMAP.exec(path);
  if (sitemap) {
    const url = request.nextUrl.clone();
    url.pathname = `/sitemaps/${sitemap[1]}`;
    return NextResponse.rewrite(url, { request: { headers } });
  }

  if (UNCOUNTED.test(path)) {
    return NextResponse.next({ request: { headers } });
  }

  const anon = request.cookies.get(ANON_COOKIE)?.value ?? newVisitorId();
  const session = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? newVisitorId();
  headers.set(ANON_HEADER, anon);
  headers.set(SESSION_HEADER, session);

  const response = NextResponse.next({ request: { headers } });

  // Both are re-set on every request: the session cookie's expiry is what
  // makes a visit end after thirty minutes of quiet, and it can only slide
  // forward by being written again.
  //
  // httpOnly because nothing in the browser needs to read these, and a value
  // scripts cannot reach is a value an injected script cannot exfiltrate.
  const secure = request.nextUrl.protocol === "https:";
  response.cookies.set(ANON_COOKIE, anon, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: ANON_MAX_AGE,
  });
  response.cookies.set(SESSION_COOKIE_NAME, session, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });

  return response;
}

export const config = {
  // Everything except Next's own assets and the files that are their own
  // answer — adding a header nobody reads to every image is waste.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
