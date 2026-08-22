// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What a hire costs, and what a late or broken return comes to (C6.10).
//
// Pure: terms and times in, integer minor units out, no database and no clock
// of its own. That is what makes "three days late on a £15-a-day tripod is
// £45" something a test can state rather than something a reviewer has to
// trace through a service.
//
// **A hire is not a payment** (§4.3's line, held here as it is for
// cancellations in C6.08). Everything below *decides* an amount; charging it
// is a deliberate act in invoicing with the step-up that implies.

/** Hours in one billable unit. A week is seven days, not five. */
const HOURS: Record<"hour" | "day" | "week", number> = {
  hour: 1,
  day: 24,
  week: 24 * 7,
};

export type RentalUnit = keyof typeof HOURS;

/**
 * How many units a window covers, rounded **up**.
 *
 * A day rate is what somebody pays for having the thing overnight, so
 * twenty-five hours is two days rather than 1.04 of them. Rounding down would
 * mean the business hires out a fortnight's use for a week's money the first
 * time somebody asked for eight days.
 */
export function unitsBetween(startsAt: Date, endsAt: Date, unit: RentalUnit): number {
  const hours = (endsAt.getTime() - startsAt.getTime()) / 3_600_000;
  if (hours <= 0) return 0;
  return Math.max(1, Math.ceil(hours / HOURS[unit]));
}

export interface RentalTermsShape {
  unit: RentalUnit;
  minUnits: number;
  maxUnits: number | null;
  depositMinor: number;
  damagePolicy: "deposit_only" | "repair_cost" | "replacement";
  replacementValueMinor: number;
  lateFeePerUnitMinor: number;
}

export interface Quote {
  units: number;
  /** The hire itself: units times whatever the catalogue says a unit costs. */
  hireMinor: number;
  depositMinor: number;
  dueNowMinor: number;
}

/**
 * What this hire comes to at a given unit rate.
 *
 * The rate is passed in rather than looked up, because pricing belongs to the
 * catalogue (§4.2's price lists and breaks) and a second place to compute a
 * price is a second answer the first time somebody edits one of them.
 */
export function quoteRental(input: {
  terms: RentalTermsShape;
  unitRateMinor: number;
  startsAt: Date;
  endsAt: Date;
}): Quote {
  const units = Math.max(
    input.terms.minUnits,
    unitsBetween(input.startsAt, input.endsAt, input.terms.unit),
  );
  const hireMinor = units * Math.max(0, input.unitRateMinor);
  return {
    units,
    hireMinor,
    depositMinor: input.terms.depositMinor,
    // Both up front: the deposit is a hold, and the hire is the sale. They are
    // one payment to the customer and two lines on the invoice.
    dueNowMinor: hireMinor + input.terms.depositMinor,
  };
}

export interface ReturnOutcome {
  /** Units past due, zero when it came back on time or early. */
  unitsLate: number;
  lateFeeMinor: number;
  damageFeeMinor: number;
  /** What goes back of the deposit once the fees are kept out of it. */
  depositRefundMinor: number;
  /** What is owed beyond the deposit, and so needs invoicing. */
  outstandingMinor: number;
  /** Why, in the words the customer should be shown. */
  reason: string;
}

/**
 * What the return came to.
 *
 * Two directions again, and both can be zero: money held above the fees goes
 * back, and fees above the deposit are a debt the business may invoice.
 * Netting them into one signed number reads neatly and then loses the
 * distinction the moment anybody has to act on it (C6.08 made the same call).
 */
export function returnOutcome(input: {
  terms: RentalTermsShape;
  dueAt: Date;
  returnedAt: Date;
  condition: "fine" | "damaged" | "lost";
  /** What the repair actually cost, when the policy charges for repairs. */
  repairCostMinor?: number;
}): ReturnOutcome {
  const unitsLate = unitsBetween(input.dueAt, input.returnedAt, input.terms.unit);
  const lateFeeMinor = unitsLate * input.terms.lateFeePerUnitMinor;

  let damageFeeMinor = 0;
  if (input.condition === "lost") {
    // Lost is replacement, whatever the damage policy says: there is nothing
    // left to repair and nothing left to inspect.
    damageFeeMinor = input.terms.replacementValueMinor;
  } else if (input.condition === "damaged") {
    damageFeeMinor =
      input.terms.damagePolicy === "replacement"
        ? input.terms.replacementValueMinor
        : input.terms.damagePolicy === "repair_cost"
          ? Math.max(0, Math.round(input.repairCostMinor ?? 0))
          : // `deposit_only` means exactly that: the deposit is the whole
            // remedy, and the business never sends a bill on top of it.
            input.terms.depositMinor;
  }

  const fees = lateFeeMinor + damageFeeMinor;
  const capped =
    input.terms.damagePolicy === "deposit_only" && input.condition !== "lost"
      ? Math.min(fees, input.terms.depositMinor)
      : fees;

  const parts: string[] = [];
  if (unitsLate > 0) parts.push(`${unitsLate} ${input.terms.unit}(s) late`);
  if (input.condition === "damaged") parts.push("returned damaged");
  if (input.condition === "lost") parts.push("not returned");

  return {
    unitsLate,
    lateFeeMinor,
    damageFeeMinor,
    depositRefundMinor: Math.max(0, input.terms.depositMinor - capped),
    outstandingMinor: Math.max(0, capped - input.terms.depositMinor),
    reason: parts.length === 0 ? "Returned on time and in good order." : `Returned ${parts.join(", ")}.`,
  };
}
