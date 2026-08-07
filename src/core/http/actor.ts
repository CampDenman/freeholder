// Copyright (C) 2026 Tony Aly
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
 * The API key behind this request, if it presents a live one.
 *
 * `Authorization: Bearer fh_live_…` only. Not a query parameter, and not a
 * cookie: a credential in a URL ends up in access logs, in `Referer` headers
 * and in browser history, and a credential the browser attaches automatically
 * is a credential that can be used by a page the caller did not write. The
 * header has neither problem, which is also why CSRF does not apply to it.
 */
export async function resolveApiKey(request: Request): Promise<Actor | undefined> {
  const header = request.headers.get("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) return undefined;

  const { verifyApiKey, touchApiKey } = await import("@/core/apikeys/tokens");
  const key = await verifyApiKey(header.slice("bearer ".length).trim());
  if (!key) return undefined;

  touchApiKey(key.id);
  return { kind: "agent", keyName: key.name, scopes: key.scopes };
}

/**
 * An expired, forged or absent credential all resolve to anonymous rather than
 * an error: a public page must render for a visitor whose session lapsed, and
 * the permission check downstream is what decides whether anonymous is enough.
 *
 * A key wins over a cookie when both are present. That combination means a
 * script running in a browser that happens to be signed in, and taking the
 * cookie would silently give it the *person's* authority instead of the key's
 * — which is the opposite of what scoping a key is for.
 */
export async function actorFromRequest(request: Request): Promise<Actor> {
  const key = await resolveApiKey(request);
  if (key) return key;

  const session = await resolveSession(request);
  if (!session) return ANONYMOUS;
  return { kind: "user", userId: session.userId, role: session.role };
}
