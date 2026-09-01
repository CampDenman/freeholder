// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The browser's one door to the front-site assistant (C9.21, MASTER.md §31).
//
// Deliberately a second endpoint rather than something bolted onto POST
// /api/chat. Posting a message and answering it are different transactions
// with different costs: the visitor's message must land in the shared inbox
// immediately whatever the model does, and an assistant that is off, over
// budget or unreachable must not be able to slow down or fail the act of
// saying something to a business.
//
// The chat bearer comes from the cookie, never the body — the same rule
// /api/chat follows, for the same reason: a token accepted from a caller is a
// token any caller can supply.
import { env } from "@/core/env";
import { readCookie } from "@/core/http/cookies";
import { json } from "@/core/http/respond";
import { serviceRoute } from "@/core/http/route";
import { SITE_CHAT_COOKIE } from "@/core/messaging/chat-cookie";
import { answer } from "@/modules/assistant/service";
import { ServiceError } from "@/core/service";

export const dynamic = "force-dynamic";

function browserToken(request: Request): string {
  const token = readCookie(request, SITE_CHAT_COOKIE);
  if (!token) throw new ServiceError("not_found", "There is no active chat in this browser.");
  return token;
}

function sameOrigin(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return new Set([new URL(request.url).origin, new URL(env().APP_URL).origin]).has(origin);
}

const ask = serviceRoute(answer, {
  readInput: (request) => ({ token: browserToken(request) }),
  present: (result) => ({
    body: result,
    headers: { "cache-control": "private, no-store" },
  }),
});

export function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) {
    return Promise.resolve(json({ error: "Cross-site chat refused." }, 403));
  }
  return ask(request);
}
