// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38/C1.08: original identity, authentic minimal feedback and money bounds.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { legacyReturnKeyOwnsAllocation } from "@/modules/invoicing/legacy-bank-return-contract";
import { legacyReplacementKey, legacyReplacementParentId, isLegacyReplacementKey, LEGACY_REPLACEMENT_PROTOCOL, LEGACY_REPLACEMENT_REASON, LEGACY_REPLACEMENT_STATE, signLegacyReplacement, verifyLegacyReplacement, type LegacyReplacementBody } from "@/modules/invoicing/legacy-bank-replacement-proof";
import { legacyReplacementBudgetAllows } from "@/modules/invoicing/legacy-bank-replacement-store";
import { legacyBankFeedbackMatchesInventory, normalizeLegacyBankFeedback, signLegacyBankFeedback, verifyLegacyBankFeedback } from "@/modules/invoicing/legacy-bank-feedback-proof";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
const owner = () => ({ returnId: randomUUID(), allocationId: randomUUID(), creditNoteId: randomUUID(), allocationDigest: "a".repeat(64), creditDigest: "b".repeat(64) });
function replacement() {
  const body: LegacyReplacementBody = { protocol: LEGACY_REPLACEMENT_PROTOCOL, evidenceId: randomUUID(), rootRefundId: randomUUID(), rootOriginalDigest: "a".repeat(64), parentRefundId: randomUUID(), parentOriginalDigest: "b".repeat(64), replacementRefundId: randomUUID(), replacementRequestHash: "c".repeat(64), paymentId: randomUUID(), invoiceId: randomUUID(), originalPaymentRef: "pi_OriginalRma", originalChargeAccountId: null, originalCreatePlatformAccountId: null, originalCreateProtocolVersion: null, amountMinor: 1000, currency: "CAD", returnPart: owner(), terminalReads: [{ refundId: randomUUID(), receiptId: randomUUID(), resolvedRevision: "d".repeat(64) }], authorizedBy: `user:${randomUUID()}`, authorizedAt: "2026-11-13T20:00:00.000Z" };
  const row = { id: body.evidenceId, subjectType: "refund", subjectId: body.parentRefundId, fromState: null, toState: LEGACY_REPLACEMENT_STATE, reason: LEGACY_REPLACEMENT_REASON, actor: body.authorizedBy, occurredAt: new Date(body.authorizedAt), metadata: signLegacyReplacement(body, "original-rma-key") };
  return { body, row };
}
function feedback() {
  const evidence = normalizeLegacyBankFeedback({ id: "evt_OriginalRma", kind: "refund_processing", providerRef: "pyr_OriginalRma", observedPaymentIntentRef: "pi_OriginalRma", providerPlatformAccountId: "acct_ActualObserved", providerAccountId: undefined, observedProviderApiVersion: "2026-02-25.clover", providerStatus: null, rawProviderStatus: "future_bank_review", amountMinor: 1000, currency: "CAD", occurredAt: "2026-11-13T20:00:00.000Z", customerEmail: "do-not-retain@example.test", metadata: { customerName: "Do not retain" } }, { rawBodySha256: "c".repeat(64), receivedAt: "2026-11-13T20:00:01.000Z" });
  const unsigned = { id: randomUUID(), captureKey: "d".repeat(64), evidenceDigest: merchantTaxDigest(evidence), createdAt: new Date("2026-11-13T20:00:02.000Z") };
  return { ...unsigned, evidence, authentication: signLegacyBankFeedback(unsigned, "original-feedback-key") };
}
describe("actual legacy RMA ownership", () => {
  it("keeps the causal child inside the exact frozen return allocation key", () => {
    const original = owner(), parent = randomUUID(), payment = randomUUID(), key = legacyReplacementKey(parent, original);
    expect(legacyReturnKeyOwnsAllocation(key, original.returnId, original.allocationId, payment)).toBe(true);
    expect(legacyReplacementParentId(key)).toBe(parent); expect(isLegacyReplacementKey(key)).toBe(true);
    expect(legacyReturnKeyOwnsAllocation(key, randomUUID(), original.allocationId, payment)).toBe(false);
    expect(legacyReturnKeyOwnsAllocation(key, original.returnId, randomUUID(), payment)).toBe(false);
  });
  it("recognizes an actual old original return/payment key without adopting another payment", () => {
    const original = owner(), payment = randomUUID(), key = `return:${original.returnId}:refund:${payment}`;
    expect(legacyReturnKeyOwnsAllocation(key, original.returnId, original.allocationId, payment)).toBe(true);
    expect(legacyReturnKeyOwnsAllocation(key, original.returnId, original.allocationId, randomUUID())).toBe(false);
  });
  it("does not treat an ordinary unrelated legacy key as causal", () => { expect(isLegacyReplacementKey("a-same-amount-refund")).toBe(false); expect(legacyReplacementParentId("a-same-amount-refund")).toBeNull(); });
  it("authenticates actual original allocation/credit identity with unknown original birth unchanged", () => {
    const { body, row } = replacement(); expect(verifyLegacyReplacement(row, ["original-rma-key"])).toEqual(body);
    expect(body.originalCreatePlatformAccountId).toBeNull(); expect(body.originalCreateProtocolVersion).toBeNull();
  });
  it.each(["returnId", "allocationId", "creditNoteId", "allocationDigest", "creditDigest"] as const)("refuses copied same-amount lineage after %s changes", key => {
    const { row } = replacement(); row.metadata.returnPart![key] = key.endsWith("Digest") ? "f".repeat(64) : randomUUID();
    expect(verifyLegacyReplacement(row, ["original-rma-key"])).toBeNull();
  });
  it("preserves compatibility with signed existing non-RMA lineage without inventing a return part", () => {
    const { body, row } = replacement(); delete body.returnPart; row.metadata = signLegacyReplacement(body, "original-rma-key");
    expect(verifyLegacyReplacement(row, ["original-rma-key"])).toEqual(body); expect(Object.hasOwn(row.metadata, "returnPart")).toBe(false);
  });
});
describe("legacy replacement whole-payment reservation", () => {
  it("reserves other genuine owed parts as well as the exact new physical attempt", () => {
    expect(legacyReplacementBudgetAllows([200], [300], 500, 1000)).toBe(true);
    expect(legacyReplacementBudgetAllows([200], [301], 500, 1000)).toBe(false);
  });
  it("does not round an over-budget safe-integer sum into admission", () => {
    expect(legacyReplacementBudgetAllows([Number.MAX_SAFE_INTEGER - 1], [], 1, Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(legacyReplacementBudgetAllows([Number.MAX_SAFE_INTEGER - 1], [], 2, Number.MAX_SAFE_INTEGER)).toBe(false);
  });
  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("refuses invalid money %s", amount => { expect(legacyReplacementBudgetAllows([], [amount], 0, 1000)).toBe(false); });
});
describe("minimal authentic original bank feedback", () => {
  it("preserves actual future nullable status and observed namespace separately from unknown create birth", () => {
    const row = feedback(); expect(verifyLegacyBankFeedback(row, ["original-feedback-key"])).toEqual(row.evidence);
    expect(row.evidence).toMatchObject({ rawProviderStatus: "future_bank_review", status: null, observedPlatformAccountId: "acct_ActualObserved", originalCreatePlatformAccountId: null, originalCreateProtocolVersion: null });
  });
  it("does not retain unrelated customer metadata in immutable financial facts", () => {
    const text = JSON.stringify(feedback().evidence); expect(text).not.toContain("do-not-retain"); expect(text).not.toContain("customerName");
  });
  it("retains a genuine unassigned resource without inventing a missing PaymentIntent, amount or raw byte digest", () => {
    const evidence = normalizeLegacyBankFeedback({ id: "evt_Unassigned", kind: "refund_processing", providerRef: "pyr_Unassigned", occurredAt: "2026-11-13T20:00:00.000Z" }, { rawBodySha256: null, receivedAt: null });
    expect(evidence).toMatchObject({ observedPaymentRef: null, amountMinor: null, rawProviderStatus: null, status: null, rawBodySha256: null, originalCreatePlatformAccountId: null });
  });
  it("does not mistake a Charge identifier for an original PaymentIntent", () => {
    const evidence = normalizeLegacyBankFeedback({ id: "evt_ChargeOnly", kind: "refund_processing", providerRef: "pyr_Original", paymentProviderRef: "ch_ObservedOnly", occurredAt: "2026-11-13T20:00:00.000Z" }, { rawBodySha256: null, receivedAt: null });
    expect(evidence.observedPaymentRef).toBeNull();
  });
  it.each(["observedRefundRef", "observedPaymentRef", "observedChargeAccountId", "observedPlatformAccountId", "rawProviderStatus", "rawBodySha256"] as const)("refuses changed actual feedback %s even if an unkeyed digest is recomputed", field => {
    const row = feedback(); row.evidence[field] = field === "rawBodySha256" ? "f".repeat(64) : field.includes("Account") ? "acct_Other" : "other";
    row.evidenceDigest = merchantTaxDigest(row.evidence); expect(verifyLegacyBankFeedback(row, ["original-feedback-key"])).toBeNull();
  });
  it("refuses moving authentic facts into another retained occurrence or time", () => {
    const row = feedback(); expect(verifyLegacyBankFeedback({ ...row, id: randomUUID() }, ["original-feedback-key"])).toBeNull();
    expect(verifyLegacyBankFeedback({ ...row, createdAt: new Date("2026-11-13T20:00:03.000Z") }, ["original-feedback-key"])).toBeNull();
  });
  it("accepts an actual retained previous key without allowing the current key alone to rewrite history", () => {
    const row = feedback(); expect(verifyLegacyBankFeedback(row, ["new-key", "original-feedback-key"])).toEqual(row.evidence);
    expect(verifyLegacyBankFeedback(row, ["new-key"])).toBeNull();
  });
});
describe("authentic feedback and exact current cash identity", () => {
  const inventory = () => ({ originalPaymentRef: "pi_OriginalRma", originalChargeAccountId: null,
    readPlatformAccountId: "acct_ActualObserved", cash: { paymentProviderRef: "pi_OriginalRma", chargeAccountId: null,
      providerChargeRef: "ch_OriginalRma", refundsComplete: true, refunds: [{ providerRef: "pyr_OriginalRma",
        paymentProviderRef: "pi_OriginalRma", chargeRef: "ch_OriginalRma", amountMinor: 1000, currency: "CAD", status: "failed" }] } });
  it("accepts the same actual resource after its bank status changes without rewriting its old signed facts", () => {
    expect(legacyBankFeedbackMatchesInventory({ ...feedback().evidence, observedChargeRef: "ch_OriginalRma", status: "succeeded" }, inventory())).toBe(true);
  });
  it.each(["observedPaymentRef", "observedChargeRef", "observedChargeAccountId", "observedPlatformAccountId", "amountMinor", "currency"] as const)("retains review when the actual observed %s contradicts current cash", field => {
    const observed = { ...feedback().evidence, observedChargeRef: "ch_OriginalRma" };
    if (field === "amountMinor") observed.amountMinor = 1001;
    else observed[field] = field === "currency" ? "USD" : field.includes("Account") ? "acct_Other" : "other";
    expect(legacyBankFeedbackMatchesInventory(observed, inventory())).toBe(false);
  });
  it("requires one actual resource in a complete inventory, never an equal amount or duplicate identity", () => {
    const observed = feedback().evidence, actual = inventory();
    expect(legacyBankFeedbackMatchesInventory(observed, { ...actual, cash: { ...actual.cash, refundsComplete: false } })).toBe(false);
    expect(legacyBankFeedbackMatchesInventory(observed, { ...actual, cash: { ...actual.cash, refunds: [{ ...actual.cash.refunds[0]!, providerRef: "pyr_UnrelatedEqual" }] } })).toBe(false);
    expect(legacyBankFeedbackMatchesInventory(observed, { ...actual, cash: { ...actual.cash, refunds: [...actual.cash.refunds, ...actual.cash.refunds] } })).toBe(false);
  });
  it("leaves genuinely unobserved fields unknown while requiring the actual resource identity", () => {
    expect(legacyBankFeedbackMatchesInventory({ ...feedback().evidence, observedPaymentRef: null, observedChargeRef: null,
      observedPlatformAccountId: null, amountMinor: null, currency: null }, inventory())).toBe(true);
  });
});
