// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Signed-in OAuth return for delegated Gmail/Microsoft transactional senders.
import { actorFromRequest } from "@/core/http/actor";
import { env } from "@/core/env";
import { completeMailOAuth } from "@/core/mail/oauth";
import { ServiceError } from "@/core/service";

export const dynamic = "force-dynamic";
const ADMIN_RETURN = /^\/admin(?:\/|$)/;

function redirect(path: string): Response {
  const base = env().APP_URL;
  const target = new URL(path, base);
  // Every target is constructed from a fixed path or from the service's
  // `/admin`-only state. Keep OAuth codes and state out of browser history,
  // caches and subsequent Referer headers.
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
  const { provider: rawProvider } = await context.params;
  if (rawProvider !== "google" && rawProvider !== "microsoft") {
    return redirect("/admin/settings?mail=oauth_invalid_provider");
  }
  let actor: Awaited<ReturnType<typeof actorFromRequest>>;
  try {
    actor = await actorFromRequest(request);
  } catch {
    console.error("mail OAuth callback could not resolve the signed-in actor");
    return redirect("/admin/settings?mail=oauth_failed");
  }
  if (actor.kind !== "user") {
    return redirect("/login?returnTo=%2Fadmin%2Fsettings");
  }
  const url = new URL(request.url);
  if (url.searchParams.has("error")) {
    return redirect("/admin/settings?mail=oauth_cancelled");
  }
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code) {
    return redirect("/admin/settings?mail=oauth_incomplete");
  }
  try {
    const result = await completeMailOAuth.call(
      { provider: rawProvider, state, code },
      actor,
    );
    if (!ADMIN_RETURN.test(result.returnTo)) {
      console.error("mail OAuth callback received an unsafe stored return path");
      return redirect("/admin/settings?mail=oauth_failed");
    }
    const target = new URL(result.returnTo, env().APP_URL);
    target.searchParams.set("mail", "connected");
    return redirect(`${target.pathname}${target.search}`);
  } catch (error) {
    if (error instanceof ServiceError) {
      const reason =
        error.code === "conflict"
          ? "oauth_conflict"
          : error.code === "permission"
            ? "oauth_expired"
            : "oauth_failed";
      return redirect(`/admin/settings?mail=${reason}`);
    }
    console.error("mail OAuth callback failed", error);
    return redirect("/admin/settings?mail=oauth_failed");
  }
}
