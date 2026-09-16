// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Catalog answers core's "can anything issue a reward?" (MASTER.md §4.13, C9.12).
//
// §4.13's convergence rule says a redeemed reward "becomes a coupon, a pass
// balance, or a zero-value invoice line — never a parallel discount path". A
// coupon is the thing this module already knows how to make, honour at
// checkout, limit per contact and report on, so redemption produces one of
// those rather than a discount only loyalty understands.
//
// Nothing here imports loyalty, and loyalty does not import this. Core owns
// the registry (`core/rewards/issue.ts`) for the same reason it owns the
// lifecycle advancer: it is the only place both sides can meet without one of
// them depending on the other.
import { registerRewardIssuer, type RewardGrant, type RewardIssued } from "@/core/rewards/issue";
import type { ServiceContext } from "@/core/service";
import { minorToDecimal } from "@/adapters/payments/currency";
import { createCoupon } from "./promotions";

/**
 * A code nobody else will be issued and nobody has to read aloud twice.
 *
 * Derived from the grant rather than random: the same redemption retried
 * inside one transaction produces the same code, so a retry cannot leave two
 * coupons behind. Ambiguous characters are left out because these get read off
 * a phone screen in a shop.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function codeFor(seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  let out = "";
  let value = hash;
  for (let i = 0; i < 8; i += 1) {
    out += ALPHABET[value % ALPHABET.length];
    value = Math.floor(value / ALPHABET.length) + 7 * (i + 1);
  }
  return `REWARD-${out}`;
}

async function issue(ctx: ServiceContext, grant: RewardGrant): Promise<RewardIssued | null> {
  // A coupon cannot express a physical product or a donation. Returning null
  // rather than inventing something means the redemption records that it needs
  // issuing by hand, which is true, instead of handing somebody a discount
  // code where they were promised a print.
  if (grant.kind !== "discount" && grant.kind !== "free_shipping" && grant.kind !== "gift_card") {
    return null;
  }

  const code = codeFor(`${grant.contactId}:${grant.label}:${grant.percentOffPpm ?? grant.amountMinor ?? 0}`);
  const currency = grant.currency ?? "USD";

  const coupon = await ctx.callAsSystem(createCoupon, {
    code,
    kind: grant.kind === "free_shipping" ? "free_shipping" : grant.percentOffPpm ? "percent" : "fixed",
    percentOffPpm: grant.percentOffPpm,
    amount: grant.amountMinor ? minorToDecimal(grant.amountMinor, currency) : undefined,
    currency: grant.amountMinor ? currency : undefined,
    // One redemption, one use. The points were spent once.
    maxRedemptions: 1,
    perContactLimit: 1,
  });

  return { issued: true, reference: coupon.code, by: "catalog" };
}

registerRewardIssuer("catalog", issue);

export { issue as issueRewardAsCoupon };
