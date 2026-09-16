// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Signed-in return for C7.16's read-only Google/Microsoft contact grant.
import { completeSignupContactsOAuth } from "@/core/import/signup-contact-service";
import { actorFromRequest } from "@/core/http/actor";
import { env } from "@/core/env";
import { ServiceError } from "@/core/service";

export const dynamic = "force-dynamic";

function redirect(path: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location: new URL(path, env().APP_URL).toString(),
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
    return redirect("/portal/contact-import?oauth=invalid_provider");
  }
  let actor: Awaited<ReturnType<typeof actorFromRequest>>;
  try {
    actor = await actorFromRequest(request);
  } catch {
    return redirect("/portal/login");
  }
  if (actor.kind !== "user") return redirect("/portal/login");
  const url = new URL(request.url);
  if (url.searchParams.has("error")) {
    return redirect("/portal/contact-import?oauth=cancelled");
  }
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code) return redirect("/portal/contact-import?oauth=incomplete");
  try {
    const connected = await completeSignupContactsOAuth.call(
      { provider, state, code },
      actor,
    );
    return redirect(
      `/portal/contact-import?oauth=connected&account=${encodeURIComponent(connected.connectedAccountId)}`,
    );
  } catch (error) {
    if (!(error instanceof ServiceError)) {
      console.error("signup contacts OAuth callback failed", error);
    }
    return redirect("/portal/contact-import?oauth=failed");
  }
}
