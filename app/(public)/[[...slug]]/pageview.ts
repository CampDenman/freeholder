// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Recording a page view (MASTER.md §4.7, §36).
//
// Server-side, during the render, from identifiers the proxy minted. That has
// three consequences worth stating, because they are the reason for doing it
// this way rather than with a script:
//
//   - Nothing to block. An ad blocker cannot remove a number the server
//     already wrote, so the traffic chart describes the traffic.
//   - Nothing third-party to load. Consent reconciliation and Web Vitals use a
//     small first-party client; page counting itself still works without it.
//   - It works with JavaScript off.
//
// The cost is that this runs inside the request. One insert against a local
// Postgres is not worth batching yet; when core/jobs lands it becomes an
// obvious candidate, and that is written down rather than assumed.
import { cookies, headers } from "next/headers";
import { campaignFromQuery, track } from "@/modules/analytics/service";
import { classify, shapeOf } from "@/modules/analytics/classify";
import {
  ANALYTICS_BOOTSTRAP_HEADER,
  ANALYTICS_CONSENT_COOKIE,
  ANON_HEADER,
  SESSION_HEADER,
  parseAnalyticsConsentState,
} from "@/modules/analytics/visitor";
import { analyticsCollectionAllowed } from "@/modules/analytics/settings";
import { currentAnalyticsSettings } from "@/modules/analytics/read";

export async function recordPageView(
  path: string,
  locale: string,
  query: Record<string, string | string[] | undefined> = {},
): Promise<void> {
  try {
    const [requestHeaders, cookieJar, settings] = await Promise.all([
      headers(),
      cookies(),
      currentAnalyticsSettings(),
    ]);
    const consent = parseAnalyticsConsentState(
      cookieJar.get(ANALYTICS_CONSENT_COOKIE)?.value,
    );
    if (!analyticsCollectionAllowed(settings.consentPolicy, consent)) return;
    const bootstrap = requestHeaders.get(ANALYTICS_BOOTSTRAP_HEADER);
    const anonId = requestHeaders.get(ANON_HEADER) ?? bootstrap;
    const sessionId = requestHeaders.get(SESSION_HEADER) ?? bootstrap;
    // No identifiers means policy refused collection or the proxy decided
    // this path is not a visit (admin, asset, feed). Nothing to record.
    if (!anonId || !sessionId) return;

    // Next prefetches links on hover. Counting those would report visits to
    // pages nobody opened — and unlike a crawler, a prefetch is not traffic
    // anybody would ever want to see, so it is dropped rather than recorded.
    if (requestHeaders.get("next-router-prefetch") === "1") return;

    // Crawlers are *recorded*, not dropped. An owner asking "how many people
    // visited" gets people by default, and an owner asking "is something
    // hammering my site" gets an answer at all — which is impossible if the
    // platform threw the rows away when it made the call.
    const verdict = classify(shapeOf(requestHeaders));

    await track.call(
      {
        anonId,
        sessionId,
        name: "page.viewed",
        path,
        referrer: requestHeaders.get("referer"),
        locale,
        props: {},
        visitorKind: verdict.kind,
        botReasons: verdict.reasons,
        campaign: campaignFromQuery(query),
      },
      { kind: "anonymous" },
    );
  } catch (error) {
    // A page must never fail to render because a counter did. This is the one
    // place in the codebase where swallowing is right: the visitor came to
    // read something, and analytics is the platform's interest, not theirs.
    console.warn("[analytics] page view not recorded", error);
  }
}
