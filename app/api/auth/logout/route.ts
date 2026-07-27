// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
import { clearedCsrfCookie } from "@/core/http/csrf";
import { logout } from "@/core/auth/service";
import { clearedSessionCookie, readSessionToken } from "@/core/http/cookies";
import { serviceRoute } from "@/core/http/route";

// The token is taken from the cookie, never the body — a caller must not be
// able to name someone else's session, and holding the cookie is the proof.
// Signing out needs a CSRF token like any other state change: forcing somebody
// out of their session is a real nuisance attack.
export const POST = serviceRoute(logout, {
  readInput: (request) => ({ token: readSessionToken(request) ?? "" }),
  present: () => ({
    body: { ok: true },
    cookies: [clearedSessionCookie(), clearedCsrfCookie()],
  }),
});
