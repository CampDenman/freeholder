// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Turning an HTTP request into an Actor — the one place identity enters the
// system from outside (MASTER.md §11). Nothing downstream reads cookies or
// headers to decide who is calling; they take the Actor this produced.
//
// Resolution goes through the auth.whoami *service*, not straight to the
// sessions table, so session validation and its sliding renewal obey the same
// invariants as every other read.
import { whoami } from "@/core/auth/service";
import type { SessionUser } from "@/core/auth/sessions";
import { readSessionToken } from "@/core/http/cookies";
import type { Actor } from "@/core/service";

const ANONYMOUS: Actor = { kind: "anonymous" };

/** The signed-in user behind this request, if the cookie names a live one. */
export async function resolveSession(
  request: Request,
): Promise<SessionUser | undefined> {
  return sessionFromToken(readSessionToken(request));
}

/**
 * The same resolution, from a bare token.
 *
 * Server Actions and server components never see a `Request` — the framework
 * hands them cookies through its own API. Rather than let `next/headers` leak
 * into src/ (§10), the routing layer reads the cookie and passes the token
 * here, so identity still resolves through exactly one function.
 */
export async function sessionFromToken(
  token: string | undefined,
): Promise<SessionUser | undefined> {
  if (!token) return undefined;
  return whoami.call({ token }, ANONYMOUS);
}

export async function actorFromToken(
  token: string | undefined,
): Promise<Actor> {
  const session = await sessionFromToken(token);
  if (!session) return ANONYMOUS;
  return { kind: "user", userId: session.userId, role: session.role };
}

/**
 * An expired, forged or absent cookie all resolve to anonymous rather than an
 * error: a public page must render for a visitor whose session lapsed, and the
 * permission check downstream is what decides whether anonymous is enough.
 */
export async function actorFromRequest(request: Request): Promise<Actor> {
  const session = await resolveSession(request);
  if (!session) return ANONYMOUS;
  return { kind: "user", userId: session.userId, role: session.role };
}
