// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: exact original source identity, immutable occurrences and safe capacity.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { cashNamespaceKey, exactCashResourceRefs, remainingOriginalCashAuxiliary, signOriginalCashRecovery, verifyOriginalCashRecovery } from "@/modules/invoicing/original-cash-recovery-proof";
function signed() {
  const body = { recoveryId: randomUUID(), operationId: randomUUID(), kind: "resource", evidence: { providerRef: "trr_Actual", amountMinor: 73, currency: "CAD" } };
  const row = { id: randomUUID(), digest: merchantTaxDigest(body), createdAt: new Date("2026-11-13T12:00:00.000Z") };
  return { body, row: { ...row, authentication: signOriginalCashRecovery("fact", row, "original-test-key") } };
}
describe("original cash-return occurrence authentication", () => {
  it("authenticates the exact original fact with a retained prior key", () => {
    const { body, row } = signed(); expect(verifyOriginalCashRecovery("fact", row, body, ["rotated-key", "original-test-key"])).toBe(true);
    expect(verifyOriginalCashRecovery("fact", row, body, ["rotated-key"])).toBe(false);
  });
  it.each(["owner", "operation", "closure"])("does not reuse a raw fact signature as %s authority", kind => {
    const { body, row } = signed(); expect(verifyOriginalCashRecovery(kind, row, body, ["original-test-key"])).toBe(false);
  });
  it("refuses changed actual money even when its unkeyed digest is recomputed", () => {
    const { body, row } = signed(); body.evidence.amountMinor++;
    expect(verifyOriginalCashRecovery("fact", { ...row, digest: merchantTaxDigest(body) }, body, ["original-test-key"])).toBe(false);
  });
  it("refuses moving a signed fact into a different retained occurrence or time", () => {
    const { body, row } = signed();
    expect(verifyOriginalCashRecovery("fact", { ...row, id: randomUUID() }, body, ["original-test-key"])).toBe(false);
    expect(verifyOriginalCashRecovery("fact", { ...row, createdAt: new Date("2026-11-13T12:00:01.000Z") }, body, ["original-test-key"])).toBe(false);
  });
  it("retains a receipt-only owner without inventing a payment or original caller", () => {
    const body = { paymentId: null, subscriptionChargeReceiptId: randomUUID(), originalCaller: null, review: "new explicit hosting review" };
    const row = { id: randomUUID(), digest: merchantTaxDigest(body), createdAt: new Date("2026-11-13T12:00:00.000Z") };
    const actual = { ...row, authentication: signOriginalCashRecovery("owner", row, "original-test-key") };
    expect(verifyOriginalCashRecovery("owner", actual, body, ["original-test-key"])).toBe(true);
    expect(verifyOriginalCashRecovery("owner", actual, { ...body, paymentId: randomUUID() }, ["original-test-key"])).toBe(false);
  });
});
describe("original cash namespace and auxiliary capacity", () => {
  const source = { providerPlatformAccountId: "acct_Original", chargeAccountId: null, providerRef: "pi_Actual" };
  it.each(["providerPlatformAccountId", "chargeAccountId", "providerRef"] as const)("separates %s without equal-money ownership inference", field => {
    expect(cashNamespaceKey(source)).not.toBe(cashNamespaceKey({ ...source, [field]: field === "providerRef" ? "pi_Other" : "acct_Other" }));
  });
  it("conserves exact remaining fee or recipient cents", () => { expect(remainingOriginalCashAuxiliary(101, 73)).toBe(28); expect(remainingOriginalCashAuxiliary(101, 101)).toBe(0); });
  it.each([null, NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("keeps unknown or invalid original amount %s in review", amount => { expect(remainingOriginalCashAuxiliary(amount, 0)).toBeNull(); });
  it("refuses an over-return rather than clamping its actual money", () => { expect(remainingOriginalCashAuxiliary(100, 101)).toBeNull(); });
  it("retains all distinct actual ACKs rather than selecting an equal resource", () => {
    expect(exactCashResourceRefs([{ kind: "ack", evidence: { providerRef: "trr_First" } }, { kind: "ack", evidence: { providerRef: "trr_Second" } }])).toEqual(["trr_First", "trr_Second"]);
    expect(exactCashResourceRefs([{ kind: "ack", evidence: { providerRef: "trr_First" } }, { kind: "ack", evidence: { providerRef: "trr_First" } }])).toEqual(["trr_First"]);
  });
});
