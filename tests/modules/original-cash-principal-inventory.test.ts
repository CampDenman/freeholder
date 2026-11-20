// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38 PREPARED/UNRUN: bank principal facts never come from callback amounts.
import { describe, expect, it } from "vitest";
import { currentBankPrincipalMatches } from "@/modules/invoicing/original-cash-principal";
import type { MerchantReturnedCashEvidence } from "@/modules/invoicing/merchant-returned-cash-proof";
const original = { amountMinor: 1500, currency: "CAD", refundedMinor: 0, apiVersion: "2026-10-28.endive", platform: "acct_originalPlatform", account: null, paymentRef: "pi_originalPrincipal", chargeRef: "ch_originalPrincipal" };
const bank = (): MerchantReturnedCashEvidence => ({ providerPlatformAccountId: original.platform, chargeAccountId: original.account, providerApiVersion: original.apiVersion,
  paymentProviderRef: original.paymentRef, providerChargeRef: original.chargeRef, amountMinor: original.amountMinor, currency: original.currency,
  paymentIntentStatus: "succeeded", amountCapturableMinor: 0, chargePaymentProviderRef: original.paymentRef, chargeAmountMinor: original.amountMinor, chargeCurrency: original.currency,
  paid: true, captured: true, refunded: false, amountRefundedMinor: 0, refundsComplete: true, refunds: [], disputesComplete: true, disputes: [],
  feeFieldObserved: false, fee: null, transferFieldObserved: false, transfer: null });
const refund = { providerRef: "re_originalPrincipal", paymentProviderRef: original.paymentRef, chargeRef: original.chargeRef, amountMinor: 1, currency: original.currency, status: "succeeded" as const };
describe("actual whole bank principal inventory independently from ancillary fee facts", () => {
  it("permits exact principal with ancillary fields still unread, without inventing their settlement", () => {
    expect(currentBankPrincipalMatches(original, bank())).toBe(true);
  });
  it("refuses real returned cash not yet applied to the canonical refund projection", () => {
    expect(currentBankPrincipalMatches(original, { ...bank(), amountRefundedMinor: 1, refunds: [refund] })).toBe(false);
  });
  it("accepts the same actually represented refund only with exact canonical money and complete actual resources", () => {
    expect(currentBankPrincipalMatches({ ...original, refundedMinor: 1 }, { ...bank(), amountRefundedMinor: 1, refunds: [refund] })).toBe(true);
  });
  it("refuses equal refund money belonging to another original charge", () => {
    expect(currentBankPrincipalMatches({ ...original, refundedMinor: 1 }, { ...bank(), amountRefundedMinor: 1, refunds: [{ ...refund, chargeRef: "ch_someoneElse" }] })).toBe(false);
  });
  it("refuses original protocol/account/charge mismatch despite equal amount", () => {
    expect(currentBankPrincipalMatches(original, { ...bank(), providerApiVersion: "2026-02-25.clover" })).toBe(false);
    expect(currentBankPrincipalMatches(original, { ...bank(), chargeAccountId: "acct_someoneElse" })).toBe(false);
    expect(currentBankPrincipalMatches(original, { ...bank(), providerChargeRef: "ch_someoneElse" })).toBe(false);
  });
  it("does not treat a pending resource or truncated inventory as refunded or absent", () => {
    expect(currentBankPrincipalMatches(original, { ...bank(), refunds: [{ ...refund, status: "pending" }] })).toBe(false);
    expect(currentBankPrincipalMatches(original, { ...bank(), refundsComplete: false })).toBe(false);
  });
  it("refuses duplicated original resource identities", () => {
    expect(currentBankPrincipalMatches({ ...original, refundedMinor: 2 }, { ...bank(), amountRefundedMinor: 2, refunds: [refund, refund] })).toBe(false);
  });
  it("requires actual captured principal and complete closed dispute inventory", () => {
    expect(currentBankPrincipalMatches(original, { ...bank(), paid: null })).toBe(false);
    expect(currentBankPrincipalMatches(original, { ...bank(), disputesComplete: false })).toBe(false);
    expect(currentBankPrincipalMatches(original, { ...bank(), disputes: [{ providerRef: "du_originalPrincipal", chargeRef: original.chargeRef, status: "open" }] })).toBe(false);
  });
});
