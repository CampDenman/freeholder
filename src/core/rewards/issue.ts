// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Turning a reward into something the money system already understands
// (MASTER.md §4.13, C9.12).
//
// §4.13: "Redemption obeys the convergence rule. Points become a coupon, a
// pass balance, or a zero-value invoice line — never a parallel discount path.
// A £0 invoice with the reward named on it is still the record of the
// transaction."
//
// That rule and §4.13's other one — "Commerce does not know loyalty exists" —
// pull in opposite directions, and the seam is how both hold. Loyalty must
// produce a *real* coupon rather than a private discount of its own, but it
// may not import commerce to do it, and commerce must not import loyalty
// either or the independence has merely changed direction.
//
// So the registry lives in core, exactly like `contacts/lifecycle.ts`: core
// asks whoever registered, the capable module registers itself at import time,
// and neither module knows the other exists.
//
// With nothing registered the fallback does not throw and does not silently
// succeed. It reports that the reward needs issuing by hand, and the caller
// records that on the redemption — because on an instance with no commerce
// module, "there is a voucher waiting for you to write out" is the honest
// answer and "redeemed" would be a lie the customer discovers at the till.
import type { ServiceContext } from "@/core/service";

/** What a redemption asks for, in terms no loyalty concept appears in. */
export type RewardGrant = {
  contactId: string;
  /** What the customer gets. `pass_credits` and `donation` have no issuer yet. */
  kind: "discount" | "free_product" | "free_shipping" | "gift_card" | "pass_credits" | "donation";
  /** Percent in parts-per-million, or a minor-unit amount, depending on kind. */
  percentOffPpm?: number;
  amountMinor?: number;
  currency?: string;
  /** Named on whatever is issued, so the record says what it was for. */
  label: string;
};

export type RewardIssued = {
  issued: boolean;
  /** A coupon code, an invoice id — whatever the customer actually presents. */
  reference: string | null;
  /** Which module did it, or "manual" when nothing could. */
  by: string;
};

export type RewardIssuer = (
  ctx: ServiceContext,
  grant: RewardGrant,
) => Promise<RewardIssued | null>;

let registered: RewardIssuer | null = null;
let registeredBy: string | null = null;

/**
 * A commerce module claims this at import time; nothing else may.
 *
 * Registering twice is a mistake worth failing on rather than a race to win:
 * two issuers means a redemption that produces two different coupons
 * depending on module load order, which is the kind of bug that only shows up
 * in somebody's basket.
 */
export function registerRewardIssuer(by: string, issuer: RewardIssuer): void {
  if (registered && registeredBy !== by) {
    throw new Error(
      `a reward issuer is already registered by "${registeredBy}"; "${by}" cannot also claim it`,
    );
  }
  registered = issuer;
  registeredBy = by;
}

/** Test seam. Production never calls this. */
export function resetRewardIssuer(): void {
  registered = null;
  registeredBy = null;
}

export function rewardIssuerName(): string | null {
  return registeredBy;
}

/**
 * Issue a reward through whatever can, or say plainly that nothing could.
 *
 * The issuer runs inside the caller's transaction, so a coupon and the ledger
 * row that paid for it commit together or not at all. A redemption that
 * debited points and then failed to produce the coupon is the single worst
 * outcome available here, and one transaction is what forecloses it.
 */
export async function issueReward(
  ctx: ServiceContext,
  grant: RewardGrant,
): Promise<RewardIssued> {
  if (!registered) return { issued: false, reference: null, by: "manual" };
  const result = await registered(ctx, grant);
  return result ?? { issued: false, reference: null, by: "manual" };
}
