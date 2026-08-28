// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Cookie-bound browser transport for the public live-chat services (C7.15).
import { env } from "@/core/env";
import { readCookie } from "@/core/http/cookies";
import { serviceRoute } from "@/core/http/route";
import { json } from "@/core/http/respond";
import {
  clearedSiteChatCookie,
  SITE_CHAT_COOKIE,
} from "@/core/messaging/chat-cookie";
import { endSiteChat, getSiteChat, postSiteChat } from "@/core/messaging/chat";
import { ServiceError } from "@/core/service";

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 16_384;

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

const read = serviceRoute(getSiteChat, {
  readInput: (request) => ({ token: browserToken(request) }),
  present: (result) => ({
    body: result,
    headers: { "cache-control": "private, no-store" },
  }),
});

const post = serviceRoute(postSiteChat, {
  readInput: async (request) => {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_BODY_BYTES) {
      throw new ServiceError("validation", "That chat message is too large.");
    }
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      throw new ServiceError("validation", "That chat message is too large.");
    }
    let message = "";
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && "message" in parsed) {
        const value = (parsed as { message?: unknown }).message;
        message = typeof value === "string" ? value : "";
      }
    } catch {
      // The service's ordinary validation produces the public error shape.
    }
    return { token: browserToken(request), message };
  },
  present: (result) => ({
    body: result,
    headers: { "cache-control": "private, no-store" },
  }),
});

const end = serviceRoute(endSiteChat, {
  readInput: (request) => ({ token: browserToken(request) }),
  present: (result) => ({
    body: result,
    headers: { "cache-control": "private, no-store" },
    cookies: [clearedSiteChatCookie()],
  }),
});

export function GET(request: Request): Promise<Response> {
  return read(request);
}

export function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return Promise.resolve(json({ error: "Cross-site chat refused." }, 403));
  return post(request);
}

export function DELETE(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return Promise.resolve(json({ error: "Cross-site chat refused." }, 403));
  return end(request);
}
