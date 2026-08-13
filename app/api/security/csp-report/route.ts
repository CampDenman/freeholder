// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Same-origin CSP report intake. Raw browser metadata is never persisted.
import { consume, rateLimitKey } from "@/core/security/rate-limit";
import { recordCspPayload } from "@/core/security/csp-reports";

const MAX_BYTES = 64 * 1_024;

function empty(status = 204): Response {
  return new Response(null, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) {
    return empty(413);
  }
  const raw = await request.text().catch(() => "");
  if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) return empty(413);
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    // This is an unauthenticated browser endpoint. Malformed input has no
    // diagnostic value and must not be able to turn the application log into
    // a second unbounded report store.
    return empty();
  }

  // Global rather than IP-derived: Freeholder does not store or derive
  // visitor network identity for telemetry, even briefly.
  const verdict = await consume(
    rateLimitKey("security.cspReport", "instance"),
    { limit: 5_000, windowSeconds: 60 },
  );
  if (!verdict.allowed) return empty();

  try {
    await recordCspPayload(payload, new URL(request.url).origin);
  } catch (error) {
    // Browsers retry reports opportunistically. Invalid input or unavailable
    // storage must not become an error page or a retry storm.
    console.warn("[csp] violation report was not recorded", error);
  }
  return empty();
}
