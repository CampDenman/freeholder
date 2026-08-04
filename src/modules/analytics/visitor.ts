// Copyright (C) 2026 Camp Denman Society
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

/** Forwarded to server components, which cannot read a cookie being set. */
export const ANON_HEADER = "x-freeholder-anon";
export const SESSION_HEADER = "x-freeholder-session";

/**
 * Six months. Long enough for the funnel an owner cares about — an enquiry in
 * March that becomes a booking in May — and short enough that a browser nobody
 * has used since is forgotten rather than kept forever.
 */
export const ANON_MAX_AGE = 60 * 60 * 24 * 180;
export const SESSION_MAX_AGE = 60 * 30;

/**
 * A random identifier.
 *
 * `crypto.randomUUID` because the Edge runtime has it and `node:crypto` is not
 * loadable there.
 */
export function newVisitorId(): string {
  return crypto.randomUUID();
}

/**
 * Requests that are not a person looking at a page.
 *
 * Bots first, because a crawler that reads every page would otherwise make an
 * owner's traffic chart a picture of Googlebot. This is a heuristic and will
 * never be complete — the honest position is that it removes the obvious ones,
 * which is most of the volume.
 */
const BOT = /bot|crawler|spider|crawling|slurp|bingpreview|headlesschrome|lighthouse|monitor|curl|wget|python-requests|axios|node-fetch/i;

export function looksAutomated(userAgent: string | null): boolean {
  if (!userAgent) return true;
  return BOT.test(userAgent);
}
