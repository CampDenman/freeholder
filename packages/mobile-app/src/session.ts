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

export interface Session {
  instanceUrl: string;
  token: string;
  /** Whose session it is, for the "not you?" affordance on re-open. */
  email: string;
  issuedAt: string;
}

export type SignInResult =
  | { ok: true; session: Session }
  | { ok: false; reason: "invalid" | "unreachable" | "magic-link-sent"; message: string };

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
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
    ? `${input.instanceUrl}/api/auth/login`
    : `${input.instanceUrl}/api/auth/magic-link`;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
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
  if (!input.password) {
    // Always the same answer, sent or not: whether an address has an account
    // is not something an unauthenticated caller gets to learn.
    return {
      ok: false,
      reason: "magic-link-sent",
      message: "If that address has an account, a sign-in link is on its way.",
    };
  }
  if (!response.ok) {
    return { ok: false, reason: "invalid", message: "That email and password did not match." };
  }
  const body = (await response.json()) as { token?: string };
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
    },
  };
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
 * Sign out, which must clear the token before anything else.
 *
 * Order matters on a phone: an app that clears its in-memory state first and
 * is then killed by the OS before the keychain write lands has "signed out"
 * into a state that signs itself back in on next launch.
 */
export async function signOut(store: SecretStore): Promise<void> {
  await store.delete(SESSION_KEY);
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
