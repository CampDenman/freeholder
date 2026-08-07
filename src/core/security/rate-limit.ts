// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Fixed-window rate limiting (MASTER.md §36, "Security hardening … rate
// limiting, login protection … shipped, not sold").
//
// ── Why this does not run inside the caller's transaction ──────────────────
//
// Every other write in this codebase joins the caller's transaction (§2
// principle 12). This one must not, and the reason is the whole point of the
// mechanism: a failed login *throws*, which rolls its transaction back. A
// counter incremented inside that transaction would roll back with it, so
// failed attempts would never be counted — the limiter would be perfectly
// effective against people who type their password correctly and useless
// against the brute-force attack it exists to stop.
//
// So `consume` takes its own connection and commits on its own. This is a
// deliberate, narrow exception to the one-transaction rule: the counter is a
// side-channel observation about traffic, not business state, and nothing else
// in a mutation depends on it. It is documented here rather than in a review
// comment because the failure mode of getting it wrong is invisible — the
// limiter still "works" in every test that only exercises the success path.
//
// The window is fixed rather than sliding: a burst straddling a boundary can
// briefly reach 2× the limit. That is an accepted trade for a counter that is
// one upsert with no history table, and it is nowhere near loose enough to
// matter for password guessing at these limits.
import { sql } from "drizzle-orm";
import { db } from "@/core/db";

export interface RateLimitPolicy {
  /** Attempts allowed per window, per key. */
  limit: number;
  windowSeconds: number;
}

export interface RateLimitVerdict {
  allowed: boolean;
  /** Attempts recorded in the current window, including this one. */
  attempts: number;
  /** Whole seconds until the window resets. */
  retryAfterSeconds: number;
}

/**
 * Namespaced so two services counting the same email never share a budget:
 * failing to log in should not consume the allowance for requesting a reset.
 */
export function rateLimitKey(serviceName: string, subject: string): string {
  return `${serviceName}:${subject.trim().toLowerCase()}`;
}

/**
 * Record one attempt against `key` and say whether it is allowed.
 *
 * The upsert both resets an expired window and increments a live one in a
 * single statement, so two concurrent attempts cannot read the same count and
 * both decide they are the first — the row lock serializes them.
 */
export async function consume(
  key: string,
  policy: RateLimitPolicy,
): Promise<RateLimitVerdict> {
  const rows = await db().execute<{
    attempts: number;
    seconds_remaining: string | number;
  }>(sql`
    insert into rate_limit_counters as c (key, window_started_at, attempts)
    values (${key}, now(), 1)
    on conflict (key) do update set
      attempts = case
        when c.window_started_at <= now() - (${policy.windowSeconds} * interval '1 second')
        then 1
        else c.attempts + 1
      end,
      window_started_at = case
        when c.window_started_at <= now() - (${policy.windowSeconds} * interval '1 second')
        then now()
        else c.window_started_at
      end
    returning
      attempts,
      extract(epoch from (
        window_started_at + (${policy.windowSeconds} * interval '1 second') - now()
      )) as seconds_remaining
  `);

  const row = rows[0];
  const attempts = Number(row?.attempts ?? 1);
  const remaining = Number(row?.seconds_remaining ?? policy.windowSeconds);
  return {
    allowed: attempts <= policy.limit,
    attempts,
    retryAfterSeconds: Math.max(1, Math.ceil(remaining)),
  };
}

/**
 * Forget a subject's attempts. Called on a *successful* login so that someone
 * who mistypes their password four times and then gets it right is not left
 * one attempt from a lockout for the rest of the window.
 */
export async function reset(key: string): Promise<void> {
  await db().execute(sql`delete from rate_limit_counters where key = ${key}`);
}
