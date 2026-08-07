// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// CSRF defence by double-submit token.
//
// The rule this implements: a forged request is only dangerous when the
// browser attaches credentials to it automatically. So the check applies to
// unsafe methods *when a session cookie is present*, and nowhere else. Login
// and first-boot carry no session yet, so they need no token — there is
// nothing to ride. Everything after sign-in does, logout included, because
// forcing somebody out is a real (if minor) attack.
//
// The token lives in a readable cookie and must be echoed in a header. A
// cross-site attacker can cause the cookie to be *sent* but cannot read it to
// copy it into a header, which is exactly the asymmetry this relies on.
// SameSite=Lax already blocks most of this; the token is what remains standing
// if a browser is old, a subdomain is hostile, or the request is a top-level
// form POST that Lax permits.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/core/env";
import { readCookie, readSessionToken } from "@/core/http/cookies";
import { ServiceError } from "@/core/service";

export const CSRF_COOKIE = "freeholder_csrf";
export const CSRF_HEADER = "x-csrf-token";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function issueCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Deliberately readable by scripts — unlike the session cookie. The client has
 * to copy this value into a header, so hiding it would defeat the mechanism.
 * It is not a credential: on its own it grants nothing.
 */
export function csrfCookie(token: string, expiresAt: Date): string {
  const attributes = [
    `${CSRF_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (env().NODE_ENV === "production") attributes.push("Secure");
  return attributes.join("; ");
}

export function clearedCsrfCookie(): string {
  const attributes = [`${CSRF_COOKIE}=`, "Path=/", "SameSite=Lax", "Max-Age=0"];
  if (env().NODE_ENV === "production") attributes.push("Secure");
  return attributes.join("; ");
}

export function readCsrfCookie(request: Request): string | undefined {
  return readCookie(request, CSRF_COOKIE);
}

function matches(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch, and the lengths themselves
  // are not secret, so compare them first.
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

/**
 * Throws unless this request is safe to act on. Called by serviceRoute before
 * the service runs, so no handler has to remember.
 */
export function requireCsrf(request: Request): void {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;
  // A bearer token is not an ambient credential: a browser never attaches one
  // by itself, so a forged request cannot carry it. The check is skipped even
  // when a session cookie is also present, because in that case the cookie is
  // not what authorized the call — actorFromRequest gives the key precedence,
  // and judging the request on a credential it is not using would refuse a
  // legitimate script for running in a tab that happens to be signed in.
  const authorization = request.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) return;

  // No ambient credential means no cross-site request forgery to defend
  // against: an attacker forging this would simply be an anonymous caller.
  if (!readSessionToken(request)) return;

  const cookie = readCsrfCookie(request);
  const header = request.headers.get(CSRF_HEADER);
  if (!cookie || !header || !matches(cookie, header)) {
    throw new ServiceError(
      "permission",
      `This request is missing a valid ${CSRF_HEADER}. Read the ${CSRF_COOKIE} cookie and send its value in that header.`,
    );
  }
}
