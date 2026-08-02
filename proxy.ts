// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Request preprocessing, at the edge (Next's `proxy` convention — the current
// name for what used to be `middleware`).
//
// One job today: forward the request path so server components can read it.
// See PATH_HEADER for why that is needed at all.
//
// Deliberately tiny. This runs in the Edge runtime, which cannot load the
// platform — core reaches node:crypto through auth — so nothing here imports
// anything but a constant.
//
// This is also where §4.9's URL strategy lands when the public surface goes
// multilingual: non-default locales are path-prefixed, and stripping that
// prefix before the route sees it is exactly this layer's job.
import { NextResponse, type NextRequest } from "next/server";
import { PATH_HEADER } from "@/core/http/headers";

/** `/sitemap-fr-CA.xml` — the address crawlers expect for a per-locale map. */
const LOCALE_SITEMAP = /^\/sitemap-([A-Za-z0-9-]+)\.xml$/;

export function proxy(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.set(PATH_HEADER, request.nextUrl.pathname);

  // Next matches a dynamic segment, never a dynamic part of one, so the file
  // cannot be named `sitemap-[locale].xml`. The published URL is the one in
  // robots.txt and the sitemap index; the route behind it is an ordinary
  // dynamic segment, and this is the seam between them.
  const sitemap = LOCALE_SITEMAP.exec(request.nextUrl.pathname);
  if (sitemap) {
    const url = request.nextUrl.clone();
    url.pathname = `/sitemaps/${sitemap[1]}`;
    return NextResponse.rewrite(url, { request: { headers } });
  }

  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Everything except Next's own assets and the files that are their own
  // answer — adding a header nobody reads to every image is waste.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
