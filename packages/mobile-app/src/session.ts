// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Auth, which is the portal's, unchanged (MASTER.md §35.1, C10.12).
//
// §35.1: "Magic link and password (§13's KISS auth), with the token in the
// platform keychain and never in JavaScript-reachable storage. Biometric
// unlock guards *re-opening* the app, never the login itself — a fingerprint
// is a convenience over a held session, not an authentication factor the
// server knows about, and treating it as one is how apps end up trusting a
// device instead of a person."
//
// The store is an interface rather than a direct `expo-secure-store` import so
// that this rule is testable without a device, and so a fake in a test cannot
// silently become the real thing in a build.

/**
 * Somewhere only the OS keychain writes.
 *
 * Deliberately not `AsyncStorage`: that is a JSON file in the app sandbox,
 * readable by anything that gets code execution and included in unencrypted
 * device backups. A session token there is a session token in a backup.
 */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export const SESSION_KEY = "freeholder.session";
/** Push token for this install, revoked when the session ends (C10.14 / C10.28). */
export const DEVICE_TOKEN_KEY = "freeholder.device-token";

export interface Session {
  instanceUrl: string;
  token: string;
  /** Whose session it is, for the "not you?" affordance on re-open. */
  email: string;
  issuedAt: string;
  /**
   * Named role from `auth.whoami` / `auth.login`.
   *
   * The customer portal is `customer`. Anything else is staff (owner,
   * administrator, editor, a custom grant bundle) and opens companion mode
   * rather than the customer tabs. Absent until whoami has answered.
   */
  role?: string;
}

/** Same codebase, two audiences: the SDK already enforces the grants. */
export type SessionAudience = "customer" | "staff";

/** The portal role. Every other stored role is staff of some kind (C10.17). */
export function isStaffRole(role: string | undefined | null): boolean {
  return Boolean(role && role !== "customer");
}

export function sessionAudience(session: Pick<Session, "role"> | null | undefined): SessionAudience {
  return isStaffRole(session?.role) ? "staff" : "customer";
}

export interface TwoFactorMethods {
  totp: boolean;
  recovery: boolean;
  webauthn: boolean;
}

export type SignInResult =
  | { ok: true; session: Session }
  | { ok: false; reason: "invalid" | "unreachable" | "magic-link-sent"; message: string }
  | {
      ok: false;
      reason: "two-factor";
      message: string;
      /** Absent when the instance did not return a completable challenge. */
      challengeToken?: string;
      methods?: TwoFactorMethods;
    };

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; credentials?: "omit" },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Sign in with a password, or ask for a magic link.
 *
 * `magic-link-sent` is a success the caller must not treat as one: nothing is
 * stored, because nothing has been proved yet. It is a distinct result rather
 * than `ok: false` with a friendly message so a caller cannot accidentally
 * fall into the failure branch and tell a customer their email was wrong.
 */
export async function signIn(
  input: { instanceUrl: string; email: string; password?: string },
  fetchImpl: FetchLike,
): Promise<SignInResult> {
  const endpoint = input.password
    ? `${input.instanceUrl}/api/v1/auth.login`
    : `${input.instanceUrl}/api/v1/auth.requestCustomerMagicLink`;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        input.password
          ? { email: input.email, password: input.password }
          : { email: input.email },
      ),
    });
  } catch {
    return { ok: false, reason: "unreachable", message: "Could not reach the site." };
  }
  if (!response.ok) return { ok: false, reason: "invalid", message: "Sign-in could not be completed. Check your details or try again later." };
  if (!input.password) {
    // Always the same answer, sent or not: whether an address has an account
    // is not something an unauthenticated caller gets to learn.
    return {
      ok: false,
      reason: "magic-link-sent",
      message: "If that address has an account, a sign-in link is on its way.",
    };
  }
  const body = (await response.json()) as {
    token?: string;
    role?: string;
    twoFactorRequired?: boolean;
    challengeToken?: string;
    methods?: TwoFactorMethods;
  };
  if (body.twoFactorRequired) {
    const challengeToken =
      typeof body.challengeToken === "string" && body.challengeToken.length >= 20
        ? body.challengeToken
        : undefined;
    return {
      ok: false,
      reason: "two-factor",
      message: challengeToken
        ? "This account requires a verification code."
        : "This account requires two-factor sign-in on the website.",
      challengeToken,
      methods: body.methods,
    };
  }
  if (!body.token) {
    return { ok: false, reason: "invalid", message: "That email and password did not match." };
  }
  return {
    ok: true,
    session: {
      instanceUrl: input.instanceUrl,
      token: body.token,
      email: input.email,
      issuedAt: new Date().toISOString(),
      role: typeof body.role === "string" && body.role ? body.role : undefined,
    },
  };
}

/**
 * Finish a password login with TOTP or a recovery code (C10.28).
 *
 * WebAuthn stays on the website: a passkey ceremony is a browser API this
 * client does not wrap. A challenge that only offers a security key is
 * refused here rather than stored as a session.
 */
export async function completeTwoFactorSignIn(
  input: { instanceUrl: string; email: string; challengeToken: string; code: string },
  fetchImpl: FetchLike,
): Promise<SignInResult> {
  let response;
  try {
    response = await fetchImpl(`${input.instanceUrl}/api/v1/auth.completeTwoFactorLogin`, {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeToken: input.challengeToken, code: input.code.trim() }),
    });
  } catch {
    return { ok: false, reason: "unreachable", message: "Could not reach the site." };
  }
  let body: { token?: string; role?: string } = {};
  try {
    body = (await response.json()) as { token?: string; role?: string };
  } catch {
    body = {};
  }
  if (!response.ok || !body.token) {
    return { ok: false, reason: "invalid", message: "That verification code did not work. Try again or start sign-in again." };
  }
  return {
    ok: true,
    session: {
      instanceUrl: input.instanceUrl,
      token: body.token,
      email: input.email,
      issuedAt: new Date().toISOString(),
      role: typeof body.role === "string" && body.role ? body.role : undefined,
    },
  };
}

/** The original email link is consumed only against its issuing business. */
export async function redeemSignInLink(input: { instanceUrl: string; link: string; email: string }, fetchImpl: FetchLike): Promise<SignInResult> {
  let token: string;
  try {
    const url = new URL(input.link.trim());
    if (url.origin !== new URL(input.instanceUrl).origin || !/^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?portal\/magic\/?$/.test(url.pathname)) throw new Error("wrong site");
    token = url.searchParams.get("token") ?? "";
    if (token.length < 20 || token.length > 200) throw new Error("invalid token");
  } catch { return { ok: false, reason: "invalid", message: "Use the original sign-in link from this business's email." }; }
  try {
    const response = await fetchImpl(`${input.instanceUrl}/api/v1/auth.consumeCustomerMagicLink`, { method: "POST", credentials: "omit", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
    const body = await response.json() as { token?: string };
    if (!response.ok || !body.token) return { ok: false, reason: "invalid", message: "That sign-in link is no longer valid." };
    return { ok: true, session: { instanceUrl: input.instanceUrl, token: body.token, email: input.email, issuedAt: new Date().toISOString(), role: "customer" } };
  } catch { return { ok: false, reason: "unreachable", message: "Could not reach the site." }; }
}

export async function saveSession(store: SecretStore, session: Session): Promise<void> {
  await store.set(SESSION_KEY, JSON.stringify(session));
}

export async function loadSession(store: SecretStore): Promise<Session | null> {
  const raw = await store.get(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Session;
    return parsed.token && parsed.instanceUrl ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Fill in the named role from the live session, not from a guess.
 *
 * Password login may already have it. Magic-link and TOTP do not. Companion
 * mode is gated on this answer, so a stale local role must not outrank whoami.
 */
export async function resolveSessionRole(
  session: Session,
  fetchImpl: FetchLike,
): Promise<Session> {
  try {
    const response = await fetchImpl(`${session.instanceUrl}/api/v1/auth.whoami`, {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: session.token }),
    });
    if (!response.ok) return session;
    const body = (await response.json()) as { role?: string; email?: string };
    if (typeof body.role !== "string" || !body.role) return session;
    return {
      ...session,
      role: body.role,
      email: typeof body.email === "string" && body.email ? body.email : session.email,
    };
  } catch {
    return session;
  }
}

/**
 * Sign out, which must clear the token before anything else.
 *
 * Order matters on a phone: an app that clears its in-memory state first and
 * is then killed by the OS before the keychain write lands has "signed out"
 * into a state that signs itself back in on next launch.
 */
export async function signOut(store: SecretStore): Promise<void> {
  await store.delete(SESSION_KEY);
}

export async function saveDeviceToken(store: SecretStore, token: string): Promise<void> {
  await store.set(DEVICE_TOKEN_KEY, token);
}

export async function loadDeviceToken(store: SecretStore): Promise<string | null> {
  const raw = await store.get(DEVICE_TOKEN_KEY);
  return raw && raw.length >= 8 ? raw : null;
}

export async function clearDeviceToken(store: SecretStore): Promise<void> {
  await store.delete(DEVICE_TOKEN_KEY);
}

export interface BiometricGate {
  available(): Promise<boolean>;
  authenticate(reason: string): Promise<boolean>;
}

/**
 * Whether to show the app's contents after it was re-opened.
 *
 * A failed or unavailable biometric check does **not** sign anyone out, and a
 * successful one does not sign anyone in. It gates the screen over a session
 * the server already granted — which is exactly as much as a fingerprint is
 * worth, because the server has no idea whose finger it was.
 */
export async function unlockOnResume(
  gate: BiometricGate,
  enabled: boolean,
): Promise<{ show: boolean; reason: string }> {
  if (!enabled) return { show: true, reason: "Biometric unlock is off." };
  if (!(await gate.available())) {
    // Locking someone out of their own bookings because a sensor broke would
    // be treating a convenience as a factor.
    return { show: true, reason: "No biometric sensor is available." };
  }
  const passed = await gate.authenticate("Unlock to see your bookings and galleries");
  return passed
    ? { show: true, reason: "Unlocked." }
    : { show: false, reason: "Locked. Unlock to continue, or sign out." };
}
