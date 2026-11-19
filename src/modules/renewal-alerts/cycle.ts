// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// When the next charge lands.
//
// Extracted from the look-ahead job because the write surface needs the same
// answer: `next_renewal_at` is computed when somebody adds or edits a tracked
// charge, and rolled forward later by the sweep. Two implementations of "when
// does this renew" would agree until one of them learned something about
// calendar months that the other did not.
import type { RenewalCycle } from "./schema";

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The first renewal strictly after `from`, counting from the first charge.
 *
 * Counted forward from the anchor rather than added to "now", so a charge
 * nobody looked at for six months lands on the date it would always have
 * landed on. Monthly steps use calendar months (`setUTCMonth`), so a charge
 * anchored on the 31st follows the month's length instead of drifting by the
 * two or three days a fixed 30-day step would lose each time.
 */
export function nextRenewalAfter(
  firstChargeAt: Date,
  cycle: RenewalCycle,
  customIntervalDays: number | null,
  from: Date,
): Date {
  const next = new Date(firstChargeAt.getTime());
  if (next > from) return next;

  // Bounded: a daily custom cycle anchored a decade back is ~3,650 steps, and
  // an unbounded `while` here would be a hang rather than a wrong answer.
  const LIMIT = 10_000;
  for (let step = 0; step < LIMIT; step += 1) {
    if (cycle === "custom") {
      const days = customIntervalDays && customIntervalDays > 0 ? customIntervalDays : 30;
      next.setTime(next.getTime() + days * DAY_MS);
    } else if (cycle === "annual") {
      next.setUTCFullYear(next.getUTCFullYear() + 1);
    } else {
      next.setUTCMonth(next.getUTCMonth() + 1);
    }
    if (next > from) return next;
  }
  return next;
}
