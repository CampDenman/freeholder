// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What a visitor did with a popup, and what they gave it (C9.30).
//
// One endpoint for three events, because they share the part that matters: all
// three read the visitor's cookies here, on the server, and none of them takes
// an identity from the client. A popup surface that could name its own visitor
// key could name somebody else's, and the only thing keeping that honest is
// that the browser never gets to say.
//
// The impression is recorded from here rather than from the render, and that
// is the difference between a cap that counts what happened and one that
// counts what was planned. An exit-intent popup that never fires was never
// shown; charging it against the visitor's three-a-week would mean the popup
// that did not appear is the reason the next one does not either.
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/core/env";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { ANON_COOKIE } from "@/modules/analytics/visitor";
import {
  POPUP_TALLY_COOKIE,
  POPUP_TALLY_MAX_AGE,
} from "@/modules/popups/tally";
import { capturePopup, recordPopupEvent } from "@/modules/popups/service";

const MAX_BODY = 8_192;

function refuse(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // A cross-site page has no legitimate reason to record an impression on
  // somebody else's popup, or to post an address to it. Same guard, same
  // reasoning, as the analytics consent endpoint.
  const fetchSite = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  const allowed = new Set([request.nextUrl.origin, new URL(env().APP_URL).origin]);
  if (fetchSite === "cross-site" || (origin !== null && !allowed.has(origin))) {
    return refuse("Cross-site popup events are refused.", 403);
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) {
    return refuse("That payload is too large.", 413);
  }

  const raw = await request.text().catch(() => "");
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY) {
    return refuse("That payload is too large.", 413);
  }
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    return refuse("That request could not be read.", 400);
  }

  const popupId = typeof body.popupId === "string" ? body.popupId : "";
  // Only a path on this site. It is stored on the event and becomes the
  // `source_url` on a consent record, and evidence saying somebody agreed on
  // https://somewhere.else is evidence that misleads.
  const path =
    typeof body.path === "string" && body.path.startsWith("/")
      ? body.path.slice(0, 2048)
      : null;
  const event = body.event;

  // Read here, never accepted from the caller.
  const visitorKey = request.cookies.get(ANON_COOKIE)?.value ?? null;
  const tally = request.cookies.get(POPUP_TALLY_COOKIE)?.value ?? null;
  const actor = await actorFromToken(request.cookies.get(SESSION_COOKIE)?.value);

  try {
    if (event === "shown" || event === "dismissed") {
      const result = await recordPopupEvent.call(
        { popupId, kind: event, path, visitorKey, tally },
        actor,
      );
      return withTally(NextResponse.json({ ok: true }), request, result.tally);
    }
    if (event === "capture") {
      const result = await capturePopup.call(
        {
          popupId,
          email: typeof body.email === "string" ? body.email : "",
          consent: body.consent === true,
          path,
          visitorKey,
          tally,
        },
        actor,
      );
      return withTally(
        NextResponse.json({ ok: true, message: result.message, pending: result.pending }),
        request,
        result.tally,
      );
    }
  } catch (error) {
    if (error instanceof ServiceError) {
      const status =
        error.code === "rate_limited"
          ? 429
          : error.code === "not_found"
            ? 404
            : error.code === "validation"
              ? 400
              : 403;
      return refuse(error.message, status);
    }
    throw error;
  }
  return refuse("Say which popup event this is.", 400);
}

/**
 * Hand the visitor back their own tally.
 *
 * `httpOnly` because nothing in the browser needs to read it — the decision is
 * made on the server on the next request — and a value script cannot touch is
 * a value that cannot be scraped by anything else on the page. `lax` because
 * this is only ever set on a same-site request.
 */
function withTally(
  response: NextResponse,
  request: NextRequest,
  value: string,
): NextResponse {
  response.cookies.set(POPUP_TALLY_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: POPUP_TALLY_MAX_AGE,
  });
  return response;
}
