// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { evaluateProviderPrincipal, type ProviderPrincipalFacts } from "@/modules/invoicing/principal-authority-contract";
function actual(): ProviderPrincipalFacts {
  return { payment: { status: "succeeded", providerRef: "pi_original", amountMinor: 4200, refundedMinor: 0, currency: "CAD" },
    route: { platform: "acct_originalPlatform", chargeAccount: null, recipient: "acct_originalSeller", settlementMerchant: "acct_originalSeller" },
    observation: { providerRef: "pi_original", platform: "acct_originalPlatform", chargeAccount: null, recipient: "acct_originalSeller", settlementMerchant: "acct_originalSeller",
      amountMinor: 4200, currency: "CAD", customerChargeVerified: true, routeVerified: true, settlementVerified: true },
    unknownCaller: false, unappliedCash: false, refundDebt: false, dispute: false, incomplete: false };
}
describe("exact original principal authority without fictional ancillary settlement", () => {
  it("requires actual customer cash and original merchant route", () => {
    expect(evaluateProviderPrincipal(actual())).toEqual({ principalSafe: true, reasons: [], ancillarySettlementPending: false });
  });
  it("allows proved customer principal with actual route while retaining a false ancillary settlement fact", () => {
    const facts = actual(); facts.observation!.settlementVerified = false;
    expect(evaluateProviderPrincipal(facts)).toEqual({ principalSafe: true, reasons: [], ancillarySettlementPending: true });
    expect(facts.observation!.settlementVerified).toBe(false);
  });
  it("never lets even a true settlement flag replace missing route proof", () => {
    const facts = actual(); facts.observation!.routeVerified = false;
    expect(evaluateProviderPrincipal(facts)).toMatchObject({ principalSafe: false, reasons: ["merchant_route"] });
  });
  it.each(["recipient", "settlementMerchant"] as const)("refuses the wrong actual %s despite every proof flag", field => {
    const facts = actual(); facts.observation![field] = "acct_someoneElse";
    expect(evaluateProviderPrincipal(facts)).toMatchObject({ principalSafe: false, reasons: ["merchant_route"] });
  });
  it.each(["platform", "chargeAccount"] as const)("refuses the wrong original charge namespace %s", field => {
    const facts = actual(); facts.observation![field] = "acct_otherPlatform";
    expect(evaluateProviderPrincipal(facts)).toMatchObject({ principalSafe: false, reasons: ["customer_charge"] });
  });
  it("refuses an unproved positive charge even when its amount and route match", () => {
    const facts = actual(); facts.observation!.customerChargeVerified = false;
    expect(evaluateProviderPrincipal(facts)).toMatchObject({ principalSafe: false, reasons: ["customer_charge"] });
  });
  it.each(["providerRef", "currency", "amountMinor"] as const)("binds actual principal %s", field => {
    const facts = actual();
    if (field === "amountMinor") facts.observation!.amountMinor = 4201; else facts.observation![field] = field === "currency" ? "USD" : "pi_anotherOriginal";
    expect(evaluateProviderPrincipal(facts)).toMatchObject({ principalSafe: false, reasons: ["customer_charge"] });
  });
  it.each(["unknownCaller", "unappliedCash", "refundDebt", "dispute", "incomplete"] as const)("preserves actual %s debt independently from all proof flags", field => {
    const facts = actual(); facts[field] = true;
    expect(evaluateProviderPrincipal(facts).principalSafe).toBe(false);
  });
  it("refuses a missing actual observation rather than reconstructing one from settled local status", () => {
    const facts = actual(); facts.observation = null;
    expect(evaluateProviderPrincipal(facts)).toMatchObject({ principalSafe: false, reasons: ["customer_charge", "merchant_route"] });
  });
});
