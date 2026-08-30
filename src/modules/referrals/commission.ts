// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What a conversion is worth, and how it divides (MASTER.md §4.3, §4.13, C9.10).
//
// This file is pure arithmetic over integers, deliberately, and it is separate
// from the service for the same reason `attribution.ts` is: the question "why
// was I paid this" has to be answerable without a database. Every number a
// referrer ever disputes is produced here.
//
// Two properties are load-bearing and are asserted in
// `tests/modules/referrals-commission.test.ts`:
//
//   1. **Money in, money out.** Splitting a commission between several
//      referrers never invents or loses a minor unit. Position-based
//      attribution divides by thirds and fifths; naive rounding of each share
//      independently loses a penny on most amounts and gains one on some,
//      which over a year is a discrepancy an accountant has to chase.
//   2. **No floats reach an amount.** Shares arrive as parts-per-million
//      integers and stay integers all the way to the row.

/** The `commission` jsonb on an affiliate programme (§4.3). */
export type CommissionConfig = {
  /**
   * `none` is a real setting, not an absent one.
   *
   * §4.13: "Dual-sided rewards can pay in points. A referrer may earn
   * commission, loyalty points, a pass, or a credit — the reward is a
   * configuration." A programme that pays its referrers only in points sets
   * `none` here and configures a loyalty `EarnRule` against the
   * `referral.converted` event this module emits. That is why paying in points
   * needs no column here and no import of loyalty: §4.13 also says "earning is
   * a listener on spine events, never a call from inside another module", and
   * names "a referral converted" as one of those events.
   */
  kind?: "percent" | "fixed" | "none";
  /** Percent in parts-per-million when `percent`; minor units when `fixed`. */
  value?: number;
  /** Which number the percent applies to. Informational for `fixed`. */
  basis?: "subtotal" | "total" | "net";
  /** Never pay more than this on one conversion, in minor units. */
  capMinor?: number;
  /**
   * Whether a recurring subscription earns every cycle or only the first.
   *
   * Read by the caller deciding whether to write an event at all, not by the
   * arithmetic here — the amount for cycle five is the amount for cycle one.
   */
  recurring?: boolean;
};

export const PPM = 1_000_000;

/**
 * What one conversion earns in total, before it is split between referrers.
 *
 * Rounds half-up on a positive amount. The alternative, banker's rounding, is
 * better for repeated statistical aggregation and worse here: a referrer
 * reading a commission table wants 2.5 to be 3 both times, and "it depends
 * whether the previous digit was even" is not an explanation anybody accepts
 * about their own money.
 */
export function commissionFor(config: CommissionConfig, basisMinor: number): number {
  const kind = config.kind ?? "none";
  if (kind === "none") return 0;
  if (basisMinor <= 0) return 0;

  let amount: number;
  if (kind === "fixed") {
    amount = Math.max(0, Math.trunc(config.value ?? 0));
  } else {
    const ppm = Math.max(0, Math.trunc(config.value ?? 0));
    amount = Math.floor((basisMinor * ppm + PPM / 2) / PPM);
  }

  const cap = config.capMinor;
  if (typeof cap === "number" && cap >= 0) amount = Math.min(amount, cap);
  // A commission may not exceed what the sale was worth. Without this a fixed
  // commission larger than a small order pays out more than came in, which is
  // a configuration mistake rather than a deal, and the cheapest place to stop
  // it is before it reaches a payout batch.
  return Math.min(amount, basisMinor);
}

export type Share = { codeId: string; sharePpm: number };

/**
 * Turn attribution's fractional credits into integer parts-per-million.
 *
 * The remainder goes to the largest shares first, so three equal referrers
 * split 1,000,000 as 333,334 / 333,333 / 333,333 rather than losing two
 * millionths. Ties break on `codeId` so the result is stable across runs —
 * an unstable tiebreak would make the same conversion reproduce differently,
 * which is precisely the property this file exists to guarantee.
 */
export function sharesFrom(credits: { codeId: string; share: number }[]): Share[] {
  if (credits.length === 0) return [];
  const floors = credits.map((credit) => ({
    codeId: credit.codeId,
    sharePpm: Math.floor(credit.share * PPM),
    remainder: credit.share * PPM - Math.floor(credit.share * PPM),
  }));
  let left = PPM - floors.reduce((sum, entry) => sum + entry.sharePpm, 0);
  const order = [...floors].sort(
    (a, b) => b.remainder - a.remainder || a.codeId.localeCompare(b.codeId),
  );
  for (const entry of order) {
    if (left <= 0) break;
    entry.sharePpm += 1;
    left -= 1;
  }
  return floors.map(({ codeId, sharePpm }) => ({ codeId, sharePpm }));
}

/**
 * Divide a total between shares so the parts sum to exactly the total.
 *
 * Largest-remainder again, and for the same reason as `sharesFrom`: the sum of
 * independently rounded parts is not the whole. £10.00 split 40/20/40 is
 * 400/200/400 and fine; split three ways it is 334/333/333 and only correct
 * because somebody decided who gets the extra penny. Here it is the largest
 * share, then the lowest `codeId` — deterministic, and written down.
 */
export function splitMinor(totalMinor: number, shares: Share[]): { codeId: string; amountMinor: number }[] {
  if (shares.length === 0) return [];
  const sign = totalMinor < 0 ? -1 : 1;
  const magnitude = Math.abs(totalMinor);

  const parts = shares.map((share) => {
    const exact = (magnitude * share.sharePpm) / PPM;
    return { codeId: share.codeId, amountMinor: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });

  let left = magnitude - parts.reduce((sum, part) => sum + part.amountMinor, 0);
  const order = [...parts].sort(
    (a, b) => b.remainder - a.remainder || a.codeId.localeCompare(b.codeId),
  );
  for (const part of order) {
    if (left <= 0) break;
    part.amountMinor += 1;
    left -= 1;
  }

  return parts.map(({ codeId, amountMinor }) => ({ codeId, amountMinor: amountMinor * sign }));
}

/** When a commission earned now becomes payable (§4.13's refund window). */
export function payableAt(earnedAt: Date, holdbackDays: number): Date {
  const days = Math.max(0, Math.trunc(holdbackDays));
  return new Date(earnedAt.getTime() + days * 24 * 60 * 60 * 1000);
}
