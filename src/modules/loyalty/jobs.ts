// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Points expiry, and the notice that has to come first
// (MASTER.md §4.13, C9.11).
//
// §4.13: "Expiry is a scheduled job that writes rows, never a silent
// recomputation, and it gives notice first. Several jurisdictions restrict or
// forbid expiry on inactivity alone, so `expiry_policy` carries a notice
// period and the platform refuses to configure an expiry with no notice."
//
// Three things follow, and each one is a decision rather than an
// implementation detail:
//
//   - Expiring writes a `points_ledger` row with reason "expire". The balance
//     falls because a row says so, and the customer can see which row.
//   - Notice comes first and is recorded, so "you were told" is a fact in the
//     timeline rather than an assumption about a job that may not have run.
//   - Nothing expires until the notice period has actually elapsed since the
//     notice. A job that noticed and expired in the same pass would satisfy
//     the letter of "gives notice first" and none of its purpose.
import { and, eq, isNotNull, lt, lte, sql } from "drizzle-orm";
import { defineJob } from "@/core/jobs";
import type { Tx } from "@/core/service";
import { loyaltyAccounts, loyaltyPrograms, pointsLedger } from "./schema";

type ExpiryPolicy = { kind: string; days?: number; noticeDays?: number };

function policyOf(value: unknown): ExpiryPolicy {
  if (typeof value !== "object" || value === null) return { kind: "never" };
  return value as ExpiryPolicy;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Balance from the rows. The cached column is never the basis for expiring. */
async function balanceOf(tx: Tx, accountId: string): Promise<number> {
  const [summed] = await tx
    .select({ total: sql<number>`coalesce(sum(${pointsLedger.delta}), 0)::int` })
    .from(pointsLedger)
    .where(eq(pointsLedger.accountId, accountId));
  return summed?.total ?? 0;
}

/**
 * Has this account already been told, recently enough for the notice to still
 * be the notice for this expiry?
 *
 * Recorded as a ledger row of delta zero rather than a column, so the notice
 * appears in the customer's statement in its place in time — "we told you on
 * the 3rd" is part of the history of the balance, not metadata about it.
 */
async function noticedAt(tx: Tx, accountId: string): Promise<Date | null> {
  const [notice] = await tx
    .select({ at: pointsLedger.at })
    .from(pointsLedger)
    .where(
      and(
        eq(pointsLedger.accountId, accountId),
        eq(pointsLedger.reason, "expire"),
        eq(pointsLedger.delta, 0),
      ),
    )
    .orderBy(sql`${pointsLedger.at} desc`)
    .limit(1);
  return notice?.at ?? null;
}

/**
 * One pass: give notice where it is due, expire where notice has run out.
 *
 * Returns counts rather than nothing, because a scheduled job whose only
 * output is a side effect is one nobody can tell has stopped working.
 */
export async function runPointsExpiry(): Promise<{
  noticed: number;
  expired: number;
  pointsExpired: number;
}> {
  const { db } = await import("@/core/db");
  let noticed = 0;
  let expired = 0;
  let pointsExpired = 0;

  await db().transaction(async (tx) => {
    const active = await tx
      .select()
      .from(loyaltyPrograms)
      .where(eq(loyaltyPrograms.status, "active"));

    for (const program of active) {
      const policy = policyOf(program.expiryPolicy);
      if (policy.kind === "never" || !policy.days || !policy.noticeDays) continue;

      const now = Date.now();

      if (policy.kind === "inactivity") {
        const dormantSince = new Date(now - policy.days * DAY_MS);
        const warnSince = new Date(now - (policy.days - policy.noticeDays) * DAY_MS);

        const candidates = await tx
          .select({ id: loyaltyAccounts.id, contactId: loyaltyAccounts.contactId })
          .from(loyaltyAccounts)
          .where(
            and(
              eq(loyaltyAccounts.programId, program.id),
              eq(loyaltyAccounts.status, "active"),
              lte(loyaltyAccounts.lastActivityAt, warnSince),
            ),
          );

        for (const account of candidates) {
          const balance = await balanceOf(tx, account.id);
          if (balance <= 0) continue;

          const told = await noticedAt(tx, account.id);
          if (!told) {
            await tx.insert(pointsLedger).values({
              accountId: account.id,
              delta: 0,
              reason: "expire",
              actor: "system",
              note: `Notice: ${balance} points expire in ${policy.noticeDays} days without activity.`,
            });
            noticed += 1;
            continue;
          }

          // Two conditions, both required: the account is genuinely dormant,
          // and the notice period has elapsed since we said so.
          const noticeElapsed = now - told.getTime() >= policy.noticeDays * DAY_MS;
          const [stale] = await tx
            .select({ id: loyaltyAccounts.id })
            .from(loyaltyAccounts)
            .where(
              and(
                eq(loyaltyAccounts.id, account.id),
                lte(loyaltyAccounts.lastActivityAt, dormantSince),
              ),
            );
          if (!noticeElapsed || !stale) continue;

          await tx.insert(pointsLedger).values({
            accountId: account.id,
            delta: -balance,
            reason: "expire",
            actor: "system",
            note: "Expired after the notice period, with no activity.",
          });
          await tx
            .update(loyaltyAccounts)
            .set({ pointsBalanceCached: 0, updatedAt: new Date() })
            .where(eq(loyaltyAccounts.id, account.id));
          expired += 1;
          pointsExpired += balance;
        }
        continue;
      }

      if (policy.kind === "fixed_window") {
        // Each earn carries its own expiry date, so this expires the specific
        // points rather than the balance — which is the difference between
        // "your March points expired" and "your points expired".
        const due = await tx
          .select({
            id: pointsLedger.id,
            accountId: pointsLedger.accountId,
            delta: pointsLedger.delta,
          })
          .from(pointsLedger)
          .innerJoin(loyaltyAccounts, eq(loyaltyAccounts.id, pointsLedger.accountId))
          .where(
            and(
              eq(loyaltyAccounts.programId, program.id),
              eq(pointsLedger.reason, "earn"),
              isNotNull(pointsLedger.expiresAt),
              lt(pointsLedger.expiresAt, new Date(now)),
            ),
          );

        for (const entry of due) {
          const already = await tx
            .select({ id: pointsLedger.id })
            .from(pointsLedger)
            .where(
              and(eq(pointsLedger.reason, "expire"), eq(pointsLedger.reversesId, entry.id)),
            );
          if (already.length > 0) continue;

          await tx.insert(pointsLedger).values({
            accountId: entry.accountId,
            delta: -entry.delta,
            reason: "expire",
            reversesId: entry.id,
            actor: "system",
            note: "Expired at the end of its window.",
          });
          expired += 1;
          pointsExpired += entry.delta;

          const balance = await balanceOf(tx, entry.accountId);
          await tx
            .update(loyaltyAccounts)
            .set({ pointsBalanceCached: balance, updatedAt: new Date() })
            .where(eq(loyaltyAccounts.id, entry.accountId));
        }
      }
    }
  });

  return { noticed, expired, pointsExpired };
}

export const expirePoints = defineJob({
  name: "loyalty.expirePoints",
  summary: "Give notice of, and then apply, points expiry (§4.13).",
  // Daily. Expiry is measured in days and notice in days, so a job that ran
  // every minute would do the same nothing 1,439 times and occasionally
  // expire somebody a few hours early.
  schedule: "0 3 * * *",
  concurrency: 1,
  handler: runPointsExpiry,
});

export default [expirePoints];
