// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Signed-in OAuth return for a social profile (C9.24).
import { actorFromRequest } from "@/core/http/actor";
import { env } from "@/core/env";
import { completeOAuth } from "@/modules/social/service";
import { ServiceError } from "@/core/service";

export const dynamic = "force-dynamic";
const ADMIN_RETURN = /^\/admin(?:\/|$)/;

function redirect(path: string): Response {
  const target = new URL(path, env().APP_URL);
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
  let actor: Awaited<ReturnType<typeof actorFromRequest>>;
  try {
    actor = await actorFromRequest(request);
  } catch {
    console.error("social OAuth callback could not resolve the signed-in actor");
    return redirect("/admin/social?social=oauth_failed");
  }
  if (actor.kind !== "user") {
    return redirect("/login?returnTo=%2Fadmin%2Fsocial");
  }
  const url = new URL(request.url);
  if (url.searchParams.has("error")) {
    return redirect("/admin/social?social=oauth_cancelled");
  }
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code) {
    return redirect("/admin/social?social=oauth_incomplete");
  }
  try {
    const result = await completeOAuth.call({ provider, state, code }, actor);
    if (!ADMIN_RETURN.test(result.returnTo)) {
      console.error("social OAuth callback received an unsafe stored return path");
      return redirect("/admin/social?social=oauth_failed");
    }
    const target = new URL(result.returnTo, env().APP_URL);
    target.searchParams.set("social", "connected");
    return redirect(`${target.pathname}${target.search}`);
  } catch (error) {
    if (error instanceof ServiceError) {
      const reason =
        error.code === "conflict"
          ? "oauth_conflict"
          : error.code === "permission"
            ? "oauth_denied"
            : "oauth_failed";
      return redirect(`/admin/social?social=${reason}`);
    }
    console.error("social OAuth callback failed", error);
    return redirect("/admin/social?social=oauth_failed");
  }
}
