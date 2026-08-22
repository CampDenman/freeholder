// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What cancelling costs, decided by the terms the customer saw (§4.4, C6.08).
//
// §4.4: "Cancellation is policy-driven, not ad hoc. The policy attached to the
// service decides whether a refund, a credit, or a fee applies, and **the
// customer saw the terms before booking**."
//
// That last clause is the whole design. The terms are *snapshotted onto the
// booking* rather than looked up through the service offering, because a
// policy is a reusable, editable, named thing — and an owner who tightens
// their cancellation window on Tuesday must not thereby change what somebody
// agreed to on Monday. A reference would do exactly that, silently, and the
// first anybody heard of it would be a fee the customer never consented to.
//
// The evaluation is deliberately pure: terms in, money out, no database and no
// clock of its own. That is what makes "cancelling four hours before a £80
// appointment with a 24-hour window costs £20" something a test can state.
import { z } from "zod";

/** §4.4's `CancellationPolicy`, exactly. */
export const CANCELLATION_FEE_TYPES = [
  "none",
  "fixed",
  "percent",
  "forfeit_deposit",
] as const;

export const cancellationTerms = z.object({
  /** Carried so the customer can be told which policy, by the name they saw. */
  name: z.string().trim().min(1).max(80),
  freeUntilHours: z.number().int().min(0).max(8_760),
  feeType: z.enum(CANCELLATION_FEE_TYPES),
  /** Minor units when `fixed`; parts-per-million when `percent`. */
  feeValue: z.number().int().min(0).nullable(),
  rescheduleLimit: z.number().int().min(0).max(100),
  noShowFeeMinor: z.number().int().min(0),
});

export type CancellationTerms = z.infer<typeof cancellationTerms>;

/**
 * The terms in force for a booking that never had a policy attached.
 *
 * Permissive on purpose. An owner who has not configured a policy has not
 * agreed one with their customer either, and inventing a fee out of a missing
 * configuration would charge somebody for the business's own omission.
 */
export const NO_POLICY: CancellationTerms = {
  name: "No cancellation policy",
  freeUntilHours: 0,
  feeType: "none",
  feeValue: null,
  rescheduleLimit: 100,
  noShowFeeMinor: 0,
};

/** Parse what is on the booking, falling back rather than throwing. */
export function termsFrom(stored: unknown): CancellationTerms {
  const parsed = cancellationTerms.safeParse(stored);
  // A row written by an older release, or by hand, still has to cancel. The
  // permissive fallback is the same one an unconfigured policy gets.
  return parsed.success ? parsed.data : NO_POLICY;
}

/**
 * The decision, as it is stored on the booking and shown to both sides.
 *
 * `settled` is deliberately absent: whether the money has actually moved is
 * the invoicing module's fact, not scheduling's, and duplicating it here would
 * create two records that can disagree about whether somebody was refunded.
 */
export const storedOutcome = z.object({
  free: z.boolean(),
  feeMinor: z.number().int().min(0),
  refundDueMinor: z.number().int().min(0),
  outstandingMinor: z.number().int().min(0),
  forfeitsDeposit: z.boolean(),
  paidMinor: z.number().int().min(0),
  valueMinor: z.number().int().min(0),
  currency: z.string().length(3).nullable(),
  policyName: z.string(),
  reason: z.string(),
  decidedAt: z.string(),
});

export type StoredOutcome = z.infer<typeof storedOutcome>;

export interface CancellationOutcome {
  /** Whether it fell inside the free window, or the policy charges nothing. */
  free: boolean;
  /** What the customer owes, in minor units. */
  feeMinor: number;
  /** What goes back to them, once the fee is kept out of what they paid. */
  refundDueMinor: number;
  /** What is still owed beyond what they paid, and so needs invoicing. */
  outstandingMinor: number;
  /** True when the fee is "keep the deposit" rather than a computed amount. */
  forfeitsDeposit: boolean;
  /** Why, in the words the customer should be shown. */
  reason: string;
}

/** The money already recorded against an appointment, from the invoice. */
export interface BookingMoney {
  /** What the appointment was invoiced for. Zero when there is no invoice. */
  valueMinor: number;
  /** What has actually been paid against it. */
  paidMinor: number;
}

function settle(
  feeMinor: number,
  money: BookingMoney,
  parts: { free: boolean; forfeitsDeposit: boolean; reason: string },
): CancellationOutcome {
  const fee = Math.max(0, Math.round(feeMinor));
  return {
    free: parts.free,
    feeMinor: fee,
    // Two directions, and both can be zero. Money already paid above the fee
    // goes back; a fee above what was paid is a debt the business may invoice.
    // Netting them into one signed number reads neatly and then loses the
    // distinction the moment anybody has to act on it.
    refundDueMinor: Math.max(0, money.paidMinor - fee),
    outstandingMinor: Math.max(0, fee - money.paidMinor),
    forfeitsDeposit: parts.forfeitsDeposit,
    reason: parts.reason,
  };
}

/**
 * What cancelling now costs.
 *
 * A percentage is a percentage **of what the appointment was invoiced for**,
 * not of what has been paid. A 50% late-cancellation fee on an £80 booking is
 * £40 whether the customer paid a £20 deposit or the whole thing up front —
 * charging half the deposit instead would quietly make the fee depend on how
 * the business happened to take the money.
 */
export function cancellationOutcome(input: {
  terms: CancellationTerms;
  startsAt: Date;
  now: Date;
  money: BookingMoney;
}): CancellationOutcome {
  const hoursLeft = (input.startsAt.getTime() - input.now.getTime()) / 3_600_000;
  if (hoursLeft >= input.terms.freeUntilHours) {
    return settle(0, input.money, {
      free: true,
      forfeitsDeposit: false,
      reason:
        input.terms.freeUntilHours > 0
          ? `Cancelled with more than ${input.terms.freeUntilHours} hours' notice.`
          : "Cancelled at no charge.",
    });
  }

  const late = `Cancelled with less than ${input.terms.freeUntilHours} hours' notice.`;
  switch (input.terms.feeType) {
    case "none":
      return settle(0, input.money, { free: true, forfeitsDeposit: false, reason: late });
    case "fixed":
      return settle(input.terms.feeValue ?? 0, input.money, {
        free: false,
        forfeitsDeposit: false,
        reason: late,
      });
    case "percent":
      // Parts-per-million, rounded once, at the end. Money is integer minor
      // units all the way through (§4.3) — a float carried between steps is a
      // penny that appears from nowhere on a reconciliation report.
      return settle(
        Math.round((input.money.valueMinor * (input.terms.feeValue ?? 0)) / 1_000_000),
        input.money,
        { free: false, forfeitsDeposit: false, reason: late },
      );
    case "forfeit_deposit":
      // Whatever they put down stays put down, and nothing more is owed. This
      // is the one fee that can never produce an invoice.
      return settle(input.money.paidMinor, input.money, {
        free: false,
        forfeitsDeposit: true,
        reason: late,
      });
  }
}

/**
 * What not turning up costs.
 *
 * Separate from cancelling, and deliberately not bounded by the free window: a
 * no-show has no notice period to fall inside. The fee is a flat figure the
 * owner set, which is why §4.4 gives it its own column rather than reusing the
 * cancellation fee.
 */
export function noShowOutcome(input: {
  terms: CancellationTerms;
  money: BookingMoney;
}): CancellationOutcome {
  if (input.terms.noShowFeeMinor === 0) {
    return settle(0, input.money, {
      free: true,
      forfeitsDeposit: false,
      reason: "Recorded as a no-show. No fee applies.",
    });
  }
  return settle(input.terms.noShowFeeMinor, input.money, {
    free: false,
    forfeitsDeposit: false,
    reason: "Recorded as a no-show.",
  });
}

export interface RescheduleVerdict {
  allowed: boolean;
  /** The sentence the customer is shown when it is refused. */
  reason?: string;
}

/**
 * Whether this appointment may be moved again.
 *
 * Two separate limits, and they refuse for different reasons: a reschedule
 * *count* stops an appointment being moved indefinitely, and the free window
 * stops it being moved at the last minute — which is a cancellation wearing a
 * different hat, and the reason a no-show policy is otherwise trivial to
 * sidestep.
 */
export function mayReschedule(input: {
  terms: CancellationTerms;
  rescheduleCount: number;
  startsAt: Date;
  now: Date;
}): RescheduleVerdict {
  if (input.rescheduleCount >= input.terms.rescheduleLimit) {
    return {
      allowed: false,
      reason:
        input.terms.rescheduleLimit === 0
          ? "This appointment cannot be moved. Please get in touch."
          : `This appointment has already been moved ${input.terms.rescheduleLimit} time(s).`,
    };
  }
  const hoursLeft = (input.startsAt.getTime() - input.now.getTime()) / 3_600_000;
  if (hoursLeft < input.terms.freeUntilHours) {
    return {
      allowed: false,
      reason: `Appointments can be moved up to ${input.terms.freeUntilHours} hours beforehand. Please get in touch.`,
    };
  }
  return { allowed: true };
}
