// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Signed-in OAuth return for a connected Google/Microsoft mailbox (C4.18).
//
// Its own route for the reason calendars have one: the redirect URI is part of
// what a provider code is bound to, so a code issued to read somebody's mail
// cannot be redeemed as permission to send as them.
import { actorFromRequest } from "@/core/http/actor";
import { env } from "@/core/env";
import { completeMailReadOAuth } from "@/core/connections/mail-read-oauth";
import { ServiceError } from "@/core/service";

export const dynamic = "force-dynamic";
const ADMIN_RETURN = /^\/admin(?:\/|$)/;

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

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await context.params;
  if (provider !== "google" && provider !== "microsoft") {
    return redirect("/admin/settings?mailbox=oauth_invalid_provider");
  }
  let actor: Awaited<ReturnType<typeof actorFromRequest>>;
  try {
    actor = await actorFromRequest(request);
  } catch {
    console.error("mailbox OAuth callback could not resolve the signed-in actor");
    return redirect("/admin/settings?mailbox=oauth_failed");
  }
  if (actor.kind !== "user") {
    return redirect("/login?returnTo=%2Fadmin%2Fsettings");
  }
  const url = new URL(request.url);
  if (url.searchParams.has("error")) {
    return redirect("/admin/settings?mailbox=oauth_cancelled");
  }
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code) {
    return redirect("/admin/settings?mailbox=oauth_incomplete");
  }
  try {
    const result = await completeMailReadOAuth.call({ provider, state, code }, actor);
    if (!ADMIN_RETURN.test(result.returnTo)) {
      console.error("mailbox OAuth callback received an unsafe stored return path");
      return redirect("/admin/settings?mailbox=oauth_failed");
    }
    const target = new URL(result.returnTo, env().APP_URL);
    target.searchParams.set("mailbox", "connected");
    return redirect(`${target.pathname}${target.search}`);
  } catch (error) {
    if (error instanceof ServiceError) {
      const reason =
        error.code === "conflict"
          ? "oauth_conflict"
          : error.code === "permission"
            ? "oauth_denied"
            : "oauth_failed";
      return redirect(`/admin/settings?mailbox=${reason}`);
    }
    console.error("mailbox OAuth callback failed", error);
    return redirect("/admin/settings?mailbox=oauth_failed");
  }
}
