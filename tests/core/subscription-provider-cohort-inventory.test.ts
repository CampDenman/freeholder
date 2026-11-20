// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: original job snapshots distinguish a real empty set from lost children.
import { describe, expect, it } from "vitest";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { originalMerchantScheduleInventoryCovers } from "@/modules/subscriptions/provider-schedule-cohorts";

const id = "00000000-0000-4000-8000-000000000080";
const other = "00000000-0000-4000-8000-000000000081";
const cohort = { id, profileId: id, requestId: id, originalJobId: id };
const payload = (originalAgreementIds: string[]) => ({ profileId: id, requestId: id, originalJobId: id, cohortId: id, originalAgreementIds });
describe("original merchant erasure agreement inventory", () => {
  it("accepts an explicit original empty inventory for an order-only financial cohort", () => {
    const original = payload([]);
    expect(originalMerchantScheduleInventoryCovers(cohort, original, merchantTaxDigest(original), new Set())).toBe(true);
  });
  it("requires every original agreement even when current financial history is settled", () => {
    const original = payload([id]);
    expect(originalMerchantScheduleInventoryCovers(cohort, original, merchantTaxDigest(original), new Set())).toBe(false);
    expect(originalMerchantScheduleInventoryCovers(cohort, original, merchantTaxDigest(original), new Set([id, other]))).toBe(true);
  });
  it("refuses pruned payloads or missing immutable enqueue hashes", () => {
    const original = payload([]);
    expect(originalMerchantScheduleInventoryCovers(cohort, null, merchantTaxDigest(original), new Set())).toBe(false);
    expect(originalMerchantScheduleInventoryCovers(cohort, original, undefined, new Set())).toBe(false);
  });
  it("refuses a rewritten empty set under the original nonempty payload hash", () => {
    expect(originalMerchantScheduleInventoryCovers(cohort, payload([]), merchantTaxDigest(payload([id])), new Set())).toBe(false);
  });
  it("never assigns another profile, request or original task's inventory to this cohort", () => {
    for (const field of ["profileId", "requestId", "cohortId", "originalJobId"] as const) {
      const foreign = { ...payload([]), [field]: other };
      expect(originalMerchantScheduleInventoryCovers(cohort, foreign, merchantTaxDigest(foreign), new Set())).toBe(false);
    }
  });
  it("keeps historical payloads without the new explicit inventory unresolved", () => {
    const legacy = { profileId: id, requestId: id, originalJobId: id, cohortId: id };
    expect(originalMerchantScheduleInventoryCovers(cohort, legacy, merchantTaxDigest(legacy), new Set())).toBe(false);
  });
});
