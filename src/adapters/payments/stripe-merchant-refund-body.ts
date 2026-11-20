// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: commit the exact provider body before physical refund admission.
import type { MerchantRefundRecoveryRequest } from "./types";
type Original = Pick<MerchantRefundRecoveryRequest, "paymentProviderRef" | "amountMinor" | "refundAttemptId" | "providerPlatformAccountId" | "paymentId" | "subscriptionChargeReceiptId">;
export function stripeMerchantRefundBody(request: Original): string {
  return new URLSearchParams({ payment_intent: request.paymentProviderRef, amount: String(request.amountMinor),
    "metadata[freeholder_refund_id]": request.refundAttemptId, "metadata[freeholder_platform_account_id]": request.providerPlatformAccountId,
    ...(request.paymentId ? { "metadata[freeholder_payment_id]": request.paymentId }
      : { "metadata[freeholder_subscription_charge_receipt_id]": request.subscriptionChargeReceiptId! }) }).toString();
}
