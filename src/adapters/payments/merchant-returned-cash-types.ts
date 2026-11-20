// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: raw original-account refund/fee/recipient return facts.
export interface MerchantReturnedCashScope {
  providerPlatformAccountId: string; chargeAccountId: string | null; providerApiVersion: string;
  paymentProviderRef: string; amountMinor: number; currency: string;
  originalChargeRef?: string | null; originalFeeRef?: string | null; originalTransferRef?: string | null;
}
export interface MerchantReturnedCashEvidence {
  providerPlatformAccountId: string; chargeAccountId: string | null; providerApiVersion: string;
  paymentProviderRef: string; providerChargeRef: string; amountMinor: number; currency: string;
  paymentIntentStatus: string; amountCapturableMinor: number | null;
  chargePaymentProviderRef: string | null; chargeAmountMinor: number | null; chargeCurrency: string | null;
  paid: boolean | null; captured: boolean | null; refunded: boolean | null; amountRefundedMinor: number | null;
  refundsComplete: boolean;
  refunds: readonly { providerRef: string; paymentProviderRef: string | null; chargeRef: string | null; amountMinor: number | null; currency: string | null;
    status: "pending" | "requires_action" | "succeeded" | "failed" | "canceled" | null }[];
  /** Presence flags distinguish actual provider null from an omitted field. */
  feeFieldObserved: boolean;
  fee: null | { providerRef: string; originatingChargeRef: string | null; accountId: string | null;
    amountMinor: number | null; refundedMinor: number | null; currency: string | null };
  transferFieldObserved: boolean;
  transfer: null | { providerRef: string; sourceChargeRef: string | null; destinationAccountId: string | null;
    amountMinor: number | null; reversedMinor: number | null; currency: string | null; reversed: boolean | null };
  disputesComplete: boolean;
  disputes: readonly { providerRef: string; chargeRef: string | null; status: string }[];
}
