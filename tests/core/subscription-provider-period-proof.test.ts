// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: synthetic authenticated provider facts must bind the exact admitted offer.
import { describe, expect, it } from "vitest";
import { freezeProviderPhase } from "@/modules/subscriptions/provider-phase-contract";
import { providerInvoiceMatchesPhase, type ProviderPeriodInvoiceEvidence } from "@/modules/subscriptions/provider-period-contract";
const phase = freezeProviderPhase({ termsId: "00000000-0000-4000-8000-000000000001", profileId: "00000000-0000-4000-8000-000000000002", profileVersion: 1,
  start: "2026-12-01T00:00:00.000Z", end: "2027-01-01T00:00:00.000Z", taxOccurredAt: "2026-12-01T00:00:00.000Z", currency: "CAD", interval: "month", intervalCount: 1,
  periodAmountMinor: 4500, setupFeeMinor: 0, taxMinor: 225, totalMinor: 4725, applicationFeeMinor: 450, siteFeeBps: 1000, taxQuoteDigest: "a".repeat(64) });
const expected = { ...phase, providerProductRef: "prod_original", providerCustomerRef: "cus_original", providerPriceRef: "price_original", operationId: "00000000-0000-4000-8000-000000000003" };
function actual(): ProviderPeriodInvoiceEvidence { return { providerInvoiceRef: "in_original", providerSubscriptionRef: "sub_original", providerCustomerRef: expected.providerCustomerRef,
  providerOperationId: expected.operationId, phaseDigest: phase.phaseDigest, termsId: phase.termsId, currency: "CAD", subtotalMinor: 4725, totalMinor: 4725, paidMinor: 4725, remainingMinor: 0,
  paid: true, unadjusted: true, complete: true, lines: [{ providerLineRef: "il_original", providerPriceRef: "price_original", providerProductRef: "prod_original", quantity: 1, quantityDecimal: "1",
    amountMinor: 4725, currency: "CAD", periodStart: phase.start, periodEnd: phase.end, subscriptionLine: true, proration: false, unadjusted: true, priceAmountMinor: 4725,
    priceCurrency: "CAD", priceInterval: "month", priceIntervalCount: 1, licensed: true, perUnit: true, inclusive: true, noTransform: true }] }; }
describe("admitted original recurring invoice", () => {
  it("binds the one actual gross price to immutable net/tax/calendar and known price identity", () => { expect(providerInvoiceMatchesPhase(actual(), expected)).toBe(true); });
  it.each([
    ["another operation", (value: ProviderPeriodInvoiceEvidence) => { value.providerOperationId = "00000000-0000-4000-8000-000000000004"; }],
    ["another acceptance", (value: ProviderPeriodInvoiceEvidence) => { value.termsId = "00000000-0000-4000-8000-000000000004"; }],
    ["another customer", (value: ProviderPeriodInvoiceEvidence) => { value.providerCustomerRef = "cus_other"; }],
    ["a mutable phase tag", (value: ProviderPeriodInvoiceEvidence) => { value.phaseDigest = "b".repeat(64); }],
    ["an unpaid balance", (value: ProviderPeriodInvoiceEvidence) => { value.paidMinor = 4700; value.remainingMinor = 25; }],
    ["a credit-adjusted invoice", (value: ProviderPeriodInvoiceEvidence) => { value.unadjusted = false; }],
    ["an extra line", (value: ProviderPeriodInvoiceEvidence) => { value.lines.push({ ...value.lines[0]!, providerLineRef: "il_extra" }); }],
    ["a truncated decimal quantity", (value: ProviderPeriodInvoiceEvidence) => { value.lines[0]!.quantityDecimal = "1.000000000001"; }],
    ["missing full precision", (value: ProviderPeriodInvoiceEvidence) => { value.lines[0]!.quantityDecimal = null; }],
    ["a proration", (value: ProviderPeriodInvoiceEvidence) => { value.lines[0]!.proration = true; }],
    ["another actual price", (value: ProviderPeriodInvoiceEvidence) => { value.lines[0]!.providerPriceRef = "price_other"; }],
    ["another actual product", (value: ProviderPeriodInvoiceEvidence) => { value.lines[0]!.providerProductRef = "prod_other"; }],
    ["another calendar", (value: ProviderPeriodInvoiceEvidence) => { value.lines[0]!.periodEnd = "2027-01-02T00:00:00.000Z"; }],
    ["another actual price amount", (value: ProviderPeriodInvoiceEvidence) => { value.lines[0]!.priceAmountMinor = 4500; }],
    ["provider-added tax", (value: ProviderPeriodInvoiceEvidence) => { value.lines[0]!.unadjusted = false; }],
    ["an exclusive price", (value: ProviderPeriodInvoiceEvidence) => { value.lines[0]!.inclusive = false; }],
    ["metered billing", (value: ProviderPeriodInvoiceEvidence) => { value.lines[0]!.licensed = false; }],
    ["a transformed quantity", (value: ProviderPeriodInvoiceEvidence) => { value.lines[0]!.noTransform = false; }],
  ] as const)("refuses %s", (_name, mutate) => { const value = actual(); mutate(value); expect(providerInvoiceMatchesPhase(value, expected)).toBe(false); });
  it("accepts exact decimal one but never rounds a monetary or quantity contradiction", () => { const value = actual(); value.lines[0]!.quantityDecimal = "1.000000000000"; expect(providerInvoiceMatchesPhase(value, expected)).toBe(true); });
  it("can verify genuine zero invoice facts without inventing a PI, cash receipt or payment", () => {
    const value = actual(); value.subtotalMinor = value.totalMinor = value.paidMinor = 0; value.lines[0]!.amountMinor = value.lines[0]!.priceAmountMinor = 0;
    const { phaseDigest: previousDigest, ...body } = phase; void previousDigest;
    const zero = freezeProviderPhase({ ...body, periodAmountMinor: 0, taxMinor: 0, totalMinor: 0, applicationFeeMinor: 0 }); value.phaseDigest = zero.phaseDigest;
    expect(providerInvoiceMatchesPhase(value, { ...expected, ...zero })).toBe(true);
  });
});
