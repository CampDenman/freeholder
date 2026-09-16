// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Whether a line item still has delivery left (MASTER.md §4.16, C9.19).
//
// Pure, like targeting and fill choice: "this campaign has used its goal" is
// the sentence an advertiser disputes, and it has to be checkable without a
// database. The numbers come from the daily rollup; this only compares them.
export type Pacing = "even" | "asap";

export interface PaceInput {
  pacing: Pacing;
  startsAt: Date | null;
  endsAt: Date | null;
  now: Date;
  goal: number | null;
  delivered: number;
  budgetCents: number | null;
  spentCents: number;
}

/**
 * Even pacing may run 10% ahead of the ideal line.
 *
 * A campaign that is forced to hit the line exactly will under-deliver every
 * time traffic is lumpy; a little headroom is how "even" still fills a
 * morning that was quieter than the model.
 */
export const EVEN_HEADROOM = 1.1;

/** Still allowed to run, given what it has already delivered. */
export function withinPace(input: PaceInput): boolean {
  if (input.goal !== null && input.delivered >= input.goal) return false;
  if (input.budgetCents !== null && input.spentCents >= input.budgetCents) return false;
  if (input.pacing === "asap") return true;
  if (input.goal === null || !input.startsAt || !input.endsAt) return true;
  const total = input.endsAt.getTime() - input.startsAt.getTime();
  if (total <= 0) return input.delivered < input.goal;
  const elapsed = Math.min(Math.max(input.now.getTime() - input.startsAt.getTime(), 0), total);
  const expected = input.goal * (elapsed / total);
  return input.delivered <= expected * EVEN_HEADROOM;
}

/** Frequency cap: how many times this visitor has already seen it. */
export function withinFrequency(cap: number | null, seen: number): boolean {
  if (cap === null) return true;
  return seen < cap;
}
