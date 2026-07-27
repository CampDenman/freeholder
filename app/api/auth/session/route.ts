// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
import { resolveSession } from "@/core/http/actor";
import {
  clearedSessionCookie,
  readSessionToken,
  sessionCookie,
} from "@/core/http/cookies";
import { json } from "@/core/http/respond";

/**
 * Who am I? Answers 200 with `user: null` rather than 401 — "nobody is signed
 * in" is a normal answer to this question, and the client uses it to decide
 * what to render, not whether to retry.
 */
export async function GET(request: Request): Promise<Response> {
  const token = readSessionToken(request);
  const session = token ? await resolveSession(request) : undefined;

  if (!token) return json({ user: null });
  if (!session) {
    // The cookie names a session that has expired or been revoked. Clearing it
    // stops the browser presenting a dead token on every subsequent request.
    return json({ user: null }, 200, {
      "set-cookie": clearedSessionCookie(),
    });
  }

  // Sessions slide: validating past the half-life extends the row in the
  // database. Re-issuing the cookie keeps the browser's copy from expiring
  // first, which would log a working session out.
  return json(
    {
      user: {
        userId: session.userId,
        email: session.email,
        role: session.role,
      },
    },
    200,
    { "set-cookie": sessionCookie(token, session.expiresAt) },
  );
}
