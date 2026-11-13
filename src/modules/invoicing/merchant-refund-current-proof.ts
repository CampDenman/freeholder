// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: a current read proves one exact resource and evidence revision.
export type OriginalRefundCurrentStatus = "pending" | "requires_action" | "succeeded" | "failed" | "canceled" | null;
export interface OriginalRefundReadIdentity {
  providerPlatformAccountId: string; chargeAccountId: string | null;
  providerApiVersion: string; providerRef: string; paymentProviderRef: string;
  amountMinor: number; currency: string;
}
export interface OriginalRefundCurrentFact extends Omit<OriginalRefundReadIdentity, "paymentProviderRef" | "providerApiVersion"> {
  paymentProviderRef: string | null; providerApiVersion: string | null; status: OriginalRefundCurrentStatus;
  failureBalanceTransactionRef: string | null; bindingVerified: boolean;
}
export type OriginalRefundReadVerdict =
  | { state: "review"; reason: "incomplete" | "unfinished_creator" | "unfinished_read" | "stale_evidence" | "foreign_resource" }
  | { state: "verified"; status: OriginalRefundCurrentStatus; terminal: boolean; failureBalanceTransactionRef: string | null };

/** The service and SQL separately derive these witnesses from original rows.
 * This pure decision does not create caller, provider or ownership authority.
 * Earlier observations remain immutable, including every earlier success.
 */
export function originalRefundCurrentReadVerdict(input: {
  original: OriginalRefundReadIdentity; actual: OriginalRefundCurrentFact;
  preparedRevision: string; currentPriorRevision: string; incomplete: boolean;
  creatorsQuiesced: boolean; readReturned: boolean; exactCallerFinished: boolean;
}): OriginalRefundReadVerdict {
  if (input.incomplete) return { state: "review", reason: "incomplete" };
  if (!input.creatorsQuiesced) return { state: "review", reason: "unfinished_creator" };
  if (!input.readReturned || !input.exactCallerFinished) return { state: "review", reason: "unfinished_read" };
  if (input.preparedRevision !== input.currentPriorRevision) return { state: "review", reason: "stale_evidence" };
  const { original, actual } = input;
  if (!actual.bindingVerified || Object.entries(original).some(([key, value]) => actual[key as keyof OriginalRefundReadIdentity] !== value)) {
    return { state: "review", reason: "foreign_resource" };
  }
  return { state: "verified", status: actual.status,
    terminal: actual.status === "succeeded" || actual.status === "failed" || actual.status === "canceled",
    failureBalanceTransactionRef: actual.failureBalanceTransactionRef };
}
