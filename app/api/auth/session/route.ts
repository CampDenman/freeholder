// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
import { resolveSession } from "@/core/http/actor";
import {
  clearedSessionCookie,
  readSessionToken,
  sessionCookie,
} from "@/core/http/cookies";
import {
  clearedCsrfCookie,
  csrfCookie,
  issueCsrfToken,
  readCsrfCookie,
} from "@/core/http/csrf";
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
    // The cookie names a session that has expired or been revoked. Clearing
    // both stops the browser presenting a dead token on every request.
    return json({ user: null }, 200, {
      cookies: [clearedSessionCookie(), clearedCsrfCookie()],
    });
  }

  // Sessions slide: validating past the half-life extends the row in the
  // database. Re-issuing the cookie keeps the browser's copy from expiring
  // first, which would log a working session out.
  const cookies = [sessionCookie(token, session.expiresAt)];

  // Replace a missing CSRF token, but never a present one — rotating it here
  // would invalidate whatever the page already has in flight.
  if (!readCsrfCookie(request)) {
    cookies.push(csrfCookie(issueCsrfToken(), session.expiresAt));
  }

  return json(
    {
      user: {
        userId: session.userId,
        email: session.email,
        role: session.role,
      },
    },
    200,
    { cookies },
  );
}
