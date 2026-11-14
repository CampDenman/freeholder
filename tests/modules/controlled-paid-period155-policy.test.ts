// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN pure purpose/immutable-approval controls, no money authority.
import { describe, expect, it } from "vitest";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { signOriginalCashRecovery, verifyOriginalCashRecovery } from "@/modules/invoicing/original-cash-recovery-proof";
import { CONTROLLED_PAID_PERIOD_PROTOCOL, controlledPaidPeriodBody } from "@/modules/subscriptions/controlled-provider-paid-period-proof";
import type { subscriptionControlledPaidPeriodReceipts } from "@/modules/subscriptions/controlled-provider-paid-period-schema";
type Receipt = typeof subscriptionControlledPaidPeriodReceipts.$inferSelect;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const key = "actual-pure-purpose-control-key-not-a-site-secret";
const original: Omit<Receipt, "digest" | "authentication"> = {
  id: id(1), protocol: CONTROLLED_PAID_PERIOD_PROTOCOL, admissionTransactionId: "123456", collectionId: id(2), resourceId: id(3), subscriptionId: id(4), invoiceId: id(5),
  termsId: id(6), renewalEventId: id(7), planEventId: null, planId: id(8), productVariantId: id(9), acceptedQuoteDigest: "a".repeat(64), canonicalTargetDigest: "b".repeat(64),
  parentRevision: "c".repeat(64), beforeParentFingerprint: "d".repeat(64),
  beforeEntries: [{ table: "subscriptions", id: id(4), fingerprint: "d".repeat(64), hashDomain: "postgres_row" }],
  beforeParentFields: { current_period_start: "2026-11-12T00:00:00.123456+00:00", current_period_end: "2026-11-13T00:00:00.123456+00:00" },
  bankRevisions: [{ paymentId: id(10), receiptId: id(11), inspectionId: id(12), observationId: id(13), revision: "e".repeat(64) }],
  periodStart: new Date("2026-11-13T00:00:00Z"), periodEnd: new Date("2026-11-14T00:00:00Z"), effectAt: new Date("2026-11-13T12:00:00Z"),
  financialReviewPending: true, createdAt: new Date("2026-11-13T12:00:00Z"),
};
function signed() {
  const digest = merchantTaxDigest(controlledPaidPeriodBody(original));
  return { ...original, digest, authentication: signOriginalCashRecovery(CONTROLLED_PAID_PERIOD_PROTOCOL, { id: original.id, createdAt: original.createdAt, digest }, key) };
}
describe("independent paid effect proof cannot inherit a cash-batch grant", () => {
  it("authenticates its exact new effect purpose and original signature envelope", () => {
    const row = signed(); expect(verifyOriginalCashRecovery(CONTROLLED_PAID_PERIOD_PROTOCOL, row, controlledPaidPeriodBody(row), [key])).toBe(true);
    expect(verifyOriginalCashRecovery("controlled_cash_application_batch.v1", row, controlledPaidPeriodBody(row), [key])).toBe(false);
    expect(verifyOriginalCashRecovery(CONTROLLED_PAID_PERIOD_PROTOCOL, { ...row, id: id(99) }, controlledPaidPeriodBody(row), [key])).toBe(false);
  });
  it.each<Partial<Receipt>>([
    { admissionTransactionId: "123457" }, { collectionId: id(20) }, { invoiceId: id(21) }, { acceptedQuoteDigest: "f".repeat(64) },
    { canonicalTargetDigest: "f".repeat(64) }, { parentRevision: "f".repeat(64) }, { financialReviewPending: false },
    { effectAt: new Date("2026-11-13T00:00:00Z") }, { renewalEventId: id(22) },
    { beforeParentFields: { current_period_start: "2026-11-12T00:00:00.123457+00:00", current_period_end: "2026-11-13T00:00:00.123456+00:00" } },
    { bankRevisions: [{ paymentId: id(10), receiptId: id(11), inspectionId: id(23), observationId: id(13), revision: "e".repeat(64) }] },
  ])("refuses changed actual source, retained PG precision, calendar or ancillary-debt ownership %j", change => {
    const row = { ...signed(), ...change };
    expect(verifyOriginalCashRecovery(CONTROLLED_PAID_PERIOD_PROTOCOL, row, controlledPaidPeriodBody(row), [key])).toBe(false);
  });
});
