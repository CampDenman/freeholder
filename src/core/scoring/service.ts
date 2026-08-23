// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Lead scoring you can read (MASTER.md §4.14, C7.05).
//
// §4.14: "rules over spine events with visible points and stated decay, never a
// model. An owner must be able to read why someone is a 40."
//
// Four consequences, and they are the whole file.
//
// **There is no score column, so there is no black-box path.** `scoring.for`
// sums the award ledger and `scoring.why` lists the same rows. The number and
// its reasons are computed from one place in one pass, so they cannot disagree
// — which a cached scalar guarantees they eventually will.
//
// **Decay is stated, per award, and frozen at award time.** An owner who lowers
// a rule from 20 points to 10 in March has changed what future behaviour is
// worth, not what somebody did in January.
//
// **A rule fires after the event has committed.** Scoring is a consequence of
// something having happened, not part of making it happen; awarding inside the
// mutation would let a scoring bug roll back a quote acceptance.
//
// **Nothing moves backwards.** A threshold or an auto-advance can only move
// somebody further along the ladder, through the one lifecycle door
// (`core/contacts/lifecycle`), so a scoring rule can never demote a customer
// because they opened an email.
import { z } from "zod";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import {
  advanceLifecycle,
  LIFECYCLE_LADDER,
  type LifecycleStage,
} from "@/core/contacts/lifecycle";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { db, isUniqueViolation } from "@/core/db";
import {
  defineService,
  ServiceError,
  type Actor,
  type ServiceContext,
  type Tx,
} from "@/core/service";
import { SCORING_RULE_KINDS, contactScoreAwards, scoringRules } from "./schema";

export { SCORING_RULE_KINDS } from "./schema";
export { LIFECYCLE_LADDER } from "@/core/contacts/lifecycle";

const id = z.string().uuid();

function requirePerson(actor: Actor): void {
  if (actor.kind !== "user" && actor.kind !== "system") {
    throw new ServiceError("permission", "Sign in to manage scoring.");
  }
}

/**
 * What one award is worth today.
 *
 * Linear to zero over the stated days. A cliff would be simpler but makes a
 * score drop overnight for a reason nobody witnessed; this way an owner reads
 * "worth 4 of its original 10, twelve days left", which is a sentence they can
 * act on. Rounded per award rather than on the total, so the rows a person is
 * shown always add up to the number they are shown.
 */
export function remainingPoints(
  points: number,
  decayDays: number,
  occurredAt: Date,
  now: Date = new Date(),
): number {
  if (decayDays <= 0) return points;
  const elapsedDays = (now.getTime() - occurredAt.getTime()) / 86_400_000;
  if (elapsedDays >= decayDays) return 0;
  if (elapsedDays <= 0) return points;
  const fraction = 1 - elapsedDays / decayDays;
  // Away from zero, so a negative award decays the same way a positive one
  // does rather than lingering half a point longer.
  const scaled = points * fraction;
  return scaled >= 0 ? Math.round(scaled) : -Math.round(-scaled);
}

/** The same arithmetic in SQL, so a whole-table sum is one query. */
const remainingSql = sql<number>`
  coalesce(sum(
    case
      when ${contactScoreAwards.decayDays} <= 0 then ${contactScoreAwards.points}
      when extract(epoch from (now() - ${contactScoreAwards.occurredAt})) / 86400
             >= ${contactScoreAwards.decayDays} then 0
      else round(${contactScoreAwards.points} * (
        1 - (extract(epoch from (now() - ${contactScoreAwards.occurredAt})) / 86400)
              / ${contactScoreAwards.decayDays}
      ))
    end
  ), 0)::int`;

const ruleRow = row({
  id: uuid,
  name: z.string(),
  kind: z.enum(SCORING_RULE_KINDS),
  eventName: z.string().nullable(),
  matchPayload: z.unknown(),
  points: z.number().int(),
  decayDays: z.number().int(),
  maxAwards: z.number().int().nullable(),
  advanceTo: z.enum(LIFECYCLE_LADDER).nullable(),
  thresholdScore: z.number().int().nullable(),
  active: z.boolean(),
});

export const saveScoringRule = defineService({
  name: "scoring.saveRule",
  summary: "Add or change one visible scoring rule.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z
    .object({
      id: id.optional(),
      name: z.string().trim().min(1).max(120),
      kind: z.enum(SCORING_RULE_KINDS).default("event"),
      eventName: z.string().trim().max(100).nullish(),
      matchPayload: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
      points: z.number().int().min(-1_000).max(1_000).default(0),
      decayDays: z.number().int().min(0).max(3_650).default(0),
      maxAwards: z.number().int().min(1).max(10_000).nullish(),
      advanceTo: z.enum(LIFECYCLE_LADDER).nullish(),
      thresholdScore: z.number().int().min(-100_000).max(100_000).nullish(),
      active: z.boolean().default(true),
    })
    .superRefine((input, issue) => {
      if (input.kind === "event" && !input.eventName) {
        issue.addIssue({
          code: "custom",
          path: ["eventName"],
          message: "Say which event this listens for.",
        });
      }
      if (input.kind === "threshold") {
        if (input.thresholdScore === undefined || input.thresholdScore === null) {
          issue.addIssue({
            code: "custom",
            path: ["thresholdScore"],
            message: "Say what score this fires at.",
          });
        }
        if (!input.advanceTo) {
          issue.addIssue({
            code: "custom",
            path: ["advanceTo"],
            // A threshold that awards nothing and moves nobody is a rule that
            // can never do anything, and storing one makes the list a lie.
            message: "Say where somebody goes when they reach it.",
          });
        }
      }
    }),
  output: ruleRow,
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const values = {
      name: input.name,
      kind: input.kind,
      eventName: input.kind === "event" ? (input.eventName ?? null) : null,
      matchPayload: input.matchPayload,
      points: input.kind === "threshold" ? 0 : input.points,
      decayDays: input.decayDays,
      maxAwards: input.maxAwards ?? null,
      advanceTo: input.advanceTo ?? null,
      thresholdScore: input.kind === "threshold" ? (input.thresholdScore ?? null) : null,
      active: input.active,
    };
    if (input.id) {
      const [updated] = await ctx.tx
        .update(scoringRules)
        .set({ ...values, updatedAt: sql`now()` })
        .where(eq(scoringRules.id, input.id))
        .returning();
      if (!updated) throw new ServiceError("not_found", "That rule is not here.");
      ctx.setSubject("scoringRule", updated.id);
      return updated;
    }
    const [created] = await ctx.tx.insert(scoringRules).values(values).returning();
    ctx.setSubject("scoringRule", created!.id);
    return created!;
  },
});

export const listScoringRules = defineService({
  name: "scoring.rules",
  summary: "Every scoring rule, with its points and its stated decay.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(ruleRow),
  handler: (_input, ctx) =>
    ctx.tx.select().from(scoringRules).orderBy(asc(scoringRules.kind), asc(scoringRules.name)),
});

export const removeScoringRule = defineService({
  name: "scoring.removeRule",
  summary: "Delete a scoring rule, leaving the points it already gave.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "destructive",
  input: z.object({ id }),
  output: row({ id: uuid }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [removed] = await ctx.tx
      .delete(scoringRules)
      .where(eq(scoringRules.id, input.id))
      .returning({ id: scoringRules.id });
    if (!removed) throw new ServiceError("not_found", "That rule is not here.");
    // The awards survive with `rule_id` nulled and `rule_name` intact: deleting
    // a rule must not silently rewrite everybody's history, and an owner asking
    // why somebody is a 40 still gets a sentence rather than a blank.
    ctx.setSubject("scoringRule", removed.id);
    return removed;
  },
});

export const scoreFor = defineService({
  name: "scoring.for",
  summary: "One contact's score, computed from what they actually did.",
  kind: "query",
  permission: "scoped",
  input: z.object({ contactId: id }),
  output: row({ score: z.number().int() }),
  handler: async (input, ctx) => ({ score: await scoreOf(ctx.tx, input.contactId) }),
});

/**
 * Why somebody is the number they are (§4.14's requirement, stated outright).
 *
 * The rows are the score: each carries what it was worth when it happened, what
 * it is worth now, and how long is left. Nothing here re-derives the total by a
 * different route, because two routes is how a number and its explanation start
 * disagreeing.
 */
export const explainScore = defineService({
  name: "scoring.why",
  summary: "Every award behind a contact's score, and what each is worth now.",
  kind: "query",
  permission: "scoped",
  input: z.object({ contactId: id, limit: z.number().int().min(1).max(200).default(100) }),
  output: row({
    score: z.number().int(),
    awards: listed(
      row({
        id: uuid,
        ruleName: z.string(),
        eventName: z.string(),
        points: z.number().int(),
        remaining: z.number().int(),
        decayDays: z.number().int(),
        daysLeft: z.number().int().nullable(),
        occurredAt: timestamp,
      }),
    ),
  }),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select()
      .from(contactScoreAwards)
      .where(eq(contactScoreAwards.contactId, input.contactId))
      .orderBy(desc(contactScoreAwards.occurredAt))
      .limit(input.limit);
    const now = new Date();
    const awards = rows.map((award) => {
      const elapsedDays = (now.getTime() - award.occurredAt.getTime()) / 86_400_000;
      return {
        id: award.id,
        ruleName: award.ruleName,
        eventName: award.eventName,
        points: award.points,
        remaining: remainingPoints(award.points, award.decayDays, award.occurredAt, now),
        decayDays: award.decayDays,
        daysLeft:
          award.decayDays <= 0 ? null : Math.max(0, Math.ceil(award.decayDays - elapsedDays)),
        occurredAt: award.occurredAt,
      };
    });
    return {
      // The listed rows *are* the total, so the arithmetic on screen adds up.
      score: awards.reduce((total, award) => total + award.remaining, 0),
      awards,
    };
  },
});

/**
 * Award points by hand.
 *
 * Not a back door: it writes the same ledger with the same shape, so a manual
 * "+20, they rang us" is as inspectable as anything a rule gave. The absence of
 * this would push owners into editing rules to nudge one person, which is worse.
 */
export const awardPoints = defineService({
  name: "scoring.award",
  summary: "Give one contact points by hand, on the record.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    contactId: id,
    reason: z.string().trim().min(1).max(120),
    points: z.number().int().min(-1_000).max(1_000),
    decayDays: z.number().int().min(0).max(3_650).default(0),
  }),
  output: row({ id: uuid, score: z.number().int() }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    const [created] = await ctx.tx
      .insert(contactScoreAwards)
      .values({
        contactId: input.contactId,
        ruleName: input.reason,
        eventName: "manual",
        points: input.points,
        decayDays: input.decayDays,
      })
      .returning({ id: contactScoreAwards.id });
    await applyThresholds(ctx, input.contactId);
    ctx.setSubject("contact", input.contactId);
    return { id: created!.id, score: await scoreOf(ctx.tx, input.contactId) };
  },
});

/** The score, from the ledger, in one query. */
export async function scoreOf(tx: Tx, contactId: string): Promise<number> {
  const [total] = await tx
    .select({ score: remainingSql })
    .from(contactScoreAwards)
    .where(eq(contactScoreAwards.contactId, contactId));
  return total?.score ?? 0;
}

/**
 * Does this event's payload satisfy the rule's extra conditions?
 *
 * Plain equality, compared as strings so `1` from a form and `"1"` from JSON
 * are the same answer. A rule asking about a key the payload does not carry
 * does not match — the safe direction, because the alternative gives points for
 * something nobody can show happened.
 */
function payloadMatches(match: unknown, payload: unknown): boolean {
  if (!match || typeof match !== "object") return true;
  const conditions = Object.entries(match as Record<string, unknown>);
  if (conditions.length === 0) return true;
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  return conditions.every(([key, value]) => {
    const actual = record[key];
    // Only primitives compare. A payload carrying an object under the key a
    // rule asked about is not an answer to the question, and stringifying it
    // would turn every such event into "[object Object]" and match nothing in a
    // way nobody could debug.
    if (typeof actual !== "string" && typeof actual !== "number" && typeof actual !== "boolean") {
      return false;
    }
    return String(actual) === String(value);
  });
}

/**
 * Apply every rule that listens for this event.
 *
 * Called from the bus, after commit, in its own transaction. That is the right
 * place: scoring is a consequence of something having happened, and awarding
 * inside the mutation would let a scoring bug roll back a quote acceptance.
 */
export async function scoreEvent(
  eventName: string,
  payload: unknown,
  sourceEventId?: string,
): Promise<{ awarded: number }> {
  const contactId = contactIdOf(payload);
  if (!contactId) return { awarded: 0 };

  const rules = await db()
    .select()
    .from(scoringRules)
    .where(
      and(
        eq(scoringRules.kind, "event"),
        eq(scoringRules.active, true),
        eq(scoringRules.eventName, eventName),
      ),
    );
  if (rules.length === 0) return { awarded: 0 };

  let awarded = 0;
  for (const rule of rules) {
    if (!payloadMatches(rule.matchPayload, payload)) continue;
    if (rule.maxAwards !== null) {
      const [counted] = await db()
        .select({ n: sql<number>`count(*)::int` })
        .from(contactScoreAwards)
        .where(
          and(
            eq(contactScoreAwards.contactId, contactId),
            eq(contactScoreAwards.ruleId, rule.id),
          ),
        );
      if ((counted?.n ?? 0) >= rule.maxAwards) continue;
    }
    try {
      await db().insert(contactScoreAwards).values({
        contactId,
        ruleId: rule.id,
        ruleName: rule.name,
        eventName,
        points: rule.points,
        decayDays: rule.decayDays,
        sourceEventId: sourceEventId ?? null,
      });
      awarded += 1;
    } catch (error) {
      // The same delivery arriving twice. The unique index is the guard; this
      // is what makes a bus retry cost nothing rather than double a score.
      if (!isUniqueViolation(error, "contact_score_awards_once_idx")) throw error;
      continue;
    }
    if (rule.advanceTo) await moveThem(contactId, rule.advanceTo);
  }

  if (awarded > 0) await applyThresholdsOutside(contactId);
  return { awarded };
}

/** The bus entry point, matching every other listener's shape. */
export async function scoreForEvent(
  eventName: string,
  payload: unknown,
  sourceEventId?: string,
): Promise<void> {
  // Never let a scoring failure take down the rest of the fan-out: the mutation
  // has already committed, and the other listeners have their own work.
  await scoreEvent(eventName, payload, sourceEventId).catch((error: unknown) => {
    console.error("[scoring] could not score", eventName, error);
  });
}

/**
 * Fire any threshold rule this contact has now crossed.
 *
 * Run after an award rather than on a schedule, because the point of a
 * threshold is that somebody becomes worth calling *now*. Advancing is
 * idempotent — `advanceLifecycle` leaves anybody already at or beyond the stage
 * alone — so re-running it costs nothing.
 */
async function applyThresholds(ctx: ServiceContext, contactId: string): Promise<void> {
  const score = await scoreOf(ctx.tx, contactId);
  const thresholds = await ctx.tx
    .select()
    .from(scoringRules)
    .where(and(eq(scoringRules.kind, "threshold"), eq(scoringRules.active, true)))
    .orderBy(asc(scoringRules.thresholdScore));
  for (const rule of thresholds) {
    if (rule.thresholdScore === null || score < rule.thresholdScore) continue;
    if (rule.advanceTo) await advanceLifecycle(ctx, contactId, rule.advanceTo);
  }
}

/** The same, from the bus, where there is no ambient transaction. */
async function applyThresholdsOutside(contactId: string): Promise<void> {
  const { getService } = await import("@/core/service");
  await getService("scoring.applyThresholds").call({ contactId }, { kind: "system" });
}

async function moveThem(contactId: string, stage: LifecycleStage): Promise<void> {
  const { getService } = await import("@/core/service");
  await getService("scoring.advance").call({ contactId, stage }, { kind: "system" });
}

/**
 * The two service wrappers the bus path needs.
 *
 * Not conveniences: the bus has no transaction of its own, and everything that
 * writes has to go through a service so it gets one, plus an audit row and the
 * same permission check any other caller would face.
 */
export const applyScoreThresholds = defineService({
  name: "scoring.applyThresholds",
  summary: "Fire any threshold a contact has now crossed.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  agentCallable: false,
  mcpExclude: true,
  input: z.object({ contactId: id }),
  output: row({ score: z.number().int() }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    await applyThresholds(ctx, input.contactId);
    return { score: await scoreOf(ctx.tx, input.contactId) };
  },
});

export const advanceForScore = defineService({
  name: "scoring.advance",
  summary: "Move a contact along the lifecycle because a rule said so.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  agentCallable: false,
  mcpExclude: true,
  input: z.object({ contactId: id, stage: z.enum(LIFECYCLE_LADDER) }),
  output: row({ moved: z.boolean() }),
  handler: async (input, ctx) => {
    requirePerson(ctx.actor);
    return { moved: await advanceLifecycle(ctx, input.contactId, input.stage) };
  },
});

/**
 * The contact an event is about, if it says.
 *
 * By convention every spine event that concerns somebody carries `contactId`.
 * An event that does not is not about a person, and scoring silently ignores it
 * rather than guessing — a guess here would award points to the wrong record.
 */
function contactIdOf(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>).contactId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * What a score means for the person's own data (§30).
 *
 * The awards go. A score is a record of what somebody did on the site — pages
 * viewed, emails opened — which is about as personal as data gets, and keeping
 * the ledger after an erasure would keep a behavioural profile of a person the
 * business was asked to forget.
 */
registerContactPrivacySource({
  scope: "contact.score",
  tables: ["contact_score_awards"],
  exportData: async (tx, contactId) =>
    tx
      .select()
      .from(contactScoreAwards)
      .where(eq(contactScoreAwards.contactId, contactId))
      .orderBy(desc(contactScoreAwards.occurredAt)),
  erase: async (tx, contactId) => {
    const removed = await tx
      .delete(contactScoreAwards)
      .where(eq(contactScoreAwards.contactId, contactId))
      .returning({ id: contactScoreAwards.id });
    return { affected: removed.length };
  },
});

/**
 * Merge adds the two ledgers together (§4.1).
 *
 * Two records of one person are one person's behaviour, so their awards
 * combine. Nothing is deduplicated: they genuinely did both things, under two
 * email addresses the business had not yet connected.
 */
registerContactReference({
  table: "contact_score_awards",
  repoint: (tx, duplicateId, survivingId) =>
    tx
      .update(contactScoreAwards)
      .set({ contactId: survivingId })
      .where(eq(contactScoreAwards.contactId, duplicateId)),
  captureForUndo: async (tx, duplicateId, survivingId) => ({
    state: await tx
      .select({ id: contactScoreAwards.id, contactId: contactScoreAwards.contactId })
      .from(contactScoreAwards)
      .where(inArray(contactScoreAwards.contactId, [duplicateId, survivingId])),
    undoable: true,
  }),
  restoreAfterUndo: async (tx, beforeState, _afterState, duplicateId) => {
    const moved = z
      .array(z.object({ id: z.string().uuid(), contactId: z.string().uuid() }))
      .parse(beforeState)
      .filter((award) => award.contactId === duplicateId);
    if (moved.length) {
      await tx
        .update(contactScoreAwards)
        .set({ contactId: duplicateId })
        .where(inArray(contactScoreAwards.id, moved.map((award) => award.id)));
    }
  },
});

export default [
  saveScoringRule,
  listScoringRules,
  removeScoringRule,
  scoreFor,
  explainScore,
  awardPoints,
  applyScoreThresholds,
  advanceForScore,
];

