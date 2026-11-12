// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: frozen new-agreement scope cannot borrow another account or tax profile.
import { describe, expect, it } from "vitest";
import { originalSubscriptionTaxDestination, subscriptionChargeScope, subscriptionMerchantScope, subscriptionMethodScopeMatches, type SubscriptionMerchantScope } from "@/modules/subscriptions/merchant-scope-contract";
const original: SubscriptionMerchantScope = {
  subscriptionId: "00000000-0000-4000-8000-000000000080", agreementRoutingVersion: 1,
  collectionKind: "direct", providerPlatformAccountId: "acct_originalPlatform", chargeAccountId: "acct_originalSeller",
  recipientAccountId: "acct_originalSeller", settlementMerchantAccountId: "acct_originalSeller",
  taxProfileId: "f23bf6ab-5c5e-4230-aeca-eafc93700abd", taxProfileVersion: 2, taxLiability: "seller", taxDestination: { country: "CA", region: "BC", postalCode: "V0R1A0" },
};
describe("new subscription original merchant scope (C12.38)", () => {
  it("keeps direct resources on the original connected account", () => {
    expect(subscriptionChargeScope(original)).toEqual({ providerPlatformAccountId: "acct_originalPlatform", providerAccountId: "acct_originalSeller" });
  });
  it("keeps destination resources on the platform while naming the actual recipient and settlement merchant", () => {
    expect(subscriptionChargeScope({ ...original, collectionKind: "destination", chargeAccountId: null })).toEqual({ providerPlatformAccountId: "acct_originalPlatform", destinationAccountId: "acct_originalSeller", settlementMerchantAccountId: "acct_originalSeller" });
  });
  it.each([
    { collectionKind: "destination", chargeAccountId: "acct_originalSeller" },
    { collectionKind: "direct", chargeAccountId: null },
    { chargeAccountId: "acct_replacementSeller" },
    { settlementMerchantAccountId: "acct_replacementSeller" },
    { providerPlatformAccountId: "acct_originalSeller" },
  ])("refuses conflicting original account facts %j", patch => {
    expect(subscriptionMerchantScope.safeParse({ ...original, ...patch }).success).toBe(false);
  });
  it("does not treat historical NULL platform methods as methods of today's verified platform", () => {
    const legacy = { providerAccountId: "acct_originalSeller", providerPlatformAccountId: null };
    expect(subscriptionMethodScopeMatches({ providerAccountId: "acct_originalSeller" }, legacy)).toBe(true);
    expect(subscriptionMethodScopeMatches(subscriptionChargeScope(original), legacy)).toBe(false);
    expect(subscriptionMethodScopeMatches(subscriptionChargeScope(original), { ...legacy, providerPlatformAccountId: "acct_originalPlatform" })).toBe(true);
    expect(subscriptionMethodScopeMatches(subscriptionChargeScope(original), { ...legacy, providerPlatformAccountId: "acct_replacementPlatform" })).toBe(false);
  });
  it("does not confuse a destination's seller with its customer and payment-method namespace", () => {
    const scope = subscriptionChargeScope({ ...original, collectionKind: "destination", chargeAccountId: null });
    expect(subscriptionMethodScopeMatches(scope, { providerAccountId: "", providerPlatformAccountId: "acct_originalPlatform" })).toBe(true);
    expect(subscriptionMethodScopeMatches(scope, { providerAccountId: "acct_originalSeller", providerPlatformAccountId: "acct_originalPlatform" })).toBe(false);
  });
  it("requires a versioned explicit tax policy and buyer declaration", () => {
    expect(subscriptionMerchantScope.safeParse({ ...original, taxProfileVersion: 0 }).success).toBe(false);
    expect(subscriptionMerchantScope.safeParse({ ...original, taxLiability: "unknown" }).success).toBe(false);
    expect(subscriptionMerchantScope.safeParse({ ...original, taxDestination: { country: "" } }).success).toBe(false);
    expect(originalSubscriptionTaxDestination(original)).toEqual(original.taxDestination);
  });
  it("retains resource scope for recovery after erasure but never reconstructs a tax destination", () => {
    const erased = { ...original, taxDestination: null };
    expect(subscriptionChargeScope(erased)).toEqual(subscriptionChargeScope(original));
    expect(() => originalSubscriptionTaxDestination(erased)).toThrow(/erased/);
  });
});
