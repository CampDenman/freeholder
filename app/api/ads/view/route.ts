// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// First-party ad beacon (MASTER.md §4.16, C9.19).
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { recordBeacon } from "@/modules/ads/service";
import { currentAnalyticsSettings } from "@/modules/analytics/read";
import { analyticsCollectionAllowed } from "@/modules/analytics/settings";
import {
  ANALYTICS_CONSENT_COOKIE,
  ANON_COOKIE,
  SESSION_COOKIE_NAME,
  parseAnalyticsConsentState,
} from "@/modules/analytics/visitor";
import { readBoundedText, RequestBodyError } from "@/core/http/body";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = JSON.parse(await readBoundedText(request, 16_384)) as unknown;
  } catch (error) {
    const status = error instanceof RequestBodyError ? error.status : 400;
    return NextResponse.json({ counted: false }, { status });
  }
  const bag = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const kind = bag.kind === "viewable" || bag.kind === "impression" ? bag.kind : null;
  const creativeId = typeof bag.creativeId === "string" ? bag.creativeId : null;
  const slotId = typeof bag.slotId === "string" ? bag.slotId : null;
  if (!kind || !creativeId || !slotId) {
    return NextResponse.json({ counted: false }, { status: 400 });
  }

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
    // Uncounted is the honest answer when identifiers are unavailable.
  }

  const path = typeof bag.path === "string" ? bag.path : "/";
  const result = await recordBeacon.call(
    { kind, creativeId, slotId, anonId: anonId ?? null, sessionId: sessionId ?? null, path },
    ANONYMOUS,
  );
  return NextResponse.json(result);
}
