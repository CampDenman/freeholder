// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Signed-in OAuth return for a connected Google/Microsoft mailbox (C4.18).
//
// Its own route for the reason calendars have one: the redirect URI is part of
// what a provider code is bound to, so a code issued to read somebody's mail
// cannot be redeemed as permission to send as them.
import { actorFromRequest } from "@/core/http/actor";
import { env } from "@/core/env";
import {
  completeMailReadOAuth,
  peekMailReadOAuthReturn,
} from "@/core/connections/mail-read-oauth";
import { ServiceError, type Actor } from "@/core/service";

export const dynamic = "force-dynamic";
const ADMIN_RETURN = /^\/admin(?:\/|$)/;
const FALLBACK = "/admin/inbox";

function redirect(path: string): Response {
  const target = new URL(path, env().APP_URL);
  // Keep OAuth codes and state out of history, caches and Referer headers.
  return new Response(null, {
    status: 303,
    headers: {
      location: target.toString(),
      "cache-control": "no-store, max-age=0",
      "referrer-policy": "no-referrer",
    },
  });
}

function flagged(path: string, reason: string): Response {
  const target = new URL(path, env().APP_URL);
  if (!ADMIN_RETURN.test(`${target.pathname}${target.search}`)) {
    return redirect(`${FALLBACK}?mailbox=oauth_failed`);
  }
  target.searchParams.set("mailbox", reason);
  return redirect(`${target.pathname}${target.search}`);
}

async function failurePath(
  actor: Actor | null,
  provider: string,
  state: string | null,
): Promise<string> {
  if (
    !actor ||
    actor.kind !== "user" ||
    (provider !== "google" && provider !== "microsoft") ||
    !state ||
    state.length < 30
  ) {
    return FALLBACK;
  }
  try {
    const peeked = await peekMailReadOAuthReturn.call({ provider, state }, actor);
    if (peeked.returnTo && ADMIN_RETURN.test(peeked.returnTo)) {
      return peeked.returnTo;
    }
  } catch {
    // The attempt is over; a missing state still returns to the inbox.
  }
  return FALLBACK;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await context.params;
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  if (provider !== "google" && provider !== "microsoft") {
    return flagged(FALLBACK, "oauth_invalid_provider");
  }
  let actor: Awaited<ReturnType<typeof actorFromRequest>>;
  try {
    actor = await actorFromRequest(request);
  } catch {
    console.error("mailbox OAuth callback could not resolve the signed-in actor");
    return flagged(FALLBACK, "oauth_failed");
  }
  if (actor.kind !== "user") {
    return redirect("/login?returnTo=%2Fadmin%2Finbox");
  }
  if (url.searchParams.has("error")) {
    return flagged(await failurePath(actor, provider, state), "oauth_cancelled");
  }
  const code = url.searchParams.get("code");
  if (!state || !code) {
    return flagged(await failurePath(actor, provider, state), "oauth_incomplete");
  }
  try {
    const result = await completeMailReadOAuth.call({ provider, state, code }, actor);
    if (!ADMIN_RETURN.test(result.returnTo)) {
      console.error("mailbox OAuth callback received an unsafe stored return path");
      return flagged(FALLBACK, "oauth_failed");
    }
    return flagged(result.returnTo, "connected");
  } catch (error) {
    if (error instanceof ServiceError) {
      const reason =
        error.code === "conflict"
          ? "oauth_conflict"
          : error.code === "permission"
            ? "oauth_denied"
            : "oauth_failed";
      return flagged(await failurePath(actor, provider, state), reason);
    }
    console.error("mailbox OAuth callback failed", error);
    return flagged(await failurePath(actor, provider, state), "oauth_failed");
  }
}
