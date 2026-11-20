// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: an actual finished creator ACK is distinct from fresh bank proof.
import { ServiceError } from "@/core/service";

/** Raised only after authentic original admission/finish/result correlation.
 * It permits no state/cash change and is not itself a bank read receipt. */
export class LegacyBankProofPendingError extends ServiceError {
  constructor(readonly refundId: string, readonly providerRef: string) {
    super("conflict", "The actual original refund ACK and finished caller are retained. Check its exact current bank resource before changing money.");
    this.name = "LegacyBankProofPendingError";
  }
}

/** A replacement may continue to actual fresh GETs only for this exact
 * retained processing child. A generic conflict/provider error is not proof. */
export function matchesLegacyBankProofContinuation(error: unknown, refund: { id: string; providerRef: string | null; status: string }): error is LegacyBankProofPendingError {
  return error instanceof LegacyBankProofPendingError && error.refundId === refund.id
    && refund.status === "processing" && refund.providerRef !== null && refund.providerRef === error.providerRef;
}
