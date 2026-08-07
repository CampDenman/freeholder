// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Recording a page view (MASTER.md §4.7, §36).
//
// Server-side, during the render, from identifiers the proxy minted. That has
// three consequences worth stating, because they are the reason for doing it
// this way rather than with a script:
//
//   - Nothing to block. An ad blocker cannot remove a number the server
//     already wrote, so the traffic chart describes the traffic.
//   - Nothing to load. No client bundle, no third-party host, no hydration —
//     which keeps the promise §5 and the SEO gate rest on.
//   - It works with JavaScript off.
//
// The cost is that this runs inside the request. One insert against a local
// Postgres is not worth batching yet; when core/jobs lands it becomes an
// obvious candidate, and that is written down rather than assumed.
import { headers } from "next/headers";
import { track } from "@/modules/analytics/service";
import { classify, shapeOf } from "@/modules/analytics/classify";
import { ANON_HEADER, SESSION_HEADER } from "@/modules/analytics/visitor";

export async function recordPageView(
  path: string,
  locale: string,
): Promise<void> {
  try {
    const requestHeaders = await headers();
    const anonId = requestHeaders.get(ANON_HEADER);
    const sessionId = requestHeaders.get(SESSION_HEADER);
    // No identifiers means the proxy decided this path is not a visit — the
    // admin, an asset, a feed. Nothing to record.
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
