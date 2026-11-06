// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The link-in-bio click-out (MASTER.md §34, C9.39).
//
// The same shape as `/go/ad`: the thinnest possible door. Every decision —
// is this a link on a published page, is it showing right now, where does it
// go — belongs to `linkinbio.follow`, so the answer is the same here, over
// the HTTP API and in a test. What this file adds is the two things only a
// request has: the visitor's own first-party identifiers, when their consent
// allows them to be used, and the redirect itself.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { env } from "@/core/env";
import { ServiceError } from "@/core/service";
import { follow } from "@/modules/linkinbio/service";
import { classify, shapeOf } from "@/modules/analytics/classify";
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

/** A dead end in plain text, never a redirect somewhere "instead". */
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const query = new URL(request.url).searchParams;

  // Counted only when the visitor's analytics policy allows identifiers, and
  // never on the shared playground or for a link prefetch. Anything else
  // still travels — it is simply not a number.
  let anonId: string | undefined;
  let sessionId: string | undefined;
  const prefetch =
    request.headers.get("next-router-prefetch") === "1" ||
    request.headers.get("purpose") === "prefetch" ||
    request.headers.get("sec-purpose")?.includes("prefetch") === true;
  if (env().FREEHOLDER_PLAYGROUND !== "1" && !prefetch) {
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
      // Analytics being unreachable must not strand a visitor on a link they
      // tapped. The click goes uncounted and the redirect stands.
    }
  }
  const verdict = classify(shapeOf(request.headers));

  try {
    const { destination } = await follow.call(
      {
        id,
        from: query.get("from") ?? "/",
        lang: query.get("lang") ?? undefined,
        anonId: anonId ?? null,
        sessionId: sessionId ?? null,
        visitorKind: verdict.kind,
        botReasons: verdict.reasons,
      },
      ANONYMOUS,
    );
    // 302, not 301: an owner may change or hide the link tomorrow, and a
    // cached permanent redirect would also stop the click being counted.
    const response = NextResponse.redirect(destination, 302);
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-robots-tag", "noindex, nofollow");
    response.headers.set("referrer-policy", "strict-origin-when-cross-origin");
    return response;
  } catch (error) {
    if (error instanceof ServiceError) {
      return refuse(
        error.code === "rate_limited" ? error.message : "That link is not available.",
        error.code === "rate_limited" ? 429 : 404,
      );
    }
    throw error;
  }
}
