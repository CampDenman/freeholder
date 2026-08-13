// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
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

const ANONYMOUS = { kind: "anonymous" } as const;

export async function POST(request: NextRequest): Promise<Response> {
  if (Number(request.headers.get("content-length") ?? 0) > 8_192) {
    return Response.json({ error: "Metric payload is too large." }, { status: 413 });
  }
  const [settings, rawBody] = await Promise.all([
    currentAnalyticsSettings(),
    request.text().catch(() => ""),
  ]);
  if (new TextEncoder().encode(rawBody).byteLength > 8_192) {
    return Response.json({ error: "Metric payload is too large." }, { status: 413 });
  }
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
