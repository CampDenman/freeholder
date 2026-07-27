// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
import { login } from "@/core/auth/service";
import { sessionCookie } from "@/core/http/cookies";
import { serviceRoute } from "@/core/http/route";

// The token leaves in a Set-Cookie header and is stripped from the body: an
// HttpOnly cookie no script can read is the only place it belongs.
export const POST = serviceRoute(login, {
  present: ({ userId, role, token, expiresAt }) => ({
    body: { userId, role },
    headers: { "set-cookie": sessionCookie(token, expiresAt) },
  }),
});
