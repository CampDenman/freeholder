// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
import { csrfCookie, issueCsrfToken } from "@/core/http/csrf";
import { login } from "@/core/auth/service";
import { loginChallengeCookie, sessionCookie } from "@/core/http/cookies";
import { serviceRoute } from "@/core/http/route";

// The session token leaves in an HttpOnly cookie and is stripped from the
// body; the CSRF token leaves in a readable one, because the client has to
// echo it back in a header. They expire together.
export const POST = serviceRoute(login, {
  present: (result) =>
    result.twoFactorRequired
      ? {
          body: {
            userId: result.userId,
            role: result.role,
            twoFactorRequired: true,
            methods: result.methods,
            webauthnOptions: result.webauthnOptions,
          },
          cookies: [loginChallengeCookie(result.challengeToken)],
        }
      : {
          body: { userId: result.userId, role: result.role, twoFactorRequired: false },
          cookies: [
            sessionCookie(result.token, result.expiresAt),
            csrfCookie(issueCsrfToken(), result.expiresAt),
          ],
        },
});
