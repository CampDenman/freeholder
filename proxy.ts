// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Request preprocessing, at the edge (Next's `proxy` convention — the current
// name for what used to be `middleware`).
//
// It forwards request context for server components, applies locale rewrites,
// and supplies only the analytics identity state policy permits at the edge.
// The short bootstrap bridges a first render until the database-backed policy
// endpoint promotes it (or clears it); durable identifiers are forwarded as
// headers because a server component cannot read a cookie being set.
//
// Deliberately tiny. This runs in the Edge runtime, which cannot load the
// platform — core reaches node:crypto through auth — so nothing here imports
// anything but leaf constants.
//
// This is also where §4.9's URL strategy lands when the public surface goes
// multilingual: non-default locales are path-prefixed, and stripping that
// prefix before the route sees it is exactly this layer's job.
import { NextResponse, type NextRequest } from "next/server";
import instanceConfig from "./freeholder.config";
import {
  LOCALE_HEADER,
  PATH_HEADER,
  REQUEST_TARGET_HEADER,
} from "@/core/http/headers";
import { env } from "@/core/env";
import {
  CSP_NONCE_HEADER,
  THIRD_PARTY_CREATIVE_CONSENT_COOKIE,
  contentSecurityPolicy,
  cspAppliesToPath,
  parseCspOrigins,
  reportingEndpointsHeader,
  thirdPartyCreativeConsentGranted,
} from "@/core/http/csp";
import {
  ANALYTICS_BOOTSTRAP_COOKIE,
  ANALYTICS_BOOTSTRAP_HEADER,
  ANALYTICS_BOOTSTRAP_MAX_AGE,
  ANALYTICS_CONSENT_COOKIE,
  ANON_COOKIE,
  ANON_HEADER,
  newVisitorId,
  SESSION_COOKIE_NAME,
  SESSION_HEADER,
  SESSION_MAX_AGE,
  analyticsIdentifiersAllowed,
  parseAnalyticsConsentState,
} from "@/modules/analytics/visitor";

/** `/sitemap-fr-CA.xml` — the address crawlers expect for a per-locale map. */
const LOCALE_SITEMAP = /^\/sitemap-([A-Za-z0-9-]+)\.xml$/;

/**
 * A leading path segment shaped like a language tag: `/fr`, `/fr-CA`.
 *
 * Shape only. The edge cannot ask the database which locales this instance
 * publishes, so it strips anything that *looks* like a prefix and lets the
 * page decide — a page whose slug genuinely is "de" on an instance with no
 * German still resolves, because the route falls back to the original path
 * when the locale turns out not to be enabled.
 */
const LOCALE_PREFIX = /^\/([a-z]{2}(?:-[A-Za-z]{2,4})?)(\/.*)?$/;

/**
 * Surfaces where a visitor identifier would be pointless or unwelcome.
 *
 * The owner's own admin is not traffic to measure, and a crawler fetching
 * robots.txt is not a visit. Anything here gets no cookie at all rather than a
 * cookie whose events are filtered out later — the cheapest way to be sure a
 * number is honest is to never record it.
 */
const UNCOUNTED = /^\/(admin|login|setup|preview|portal|api|media)(\/|$)|\.(xml|txt|ico|png|jpg|svg|webp|avif)$/;

/** Owner/internal routes may look like locale-prefixed public paths, but are not. */
const NEVER_LOCALIZED = /^\/(admin|login|setup|preview|api|media)(\/|$)/;

export function proxy(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  const path = request.nextUrl.pathname;
  headers.set(PATH_HEADER, path);
  headers.set(REQUEST_TARGET_HEADER, `${path}${request.nextUrl.search}`);
  const policy = requestPolicy(request, path);
  if (policy) {
    // Next parses the request policy and applies this nonce to its framework
    // scripts and styles. The browser enforces the identical response policy.
    headers.set(CSP_NONCE_HEADER, policy.nonce);
    headers.set("content-security-policy", policy.value);
  }
  const finalize = (response: NextResponse): NextResponse => {
    if (policy) {
      response.headers.set("Content-Security-Policy", policy.value);
      response.headers.set("Reporting-Endpoints", reportingEndpointsHeader());
    }
    return response;
  };

  // Next matches a dynamic segment, never a dynamic part of one, so the file
  // cannot be named `sitemap-[locale].xml`. The published URL is the one in
  // robots.txt and the sitemap index; the route behind it is an ordinary
  // dynamic segment, and this is the seam between them.
  const sitemap = LOCALE_SITEMAP.exec(path);
  if (sitemap) {
    const url = request.nextUrl.clone();
    url.pathname = `/sitemaps/${sitemap[1]}`;
    return finalize(NextResponse.rewrite(url, { request: { headers } }));
  }

  // §4.9's URL strategy, applied before anything else routes: public pages and
  // the customer portal accept a prefix. Owner/internal routes never do, even
  // when somebody types `/fr/admin` by hand.
  const prefixed = LOCALE_PREFIX.exec(path);
  if (prefixed && !NEVER_LOCALIZED.test(prefixed[2] ?? "/")) {
    const [, locale = "", rest = "/"] = prefixed;
    headers.set(LOCALE_HEADER, locale);
    headers.set(PATH_HEADER, rest);
    const url = request.nextUrl.clone();
    url.pathname = rest;
    // A localized portal request is still account traffic, not analytics.
    return finalize(UNCOUNTED.test(rest)
      ? NextResponse.rewrite(url, { request: { headers } })
      : withAnalyticsIdentity(
          request,
          headers,
          (forwarded) => NextResponse.rewrite(url, { request: { headers: forwarded } }),
        ));
  }

  if (UNCOUNTED.test(path)) {
    return finalize(NextResponse.next({ request: { headers } }));
  }

  return finalize(withAnalyticsIdentity(
    request,
    headers,
    (forwarded) => NextResponse.next({ request: { headers: forwarded } }),
  ));
}

function originOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function requestPolicy(
  request: NextRequest,
  path: string,
): { nonce: string; value: string } | null {
  if (!cspAppliesToPath(path)) return null;
  const runtime = env();
  const storageOrigins = (runtime.FREEHOLDER_STORAGE ?? instanceConfig.adapters.storage) === "s3"
    ? [
        originOf(runtime.S3_ENDPOINT),
        originOf(runtime.S3_PUBLIC_BASE_URL),
      ].filter((value): value is string => Boolean(value))
    : [];
  const nonce = crypto.randomUUID().replaceAll("-", "");
  return {
    nonce,
    value: contentSecurityPolicy({
      nonce,
      path,
      production: runtime.NODE_ENV === "production",
      mediaOrigins: storageOrigins,
      uploadOrigins: storageOrigins,
      creativeOrigins: parseCspOrigins(runtime.CSP_THIRD_PARTY_ORIGINS),
      thirdPartyCreativeConsent: thirdPartyCreativeConsentGranted(
        request.cookies.get(THIRD_PARTY_CREATIVE_CONSENT_COOKIE)?.value,
      ),
    }),
  };
}

/**
 * Attach the visitor and session cookies to whatever response is going back.
 *
 * Shared because a locale-prefixed URL is rewritten rather than passed
 * through, and a visitor reading the French site is still a visitor.
 */
function withAnalyticsIdentity(
  request: NextRequest,
  headers: Headers,
  respond: (headers: Headers) => NextResponse,
): NextResponse {
  const consent = parseAnalyticsConsentState(
    request.cookies.get(ANALYTICS_CONSENT_COOKIE)?.value,
  );
  const durableAnon = request.cookies.get(ANON_COOKIE)?.value;
  if (!analyticsIdentifiersAllowed(consent) || !durableAnon) {
    if (consent === "denied" || consent === "disabled") return respond(headers);
    const bootstrap =
      request.cookies.get(ANALYTICS_BOOTSTRAP_COOKIE)?.value ?? newVisitorId();
    headers.set(ANALYTICS_BOOTSTRAP_HEADER, bootstrap);
    const response = respond(headers);
    response.cookies.set(ANALYTICS_BOOTSTRAP_COOKIE, bootstrap, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: ANALYTICS_BOOTSTRAP_MAX_AGE,
    });
    return response;
  }

  const anon = durableAnon;
  const session = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? newVisitorId();
  headers.set(ANON_HEADER, anon);
  headers.set(SESSION_HEADER, session);
  const response = respond(headers);

  // The session is re-set on every request: its expiry is what makes a visit
  // end after thirty minutes of quiet. The visitor cookie is deliberately
  // refreshed only by the policy-aware consent endpoint, which knows the
  // configured retention period that this edge layer cannot read.
  //
  // httpOnly because nothing in the browser needs to read these, and a value
  // scripts cannot reach is a value an injected script cannot exfiltrate.
  const secure = request.nextUrl.protocol === "https:";
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
