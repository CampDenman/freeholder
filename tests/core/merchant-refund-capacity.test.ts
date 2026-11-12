// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { merchantRefundCapacity, type MerchantRefundCashFact, type MerchantRefundReservation } from "@/modules/invoicing/merchant-refund-capacity";
const request = (changes: Partial<MerchantRefundReservation> = {}): MerchantRefundReservation => ({ id: "original", amountMinor: 400, dispatched: true, creatorsQuiesced: true, terminalFailureVerified: false, ...changes });
const fact = (changes: Partial<MerchantRefundCashFact> = {}): MerchantRefundCashFact => ({ requestId: "original", providerRef: "re_original", amountMinor: 400, currency: "CAD", status: "succeeded", bindingVerified: true, ...changes });
const capacity = (reservations: MerchantRefundReservation[], observations: MerchantRefundCashFact[]) => merchantRefundCapacity({ originalCashMinor: 1000, currency: "CAD", reservations, observations });
describe("original merchant refund cash capacity", () => {
  it("counts one actual refund once across duplicate observations and preserves remaining original cash", () => {
    expect(capacity([request()], [fact(), fact()])).toEqual({ refundedMinor: 400, reservedMinor: 0, availableMinor: 600, debt: [] });
  });
  it("keeps an unknown original dispatch reserved without inferring provider absence", () => {
    expect(capacity([request()], [])).toEqual({ refundedMinor: 0, reservedMinor: 400, availableMinor: 600, debt: ["unknown_refund"] });
  });
  it("does not release a canonical failed operation while its physical creator remains unfinished", () => {
    expect(capacity([request({ terminalFailureVerified: true, creatorsQuiesced: false })], [fact({ status: "failed" })])).toMatchObject({ reservedMinor: 400, debt: ["unfinished_creator", "unknown_refund"] });
    expect(capacity([request({ terminalFailureVerified: true })], [fact({ status: "failed" })])).toEqual({ refundedMinor: 0, reservedMinor: 0, availableMinor: 1000, debt: [] });
  });
  it("keeps creator debt even after an actual successful refund", () => {
    expect(capacity([request({ creatorsQuiesced: false })], [fact()])).toMatchObject({ refundedMinor: 400, reservedMinor: 0, debt: ["unfinished_creator"] });
  });
  it("does not use an invoice cap to discard actual extra successful refund resources", () => {
    expect(capacity([request()], [fact(), fact({ providerRef: "re_second" })])).toMatchObject({ refundedMinor: 800, availableMinor: null, debt: ["over_refunded"] });
  });
  it("preserves original account refunds without inventing a logical request for dashboard activity", () => {
    expect(capacity([], [fact({ requestId: null })])).toMatchObject({ refundedMinor: 400, availableMinor: 600, debt: ["unassigned_refund"] });
  });
  it("reserves multiple pending physical resources even when they exceed their logical amount", () => {
    expect(capacity([request()], [fact({ status: "pending" }), fact({ providerRef: "re_second", amountMinor: 500, status: "pending" })])).toMatchObject({ reservedMinor: 900, availableMinor: 100, debt: ["unknown_refund"] });
  });
  it("refuses to choose between contradictory money, currency or succeeded/failed provider evidence", () => {
    expect(capacity([request()], [fact(), fact({ amountMinor: 200 })])).toMatchObject({ refundedMinor: null, availableMinor: null, debt: ["contradictory_provider_fact", "unknown_refund"] });
    expect(capacity([request()], [fact({ currency: "USD" })])).toMatchObject({ availableMinor: null, debt: ["contradictory_provider_fact", "unknown_refund"] });
    expect(capacity([request({ terminalFailureVerified: true })], [fact(), fact({ status: "failed" })])).toMatchObject({ refundedMinor: null, availableMinor: null, debt: ["contradictory_provider_fact"] });
  });
  it("can use a later verified binding without deleting its original unassigned cash observation", () => {
    expect(capacity([request()], [fact({ requestId: null, bindingVerified: false }), fact()])).toEqual({ refundedMinor: 400, reservedMinor: 0, availableMinor: 600, debt: [] });
  });

  it("reserves nullable and customer-action refund statuses without treating them as absence", () => {
    for (const status of [null, "requires_action"] as const) {
      expect(capacity([request()], [fact({ status })])).toMatchObject({ refundedMinor: 0, reservedMinor: 400, availableMinor: 600, debt: ["unknown_refund"] });
    }
  });
  it("keeps a later contradictory refund action or cancellation as recovery debt", () => {
    for (const status of ["requires_action", "canceled", null] as const) {
      expect(capacity([request()], [fact(), fact({ status })])).toMatchObject({ refundedMinor: null, availableMinor: null, debt: ["contradictory_provider_fact"] });
    }
  });
  it("does not use an unbound cancellation to release original refund capacity", () => {
    expect(capacity([request()], [fact({ status: "canceled" })])).toMatchObject({ reservedMinor: 400, debt: ["unknown_refund"] });
    expect(capacity([request({ terminalFailureVerified: true })], [fact({ status: "canceled" })])).toMatchObject({ reservedMinor: 0, debt: [] });
  });
});
