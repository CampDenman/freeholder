// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What the assistant is allowed to spend, and how often it may answer
// (MASTER.md §31, §40, C9.21).
//
// Everything here is a *read*, and that is the whole design. §40's rule — "a
// budget in cents checked *before* each step rather than tallied afterwards" —
// is what turns a number in a settings form into a promise; a tally only tells
// an owner what they already owe. And a predictable refusal has to be decided
// before anything is written, because a failed statement aborts a Postgres
// transaction: a module that discovered its budget was gone by trying to spend
// it could not then record that it had refused.
//
// The money helpers come from `core/agents/pricing` rather than being copied.
// A second implementation of "what did that turn cost" is a second answer, and
// §15.4's integer-minor-unit discipline is not something to get right twice.
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { modelPrice, turnCostCents, type ModelPrice } from "@/core/agents/pricing";
import type { Tx } from "@/core/service";
import type { AssistantSpendPeriod } from "./contract";
import { assistantTurns, type AssistantSettings } from "./schema";

/** Roughly four characters to a token. Deliberately an over-estimate. */
const CHARS_PER_TOKEN = 4;

export interface SpendState {
  capCents: number;
  period: AssistantSpendPeriod;
  spentCents: number;
  remainingCents: number;
}

/** What the assistant has spent in the current window. */
export async function periodSpend(
  tx: Tx,
  period: AssistantSpendPeriod,
): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`coalesce(sum(${assistantTurns.costCents}), 0)::int` })
    .from(assistantTurns)
    .where(sql`${assistantTurns.createdAt} >= date_trunc(${period}, now())`);
  return row?.total ?? 0;
}

/**
 * Outcomes in which the visitor was actually spoken to.
 *
 * `refused_scope` belongs here: the model asked for something out of bounds,
 * the module refused the act, and the words still went out. Counting it as a
 * non-reply would let a visitor whose every turn is refused talk forever.
 */
export const REPLYING_OUTCOMES = ["answered", "refused_scope"] as const;

/** Answers given across the whole site in the last hour. */
export async function repliesInLastHour(tx: Tx): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(assistantTurns)
    .where(
      and(
        inArray(assistantTurns.outcome, [...REPLYING_OUTCOMES]),
        gte(assistantTurns.createdAt, sql`now() - interval '1 hour'`),
      ),
    );
  return row?.total ?? 0;
}

/** Answers already given in one conversation. */
export async function repliesOnConversation(
  tx: Tx,
  conversationId: string,
): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(assistantTurns)
    .where(
      and(
        eq(assistantTurns.conversationId, conversationId),
        inArray(assistantTurns.outcome, [...REPLYING_OUTCOMES]),
      ),
    );
  return row?.total ?? 0;
}

/**
 * The price of this instance's model.
 *
 * An owner-set price always wins: they know what their contract says, and a
 * platform that overrode it would be telling an owner their own invoice is
 * wrong. Null means unpriced, and an unpriced model may not spend — the
 * fail-closed direction, because a cap enforced against a guess is not a cap.
 */
export function assistantPrice(settings: AssistantSettings): ModelPrice | null {
  return modelPrice(settings.model, {
    ...(settings.inputCentsPerMillion === null
      ? {}
      : { inputCentsPerMillion: settings.inputCentsPerMillion }),
    ...(settings.outputCentsPerMillion === null
      ? {}
      : { outputCentsPerMillion: settings.outputCentsPerMillion }),
  });
}

/**
 * What the next answer might cost, before it is asked for.
 *
 * A budget check needs a number the turn has not produced yet, so this
 * over-estimates on both sides: the whole prompt as input, the full output
 * ceiling as output. Under-estimating would let the last answer of a period
 * cross the cap that exists to hold it.
 */
export function estimateTurnCents(
  price: ModelPrice,
  prompt: string,
  maxOutputTokens: number,
): number {
  return turnCostCents(price, {
    inputTokens: Math.ceil(prompt.length / CHARS_PER_TOKEN) + 200,
    outputTokens: maxOutputTokens,
  });
}

export type AssistantRefusal =
  | { kind: "unpriced" }
  | { kind: "no_budget" }
  | { kind: "period_exhausted"; spend: SpendState }
  | { kind: "would_exceed"; spend: SpendState; estimateCents: number }
  | { kind: "hourly_cap"; limit: number }
  | { kind: "conversation_cap"; limit: number };

/** Plain English for an owner reading the admin, from the machine reason. */
export function refusalDetail(refusal: AssistantRefusal): string {
  switch (refusal.kind) {
    case "unpriced":
      return "The platform does not know what this model costs, so the assistant may not spend against its budget. Set a price on the assistant's settings, or choose a model with a published price.";
    case "no_budget":
      return "The assistant has no budget, so it cannot answer. Set one in Settings — every answer costs money.";
    case "period_exhausted":
      return `The assistant has spent its ${refusal.spend.period}ly budget (${refusal.spend.spentCents} of ${refusal.spend.capCents} cents).`;
    case "would_exceed":
      return `The next answer could cost ${refusal.estimateCents} cents and only ${refusal.spend.remainingCents} are left in this ${refusal.spend.period}'s budget.`;
    case "hourly_cap":
      return `The assistant has already answered ${refusal.limit} times this hour, which is its limit.`;
    case "conversation_cap":
      return `The assistant has already answered ${refusal.limit} times in this conversation, which is its limit.`;
  }
}

/** Which outcome a refusal is recorded as. */
export function refusalOutcome(
  refusal: AssistantRefusal,
): "refused_spend" | "refused_rate" | "refused_conversation_cap" {
  switch (refusal.kind) {
    case "hourly_cap":
      return "refused_rate";
    case "conversation_cap":
      return "refused_conversation_cap";
    default:
      return "refused_spend";
  }
}

export interface AllowanceInput {
  settings: AssistantSettings;
  spentCents: number;
  repliesThisHour: number;
  repliesHere: number;
  price: ModelPrice | null;
  estimateCents: number;
}

/**
 * The whole allow/refuse decision, as one pure function.
 *
 * Pure so the ordering — rate limits before money, cheapest refusal first —
 * can be proved without a database standing behind it, and so the same
 * decision the answer path makes is the one the admin screen displays.
 */
export function allowance(input: AllowanceInput):
  | { allowed: true; spend: SpendState; price: ModelPrice }
  | { allowed: false; refusal: AssistantRefusal } {
  const { settings } = input;
  // No "zero means unlimited" anywhere below. Every one of these is a ceiling,
  // so a zero read as "unset" would turn the strictest setting an owner can
  // type into the loosest one the platform has.
  if (input.repliesHere >= settings.repliesPerConversation) {
    return {
      allowed: false,
      refusal: { kind: "conversation_cap", limit: settings.repliesPerConversation },
    };
  }
  if (input.repliesThisHour >= settings.repliesPerHour) {
    return { allowed: false, refusal: { kind: "hourly_cap", limit: settings.repliesPerHour } };
  }
  if (settings.spendCapCents <= 0) return { allowed: false, refusal: { kind: "no_budget" } };
  if (!input.price) return { allowed: false, refusal: { kind: "unpriced" } };

  const spend: SpendState = {
    capCents: settings.spendCapCents,
    period: settings.spendPeriod,
    spentCents: input.spentCents,
    remainingCents: Math.max(0, settings.spendCapCents - input.spentCents),
  };
  if (spend.remainingCents <= 0) {
    return { allowed: false, refusal: { kind: "period_exhausted", spend } };
  }
  if (input.estimateCents > spend.remainingCents) {
    return {
      allowed: false,
      refusal: { kind: "would_exceed", spend, estimateCents: input.estimateCents },
    };
  }
  return { allowed: true, spend, price: input.price };
}
