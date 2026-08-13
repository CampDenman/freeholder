// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { csrfCookie, issueCsrfToken } from "@/core/http/csrf";
import { registerOwner } from "@/core/auth/service";
import { sessionCookie } from "@/core/http/cookies";
import { serviceRoute } from "@/core/http/route";

// First boot (§13 step 1). Public by necessity and once-only by database
// constraint, not by this route being hard to find.
export const POST = serviceRoute(registerOwner, {
  present: ({ userId, token, expiresAt }) => ({
    status: 201,
    body: { userId },
    cookies: [
      sessionCookie(token, expiresAt),
      csrfCookie(issueCsrfToken(), expiresAt),
    ],
  }),
});
