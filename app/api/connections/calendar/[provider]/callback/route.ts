// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Signed-in OAuth return for connected Google/Microsoft calendars (C4.11).
//
// A separate route from mail's on purpose: the redirect URI is part of what a
// provider code is bound to, so a code issued for calendars cannot be
// redeemed by the mail flow even if somebody replays it there.
import { actorFromRequest } from "@/core/http/actor";
import { env } from "@/core/env";
import { completeCalendarOAuth } from "@/core/connections/calendar-oauth";
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
    return redirect("/admin/settings?calendar=oauth_invalid_provider");
  }
  let actor: Awaited<ReturnType<typeof actorFromRequest>>;
  try {
    actor = await actorFromRequest(request);
  } catch {
    console.error("calendar OAuth callback could not resolve the signed-in actor");
    return redirect("/admin/settings?calendar=oauth_failed");
  }
  if (actor.kind !== "user") {
    return redirect("/login?returnTo=%2Fadmin%2Fsettings");
  }
  const url = new URL(request.url);
  if (url.searchParams.has("error")) {
    return redirect("/admin/settings?calendar=oauth_cancelled");
  }
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code) {
    return redirect("/admin/settings?calendar=oauth_incomplete");
  }
  try {
    const result = await completeCalendarOAuth.call({ provider, state, code }, actor);
    if (!ADMIN_RETURN.test(result.returnTo)) {
      console.error("calendar OAuth callback received an unsafe stored return path");
      return redirect("/admin/settings?calendar=oauth_failed");
    }
    const target = new URL(result.returnTo, env().APP_URL);
    target.searchParams.set("calendar", "connected");
    return redirect(`${target.pathname}${target.search}`);
  } catch (error) {
    if (error instanceof ServiceError) {
      const reason =
        error.code === "conflict"
          ? "oauth_conflict"
          : error.code === "permission"
            ? "oauth_denied"
            : "oauth_failed";
      return redirect(`/admin/settings?calendar=${reason}`);
    }
    console.error("calendar OAuth callback failed", error);
    return redirect("/admin/settings?calendar=oauth_failed");
  }
}
