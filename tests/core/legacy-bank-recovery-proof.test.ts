// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: immutable exact lineage and actual reader-stop policy.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LEGACY_REPLACEMENT_PROTOCOL, LEGACY_REPLACEMENT_REASON, LEGACY_REPLACEMENT_STATE, signLegacyReplacement, verifyLegacyReplacement, type LegacyReplacementBody } from "@/modules/invoicing/legacy-bank-replacement-proof";
import { legacyReaderStopVerdict } from "@/modules/invoicing/legacy-bank-reader-recovery";
function fixture() {
  const body: LegacyReplacementBody = { protocol: LEGACY_REPLACEMENT_PROTOCOL, evidenceId: randomUUID(), rootRefundId: randomUUID(), rootOriginalDigest: "a".repeat(64),
    parentRefundId: randomUUID(), parentOriginalDigest: "b".repeat(64), replacementRefundId: randomUUID(), replacementRequestHash: "c".repeat(64), paymentId: randomUUID(), invoiceId: randomUUID(),
    originalPaymentRef: "pi_actualLegacy", originalChargeAccountId: null, originalCreatePlatformAccountId: null, originalCreateProtocolVersion: null,
    amountMinor: 400, currency: "CAD", terminalReads: [{ refundId: randomUUID(), receiptId: randomUUID(), resolvedRevision: "d".repeat(64) }], authorizedBy: `user:${randomUUID()}`, authorizedAt: "2026-11-13T20:00:00.000Z" };
  const row = { id: body.evidenceId, subjectType: "refund", subjectId: body.parentRefundId, fromState: null as string | null,
    toState: LEGACY_REPLACEMENT_STATE, reason: LEGACY_REPLACEMENT_REASON, actor: body.authorizedBy, occurredAt: new Date(body.authorizedAt), metadata: signLegacyReplacement(body, "current-fixture-key") };
  return { body, row };
}
describe("authentic legacy replacement signatures", () => {
  it("verifies actual refund IDs while preserving unknown original birth scope", () => {
    const { body, row } = fixture(); expect(verifyLegacyReplacement(row, ["current-fixture-key"])).toEqual(body);
    expect(row.metadata.originalCreatePlatformAccountId).toBeNull(); expect(row.metadata.originalCreateProtocolVersion).toBeNull();
  });
  it("accepts the retained previous key only for existing proof", () => {
    const { body, row } = fixture(); row.metadata = signLegacyReplacement(body, "previous-fixture-key");
    expect(verifyLegacyReplacement(row, ["current-fixture-key", "previous-fixture-key"])).toEqual(body);
    expect(verifyLegacyReplacement(row, ["current-fixture-key"])).toBeNull();
  });
  it.each(["rootRefundId", "parentRefundId", "replacementRefundId", "paymentId", "invoiceId"] as const)("rejects a same-amount copied association after %s changes", key => {
    const { row } = fixture(); row.metadata[key] = randomUUID(); expect(verifyLegacyReplacement(row, ["current-fixture-key"])).toBeNull();
  });
  it.each(["rootOriginalDigest", "parentOriginalDigest", "replacementRequestHash"] as const)("refuses changed original authority %s", key => {
    const { row } = fixture(); row.metadata[key] = "f".repeat(64); expect(verifyLegacyReplacement(row, ["current-fixture-key"])).toBeNull();
  });
  it("rejects changed authorization bytes even with the same exact resource and amount", () => {
    const { row } = fixture(); row.metadata.terminalReads[0]!.resolvedRevision = "e".repeat(64); expect(verifyLegacyReplacement(row, ["current-fixture-key"])).toBeNull();
  });
  it("refuses a copied journal row whose external subject differs from its signed parent", () => {
    const { row } = fixture(); row.subjectId = randomUUID(); expect(verifyLegacyReplacement(row, ["current-fixture-key"])).toBeNull();
  });
  it("refuses a different author or a changed journal timestamp", () => {
    const { row } = fixture(); expect(verifyLegacyReplacement({ ...row, actor: `user:${randomUUID()}` }, ["current-fixture-key"])).toBeNull();
    expect(verifyLegacyReplacement({ ...row, occurredAt: new Date("2026-11-13T20:00:01.000Z") }, ["current-fixture-key"])).toBeNull();
  });
  it("does not accept a newly manufactured historical create platform", () => {
    const { row } = fixture(); expect(verifyLegacyReplacement({ ...row, metadata: { ...row.metadata, originalCreatePlatformAccountId: "acct_invented" } }, ["current-fixture-key"])).toBeNull();
  });
});
describe("exact stopped legacy reader policy", () => {
  const actual = () => ({ expectedCallerId: "original-caller", actualCallerId: "original-caller", expectedOriginalDigest: "a", actualOriginalDigest: "a",
    expectedSourceRevision: "b", actualSourceRevision: "b", hasFinish: false, liveness: "live" as "live" | "absent" | "unobservable" });
  it("rejects an observable live original birth", () => { expect(legacyReaderStopVerdict(actual())).toBe("live"); });
  it("classifies an exact mechanically absent birth separately from returned/thrown", () => { expect(legacyReaderStopVerdict({ ...actual(), liveness: "absent" })).toBe("original_process_absent"); });
  it("does not label an unobservable host mechanically absent", () => { expect(legacyReaderStopVerdict({ ...actual(), liveness: "unobservable" })).toBe("unobservable_host_review"); });
  it.each(["expectedCallerId", "expectedOriginalDigest", "expectedSourceRevision"] as const)("refuses stale review of %s", key => {
    const input = actual(); input[key] = "other"; expect(legacyReaderStopVerdict({ ...input, liveness: "absent" })).toBe("changed_or_finished");
  });
  it("does not replace an actual wrapper finish with a hosting review", () => { expect(legacyReaderStopVerdict({ ...actual(), hasFinish: true, liveness: "absent" })).toBe("changed_or_finished"); });
});
