// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.26/C12.38: monetary conservation across independently collected sellers.
import { describe, expect, it } from "vitest";
import { nextMerchantCollectionAmount, type MerchantCollectedAmount } from "@/modules/invoicing/merchant-collection-amounts";

const allocations = [{ allocationId: "seller-b", totalMinor: 603, feeMinor: 50 }, { allocationId: "site", totalMinor: 1575, feeMinor: 0 }, { allocationId: "seller-a", totalMinor: 2412, feeMinor: 200 }];
function choose(paidMinor: number, payments: MerchantCollectedAmount[], dueMinor = 4590 - paidMinor, allocationId?: string) {
  return nextMerchantCollectionAmount({ invoiceTotalMinor: 4590, invoicePaidMinor: paidMinor, dueMinor, allocations, payments, allocationId });
}
describe("one invoice, original merchant payment amounts (C12.26/C12.38)", () => {
  it("collects each original seller/site portion once and conserves tax, freight and exact fees", () => {
    const payments: MerchantCollectedAmount[] = [];
    let paid = 0;
    for (let index = 0; index < 3; index++) {
      const next = choose(paid, payments)!;
      payments.push({ ...next, status: "succeeded" }); paid += next.amountMinor;
    }
    expect(payments.map(row => [row.allocationId, row.amountMinor, row.applicationFeeMinor])).toEqual([["seller-a", 2412, 200], ["seller-b", 603, 50], ["site", 1575, 0]]);
    expect(paid).toBe(4590); expect(choose(paid, payments)).toBeNull();
  });
  it("respects the existing instalment's remaining due amount and cumulative fee cents", () => {
    const payments: MerchantCollectedAmount[] = [];
    let paid = 0;
    for (const due of [1, 998, 1, 1000, 412]) {
      const next = choose(paid, payments, due)!;
      payments.push({ ...next, status: "succeeded" }); paid += next.amountMinor;
      expect(next.amountMinor).toBe(due);
    }
    expect(payments.reduce((sum, row) => sum + row.applicationFeeMinor, 0)).toBe(200);
    expect(choose(paid, payments, 100)).toMatchObject({ allocationId: "seller-b", amountMinor: 100, applicationFeeMinor: 8 });
  });
  it("does not recollect an already paid portion after a customer refund", () => {
    const payments: MerchantCollectedAmount[] = [{ allocationId: "seller-a", amountMinor: 2412, applicationFeeMinor: 200, status: "succeeded" }];
    expect(choose(2412, payments)).toMatchObject({ allocationId: "seller-b", amountMinor: 603 });
    expect(choose(2412, payments, 100, "seller-a")).toBeNull();
  });
  it.each(["created", "processing"] as const)("blocks another charge while any original attempt is %s", status => {
    expect(() => choose(0, [{ allocationId: "seller-b", amountMinor: 603, applicationFeeMinor: 50, status }])).toThrow("Reconcile");
  });
  it("permits a new attempt after a genuinely terminal refusal without changing the original portion", () => {
    expect(choose(0, [{ allocationId: "seller-a", amountMinor: 2412, applicationFeeMinor: 200, status: "failed" }])).toMatchObject({ allocationId: "seller-a", amountMinor: 2412, applicationFeeMinor: 200 });
  });
  it.each([
    { payments: [{ allocationId: "seller-a", amountMinor: 2412, applicationFeeMinor: 199, status: "succeeded" as const }] },
    { payments: [{ allocationId: "seller-a", amountMinor: 2413, applicationFeeMinor: 200, status: "succeeded" as const }] },
    { payments: [{ allocationId: "replacement", amountMinor: 2412, applicationFeeMinor: 200, status: "succeeded" as const }] },
  ])("refuses inconsistent original money or fee histories: %j", ({ payments }) => {
    expect(() => choose(2412, payments)).toThrow("reconciliation");
  });
  it("keeps BigInt products exact at the supported currency limit", () => {
    const total = Number.MAX_SAFE_INTEGER, fee = Math.floor(total / 2), already = total - 1;
    const priorFee = Number(BigInt(fee) * BigInt(already) / BigInt(total));
    expect(nextMerchantCollectionAmount({ invoiceTotalMinor: total, invoicePaidMinor: already, dueMinor: 1,
      allocations: [{ allocationId: "seller", totalMinor: total, feeMinor: fee }],
      payments: [{ allocationId: "seller", amountMinor: already, applicationFeeMinor: priorFee, status: "succeeded" }] })).toEqual({ allocationId: "seller", amountMinor: 1, applicationFeeMinor: fee - priorFee });
  });
});
