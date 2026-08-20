// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What a managed model turn costs (C4.06, MASTER.md §40: "Everything costs
// money, and the money is counted").
//
// Prices are integers — cents per million tokens — and every calculation runs
// in bigint with explicit half-up rounding, because §15.4's rule that money
// is integer minor units does not stop applying just because the money is
// owed to a model provider rather than by a customer.
//
// The rounding helper is local rather than imported from invoicing: core does
// not depend on modules (that direction is the whole point of §11), and this
// is four lines of arithmetic, not a shared abstraction waiting to happen.

/** Cents per million tokens, in and out. Both integers. */
export interface ModelPrice {
  inputCentsPerMillion: number;
  outputCentsPerMillion: number;
}

/**
 * Published list prices for the models this platform ships knowledge of.
 *
 * Deliberately small and deliberately explicit: a wrong number here bills an
 * owner's budget wrongly, so this table holds only models whose price is
 * published and stable, and everything else is priced by the owner on the
 * connection. A provider's price change is a one-line edit with a date in the
 * commit — not a silent drift, and never a guess.
 *
 * Anthropic list prices, current at 2026-06-24.
 */
export const KNOWN_MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  "claude-fable-5": { inputCentsPerMillion: 1_000, outputCentsPerMillion: 5_000 },
  "claude-mythos-5": { inputCentsPerMillion: 1_000, outputCentsPerMillion: 5_000 },
  "claude-opus-5": { inputCentsPerMillion: 500, outputCentsPerMillion: 2_500 },
  "claude-opus-4-8": { inputCentsPerMillion: 500, outputCentsPerMillion: 2_500 },
  "claude-opus-4-7": { inputCentsPerMillion: 500, outputCentsPerMillion: 2_500 },
  "claude-opus-4-6": { inputCentsPerMillion: 500, outputCentsPerMillion: 2_500 },
  "claude-sonnet-5": { inputCentsPerMillion: 300, outputCentsPerMillion: 1_500 },
  "claude-sonnet-4-6": { inputCentsPerMillion: 300, outputCentsPerMillion: 1_500 },
  "claude-haiku-4-5": { inputCentsPerMillion: 100, outputCentsPerMillion: 500 },
};

/**
 * The price for one connection's model.
 *
 * An owner-set price on the connection always wins: they know what their
 * contract says, and a platform that overrode it would be telling an owner
 * their own invoice is wrong. Null means unpriced — the caller must then
 * refuse to spend rather than guess, which is what makes a budget a promise.
 */
export function modelPrice(
  model: string | null,
  override: Partial<ModelPrice> = {},
): ModelPrice | null {
  const input = override.inputCentsPerMillion;
  const output = override.outputCentsPerMillion;
  if (typeof input === "number" && typeof output === "number") {
    return { inputCentsPerMillion: input, outputCentsPerMillion: output };
  }
  if (!model) return null;
  return KNOWN_MODEL_PRICES[model] ?? null;
}

/** Half-up rounding of a non-negative ratio, in bigint. */
function roundRatio(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const doubled = (numerator % denominator) * 2n;
  return doubled >= denominator ? quotient + 1n : quotient;
}

const PER_MILLION = 1_000_000n;

/**
 * Cost of a turn, in whole cents, rounded half-up once at the end.
 *
 * Rounding once on the combined total rather than per direction is the
 * difference between a run of twenty cheap turns costing what it actually
 * cost and costing twenty half-cent rounding errors more.
 */
export function turnCostCents(
  price: ModelPrice,
  usage: { inputTokens: number; outputTokens: number },
): number {
  const input = BigInt(Math.max(0, Math.trunc(usage.inputTokens)));
  const output = BigInt(Math.max(0, Math.trunc(usage.outputTokens)));
  const total =
    input * BigInt(price.inputCentsPerMillion) +
    output * BigInt(price.outputCentsPerMillion);
  return Number(roundRatio(total, PER_MILLION));
}

/**
 * What the *next* turn might cost, before it is made.
 *
 * §40 requires the budget checked before each step rather than tallied after,
 * and a check needs a number the turn has not produced yet. So this is a
 * deliberate over-estimate: the largest input seen so far in this run (a
 * transcript only grows), plus the full output ceiling, because a budget that
 * under-estimates would let a run cross the cap it exists to hold.
 */
export function estimateNextTurnCents(
  price: ModelPrice,
  seen: { largestInputTokens: number; maxOutputTokens: number },
): number {
  const floor = 2_000;
  return turnCostCents(price, {
    inputTokens: Math.max(seen.largestInputTokens, floor),
    outputTokens: seen.maxOutputTokens,
  });
}
