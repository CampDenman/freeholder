// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: PREPARED/UNRUN exact original identities, no amount adoption.
import { describe, expect, it } from "vitest";
import { uniqueOriginalFeedbackOwner, originalFeedbackMatchesFrozenSource, type OriginalFeedbackOwnerCandidate } from "@/modules/invoicing/original-cash-feedback-owner";
const payment = "00000000-0000-4000-8000-000000000001", receipt = "00000000-0000-4000-8000-000000000002", foreign = "00000000-0000-4000-8000-000000000003";
const source = (change: Partial<OriginalFeedbackOwnerCandidate> = {}): OriginalFeedbackOwnerCandidate => ({ paymentId: payment, subscriptionChargeReceiptId: null,
  platform: "acct_Original", account: null, paymentRef: "pi_Original", kind: "payment_observation", id: payment, fingerprint: "a".repeat(64), ...change });
describe("original feedback financial owner selection", () => {
  it("retains one actual payment across distinct receipts for its same original namespace", () => {
    expect(uniqueOriginalFeedbackOwner([source(), source({ id: foreign })], [])).toMatchObject({ kind: "payment", paymentId: payment, subscriptionChargeReceiptId: null });
  });
  it("retains a real NULL-payment receipt without manufacturing a local payment", () => {
    expect(uniqueOriginalFeedbackOwner([source({ paymentId: null, subscriptionChargeReceiptId: receipt, kind: "charge_receipt", id: receipt })], []))
      .toMatchObject({ kind: "subscription", paymentId: null, subscriptionChargeReceiptId: receipt });
  });
  it("requires the real receipt FK alias to combine a receipt with its actual local payment", () => {
    const sources = [source(), source({ paymentId: null, subscriptionChargeReceiptId: receipt, kind: "charge_receipt", id: receipt })];
    expect(() => uniqueOriginalFeedbackOwner(sources, [])).toThrow();
    expect(uniqueOriginalFeedbackOwner(sources, [{ paymentId: payment, receiptId: receipt }])).toMatchObject({ kind: "payment", paymentId: payment });
  });
  it("refuses a second original owner even when every provider namespace field is equal", () => {
    expect(() => uniqueOriginalFeedbackOwner([source(), source({ paymentId: foreign, id: foreign })], [])).toThrow();
  });
  it("refuses contradictory PI, account or known platform rather than selecting the first original source", () => {
    for (const change of [{ paymentRef: "pi_Foreign" }, { account: "acct_Foreign" }, { platform: "acct_Foreign" }])
      expect(() => uniqueOriginalFeedbackOwner([source(), source(change)], [])).toThrow();
  });
  it("allows an authentic old unknown creator platform only for the same original local owner/PI/account", () => {
    const legacy = source({ platform: null, kind: "legacy_admission" });
    expect(uniqueOriginalFeedbackOwner([legacy, source()], [])).toMatchObject({ kind: "payment", paymentId: payment });
    expect(legacy.platform).toBeNull();
    expect(() => uniqueOriginalFeedbackOwner([legacy, source({ paymentRef: "pi_Foreign" })], [])).toThrow();
  });
  it("refuses an absent original owner or a conflicting receipt alias", () => {
    expect(() => uniqueOriginalFeedbackOwner([], [])).toThrow();
    expect(() => uniqueOriginalFeedbackOwner([source()], [{ paymentId: payment, receiptId: receipt }, { paymentId: foreign, receiptId: receipt }])).toThrow();
  });
  it("refuses incomplete bounds without selecting a sample", () => {
    expect(() => uniqueOriginalFeedbackOwner(Array.from({ length: 5001 }, () => source()), [])).toThrow();
  });
  it("refuses a positive observation from a foreign platform/account instead of borrowing a matching local route",()=>{
    const namespace={platform:"acct_Original",account:null,paymentRef:"pi_Original"};
    expect(originalFeedbackMatchesFrozenSource(namespace,{platform:"acct_Original",account:null})).toBe(true);
    expect(originalFeedbackMatchesFrozenSource(namespace,{platform:"acct_Foreign",account:null})).toBe(false);
    expect(originalFeedbackMatchesFrozenSource(namespace,{platform:"acct_Original",account:"acct_Foreign"})).toBe(false);
    expect(originalFeedbackMatchesFrozenSource({...namespace,platform:null},{platform:"acct_Original",account:null})).toBe(true);
    expect(originalFeedbackMatchesFrozenSource({...namespace,platform:null,observedPlatform:"acct_Foreign"},{platform:"acct_Original",account:null})).toBe(false);
  });
  it("retains exact immutable source generations in the repair evidence digest", () => {
    expect(uniqueOriginalFeedbackOwner([source()], []).lineageDigest).not.toBe(uniqueOriginalFeedbackOwner([source({ fingerprint: "b".repeat(64) })], []).lineageDigest);
    expect(uniqueOriginalFeedbackOwner([source(), source({ id: foreign })], []).lineageDigest).toBe(uniqueOriginalFeedbackOwner([source({ id: foreign }), source()], []).lineageDigest);
  });
});
