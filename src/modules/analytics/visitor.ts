// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Who a visitor is, to this site and to nobody else.
//
// A leaf module, imported by `proxy.ts`, so it may not import anything the
// Edge runtime cannot load — the same constraint core/http/headers.ts carries
// and for the same reason.
//
// ── Why cookies rather than a fingerprint ─────────────────────────────────
//
// The cookieless alternative is a daily hash of IP + user-agent + salt, which
// is what several privacy-first analytics products do. It avoids a cookie and
// avoids consent, and it pays for that by being unable to join anything across
// days — which would make §4.7's "visit → lead → quote → paid, one query" a
// sentence the platform could not deliver.
//
// So: a random first-party value, meaningless to anyone else, in a cookie the
// owner's own site sets. No IP is stored, no user-agent, nothing derived from
// the device. The identifier says "the same browser came back" and nothing
// more, which is the least it can say and still answer the question an owner
// is actually asking.

/** The visitor, across visits. */
export const ANON_COOKIE = "fh_v";
/** One visit, expiring after 30 minutes of quiet. */
export const SESSION_COOKIE_NAME = "fh_s";
/** Persisted consent/policy choice; never an identity. */
export const ANALYTICS_CONSENT_COOKIE = "fh_ac";
/** Short-lived first-navigation handoff, promoted only when policy allows. */
export const ANALYTICS_BOOTSTRAP_COOKIE = "fh_ab";

/** Forwarded to server components, which cannot read a cookie being set. */
export const ANON_HEADER = "x-freeholder-anon";
export const SESSION_HEADER = "x-freeholder-session";
export const ANALYTICS_BOOTSTRAP_HEADER = "x-freeholder-analytics-bootstrap";

/**
 * Six months. Long enough for the funnel an owner cares about — an enquiry in
 * March that becomes a booking in May — and short enough that a browser nobody
 * has used since is forgotten rather than kept forever.
 */
export const ANON_MAX_AGE = 60 * 60 * 24 * 180;
export const SESSION_MAX_AGE = 60 * 30;
export const ANALYTICS_BOOTSTRAP_MAX_AGE = 60 * 5;
export const ANALYTICS_CONSENT_MAX_AGE = 60 * 60 * 24 * 365;

export type AnalyticsConsentState =
  | "implicit"
  | "granted"
  | "pending"
  | "denied"
  | "disabled";

const CONSENT_STATES = new Set<AnalyticsConsentState>([
  "implicit",
  "granted",
  "pending",
  "denied",
  "disabled",
]);

export function parseAnalyticsConsentState(
  value: string | null | undefined,
): AnalyticsConsentState | null {
  return value && CONSENT_STATES.has(value as AnalyticsConsentState)
    ? (value as AnalyticsConsentState)
    : null;
}

/** Only these durable choices permit long-lived visitor identifiers. */
export function analyticsIdentifiersAllowed(
  state: AnalyticsConsentState | null,
): boolean {
  return state === "implicit" || state === "granted";
}

/**
 * A random identifier.
 *
 * `crypto.randomUUID` because the Edge runtime has it and `node:crypto` is not
 * loadable there.
 */
export function newVisitorId(): string {
  return crypto.randomUUID();
}

// Telling a person from a program used to live here as one hand-written
// regex. It moved to classify.ts and became several signals over a maintained
// list, because a hand-written list is wrong in both directions from the day
// it is written — and because the interesting bots are the ones that do not
// say so.
