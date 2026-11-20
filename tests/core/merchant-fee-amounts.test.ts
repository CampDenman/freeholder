// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { remainingMerchantFeeRefund } from "@/modules/invoicing/merchant-fee-amounts";

describe("cumulative original application fee reconciliation", () => {
  it("corrects an actual gross-based fee to the frozen merchandise commission", () => {
    expect(remainingMerchantFeeRefund({ observedOriginalFeeMinor: 113, targetRetainedFeeMinor: 100, operations: [] })).toEqual({ state: "ready", amountMinor: 13 });
  });
  it("counts the earlier excess correction before a later customer refund", () => {
    expect(remainingMerchantFeeRefund({ observedOriginalFeeMinor: 113, targetRetainedFeeMinor: 50, operations: [{ amountMinor: 13, status: "accepted" }] })).toEqual({ state: "ready", amountMinor: 50 });
  });
  it("counts all earlier partial customer refunds without returning the fee twice", () => {
    expect(remainingMerchantFeeRefund({ observedOriginalFeeMinor: 113, targetRetainedFeeMinor: 0, operations: [{ amountMinor: 13, status: "accepted" }, { amountMinor: 50, status: "accepted" }] })).toEqual({ state: "ready", amountMinor: 50 });
  });
  it.each(["reserved", "dispatching", "unknown"] as const)("blocks a new operation while an original %s operation may still complete", status => {
    expect(remainingMerchantFeeRefund({ observedOriginalFeeMinor: 113, targetRetainedFeeMinor: 0, operations: [{ amountMinor: 13, status }] })).toEqual({ state: "pending", amountMinor: 0 });
  });
  it("allows an actual terminal refusal to be replaced without pretending it refunded money", () => {
    expect(remainingMerchantFeeRefund({ observedOriginalFeeMinor: 113, targetRetainedFeeMinor: 100, operations: [{ amountMinor: 13, status: "refused" }] })).toEqual({ state: "ready", amountMinor: 13 });
  });
  it("keeps observed under-collection visible without fabricating a fee or charging the customer again", () => {
    expect(remainingMerchantFeeRefund({ observedOriginalFeeMinor: 99, targetRetainedFeeMinor: 100, operations: [] })).toEqual({ state: "under_collected", amountMinor: 0 });
  });
  it("keeps actual excess refunds visible rather than inventing a negative refund", () => {
    expect(remainingMerchantFeeRefund({ observedOriginalFeeMinor: 113, targetRetainedFeeMinor: 100, operations: [{ amountMinor: 14, status: "accepted" }] })).toEqual({ state: "over_refunded", amountMinor: 0 });
  });
  it("refuses impossible original evidence", () => {
    expect(() => remainingMerchantFeeRefund({ observedOriginalFeeMinor: 10, targetRetainedFeeMinor: 0, operations: [{ amountMinor: 11, status: "accepted" }] })).toThrow();
    expect(() => remainingMerchantFeeRefund({ observedOriginalFeeMinor: Number.MAX_SAFE_INTEGER + 1, targetRetainedFeeMinor: 0, operations: [] })).toThrow();
  });
});
