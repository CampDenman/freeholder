// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Calendar arithmetic for anything that comes round again (C6.17, C7.02).
//
// Extracted from the invoicing module the moment a second caller appeared. A
// recurring invoice and a recurring task ask the same two questions — "when is
// the next one" and "where do I resume after a gap" — and two copies of this
// would drift the first time somebody fixed one of them.
//
// The rule both callers need is that a cadence is *calendar* arithmetic, not a
// number of days. A monthly thing set for the 31st lands on the 30th in April
// rather than drifting a day earlier every other month, which is what adding
// 30 days would do.

/** Every cadence anything in the platform repeats on. */
export const CADENCES = ["daily", "weekly", "monthly", "quarterly", "yearly"] as const;

export type Cadence = (typeof CADENCES)[number];

/**
 * One step of a cadence from a given moment.
 *
 * A day and a week are fixed spans and add directly. Months are not: the
 * date moves to the first before the month is added, so a 31st never rolls
 * through into the following month on its way past February, and is then
 * clamped back to the last real day of wherever it landed.
 */
export function advance(from: Date, cadence: Cadence, intervalCount: number): Date {
  const next = new Date(from.getTime());
  if (cadence === "daily") {
    next.setUTCDate(next.getUTCDate() + intervalCount);
    return next;
  }
  if (cadence === "weekly") {
    next.setUTCDate(next.getUTCDate() + 7 * intervalCount);
    return next;
  }
  const months =
    cadence === "monthly"
      ? intervalCount
      : cadence === "quarterly"
        ? 3 * intervalCount
        : 12 * intervalCount;
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
  ).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

/**
 * The next occurrence strictly after `now`.
 *
 * Loops the cadence forward rather than adding one step, so a thing that fell
 * three months behind resumes at the next real date rather than firing three
 * months of history and still being behind. The bound is a guard against a
 * pathological interval rather than a business rule.
 */
export function nextAfter(
  from: Date,
  now: Date,
  cadence: Cadence,
  intervalCount: number,
): Date {
  let next = advance(from, cadence, intervalCount);
  for (let step = 0; step < 1_000 && next <= now; step++) {
    next = advance(next, cadence, intervalCount);
  }
  return next;
}
