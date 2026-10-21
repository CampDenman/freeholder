// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Who gets the credit, worked out from the chain (MASTER.md §4.13, C9.09).
//
// §4.13: "The attribution model is a choice the owner makes and can see: last
// touch (default), first touch, or position-based, with a stated cookie window
// and a server-side record. `AttributionTouch` keeps the whole chain
// regardless, so changing the model does not require re-running history — it
// re-reads it."
//
// That sentence is why this file is a pure function over touches rather than a
// column somewhere. Nothing stores a winner. An owner who switches from
// last-touch to first-touch on Tuesday gets a different, correct answer about
// Monday, with no migration and nobody's history rewritten.
//
// Credit is returned as *shares* rather than a single winner, because
// position-based genuinely splits it and C9.10 has to divide real money by
// these numbers. A model that returned one code would have forced
// position-based to lie.

export type AttributionModel = "last_touch" | "first_touch" | "position_based";

export type Touch = {
  codeId: string;
  at: Date;
};

export type Credit = {
  codeId: string;
  /** Fraction of the conversion, summing to 1 across the result. */
  share: number;
};

/**
 * Touches inside the window, oldest first.
 *
 * The window is the programme's stated one. §4.13 asks for it to be stated
 * because "we did not count that click" is an argument nobody can win without
 * a number both sides agreed to beforehand.
 */
export function withinWindow(touches: Touch[], windowDays: number, now: Date): Touch[] {
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  return touches
    .filter((touch) => touch.at.getTime() >= cutoff)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * Shares by code, for one model over one chain.
 *
 * Position-based is 40/20/40 — the shape almost every analytics product uses,
 * and worth naming rather than leaving as three magic numbers: the click that
 * introduced somebody and the click that closed them are each worth twice
 * everything in between, together.
 *
 * Two edges matter and are handled deliberately rather than by accident:
 * with one touch it takes everything (there is no middle and no second end),
 * and with two the middle share does not exist, so the ends take half each
 * rather than 40% with a fifth going nowhere.
 */
export function creditsFor(model: AttributionModel, ordered: Touch[]): Credit[] {
  if (ordered.length === 0) return [];

  const merge = (weights: Map<string, number>): Credit[] => {
    const total = [...weights.values()].reduce((sum, w) => sum + w, 0);
    if (total === 0) return [];
    return [...weights.entries()]
      .map(([codeId, weight]) => ({ codeId, share: weight / total }))
      .sort((a, b) => b.share - a.share || a.codeId.localeCompare(b.codeId));
  };

  if (model === "first_touch") {
    return [{ codeId: ordered[0]!.codeId, share: 1 }];
  }
  if (model === "last_touch") {
    return [{ codeId: ordered[ordered.length - 1]!.codeId, share: 1 }];
  }

  const weights = new Map<string, number>();
  const add = (codeId: string, weight: number) =>
    weights.set(codeId, (weights.get(codeId) ?? 0) + weight);

  if (ordered.length === 1) {
    add(ordered[0]!.codeId, 1);
    return merge(weights);
  }
  if (ordered.length === 2) {
    add(ordered[0]!.codeId, 0.5);
    add(ordered[1]!.codeId, 0.5);
    return merge(weights);
  }

  add(ordered[0]!.codeId, 0.4);
  add(ordered[ordered.length - 1]!.codeId, 0.4);
  const middle = ordered.slice(1, -1);
  const each = 0.2 / middle.length;
  for (const touch of middle) add(touch.codeId, each);
  return merge(weights);
}
