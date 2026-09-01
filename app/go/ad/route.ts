// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The signed ad click-out (MASTER.md §4.16, C9.18).
//
// §4.16: "Click-outs are counted then redirected through a signed first-party
// endpoint, so the count and the destination cannot disagree, and a creative
// cannot be swapped for a different target after approval."
//
// This is the thinnest possible door: it hands the token to `ads.recordClick`
// and redirects to whatever that returns. Every decision — is the signature
// real, has it expired, does the stored destination still match the one that
// was signed, is it even a web address — belongs to the service, so the answer
// is the same whether the click arrives here, through the REST API or from a
// test. What this file adds is the two things only a request has: the
// visitor's own first-party identifiers, and the redirect itself.
//
// Not under `/ads/`: that path is on every content blocker's list, and a
// publisher whose click-outs 404 for a third of their readers has a broken
// site rather than a private one.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ServiceError } from "@/core/service";
import { recordClick } from "@/modules/ads/service";
import { currentAnalyticsSettings } from "@/modules/analytics/read";
import { analyticsCollectionAllowed } from "@/modules/analytics/settings";
import {
  ANALYTICS_CONSENT_COOKIE,
  ANON_COOKIE,
  SESSION_COOKIE_NAME,
  parseAnalyticsConsentState,
} from "@/modules/analytics/visitor";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;

/**
 * A refusal is plain text and a dead end, never a redirect.
 *
 * The whole point of signing the token is that this endpoint cannot be talked
 * into sending somebody somewhere; a "sorry, try this instead" would give that
 * back.
 */
function refuse(message: string, status: number): NextResponse {
  return new NextResponse(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

function pathOfReferrer(referrer: string | null): string {
  if (!referrer) return "/";
  try {
    return new URL(referrer).pathname;
  } catch {
    return "/";
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = new URL(request.url).searchParams.get("t");
  if (!token) return refuse("That ad link is not valid.", 400);

  // Consent is decided here rather than in the service, because the cookies
  // that answer it only exist on a request. A visitor whose policy forbids
  // identifiers still travels — they are simply not counted, which is the
  // trade the rest of §4.7 already makes.
  let anonId: string | undefined;
  let sessionId: string | undefined;
  try {
    const settings = await currentAnalyticsSettings();
    const consent = parseAnalyticsConsentState(
      request.cookies.get(ANALYTICS_CONSENT_COOKIE)?.value,
    );
    if (analyticsCollectionAllowed(settings.consentPolicy, consent)) {
      anonId = request.cookies.get(ANON_COOKIE)?.value;
      sessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    }
  } catch {
    // Analytics being unreachable is not a reason to strand the visitor on a
    // link they clicked. The click goes uncounted and the redirect stands.
  }

  try {
    const { url } = await recordClick.call(
      {
        token,
        anonId: anonId ?? null,
        sessionId: sessionId ?? null,
        // The page the ad was on, as a path. The referrer header carries the
        // whole URL and analytics stores paths, so it is reduced here rather
        // than filed as something it is not.
        path: pathOfReferrer(request.headers.get("referer")),
      },
      ANONYMOUS,
    );
    // 302, not 301: a cached permanent redirect would outlive the campaign and
    // would stop the click reaching the counter at all.
    const response = NextResponse.redirect(url, 302);
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-robots-tag", "noindex, nofollow");
    return response;
  } catch (error) {
    if (error instanceof ServiceError) {
      return refuse(error.message, error.code === "not_found" ? 404 : 400);
    }
    throw error;
  }
}
