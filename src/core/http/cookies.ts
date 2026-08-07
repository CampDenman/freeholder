// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Cookie plumbing, written against the web platform rather than a framework so
// the §10 rule holds: src/ is the application, app/ is the routing skin.
//
// The session token lives in an HttpOnly cookie and nowhere else. It is never
// returned in a response body, because a body is readable by any script on the
// page and a stolen session token is a full account takeover.
import { env } from "@/core/env";
import { SESSION_COOKIE } from "@/core/auth/sessions";

export function readCookie(
  request: Request,
  name: string,
): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return undefined;
}

export function readSessionToken(request: Request): string | undefined {
  return readCookie(request, SESSION_COOKIE);
}

/**
 * SameSite=Lax rather than Strict: a customer following a magic link or a
 * quote link from their email arrives by top-level navigation, and Strict
 * would drop the cookie and log them straight back out. Lax still withholds
 * it from cross-site subrequests, which is what CSRF actually needs.
 */
export function sessionCookie(token: string, expiresAt: Date): string {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
  ];
  // Dev runs on http://localhost, where Secure would make the cookie unusable.
  if (env().NODE_ENV === "production") attributes.push("Secure");
  return attributes.join("; ");
}

export function clearedSessionCookie(): string {
  const attributes = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (env().NODE_ENV === "production") attributes.push("Secure");
  return attributes.join("; ");
}
