// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Consented Core Web Vitals collector (MASTER.md C1.18).
import type { NextRequest } from "next/server";
import { errorResponse } from "@/core/http/respond";
import { recordWebVital } from "@/modules/analytics/service";
import { currentAnalyticsSettings } from "@/modules/analytics/read";
import { analyticsCollectionAllowed } from "@/modules/analytics/settings";
import {
  ANALYTICS_CONSENT_COOKIE,
  ANON_COOKIE,
  SESSION_COOKIE_NAME,
  parseAnalyticsConsentState,
} from "@/modules/analytics/visitor";
import { readBoundedText, RequestBodyError } from "@/core/http/body";

const ANONYMOUS = { kind: "anonymous" } as const;

export async function POST(request: NextRequest): Promise<Response> {
  let rawBody: string;
  try {
    rawBody = await readBoundedText(request, 8_192);
  } catch (error) {
    const status = error instanceof RequestBodyError ? error.status : 400;
    return Response.json({ error: "Metric payload could not be read." }, { status });
  }
  const settings = await currentAnalyticsSettings();
  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // Invalid public telemetry is deliberately ignored below.
  }
  const consent = parseAnalyticsConsentState(
    request.cookies.get(ANALYTICS_CONSENT_COOKIE)?.value,
  );
  const anonId = request.cookies.get(ANON_COOKIE)?.value;
  const sessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (
    !analyticsCollectionAllowed(settings.consentPolicy, consent) ||
    !anonId ||
    !sessionId ||
    !body
  ) {
    return new Response(null, { status: 204 });
  }

  try {
    const result = await recordWebVital.call(
      { ...body, anonId, sessionId },
      ANONYMOUS,
    );
    return Response.json(result, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, ANONYMOUS);
  }
}
