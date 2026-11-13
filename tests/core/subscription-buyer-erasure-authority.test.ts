// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: real cohort authority distinguishes a buyer from the merchant.
import { describe, expect, it } from "vitest";
import type { Tx } from "@/core/service";
import { originalScheduleCohortAuthority } from "@/modules/subscriptions/provider-schedule-cohort-authority";

const buyer = "00000000-0000-4000-8000-000000000001";
const merchant = "00000000-0000-4000-8000-000000000002";
const input = { profileId: "00000000-0000-4000-8000-000000000003", requestId: "00000000-0000-4000-8000-000000000004",
  cohortId: "00000000-0000-4000-8000-000000000005", originalJobId: "00000000-0000-4000-8000-000000000006" };
const subscriptionId = "00000000-0000-4000-8000-000000000007";
const request = { id: input.requestId, kind: "erasure", verifiedAt: new Date("2026-11-12T00:00:00Z"), contactId: buyer };
const cohort = { id: input.cohortId, profileId: input.profileId, requestId: input.requestId, jobId: input.originalJobId,
  jobIds: [input.originalJobId], privacyScope: "subscriptions.agreements", subscriptionId };
const original = { parent: { contactId: buyer, merchantScopeVersion: 1, billingMode: "provider" }, scope: { taxProfileId: input.profileId } };
function txFor(...results: unknown[][]): Tx {
  // Execute the real authority helper against finite read results; no service
  // permission/context/provider behavior is replaced by this read-only seam.
  const select = () => {
    const result = Promise.resolve(results.shift() ?? []);
    const query = Object.assign(result, { for: () => result });
    const chain = { from: () => chain, innerJoin: () => chain, where: () => chain, limit: () => query };
    return chain;
  };
  return { select } as unknown as Tx;
}

describe("original buyer schedule-erasure authority", () => {
  it("accepts the actual buyer task without requiring ownership of the seller's tax profile", async () => {
    const result = await originalScheduleCohortAuthority(txFor([request], [cohort], [original]), input, true);
    expect(result.cohort.subscriptionId).toBe(subscriptionId);
    expect(result.request.contactId).toBe(buyer);
    expect(result.request.contactId).not.toBe(merchant);
  });
  it("refuses a later holder or another buyer using the original cohort", async () => {
    await expect(originalScheduleCohortAuthority(txFor([{ ...request, contactId: merchant }], [cohort], [original]), input)).rejects.toMatchObject({ code: "permission" });
  });
  it("refuses a forged profile or a legacy epoch as buyer authority", async () => {
    for (const invalid of [{ ...original, scope: { taxProfileId: input.requestId } },
      { ...original, parent: { ...original.parent, merchantScopeVersion: 0 } }]) {
      await expect(originalScheduleCohortAuthority(txFor([request], [cohort], [invalid]), input)).rejects.toMatchObject({ code: "permission" });
    }
  });
  it("does not discard an original buyer cohort when mutable local billing mode later changes", async () => {
    for (const billingMode of ["manual", "platform"]) {
      const restored = { ...original, parent: { ...original.parent, billingMode } };
      const result = await originalScheduleCohortAuthority(txFor([request], [cohort], [restored]), input);
      expect(result.cohort.subscriptionId).toBe(subscriptionId);
    }
  });
  it("requires both the current real task and original cohort membership", async () => {
    for (const invalid of [{ ...cohort, jobId: subscriptionId }, { ...cohort, jobIds: [] },
      { ...cohort, requestId: subscriptionId }, { ...cohort, profileId: subscriptionId }]) {
      await expect(originalScheduleCohortAuthority(txFor([request], [invalid], [original]), input)).rejects.toMatchObject({ code: "permission" });
    }
  });
  it("refuses unverified and non-erasure requests before any original schedule is read", async () => {
    for (const invalid of [{ ...request, verifiedAt: null }, { ...request, kind: "export" }]) {
      await expect(originalScheduleCohortAuthority(txFor([invalid], [cohort]), input)).rejects.toMatchObject({ code: "permission" });
    }
  });
  it("keeps merchant-owner authority distinct and refuses a buyer impersonating that owner", async () => {
    const merchantCohort = { ...cohort, privacyScope: "commerce.merchantTax", subscriptionId: null };
    await expect(originalScheduleCohortAuthority(txFor([request], [merchantCohort], [{ state: "active", contactId: merchant }]), input)).rejects.toMatchObject({ code: "permission" });
    const result = await originalScheduleCohortAuthority(txFor([{ ...request, contactId: merchant }], [merchantCohort], [{ state: "active", contactId: merchant }]), input);
    expect(result.cohort.privacyScope).toBe("commerce.merchantTax");
  });
  it("refuses mismatched or missing original scope rows rather than inventing authority", async () => {
    for (const invalid of [{ ...cohort, privacyScope: "commerce.merchantTax" }, { ...cohort, subscriptionId: null }]) {
      await expect(originalScheduleCohortAuthority(txFor([request], [invalid], [original]), input)).rejects.toMatchObject({ code: "permission" });
    }
    await expect(originalScheduleCohortAuthority(txFor([request], [cohort], []), input)).rejects.toMatchObject({ code: "permission" });
  });
});
