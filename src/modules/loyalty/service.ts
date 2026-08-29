// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Loyalty programmes, earning and the points ledger (MASTER.md §4.13, C9.11).
//
// Two rules from §4.13 shape everything here, and both are about trust rather
// than bookkeeping:
//
//   "Points are a ledger, not a number … a balance you cannot explain is a
//   balance customers stop believing."
//
//   "Earning is a listener on spine events, never a call from inside another
//   module … Commerce does not know loyalty exists."
//
// So there is no `setBalance`, no `addPoints(contact, 50)` for another module
// to call, and no code path that writes `points_balance_cached` as though it
// were the truth. Every movement is an append to `points_ledger`, every
// balance is a sum of those rows, and the cached column is refreshed from the
// sum immediately afterwards so a list screen has something cheap to render.
import { z } from "zod";
import { and, asc, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { listed, row, uuid as uuidSchema } from "@/core/contract";
import { actorString, defineService, ServiceError, type Tx } from "@/core/service";
import { registerContactReference, resolveContact } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { contacts } from "@/core/contacts/schema";
import { earnRules, loyaltyAccounts, loyaltyPrograms, pointsLedger } from "./schema";
import { SPINE_SOURCES, spineFactFor } from "./spine";
// Tiers, rewards and redemption (C9.12). A sibling file rather than a
// second module: they are the same programme, and a redemption reads the
// same ledger an earn writes.
export {
  catalogue,
  redeem,
  redemptionHistory,
  reevaluateTier,
  saveReward,
  saveTier,
  tiers,
  evaluateTier,
} from "./rewards-service";
import {
  catalogue,
  redeem,
  redemptionHistory,
  reevaluateTier,
  saveReward,
  saveTier,
  tiers,
  evaluateTier,
} from "./rewards-service";

/* ------------------------------------------------------------ the ledger */

/**
 * The balance, from the rows.
 *
 * Everything that decides anything calls this. `points_balance_cached` is
 * never read by this module — see the file header — because the first time a
 * cache and a ledger disagree, the customer is holding the ledger.
 */
async function balanceOf(tx: Tx, accountId: string): Promise<number> {
  const [summed] = await tx
    .select({ total: sql<number>`coalesce(sum(${pointsLedger.delta}), 0)::int` })
    .from(pointsLedger)
    .where(eq(pointsLedger.accountId, accountId));
  return summed?.total ?? 0;
}

async function lifetimeOf(tx: Tx, accountId: string): Promise<number> {
  const [summed] = await tx
    .select({
      total: sql<number>`coalesce(sum(case when ${pointsLedger.delta} > 0 then ${pointsLedger.delta} else 0 end), 0)::int`,
    })
    .from(pointsLedger)
    .where(eq(pointsLedger.accountId, accountId));
  return summed?.total ?? 0;
}

/** Re-derive the display cache. Called after every append, never trusted. */
async function refreshCache(tx: Tx, accountId: string): Promise<number> {
  const [balance, lifetime] = await Promise.all([
    balanceOf(tx, accountId),
    lifetimeOf(tx, accountId),
  ]);
  await tx
    .update(loyaltyAccounts)
    .set({
      pointsBalanceCached: balance,
      lifetimePoints: lifetime,
      lastActivityAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(loyaltyAccounts.id, accountId));
  return balance;
}

/* ------------------------------------------------------------- contracts */

const expiryPolicy = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("never") }),
    z.object({
      kind: z.literal("inactivity"),
      days: z.number().int().min(1).max(3650),
      noticeDays: z.number().int().min(1).max(365),
    }),
    z.object({
      kind: z.literal("fixed_window"),
      days: z.number().int().min(1).max(3650),
      noticeDays: z.number().int().min(1).max(365),
    }),
  ])
  // The refusal is in the type, not in a handler. §4.13: "Several
  // jurisdictions restrict or forbid expiry on inactivity alone, so
  // `expiry_policy` carries a notice period and the platform refuses to
  // configure an expiry with no notice." A schema that made noticeDays
  // optional would be a platform that permits it and hopes nobody does.
  .default({ kind: "never" });

const programRow = row({
  id: uuidSchema,
  name: z.string(),
  pointsLabel: z.string(),
  status: z.enum(["draft", "active", "closed"]),
  earnCurrency: z.string(),
  redemptionValueCents: z.number().int(),
  expiryPolicy: z.unknown(),
  enrolment: z.enum(["automatic", "opt_in"]),
});

const ledgerRow = row({
  id: uuidSchema,
  delta: z.number().int(),
  reason: z.enum(["earn", "redeem", "expire", "adjust", "reverse"]),
  ruleName: z.string().nullable(),
  sourceType: z.string().nullable(),
  sourceId: z.string().nullable(),
  reversesId: uuidSchema.nullable(),
  note: z.string().nullable(),
  at: z.date(),
});

const statement = row({
  accountId: uuidSchema,
  programId: uuidSchema,
  pointsLabel: z.string(),
  /** Summed from the rows below, so the two can never disagree on screen. */
  balance: z.number().int(),
  lifetimePoints: z.number().int(),
  entries: z.array(ledgerRow),
});

/* -------------------------------------------------------------- services */

export const saveProgram = defineService({
  name: "loyalty.saveProgram",
  writeClass: "write",
  summary: "Create or change a loyalty programme.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuidSchema.optional(),
    name: z.string().trim().min(1).max(120),
    pointsLabel: z.string().trim().min(1).max(40).default("points"),
    status: z.enum(["draft", "active", "closed"]).default("draft"),
    earnCurrency: z.string().trim().length(3).default("USD"),
    redemptionValueCents: z.number().int().min(1).max(100000).default(1),
    expiryPolicy,
    enrolment: z.enum(["automatic", "opt_in"]).default("opt_in"),
    termsPageId: uuidSchema.nullish(),
    /** §4.13's fraud floor: how old an account must be to redeem (C9.12). */
    minAccountAgeDays: z.number().int().min(0).max(3650).default(0),
  }),
  output: programRow,
  handler: async (input, ctx) => {
    const values = {
      name: input.name,
      pointsLabel: input.pointsLabel,
      status: input.status,
      earnCurrency: input.earnCurrency.toUpperCase(),
      redemptionValueCents: input.redemptionValueCents,
      expiryPolicy: input.expiryPolicy,
      enrolment: input.enrolment,
      termsPageId: input.termsPageId ?? null,
      minAccountAgeDays: input.minAccountAgeDays,
    };
    if (input.id) {
      const [updated] = await ctx.tx
        .update(loyaltyPrograms)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(loyaltyPrograms.id, input.id))
        .returning();
      if (!updated) throw new ServiceError("not_found", "There is no such programme.");
      ctx.setSubject("loyalty_program", updated.id);
      return updated;
    }
    const [created] = await ctx.tx.insert(loyaltyPrograms).values(values).returning();
    ctx.setSubject("loyalty_program", created!.id);
    return created!;
  },
});

export const programs = defineService({
  name: "loyalty.programs",
  summary: "Every loyalty programme.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(programRow),
  handler: (_input, ctx) =>
    ctx.tx.select().from(loyaltyPrograms).orderBy(asc(loyaltyPrograms.name)),
});

export const saveEarnRule = defineService({
  name: "loyalty.saveEarnRule",
  writeClass: "write",
  summary: "Say what earns points, and how many.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: uuidSchema.optional(),
    programId: uuidSchema,
    name: z.string().trim().min(1).max(120),
    /**
     * A spine event type. Constrained to what this module actually listens
     * for, because a rule naming an event nobody delivers is a rule that
     * silently never pays — and an owner would have no way to tell that from
     * a rule that simply had not triggered yet.
     */
    eventType: z.string().trim().min(1).max(80),
    formula: z.enum(["fixed", "per_currency_unit", "multiplier"]).default("fixed"),
    points: z.number().int().min(0).max(1000000),
    capPerPeriod: z.number().int().min(1).max(10000000).nullish(),
    capPeriodDays: z.number().int().min(1).max(3650).default(30),
    startsAt: z.coerce.date().nullish(),
    endsAt: z.coerce.date().nullish(),
    priority: z.number().int().min(0).max(1000).default(0),
    active: z.enum(["yes", "no"]).default("yes"),
  }),
  output: row({ id: uuidSchema, eventType: z.string() }),
  handler: async (input, ctx) => {
    const known = new Set(Object.values(SPINE_SOURCES).map((s) => s.eventType));
    if (!known.has(input.eventType)) {
      throw new ServiceError(
        "validation",
        `Nothing delivers "${input.eventType}" to loyalty. It earns from: ${[...known].sort().join(", ")}.`,
      );
    }
    const [program] = await ctx.tx
      .select({ id: loyaltyPrograms.id })
      .from(loyaltyPrograms)
      .where(eq(loyaltyPrograms.id, input.programId));
    if (!program) throw new ServiceError("not_found", "There is no such programme.");

    const values = {
      programId: input.programId,
      name: input.name,
      eventType: input.eventType,
      formula: input.formula,
      points: input.points,
      capPerPeriod: input.capPerPeriod ?? null,
      capPeriodDays: input.capPeriodDays,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      priority: input.priority,
      active: input.active,
    };
    if (input.id) {
      const [updated] = await ctx.tx
        .update(earnRules)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(earnRules.id, input.id))
        .returning({ id: earnRules.id, eventType: earnRules.eventType });
      if (!updated) throw new ServiceError("not_found", "There is no such rule.");
      return updated;
    }
    const [created] = await ctx.tx
      .insert(earnRules)
      .values(values)
      .returning({ id: earnRules.id, eventType: earnRules.eventType });
    return created!;
  },
});

/**
 * Enrol a contact, or return the account they already have.
 *
 * Idempotent on purpose: enrolment happens from an owner's screen, from an
 * automatic programme's listener and potentially from a customer opting in,
 * and none of those should be able to create a second balance.
 */
export const enrol = defineService({
  name: "loyalty.enrol",
  writeClass: "write",
  summary: "Give a contact a standing in a programme.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ contactId: uuidSchema, programId: uuidSchema }),
  output: row({ accountId: uuidSchema, alreadyEnrolled: z.boolean() }),
  handler: async (input, ctx) => {
    const account = await ensureAccount(ctx.tx, input.contactId, input.programId);
    if (!account.created) return { accountId: account.id, alreadyEnrolled: true };
    ctx.queueEvent("loyalty.enrolled", { accountId: account.id, contactId: input.contactId });
    await ctx.emitTimeline({
      contactId: input.contactId,
      eventType: "loyalty.enrolled",
      subjectType: "loyalty_account",
      subjectId: account.id,
      payload: { programId: input.programId },
    });
    return { accountId: account.id, alreadyEnrolled: false };
  },
});

async function ensureAccount(
  tx: Tx,
  contactId: string,
  programId: string,
): Promise<{ id: string; created: boolean }> {
  const [existing] = await tx
    .select({ id: loyaltyAccounts.id })
    .from(loyaltyAccounts)
    .where(
      and(eq(loyaltyAccounts.contactId, contactId), eq(loyaltyAccounts.programId, programId)),
    );
  if (existing) return { id: existing.id, created: false };
  const [created] = await tx
    .insert(loyaltyAccounts)
    .values({ contactId, programId })
    .returning({ id: loyaltyAccounts.id });
  return { id: created!.id, created: true };
}

/**
 * The whole statement: a balance and the rows it is made of.
 *
 * One service rather than a balance service and a history service, because
 * §4.13's requirement is that the balance be *explainable* — and a number
 * returned without its workings is exactly the thing customers stop believing.
 */
export const statementFor = defineService({
  name: "loyalty.statement",
  summary: "A contact's balance and every movement behind it.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    contactId: uuidSchema,
    programId: uuidSchema,
    limit: z.number().int().min(1).max(500).default(100),
  }),
  output: statement.nullable(),
  handler: async (input, ctx) => readStatement(ctx.tx, input.contactId, input.programId, input.limit),
});

/**
 * The same statement, for the person it belongs to.
 *
 * A customer may read their own points and nobody else's, so this resolves the
 * account from the actor rather than taking a contact id — the shape that
 * cannot be pointed at somebody else.
 */
export const myStatement = defineService({
  name: "loyalty.myStatement",
  summary: "Your points, and how you got them.",
  kind: "query",
  permission: "authenticated",
  input: z.object({ programId: uuidSchema, limit: z.number().int().min(1).max(500).default(100) }),
  output: statement.nullable(),
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user") return null;
    const [contact] = await ctx.tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.userId, ctx.actor.userId));
    if (!contact) return null;
    return readStatement(ctx.tx, contact.id, input.programId, input.limit);
  },
});

async function readStatement(tx: Tx, contactId: string, programId: string, limit: number) {
  const [account] = await tx
    .select({
      id: loyaltyAccounts.id,
      programId: loyaltyAccounts.programId,
      pointsLabel: loyaltyPrograms.pointsLabel,
    })
    .from(loyaltyAccounts)
    .innerJoin(loyaltyPrograms, eq(loyaltyPrograms.id, loyaltyAccounts.programId))
    .where(
      and(eq(loyaltyAccounts.contactId, contactId), eq(loyaltyAccounts.programId, programId)),
    );
  if (!account) return null;

  const entries = await tx
    .select({
      id: pointsLedger.id,
      delta: pointsLedger.delta,
      reason: pointsLedger.reason,
      ruleName: earnRules.name,
      sourceType: pointsLedger.sourceType,
      sourceId: pointsLedger.sourceId,
      reversesId: pointsLedger.reversesId,
      note: pointsLedger.note,
      at: pointsLedger.at,
    })
    .from(pointsLedger)
    .leftJoin(earnRules, eq(earnRules.id, pointsLedger.ruleId))
    .where(eq(pointsLedger.accountId, account.id))
    .orderBy(desc(pointsLedger.at))
    .limit(limit);

  return {
    accountId: account.id,
    programId: account.programId,
    pointsLabel: account.pointsLabel,
    balance: await balanceOf(tx, account.id),
    lifetimePoints: await lifetimeOf(tx, account.id),
    entries,
  };
}

export const adjustPoints = defineService({
  name: "loyalty.adjustPoints",
  writeClass: "write",
  summary: "Add or remove points by hand, with a reason.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    accountId: uuidSchema,
    delta: z.number().int().refine((n) => n !== 0, "An adjustment of zero is not an adjustment."),
    // Required, not optional. A manual movement with no stated reason is the
    // one entry in a ledger nobody can explain later, which defeats the point
    // of keeping one.
    note: z.string().trim().min(1).max(500),
  }),
  output: row({ balance: z.number().int() }),
  handler: async (input, ctx) => {
    const [account] = await ctx.tx
      .select({ id: loyaltyAccounts.id })
      .from(loyaltyAccounts)
      .where(eq(loyaltyAccounts.id, input.accountId));
    if (!account) throw new ServiceError("not_found", "There is no such account.");
    await ctx.tx.insert(pointsLedger).values({
      accountId: input.accountId,
      delta: input.delta,
      reason: "adjust",
      actor: actorString(ctx.actor),
      note: input.note,
    });
    return { balance: await refreshCache(ctx.tx, input.accountId) };
  },
});

/**
 * What the outstanding points would cost if everybody spent them today.
 *
 * §4.13: "Outstanding points are a liability, and the owner is shown the
 * number … A loyalty programme whose cost is invisible is how a business gives
 * away a margin it never measured." Summed from the ledger, not from the
 * caches, because a liability figure derived from a cache is a guess wearing a
 * currency symbol.
 */
export const liability = defineService({
  name: "loyalty.liability",
  summary: "What outstanding points would cost if they were all spent.",
  kind: "query",
  permission: "scoped",
  input: z.object({ programId: uuidSchema }),
  output: row({
    programId: uuidSchema,
    outstandingPoints: z.number().int(),
    valueMinor: z.number().int(),
    currency: z.string(),
    accounts: z.number().int(),
  }),
  handler: async (input, ctx) => {
    const [program] = await ctx.tx
      .select()
      .from(loyaltyPrograms)
      .where(eq(loyaltyPrograms.id, input.programId));
    if (!program) throw new ServiceError("not_found", "There is no such programme.");

    const [summed] = await ctx.tx
      .select({
        points: sql<number>`coalesce(sum(${pointsLedger.delta}), 0)::int`,
        accounts: sql<number>`count(distinct ${loyaltyAccounts.id})::int`,
      })
      .from(loyaltyAccounts)
      .leftJoin(pointsLedger, eq(pointsLedger.accountId, loyaltyAccounts.id))
      .where(eq(loyaltyAccounts.programId, input.programId));

    const outstanding = summed?.points ?? 0;
    return {
      programId: program.id,
      outstandingPoints: outstanding,
      valueMinor: outstanding * program.redemptionValueCents,
      currency: program.earnCurrency,
      accounts: summed?.accounts ?? 0,
    };
  },
});

/* -------------------------------------------------------------- earning */

/**
 * Points owed for one event under one rule.
 *
 * `per_currency_unit` and `multiplier` both work from major units, so a
 * £41.50 order under "1 point per £1" earns 41 and not 4150. Truncation rather
 * than rounding, because a customer who sees 41 for £41.50 understands it, and
 * one who sees 42 asks where the extra point came from.
 */
export function pointsFor(
  formula: "fixed" | "per_currency_unit" | "multiplier",
  rulePoints: number,
  amountMinor: number,
): number {
  if (formula === "fixed") return rulePoints;
  const majorUnits = Math.floor(Math.abs(amountMinor) / 100);
  return rulePoints * majorUnits;
}

async function awardedInPeriod(
  tx: Tx,
  accountId: string,
  ruleId: string,
  periodDays: number,
): Promise<number> {
  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
  const [summed] = await tx
    .select({ total: sql<number>`coalesce(sum(${pointsLedger.delta}), 0)::int` })
    .from(pointsLedger)
    .where(
      and(
        eq(pointsLedger.accountId, accountId),
        eq(pointsLedger.ruleId, ruleId),
        eq(pointsLedger.reason, "earn"),
        gte(pointsLedger.at, since),
      ),
    );
  return summed?.total ?? 0;
}

/**
 * The listener. One function for every topic in the manifest.
 *
 * It runs after the emitting transaction has committed, in its own, and is
 * safe to run twice: the partial unique index on (rule, source) means a
 * retried delivery cannot pay for the same order a second time. That matters
 * because the outbox retries, and "we paid you twice for one order" is a
 * harder conversation than "we have not paid you yet".
 */
export async function onSpineEvent(payload: unknown, eventName?: string): Promise<void> {
  const topic = eventName ?? "";
  const source = SPINE_SOURCES[topic];
  if (!source) return;
  const { db } = await import("@/core/db");

  await db().transaction(async (tx) => {
    const fact = await spineFactFor(tx, topic, payload);
    if (!fact) return;

    const active = await tx
      .select()
      .from(loyaltyPrograms)
      .where(eq(loyaltyPrograms.status, "active"));
    if (active.length === 0) return;

    for (const program of active) {
      if (source.direction === "reverse") {
        await reverseFor(tx, program.id, fact.contactId, fact.subjectType, fact.subjectId);
        continue;
      }

      const rules = await tx
        .select()
        .from(earnRules)
        .where(
          and(
            eq(earnRules.programId, program.id),
            eq(earnRules.eventType, fact.eventType),
            eq(earnRules.active, "yes"),
            or(isNull(earnRules.startsAt), lte(earnRules.startsAt, new Date())),
            or(isNull(earnRules.endsAt), gte(earnRules.endsAt, new Date())),
          ),
        )
        .orderBy(desc(earnRules.priority));
      if (rules.length === 0) continue;

      // An opt-in programme does not enrol somebody because they bought
      // something. §4.13 makes enrolment a property of the programme, and
      // quietly enrolling is how a business ends up emailing people about
      // points they never asked for.
      const [account] = await tx
        .select({ id: loyaltyAccounts.id, status: loyaltyAccounts.status })
        .from(loyaltyAccounts)
        .where(
          and(
            eq(loyaltyAccounts.contactId, fact.contactId),
            eq(loyaltyAccounts.programId, program.id),
          ),
        );
      let accountId = account?.id ?? null;
      if (!accountId) {
        if (program.enrolment !== "automatic") continue;
        accountId = (await ensureAccount(tx, fact.contactId, program.id)).id;
      } else if (account!.status !== "active") {
        continue;
      }

      for (const rule of rules) {
        let points = pointsFor(rule.formula, rule.points, fact.amountMinor);
        if (points <= 0) continue;

        if (rule.capPerPeriod !== null) {
          const already = await awardedInPeriod(tx, accountId, rule.id, rule.capPeriodDays);
          const headroom = rule.capPerPeriod - already;
          if (headroom <= 0) continue;
          points = Math.min(points, headroom);
        }

        await tx
          .insert(pointsLedger)
          .values({
            accountId,
            delta: points,
            reason: "earn",
            ruleId: rule.id,
            sourceType: fact.subjectType,
            sourceId: fact.subjectId,
            actor: "system",
            note: rule.name,
            expiresAt: expiryFor(program.expiryPolicy),
          })
          // The index is the guard; this makes a retry quiet rather than loud.
          .onConflictDoNothing();
      }
      await refreshCache(tx, accountId);
      // Run on write, as §4.13 asks. The notification of a change belongs
      // to `reevaluateTier`, which has a service context to emit from; here
      // the standing is simply kept true.
      await evaluateTier(tx, accountId);
    }
  });
}

/**
 * Reverse what an event previously earned.
 *
 * §4.13: "Reversal writes a negative row citing the original; it never deletes
 * history." So this reads the earns for that subject and writes their mirror
 * image — and skips any that already have one, because a refund can be
 * delivered twice and the customer should not lose the points twice.
 */
async function reverseFor(
  tx: Tx,
  programId: string,
  contactId: string,
  subjectType: string,
  subjectId: string,
): Promise<void> {
  const [account] = await tx
    .select({ id: loyaltyAccounts.id })
    .from(loyaltyAccounts)
    .where(
      and(eq(loyaltyAccounts.contactId, contactId), eq(loyaltyAccounts.programId, programId)),
    );
  if (!account) return;

  const earned = await tx
    .select()
    .from(pointsLedger)
    .where(
      and(
        eq(pointsLedger.accountId, account.id),
        eq(pointsLedger.reason, "earn"),
        eq(pointsLedger.sourceId, subjectId),
      ),
    );
  if (earned.length === 0) return;

  const alreadyReversed = await tx
    .select({ reversesId: pointsLedger.reversesId })
    .from(pointsLedger)
    .where(and(eq(pointsLedger.accountId, account.id), eq(pointsLedger.reason, "reverse")));
  const done = new Set(alreadyReversed.map((r) => r.reversesId).filter(Boolean) as string[]);

  for (const original of earned) {
    if (done.has(original.id)) continue;
    await tx.insert(pointsLedger).values({
      accountId: account.id,
      delta: -original.delta,
      reason: "reverse",
      ruleId: original.ruleId,
      sourceType: subjectType,
      sourceId: subjectId,
      reversesId: original.id,
      actor: "system",
      note: "Reversed: the thing that earned these was undone.",
    });
  }
  await refreshCache(tx, account.id);
}

/** When points earned now would expire, under this programme's policy. */
export function expiryFor(policy: unknown): Date | null {
  if (typeof policy !== "object" || policy === null) return null;
  const p = policy as { kind?: string; days?: number };
  if (p.kind !== "fixed_window" || typeof p.days !== "number") return null;
  return new Date(Date.now() + p.days * 24 * 60 * 60 * 1000);
}

/* ------------------------------------------------------------ the spine */

registerContactReference({
  table: "loyalty_accounts",
  // Merging two people who were both enrolled would collide on the unique
  // (contact, programme) index, so the survivor keeps their account and the
  // duplicate's ledger is moved onto it. Points are not lost in a merge —
  // that is the whole reason the ledger is the record and the balance is not.
  repoint: async (tx, duplicateId, survivingId) => {
    const duplicates = await tx
      .select()
      .from(loyaltyAccounts)
      .where(eq(loyaltyAccounts.contactId, duplicateId));
    for (const account of duplicates) {
      const [survivor] = await tx
        .select({ id: loyaltyAccounts.id })
        .from(loyaltyAccounts)
        .where(
          and(
            eq(loyaltyAccounts.contactId, survivingId),
            eq(loyaltyAccounts.programId, account.programId),
          ),
        );
      if (survivor) {
        await tx
          .update(pointsLedger)
          .set({ accountId: survivor.id })
          .where(eq(pointsLedger.accountId, account.id));
        await tx.delete(loyaltyAccounts).where(eq(loyaltyAccounts.id, account.id));
        await refreshCache(tx, survivor.id);
      } else {
        await tx
          .update(loyaltyAccounts)
          .set({ contactId: survivingId })
          .where(eq(loyaltyAccounts.id, account.id));
      }
    }
  },
  captureForUndo: async (tx, duplicateId, survivingId) => {
    const mine = await tx
      .select()
      .from(loyaltyAccounts)
      .where(eq(loyaltyAccounts.contactId, duplicateId));
    const theirs = await tx
      .select({ programId: loyaltyAccounts.programId })
      .from(loyaltyAccounts)
      .where(eq(loyaltyAccounts.contactId, survivingId));
    const survivorPrograms = new Set(theirs.map((a) => a.programId));

    // Only a merge that actually *combined* two ledgers is irreversible:
    // once the rows sit on one account they are indistinguishable, and
    // inventing a split would be worse than saying so. Repointing an
    // account whose programme the survivor was not in moves nothing
    // together and undoes perfectly — and declaring every merge
    // irreversible because loyalty is installed would take undo away from
    // instances where no points were involved at all.
    const combined = mine.some((a) => survivorPrograms.has(a.programId));
    return {
      state: { accounts: mine.map((a) => ({ id: a.id, programId: a.programId })) },
      undoable: !combined,
    };
  },
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const parsed = z
      .object({
        accounts: z.array(z.object({ id: z.string().uuid(), programId: z.string().uuid() })),
      })
      .parse(beforeState);
    for (const account of parsed.accounts) {
      // Undo only reaches here when nothing was combined, so each of these
      // is still its own row and goes back to the contact it came from.
      await tx
        .update(loyaltyAccounts)
        .set({ contactId: duplicateId })
        .where(eq(loyaltyAccounts.id, account.id));
    }
  },
});

registerContactPrivacySource({
  scope: "contact.loyalty",
  tables: ["loyalty_accounts", "points_ledger"],
  exportData: async (tx, contactId) => {
    const accounts = await tx
      .select()
      .from(loyaltyAccounts)
      .where(eq(loyaltyAccounts.contactId, contactId));
    const ledger = accounts.length
      ? await tx
          .select()
          .from(pointsLedger)
          .where(
            or(...accounts.map((a) => eq(pointsLedger.accountId, a.id))) ?? sql`false`,
          )
      : [];
    return { accounts, ledger };
  },
  erase: async (tx, contactId) => {
    // The account and its ledger go together. Unlike a review, a points
    // balance is not a public fact anybody else relies on — it is a private
    // arrangement between one business and one person, so erasure removes it
    // rather than anonymising it.
    const accounts = await tx
      .select({ id: loyaltyAccounts.id })
      .from(loyaltyAccounts)
      .where(eq(loyaltyAccounts.contactId, contactId));
    await tx.delete(loyaltyAccounts).where(eq(loyaltyAccounts.contactId, contactId));
    return { affected: accounts.length };
  },
});

export { resolveContact };

export default [
  saveProgram,
  programs,
  saveEarnRule,
  enrol,
  statementFor,
  myStatement,
  adjustPoints,
  liability,
  catalogue,
  redeem,
  redemptionHistory,
  reevaluateTier,
  saveReward,
  saveTier,
  tiers,
];
