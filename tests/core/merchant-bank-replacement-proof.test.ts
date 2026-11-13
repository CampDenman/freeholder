// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: an equal refund or copied journal row cannot replace causality.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BANK_REPLACEMENT_PROTOCOL, BANK_REPLACEMENT_REASON, BANK_REPLACEMENT_STATE,
  signBankReplacement, verifyBankReplacement, type BankReplacementBody } from "@/modules/invoicing/merchant-bank-replacement-proof";

const currentKey = "replacement-current-test-only-key", previousKey = "replacement-previous-test-only-key";
function fixture() {
  const body: BankReplacementBody = {
    protocol: BANK_REPLACEMENT_PROTOCOL, evidenceId: randomUUID(), rootRequestId: randomUUID(), rootRequestDigest: "a".repeat(64),
    parentRequestId: randomUUID(), parentRequestDigest: "b".repeat(64), parentRefundId: randomUUID(),
    replacementRequestId: randomUUID(), replacementRequestDigest: "c".repeat(64), replacementRefundId: randomUUID(),
    paymentId: randomUUID(), providerPlatformAccountId: "acct_originalPlatform", chargeAccountId: "acct_originalSeller",
    originalPaymentRef: "pi_original", amountMinor: 400, currency: "CAD",
    terminalReads: [{ requestId: randomUUID(), receiptId: randomUUID(), resolvedRevision: "d".repeat(64) }],
    retiredRequestIds: [], authorizedBy: `user:${randomUUID()}`, authorizedAt: "2026-11-13T01:00:00.000Z",
  };
  const row = { id: body.evidenceId, subjectType: "refund", subjectId: body.parentRefundId, fromState: null as string | null,
    toState: BANK_REPLACEMENT_STATE, reason: BANK_REPLACEMENT_REASON, actor: body.authorizedBy,
    occurredAt: new Date(body.authorizedAt), metadata: signBankReplacement(body, currentKey) };
  return { body, row };
}

describe("original bank-refund replacement authorization", () => {
  it("verifies retained evidence after key rotation without signing it again", () => {
    const { body, row } = fixture();
    row.metadata = signBankReplacement(body, previousKey);
    expect(verifyBankReplacement(row, [currentKey, previousKey])).toEqual(body);
    expect(verifyBankReplacement(row, [currentKey])).toBeNull();
  });
  it("refuses a record from another purpose even with an otherwise valid MAC", () => {
    const { row } = fixture();
    expect(verifyBankReplacement({ ...row, toState: "provider_result_observed" }, [currentKey])).toBeNull();
    expect(verifyBankReplacement({ ...row, subjectType: "payment" }, [currentKey])).toBeNull();
  });
  it.each(["amountMinor", "currency", "paymentId", "providerPlatformAccountId", "chargeAccountId", "originalPaymentRef",
    "rootRequestId", "rootRequestDigest", "parentRequestId", "replacementRequestId", "replacementRefundId", "terminalReads"] as const)
  ("refuses an altered original or causal field: %s", field => {
    const { row } = fixture();
    const changes = { amountMinor: 401, currency: "USD", paymentId: randomUUID(), providerPlatformAccountId: "acct_otherPlatform",
      chargeAccountId: null, originalPaymentRef: "pi_other", rootRequestId: randomUUID(), rootRequestDigest: "e".repeat(64),
      parentRequestId: randomUUID(), replacementRequestId: randomUUID(), replacementRefundId: randomUUID(),
      terminalReads: [{ ...row.metadata.terminalReads[0], resolvedRevision: "f".repeat(64) }] };
    expect(verifyBankReplacement({ ...row, metadata: { ...row.metadata, [field]: changes[field] } }, [currentKey])).toBeNull();
  });
  it("binds authorization to the actual journal row, actor and occurrence", () => {
    const { row } = fixture();
    for (const change of [{ id: randomUUID() }, { subjectId: randomUUID() }, { actor: `user:${randomUUID()}` },
      { occurredAt: new Date("2026-11-13T01:00:01.000Z") }, { occurredAt: new Date("invalid") }, { fromState: "created" }]) {
      expect(verifyBankReplacement({ ...row, ...change }, [currentKey])).toBeNull();
    }
  });
  it("does not adopt an unsigned, corrupt, or extended historical journal entry", () => {
    const { body, row } = fixture();
    expect(verifyBankReplacement({ ...row, metadata: body }, [currentKey])).toBeNull();
    expect(verifyBankReplacement({ ...row, metadata: { ...row.metadata, authentication: "0".repeat(64) } }, [currentKey])).toBeNull();
    expect(verifyBankReplacement({ ...row, metadata: { ...row.metadata, ignoreOriginalFailure: true } }, [currentKey])).toBeNull();
    expect(verifyBankReplacement(row, [])).toBeNull();
  });
  it("does not make JSON key order a replacement authority", () => {
    const { body, row } = fixture();
    const reversed = Object.fromEntries(Object.entries(row.metadata).reverse());
    expect(verifyBankReplacement({ ...row, metadata: reversed }, [currentKey])).toEqual(body);
  });
  it("requires an actual retained terminal read and a current signing key", () => {
    const { body } = fixture();
    expect(() => signBankReplacement({ ...body, terminalReads: [] }, currentKey)).toThrow();
    expect(() => signBankReplacement(body, "")).toThrow();
  });
});
