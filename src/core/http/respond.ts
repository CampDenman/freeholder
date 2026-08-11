// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The one translation from a ServiceError into an HTTP status. Doing this once,
// here, is what stops each route inventing its own status codes and its own
// idea of how much to tell the caller.
import { ServiceError, type Actor } from "@/core/service";

const STATUS: Record<ServiceError["code"], number> = {
  validation: 400,
  permission: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  step_up_required: 403,
};

export interface ResponseParts {
  headers?: Record<string, string>;
  /**
   * Set-Cookie is the one header that legitimately repeats, and a plain record
   * cannot express that — signing in sets both the session and CSRF cookies.
   */
  cookies?: string[];
}

export function json(
  body: unknown,
  status = 200,
  parts: ResponseParts = {},
): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    ...parts.headers,
  });
  for (const cookie of parts.cookies ?? []) {
    headers.append("set-cookie", cookie);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * ServiceError messages are written for the caller and are safe to return —
 * they say what was wrong with the request, never how the system works.
 * Anything else is a bug, and a bug's message can contain a connection string
 * or a query, so it is logged and answered with a flat 500.
 *
 * A refused permission answers 401 for an anonymous caller and 403 for a
 * signed-in one: the first means "log in", the second means "logging in as
 * someone else would not help", and conflating them makes both confusing.
 */
export function errorResponse(error: unknown, actor: Actor): Response {
  if (error instanceof ServiceError) {
    const status =
      error.code === "permission" && actor.kind === "anonymous"
        ? 401
        : STATUS[error.code];
    // Retry-After turns "try later" into a number the caller can act on —
    // clients and well-behaved crawlers both honour it, and a person staring
    // at a login form deserves to be told how long rather than guessing.
    const headers = error.retryAfterSeconds
      ? { "retry-after": String(error.retryAfterSeconds) }
      : undefined;
    return json(
      { error: { code: error.code, message: error.message } },
      status,
      { headers },
    );
  }
  console.error("unhandled error in a route handler", error);
  return json(
    { error: { code: "internal", message: "Something went wrong." } },
    500,
  );
}
