// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: original fee and recipient resources have their own physical callers.
export interface MerchantCashAuxiliaryEvidence {
  providerRef: string; parentRef: string | null; amountMinor: number | null; currency: string | null;
  operationId: string | null; bindingVerified: boolean;
}
export interface MerchantCashAuxiliaryRequest {
  kind: "fee" | "recipient"; operationId: string; providerPlatformAccountId: string;
  providerApiVersion: "2026-02-25.clover" | "2026-10-28.endive";
  originalChargeRef: string; originalAccountId: string; parentRef: string;
  originalAmountMinor: number; alreadyReturnedMinor: number; amountMinor: number; currency: string;
  idempotencyKey: string; frozenBody: string; originalResourceRef?: string;
  targetFactId?: string;
  onResourceAcknowledged: (providerRef: string) => Promise<void>;
  onResourceObserved: (evidence: MerchantCashAuxiliaryEvidence) => Promise<void>;
  onParentObserved: (evidence: { providerRef: string | null; chargeRef: string | null; accountId: string | null; amountMinor: number | null; returnedMinor: number | null; currency: string | null }) => Promise<void>;
}
