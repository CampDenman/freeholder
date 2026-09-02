// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Tiers, rewards and redemption (MASTER.md §4.13, C9.12).
//
// Two of §4.13's rules govern this file, and both are about not inventing a
// second version of something that already exists:
//
//   "Tier evaluation is a pure function of the ledger and a window, run on
//   write and on a schedule, emitting TimelineEvents on promotion and demotion
//   so automations can act and the customer can be told."
//
//   "Redemption obeys the convergence rule. Points become a coupon, a pass
//   balance, or a zero-value invoice line — never a parallel discount path."
//
// So a tier is never stored as a decision somebody made; it is recomputed from
// the same rows that explain the balance, and the stored column is the answer
// rather than the reason. And redeeming produces something the money system
// already honours, through the seam in `core/rewards/issue.ts` — which is how
// a redemption becomes a real coupon without this module importing commerce.
import { z } from "zod";
import { and, asc, desc, eq, gte, notInArray, sql } from "drizzle-orm";
import { listed, row, uuid as uuidSchema } from "@/core/contract";
import { actorString, defineService, ServiceError, type Tx } from "@/core/service";
import { issueReward } from "@/core/rewards/issue";
import { syncTierAccess } from "@/core/entitlements/access";
import {
  loyaltyAccounts,
  loyaltyPrograms,
  loyaltyTiers,
  pointsLedger,
  redemptions,
  rewards,
} from "./schema";

const DAY_MS = 24 * 60 * 60 * 1000;

/* ---------------------------------------------------------------- tiers */

const tierRow = row({
  id: uuidSchema,
  programId: uuidSchema,
  name: z.string(),
  thresholdBasis: z.enum(["points_earned", "lifetime_spend"]),
  threshold: z.number().int(),
  windowDays: z.number().int(),
  benefits: z.unknown(),
  position: z.number().int(),
});

export const saveTier = defineService({
  name: "loyalty.saveTier",
  writeClass: "write",
  summary: "Add or change a status level.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuidSchema.optional(),
    programId: uuidSchema,
    name: z.string().trim().min(1).max(80),
    thresholdBasis: z.enum(["points_earned", "lifetime_spend"]).default("points_earned"),
    threshold: z.number().int().min(0).max(100000000),
    /** Zero is all time; anything else is a rolling window. */
    windowDays: z.number().int().min(0).max(3650).default(365),
    benefits: z
      .object({
        pointsMultiplier: z.number().min(1).max(20).optional(),
        freeShipping: z.boolean().optional(),
        earlyAccess: z.boolean().optional(),
        perks: z.array(z.string().trim().max(120)).max(20).optional(),
      })
      .default({}),
    position: z.number().int().min(0).max(100),
  }),
  output: tierRow,
  handler: async (input, ctx) => {
    const values = {
      programId: input.programId,
      name: input.name,
      thresholdBasis: input.thresholdBasis,
      threshold: input.threshold,
      windowDays: input.windowDays,
      benefits: input.benefits,
      position: input.position,
    };
    if (input.id) {
      const [updated] = await ctx.tx
        .update(loyaltyTiers)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(loyaltyTiers.id, input.id))
        .returning();
      if (!updated) throw new ServiceError("not_found", "There is no such tier.");
      return updated;
    }
    const [created] = await ctx.tx.insert(loyaltyTiers).values(values).returning();
    return created!;
  },
});

export const tiers = defineService({
  name: "loyalty.tiers",
  summary: "A programme's status levels, entry level first.",
  kind: "query",
  permission: "scoped",
  input: z.object({ programId: uuidSchema }),
  output: listed(tierRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(loyaltyTiers)
      .where(eq(loyaltyTiers.programId, input.programId))
      .orderBy(asc(loyaltyTiers.position)),
});

/**
 * What an account has earned inside a window, on one basis.
 *
 * `points_earned` is what they earned, not what they have left: spending
 * points must not cost somebody their standing. So it sums every movement
 * except `redeem` and `expire` — earning and a goodwill adjustment both count
 * up, a reversal counts down because the thing that earned it was undone, and
 * neither spending nor a lapsed balance touches status. Excluding adjustments
 * would mean "we gave you 500 points to apologise, but they do not count
 * towards Gold", which is a distinction the customer cannot see.
 *
 * `lifetime_spend` counts the money on the spine events those earns cite,
 * which is why the ledger carries the source and not only the number.
 */
async function basisTotal(
  tx: Tx,
  accountId: string,
  basis: "points_earned" | "lifetime_spend",
  windowDays: number,
): Promise<number> {
  const since = windowDays > 0 ? new Date(Date.now() - windowDays * DAY_MS) : new Date(0);
  if (basis === "points_earned") {
    const [summed] = await tx
      .select({ total: sql<number>`coalesce(sum(${pointsLedger.delta}), 0)::int` })
      .from(pointsLedger)
      .where(
        and(
          eq(pointsLedger.accountId, accountId),
          notInArray(pointsLedger.reason, ["redeem", "expire"]),
          gte(pointsLedger.at, since),
        ),
      );
    return Math.max(0, summed?.total ?? 0);
  }
  // Spend is read back off the spine rows the earns cite, so this number and
  // the customer's order history cannot drift apart.
  const { timelineEvents } = await import("@/core/contacts/schema");
  const [summed] = await tx
    .select({
      total: sql<number>`coalesce(sum((${timelineEvents.payload} ->> 'totalMinor')::int), 0)::int`,
    })
    .from(pointsLedger)
    .innerJoin(timelineEvents, eq(timelineEvents.subjectId, pointsLedger.sourceId))
    .where(
      and(
        eq(pointsLedger.accountId, accountId),
        eq(pointsLedger.reason, "earn"),
        gte(pointsLedger.at, since),
        sql`${timelineEvents.payload} ? 'totalMinor'`,
      ),
    );
  return summed?.total ?? 0;
}

export type TierChange = {
  accountId: string;
  from: string | null;
  to: string | null;
  direction: "promoted" | "demoted" | "unchanged";
};

/**
 * Recompute one account's standing.
 *
 * Pure in the sense that matters: given the ledger and the tier thresholds, it
 * always produces the same answer, so nobody can be in a tier the rows do not
 * justify. It writes the answer and returns what changed, and the caller
 * decides whether that is worth telling somebody about.
 */
export async function evaluateTier(tx: Tx, accountId: string): Promise<TierChange> {
  const [account] = await tx
    .select()
    .from(loyaltyAccounts)
    .where(eq(loyaltyAccounts.id, accountId));
  if (!account) return { accountId, from: null, to: null, direction: "unchanged" };

  const ladder = await tx
    .select()
    .from(loyaltyTiers)
    .where(eq(loyaltyTiers.programId, account.programId))
    .orderBy(asc(loyaltyTiers.position));
  if (ladder.length === 0) {
    return { accountId, from: account.tierId, to: account.tierId, direction: "unchanged" };
  }

  let earned: string | null = null;
  let expiresAt: Date | null = null;
  for (const tier of ladder) {
    const total = await basisTotal(tx, accountId, tier.thresholdBasis, tier.windowDays);
    if (total >= tier.threshold) {
      earned = tier.id;
      // A windowed tier lapses when the window rolls past the earning that
      // won it; an all-time tier does not lapse at all.
      expiresAt = tier.windowDays > 0 ? new Date(Date.now() + tier.windowDays * DAY_MS) : null;
    }
  }

  const before = account.tierId;
  if (before === earned) {
    return { accountId, from: before, to: earned, direction: "unchanged" };
  }

  const positionOf = (id: string | null) =>
    id ? (ladder.find((t) => t.id === id)?.position ?? -1) : -1;
  const direction = positionOf(earned) > positionOf(before) ? "promoted" : "demoted";

  await tx
    .update(loyaltyAccounts)
    .set({
      tierId: earned,
      tierSince: new Date(),
      tierExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(loyaltyAccounts.id, accountId));

  await syncTierAccess(tx, {
    contactId: account.contactId,
    fromTierId: before,
    toTierId: earned,
    endsAt: expiresAt,
  });

  return { accountId, from: before, to: earned, direction };
}

/* -------------------------------------------------------------- rewards */

const rewardRow = row({
  id: uuidSchema,
  programId: uuidSchema,
  name: z.string(),
  kind: z.enum([
    "discount",
    "free_product",
    "free_shipping",
    "gift_card",
    "pass_credits",
    "donation",
  ]),
  costPoints: z.number().int(),
  value: z.unknown(),
  stock: z.number().int().nullable(),
  perContactLimit: z.number().int().nullable(),
  status: z.enum(["draft", "active", "retired"]),
});

export const saveReward = defineService({
  name: "loyalty.saveReward",
  writeClass: "write",
  summary: "Say what points buy.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuidSchema.optional(),
    programId: uuidSchema,
    name: z.string().trim().min(1).max(120),
    kind: z.enum([
      "discount",
      "free_product",
      "free_shipping",
      "gift_card",
      "pass_credits",
      "donation",
    ]),
    // At least one point. A reward costing nothing is not a redemption, it is
    // a benefit, and benefits belong to a tier.
    costPoints: z.number().int().min(1).max(10000000),
    value: z
      .object({
        percentOffPpm: z.number().int().min(1).max(1000000).optional(),
        amountMinor: z.number().int().min(1).max(100000000).optional(),
        currency: z.string().trim().length(3).optional(),
        productId: uuidSchema.optional(),
      })
      .default({}),
    stock: z.number().int().min(0).max(1000000).nullish(),
    perContactLimit: z.number().int().min(1).max(1000).nullish(),
    eligibleTierIds: z.array(uuidSchema).max(20).default([]),
    status: z.enum(["draft", "active", "retired"]).default("draft"),
  }),
  output: rewardRow,
  handler: async (input, ctx) => {
    if (input.kind === "discount" && !input.value.percentOffPpm && !input.value.amountMinor) {
      throw new ServiceError(
        "validation",
        "A discount reward needs either a percentage or an amount.",
      );
    }
    const values = {
      programId: input.programId,
      name: input.name,
      kind: input.kind,
      costPoints: input.costPoints,
      value: input.value,
      stock: input.stock ?? null,
      perContactLimit: input.perContactLimit ?? null,
      eligibleTierIds: input.eligibleTierIds,
      status: input.status,
    };
    if (input.id) {
      const [updated] = await ctx.tx
        .update(rewards)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(rewards.id, input.id))
        .returning();
      if (!updated) throw new ServiceError("not_found", "There is no such reward.");
      return updated;
    }
    const [created] = await ctx.tx.insert(rewards).values(values).returning();
    return created!;
  },
});

export const catalogue = defineService({
  name: "loyalty.rewards",
  summary: "The rewards a programme is offering.",
  kind: "query",
  permission: "public",
  input: z.object({ programId: uuidSchema }),
  output: listed(rewardRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(rewards)
      .where(and(eq(rewards.programId, input.programId), eq(rewards.status, "active")))
      .orderBy(asc(rewards.costPoints)),
});

/* ----------------------------------------------------------- redemption */

/**
 * Spend points on a reward.
 *
 * Everything that can go wrong is checked from the rows rather than from a
 * cached column, in the order a person would ask about it, and the ledger row
 * and the coupon are written in one transaction — a redemption that debited
 * points and then failed to produce anything is the single worst outcome
 * available here.
 */
export const redeem = defineService({
  name: "loyalty.redeem",
  writeClass: "money",
  summary: "Spend points on a reward.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ accountId: uuidSchema, rewardId: uuidSchema }),
  output: row({
    redemptionId: uuidSchema,
    pointsSpent: z.number().int(),
    balance: z.number().int(),
    reference: z.string().nullable(),
    issuedBy: z.string(),
    status: z.enum(["issued", "manual", "used", "expired", "reversed"]),
  }),
  handler: async (input, ctx) => {
    const [account] = await ctx.tx
      .select()
      .from(loyaltyAccounts)
      .where(eq(loyaltyAccounts.id, input.accountId));
    if (!account) throw new ServiceError("not_found", "There is no such account.");
    if (account.status !== "active") {
      throw new ServiceError("validation", "That account is not active.");
    }

    const [reward] = await ctx.tx.select().from(rewards).where(eq(rewards.id, input.rewardId));
    if (!reward || reward.status !== "active") {
      throw new ServiceError("not_found", "That reward is not available.");
    }
    if (reward.programId !== account.programId) {
      throw new ServiceError("validation", "That reward belongs to a different programme.");
    }

    const [program] = await ctx.tx
      .select()
      .from(loyaltyPrograms)
      .where(eq(loyaltyPrograms.id, account.programId));

    // §4.13's fraud floor: "a minimum account age before redemption". Points
    // farmed and cashed out the same hour is the pattern this closes.
    const ageDays = (Date.now() - account.enrolledAt.getTime()) / DAY_MS;
    if (program && ageDays < program.minAccountAgeDays) {
      throw new ServiceError(
        "validation",
        `This account can redeem after ${program.minAccountAgeDays} days.`,
      );
    }

    const eligible = (reward.eligibleTierIds as string[]) ?? [];
    if (eligible.length > 0 && (!account.tierId || !eligible.includes(account.tierId))) {
      throw new ServiceError("validation", "That reward is for a different tier.");
    }

    if (reward.stock !== null && reward.stock <= 0) {
      throw new ServiceError("validation", "That reward has run out.");
    }

    if (reward.perContactLimit !== null) {
      const taken = await ctx.tx
        .select({ id: redemptions.id })
        .from(redemptions)
        .where(
          and(
            eq(redemptions.accountId, account.id),
            eq(redemptions.rewardId, reward.id),
          ),
        );
      if (taken.length >= reward.perContactLimit) {
        throw new ServiceError("validation", "You have already taken that reward.");
      }
    }

    // The balance comes from the rows, never from points_balance_cached.
    const [summed] = await ctx.tx
      .select({ total: sql<number>`coalesce(sum(${pointsLedger.delta}), 0)::int` })
      .from(pointsLedger)
      .where(eq(pointsLedger.accountId, account.id));
    const balance = summed?.total ?? 0;
    if (balance < reward.costPoints) {
      throw new ServiceError(
        "validation",
        `That costs ${reward.costPoints} and this account has ${balance}.`,
      );
    }

    const value = (reward.value ?? {}) as {
      percentOffPpm?: number;
      amountMinor?: number;
      currency?: string;
    };
    // The convergence rule: whatever comes back is a thing the money system
    // already honours, or an honest "nothing could issue this".
    const issued = await issueReward(ctx, {
      contactId: account.contactId,
      kind: reward.kind,
      percentOffPpm: value.percentOffPpm,
      amountMinor: value.amountMinor,
      currency: value.currency ?? program?.earnCurrency,
      label: reward.name,
    });

    const [ledgerEntry] = await ctx.tx
      .insert(pointsLedger)
      .values({
        accountId: account.id,
        delta: -reward.costPoints,
        reason: "redeem",
        sourceType: "reward",
        sourceId: reward.id,
        actor: actorString(ctx.actor),
        note: reward.name,
      })
      .returning({ id: pointsLedger.id });

    const [redemption] = await ctx.tx
      .insert(redemptions)
      .values({
        accountId: account.id,
        rewardId: reward.id,
        pointsSpent: reward.costPoints,
        ledgerId: ledgerEntry!.id,
        issuedReference: issued.reference,
        issuedBy: issued.by,
        // "manual" is a real state, not a failure: on an instance with no
        // commerce module there is a voucher waiting to be written out, and
        // calling that "issued" is a lie the customer finds at the till.
        status: issued.issued ? "issued" : "manual",
      })
      .returning();

    if (reward.stock !== null) {
      await ctx.tx
        .update(rewards)
        .set({ stock: reward.stock - 1, updatedAt: new Date() })
        .where(eq(rewards.id, reward.id));
    }

    const after = balance - reward.costPoints;
    await ctx.tx
      .update(loyaltyAccounts)
      .set({ pointsBalanceCached: after, updatedAt: new Date() })
      .where(eq(loyaltyAccounts.id, account.id));

    await ctx.emitTimeline({
      contactId: account.contactId,
      eventType: "loyalty.redeemed",
      subjectType: "redemption",
      subjectId: redemption!.id,
      payload: { reward: reward.name, pointsSpent: reward.costPoints, reference: issued.reference },
    });
    ctx.queueEvent("loyalty.redeemed", { redemptionId: redemption!.id });

    return {
      redemptionId: redemption!.id,
      pointsSpent: reward.costPoints,
      balance: after,
      reference: issued.reference,
      issuedBy: issued.by,
      status: redemption!.status,
    };
  },
});

export const redemptionHistory = defineService({
  name: "loyalty.redemptions",
  summary: "What has been redeemed, newest first.",
  kind: "query",
  permission: "scoped",
  input: z.object({ programId: uuidSchema, limit: z.number().int().min(1).max(500).default(100) }),
  output: listed(
    row({
      id: uuidSchema,
      accountId: uuidSchema,
      rewardName: z.string(),
      pointsSpent: z.number().int(),
      issuedReference: z.string().nullable(),
      issuedBy: z.string().nullable(),
      status: z.enum(["issued", "manual", "used", "expired", "reversed"]),
      at: z.date(),
    }),
  ),
  handler: (input, ctx) =>
    ctx.tx
      .select({
        id: redemptions.id,
        accountId: redemptions.accountId,
        rewardName: rewards.name,
        pointsSpent: redemptions.pointsSpent,
        issuedReference: redemptions.issuedReference,
        issuedBy: redemptions.issuedBy,
        status: redemptions.status,
        at: redemptions.at,
      })
      .from(redemptions)
      .innerJoin(rewards, eq(rewards.id, redemptions.rewardId))
      .innerJoin(loyaltyAccounts, eq(loyaltyAccounts.id, redemptions.accountId))
      .where(eq(loyaltyAccounts.programId, input.programId))
      .orderBy(desc(redemptions.at))
      .limit(input.limit),
});

export const reevaluateTier = defineService({
  name: "loyalty.reevaluateTier",
  writeClass: "write",
  summary: "Recompute one account's standing from its ledger.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ accountId: uuidSchema }),
  output: row({
    from: uuidSchema.nullable(),
    to: uuidSchema.nullable(),
    direction: z.enum(["promoted", "demoted", "unchanged"]),
  }),
  handler: async (input, ctx) => {
    const change = await evaluateTier(ctx.tx, input.accountId);
    if (change.direction !== "unchanged") {
      const [account] = await ctx.tx
        .select({ contactId: loyaltyAccounts.contactId })
        .from(loyaltyAccounts)
        .where(eq(loyaltyAccounts.id, input.accountId));
      if (account) {
        // §4.13 wants promotion and demotion on the timeline "so automations
        // can act and the customer can be told" — both of which need the
        // event to exist whether or not anyone is listening today.
        await ctx.emitTimeline({
          contactId: account.contactId,
          eventType: `loyalty.${change.direction}`,
          subjectType: "loyalty_account",
          subjectId: input.accountId,
          payload: { from: change.from, to: change.to },
        });
        ctx.queueEvent(`loyalty.${change.direction}`, {
          accountId: input.accountId,
          from: change.from,
          to: change.to,
        });
      }
    }
    return { from: change.from, to: change.to, direction: change.direction };
  },
});

export default [
  saveTier,
  tiers,
  saveReward,
  catalogue,
  redeem,
  redemptionHistory,
  reevaluateTier,
];
