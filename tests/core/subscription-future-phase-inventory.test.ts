// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: declared future inventory never invents a provider subscription.
import { expect, it } from "vitest";
import { freezeProviderPhase, providerPhaseInventory } from "@/modules/subscriptions/provider-phase-contract";
const phase = freezeProviderPhase({ termsId: "00000000-0000-4000-8000-000000000401", profileId: "00000000-0000-4000-8000-000000000402", profileVersion: 1,
  start: "2027-06-01T00:00:00.000Z", end: "2027-07-01T00:00:00.000Z", taxOccurredAt: "2027-06-01T00:00:00.000Z", currency: "CAD", interval: "month", intervalCount: 1,
  periodAmountMinor: 4000, setupFeeMinor: 500, taxMinor: 225, totalMinor: 4725, applicationFeeMinor: 450, siteFeeBps: 1000, taxQuoteDigest: "a".repeat(64) });
const future = { version: 1, operationId: "00000000-0000-4000-8000-000000000403", requestDigest: "b".repeat(64), providerScheduleRef: "sub_sched_original",
  providerSubscriptionRef: null, providerPlatformAccountId: "acct_originalPlatform", chargeAccountId: null, recipientAccountId: "acct_originalSeller", settlementMerchantAccountId: "acct_originalSeller",
  providerApiVersion: "2026-10-28.endive", status: "not_started", endBehavior: "cancel", complete: true, currentPhaseStart: null, phases: [{ ...phase, providerPriceRef: "price_original" }] };
it("retains an original not-started schedule without inventing its later subscription", () => {
  expect(providerPhaseInventory.parse(future).providerSubscriptionRef).toBeNull();
});
it("requires the actual linked subscription and current phase for active inventory", () => {
  expect(providerPhaseInventory.safeParse({ ...future, status: "active" }).success).toBe(false);
  expect(providerPhaseInventory.safeParse({ ...future, status: "active", providerSubscriptionRef: "sub_original", currentPhaseStart: phase.start }).success).toBe(true);
});
it("refuses a manufactured linked subscription on a not-started schedule", () => {
  expect(providerPhaseInventory.safeParse({ ...future, providerSubscriptionRef: "sub_invented" }).success).toBe(false);
});
it("refuses a current-phase pointer outside the actual returned phase inventory", () => {
  expect(providerPhaseInventory.safeParse({ ...future, status: "active", providerSubscriptionRef: "sub_original", currentPhaseStart: phase.end }).success).toBe(false);
});
it("requires explicit complete inventory and actual nullable linkage rather than absent history", () => {
  const { providerSubscriptionRef, ...missing } = future; void providerSubscriptionRef;
  expect(providerPhaseInventory.safeParse(missing).success).toBe(false);
  expect(providerPhaseInventory.safeParse({ ...future, complete: false }).success).toBe(false);
});
