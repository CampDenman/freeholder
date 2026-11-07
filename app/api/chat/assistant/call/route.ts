// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { readCookie } from "@/core/http/cookies";
import { readBoundedText } from "@/core/http/body";
import { serviceRoute } from "@/core/http/route";
import { SITE_CHAT_COOKIE } from "@/core/messaging/chat-cookie";
import { ServiceError } from "@/core/service";
import { previewCall } from "@/modules/assistant/service";
import { env } from "@/core/env";
import { json } from "@/core/http/respond";

export const dynamic = "force-dynamic";
const control = serviceRoute(previewCall, {
  readInput: async (request) => {
    const token = readCookie(request, SITE_CHAT_COOKIE);
    if (!token) throw new ServiceError("not_found", "There is no active chat in this browser.");
    const raw = await readBoundedText(request, 12288);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new ServiceError("validation", "Invalid call request."); }
    if (!body || typeof body !== "object" || Array.isArray(body) || "token" in body) {
      throw new ServiceError("validation", "Invalid call request.");
    }
    return { ...body, token };
  },
  present: (body) => ({ body, headers: { "cache-control": "private, no-store" } }),
});

export function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site"
      || (origin && ![new URL(request.url).origin, new URL(env().APP_URL).origin].includes(origin))) {
    return Promise.resolve(json({ error: "Cross-site chat refused." }, 403));
  }
  return control(request);
}
