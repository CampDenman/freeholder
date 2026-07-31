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

export function proxy(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.set(PATH_HEADER, request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Everything except Next's own assets and the files that are their own
  // answer — adding a header nobody reads to every image is waste.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
