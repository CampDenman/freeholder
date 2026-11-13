// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: PREPARED/UNRUN original policy authority and cumulative residuals.
import { describe, expect, it } from "vitest";
import { authoritativeOriginalLineFees, originalCumulativeResourceShare, originalPartialCashTargets } from "@/modules/invoicing/original-cash-partial-amounts";
import { merchantRefundCapacity } from "@/modules/invoicing/merchant-refund-capacity";
const targets = (change: Partial<Parameters<typeof originalPartialCashTargets>[0]> = {}) => originalPartialCashTargets({ principalMinor: 7, principalCurrency: "CAD", customerReturnedMinor: 2,
  acceptedFeeMinor: 3, acceptedFeeRetainedMinor: 2, fee: { originalMinor: 3, returnedMinor: 0, currency: "CAD" }, recipient: { originalMinor: 5, returnedMinor: 0, currency: "USD" }, ...change });
describe("original partial-return cumulative targets", () => {
  it("preserves accepted per-line zero while aggregate authority allocates the residual to a real line", () => {
    const lines = [{ id: "line-b", revenueMinor: 1 }, { id: "line-a", revenueMinor: 1 }];
    expect([...authoritativeOriginalLineFees(lines, 5000, "per_line")]).toEqual([["line-a", 0], ["line-b", 0]]);
    expect([...authoritativeOriginalLineFees(lines, 5000, "aggregate")]).toEqual([["line-a", 1], ["line-b", 0]]);
    expect([...authoritativeOriginalLineFees([...lines].reverse(), 5000, "aggregate")]).toEqual([["line-a", 1], ["line-b", 0]]);
  });
  it("uses fractional remainder before the original line identity tie break", () => {
    expect([...authoritativeOriginalLineFees([{ id: "a", revenueMinor: 1 }, { id: "b", revenueMinor: 2 }], 4000, "aggregate")]).toEqual([["a", 0], ["b", 1]]);
  });
  it("never creates a fake residual line or accepts duplicate original identities", () => {
    expect(() => authoritativeOriginalLineFees([{ id: "a", revenueMinor: 1 }, { id: "a", revenueMinor: 1 }], 5000, "aggregate")).toThrow(RangeError);
    expect(() => authoritativeOriginalLineFees([{ id: "", revenueMinor: 1 }], 5000, "per_line")).toThrow(RangeError);
  });
  it("rejects unsupported cumulative money rather than losing safe-integer cents", () => {
    expect(() => authoritativeOriginalLineFees([{ id: "a", revenueMinor: Number.MAX_SAFE_INTEGER }, { id: "b", revenueMinor: 1 }], 10000, "aggregate")).toThrow(RangeError);
    expect(originalCumulativeResourceShare(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1)).toBe(Number.MAX_SAFE_INTEGER - 1);
  });
  it("allocates exact recipient residuals cumulatively through the last original unit", () => {
    const cumulative = [0, 1, 2, 3, 4, 5, 6, 7].map(returned => originalCumulativeResourceShare(5, 7, returned));
    expect(cumulative).toEqual([0, 0, 1, 2, 2, 3, 4, 5]);
    expect(cumulative.slice(1).reduce((sum, amount, i) => sum + amount - cumulative[i]!, 0)).toBe(5);
  });
  it("uses accepted original line fee credit independently of taxed gross principal", () => {
    expect(targets()).toEqual({ fee: { targetMinor: 1, remainingMinor: 1, overReturnedMinor: 0 }, recipient: { targetMinor: 1, remainingMinor: 1, overReturnedMinor: 0 } });
  });
  it("retains the actual observed same-currency fee excess in the cumulative correction", () => {
    expect(targets({ fee: { originalMinor: 4, returnedMinor: 0, currency: "CAD" } }).fee).toEqual({ targetMinor: 2, remainingMinor: 2, overReturnedMinor: 0 });
  });
  it("allocates actual foreign original fee money without inventing an FX rate", () => {
    expect(targets({ fee: { originalMinor: 8, returnedMinor: 0, currency: "USD" } }).fee.targetMinor).toBe(2);
    expect(targets({ customerReturnedMinor: 7, acceptedFeeRetainedMinor: 0, fee: { originalMinor: 8, returnedMinor: 8, currency: "USD" } }).fee).toEqual({ targetMinor: 8, remainingMinor: 0, overReturnedMinor: 0 });
  });
  it("keeps an already overreturned partial resource visible instead of waiving debt", () => {
    expect(targets({ recipient: { originalMinor: 5, returnedMinor: 2, currency: "USD" } }).recipient).toEqual({ targetMinor: 1, remainingMinor: 0, overReturnedMinor: 1 });
    expect(() => targets({ recipient: { originalMinor: 5, returnedMinor: 6, currency: "USD" } })).toThrow(RangeError);
  });
  it("refuses undefined zero-fee conversion and returned principal beyond the actual original", () => {
    expect(() => targets({ acceptedFeeMinor: 0, acceptedFeeRetainedMinor: 0 })).toThrow(RangeError);
    expect(() => targets({ customerReturnedMinor: 8 })).toThrow(RangeError);
    expect(targets({ acceptedFeeMinor: 0, acceptedFeeRetainedMinor: 0, fee: { originalMinor: 0, returnedMinor: 0, currency: "USD" } }).fee.targetMinor).toBe(0);
  });
});
describe("reviewed actual unassigned cash remains unassigned", () => {
  const observed = { requestId: null, providerRef: "re_actual_dashboard", amountMinor: 400, currency: "CAD", status: "succeeded" as const, bindingVerified: false };
  const reviewed = { providerRef: observed.providerRef, amountMinor: 400, currency: "CAD", status: "succeeded" as const };
  const capacity = (reviews: typeof reviewed[]) => merchantRefundCapacity({ originalCashMinor: 1000, currency: "CAD", reservations: [], observations: [observed], reviewedUnassignedResources: reviews });
  it("counts real cash once without creating a logical owner or discarding the remaining cash", () => {
    expect(capacity([reviewed])).toEqual({ refundedMinor: 400, reservedMinor: 0, availableMinor: 600, debt: [] });
    expect(observed.requestId).toBeNull(); expect(observed.bindingVerified).toBe(false);
  });
  it("retains review debt for an unreviewed or merely equal resource", () => {
    expect(capacity([]).debt).toContain("unassigned_refund");
    expect(capacity([{ ...reviewed, providerRef: "re_foreign" }]).debt).toContain("unassigned_refund");
    expect(capacity([{ ...reviewed, amountMinor: 399 }]).debt).toContain("unassigned_refund");
  });
  it("fails closed on duplicate review authority", () => {
    const result=capacity([reviewed, reviewed]);
    expect(result).toMatchObject({ refundedMinor:null,availableMinor:null });
    expect(result.debt).toContain("contradictory_provider_fact");expect(result.debt).toContain("unassigned_refund");
  });
});
