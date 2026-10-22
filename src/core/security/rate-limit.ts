// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
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
import { isIP } from "node:net";
import { sql } from "drizzle-orm";
import { db } from "@/core/db";
import type { Actor, Tx } from "@/core/service";

/**
 * The bucket an anonymous caller is counted in (C11.10).
 *
 * The deployment-validated address (`TRUSTED_CLIENT_IP_HEADER`) is the one a
 * client cannot choose, and is used whenever it is configured. Without it,
 * the forwarded address is still the best per-visitor key there is: a caller
 * who forges it escapes their own limit, but nobody can spend everybody
 * else's. One shared bucket would be the opposite trade — unforgeable, and a
 * site-wide off switch. Services pair this with `untrustedBackstop`, the
 * high site-wide ceiling that bounds the forgers.
 */
export function anonymousClientKey(actor: Actor): string {
  const trusted = actor.request?.trustedIp;
  if (trusted) return `ip:${clientNetwork(trusted)}`;
  const forwarded = actor.request?.ip;
  return `untrusted-ip:${forwarded ? clientNetwork(forwarded) : "unknown"}`;
}

/**
 * The part of an address that names one client, for counting (C11.10).
 *
 * An IPv6 subscriber is routinely handed a whole /64 and can pick a fresh
 * address from it for every request, so a limit keyed on the full address is
 * no limit at all; the /64 is what one household or one server holds. An
 * IPv4-mapped IPv6 address (`::ffff:192.0.2.1`) is the IPv4 address it
 * carries, so the same visitor is not two subjects depending on the socket
 * family. Anything that is not an address is returned unchanged.
 */
export function clientNetwork(ip: string): string {
  const family = isIP(ip);
  if (family !== 6) return ip;
  const groups = expandIpv6(ip.toLowerCase());
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const [hi = 0, lo = 0] = [groups[6], groups[7]];
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
}

/** Eight 16-bit groups from a valid IPv6 literal (zone id dropped). */
function expandIpv6(ip: string): number[] {
  const bare = ip.split("%", 1)[0]!;
  const [head = "", tail] = bare.split("::", 2);
  const parse = (part: string): number[] => {
    if (!part) return [];
    const out: number[] = [];
    for (const piece of part.split(":")) {
      if (piece.includes(".")) {
        const [a = 0, b = 0, c = 0, d = 0] = piece.split(".").map(Number);
        out.push((a << 8) | b, (c << 8) | d);
      } else {
        out.push(parseInt(piece, 16));
      }
    }
    return out;
  };
  const left = parse(head);
  const right = tail === undefined ? [] : parse(tail);
  const fill = new Array<number>(Math.max(0, 8 - left.length - right.length)).fill(0);
  return [...left, ...fill, ...right];
}

/**
 * How much higher the site-wide ceiling sits for callers whose address the
 * deployment validated. Their per-client key is the stronger one, so their
 * ceiling is looser; it still exists, because "validated" rests on a platform
 * behaving as documented and one client can hold many addresses.
 */
export const TRUSTED_BACKSTOP_FACTOR = 10;

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
  return consumeWith(db(), key, policy);
}

/** Limit committed form submissions, not failed authentication attempts.
 * Uses the existing transaction so parallel submissions cannot exhaust the
 * connection pool while each waits for a second connection (C11.10).
 */
export async function consumeAccepted(tx: Tx, key: string, policy: RateLimitPolicy): Promise<RateLimitVerdict> {
  return consumeWith(tx, key, policy);
}

async function consumeWith(executor: Pick<Tx, "execute">, key: string, policy: RateLimitPolicy): Promise<RateLimitVerdict> {
  const rows = await executor.execute<{
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
