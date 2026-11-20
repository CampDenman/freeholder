// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: a typed creator continuation never substitutes for bank proof.
import { describe, expect, it } from "vitest";
import { ServiceError } from "@/core/service";
import { LegacyBankProofPendingError, matchesLegacyBankProofContinuation } from "@/modules/invoicing/legacy-bank-proof-pending";
const refund = { id: "00000000-0000-4000-8000-000000000001", providerRef: "pyr_ActualFinishedChild", status: "processing" };
describe("actual legacy creator bank-proof continuation", () => {
  it("retains a refusal for public callers while matching only its exact retained child ACK", () => {
    const error = new LegacyBankProofPendingError(refund.id, refund.providerRef);
    expect(error).toBeInstanceOf(ServiceError); expect(error.code).toBe("conflict");
    expect(matchesLegacyBankProofContinuation(error, refund)).toBe(true);
    expect(error.message).not.toContain(refund.providerRef);
  });
  it("does not turn an ordinary provider/SQL/conflict failure or lookalike object into permission to continue", () => {
    for (const error of [new Error("Provider failure"), new ServiceError("conflict", "Original caller needs recovery"), { name: "LegacyBankProofPendingError", code: "conflict", refundId: refund.id, providerRef: refund.providerRef }, null]) {
      expect(matchesLegacyBankProofContinuation(error, refund)).toBe(false);
    }
  });
  it("refuses a different original child or a different actual resource reference", () => {
    expect(matchesLegacyBankProofContinuation(new LegacyBankProofPendingError("00000000-0000-4000-8000-000000000002", refund.providerRef), refund)).toBe(false);
    expect(matchesLegacyBankProofContinuation(new LegacyBankProofPendingError(refund.id, "pyr_UnrelatedEqualAmount"), refund)).toBe(false);
  });
  it("does not treat an absent ACK or a created/succeeded/failed row as the retained processing continuation", () => {
    const error = new LegacyBankProofPendingError(refund.id, refund.providerRef);
    expect(matchesLegacyBankProofContinuation(error, { ...refund, providerRef: null })).toBe(false);
    for (const status of ["created", "succeeded", "failed", "cancelled"]) expect(matchesLegacyBankProofContinuation(error, { ...refund, status })).toBe(false);
  });
});
