// Copyright (C) 2026 Camp Denman Society
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
};

export function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
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
    return json({ error: { code: error.code, message: error.message } }, status);
  }
  console.error("unhandled error in a route handler", error);
  return json(
    { error: { code: "internal", message: "Something went wrong." } },
    500,
  );
}
