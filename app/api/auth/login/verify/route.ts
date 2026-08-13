// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Finish the two-phase browser/API login. The challenge is accepted only from
// its HttpOnly cookie, never from caller-controlled JSON.
import {
  LOGIN_CHALLENGE_COOKIE,
  completeTwoFactorLogin,
  completeWebAuthnLogin,
} from "@/core/auth/two-factor";
import {
  clearedLoginChallengeCookie,
  loginChallengeCookie,
  readCookie,
  sessionCookie,
} from "@/core/http/cookies";
import { csrfCookie, issueCsrfToken } from "@/core/http/csrf";
import { errorResponse, json } from "@/core/http/respond";
import { ServiceError, type Actor } from "@/core/service";

const ANONYMOUS: Actor = { kind: "anonymous" };

export async function POST(request: Request): Promise<Response> {
  const challengeToken = readCookie(request, LOGIN_CHALLENGE_COOKIE);
  if (!challengeToken) {
    return errorResponse(
      new ServiceError("permission", "That sign-in attempt expired. Start again."),
      ANONYMOUS,
    );
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // The service validator supplies the ordinary validation response.
  }
  try {
    const result = body.credentialResponse
      ? await completeWebAuthnLogin.call(
          { challengeToken, credentialResponse: body.credentialResponse },
          ANONYMOUS,
        )
      : await completeTwoFactorLogin.call(
          { challengeToken, code: body.code },
          ANONYMOUS,
        );
    return json(
      { userId: result.userId, method: result.method },
      200,
      {
        cookies: [
          sessionCookie(result.token, result.expiresAt),
          csrfCookie(issueCsrfToken(), result.expiresAt),
          clearedLoginChallengeCookie(),
        ],
      },
    );
  } catch (error) {
    const response = errorResponse(error, ANONYMOUS);
    // Keep the challenge cookie on an ordinary bad code so the caller can
    // correct a typo. Its own ten-minute expiry is still the hard bound.
    response.headers.append("set-cookie", loginChallengeCookie(challengeToken));
    return response;
  }
}
