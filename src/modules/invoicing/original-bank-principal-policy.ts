// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: acyclic exact original bank principal policy, no collectors or I/O.
import type { MerchantReturnedCashEvidence } from "./merchant-returned-cash-proof";

/** Bank evidence is actual exact-source inventory, not an amount selected from
 * a callback. The caller independently proves the actual merchant route. */
export function currentBankPrincipalMatches(input: { amountMinor: number; currency: string; refundedMinor: number; apiVersion: string; platform: string; account: string | null; paymentRef: string; chargeRef?: string | null }, evidence: MerchantReturnedCashEvidence) {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || evidence.providerApiVersion !== input.apiVersion || evidence.providerPlatformAccountId !== input.platform || evidence.chargeAccountId !== input.account || evidence.paymentProviderRef !== input.paymentRef
    || input.chargeRef && evidence.providerChargeRef !== input.chargeRef || evidence.chargePaymentProviderRef !== input.paymentRef
    || evidence.paymentIntentStatus !== "succeeded" || evidence.amountCapturableMinor !== 0 || evidence.amountMinor !== input.amountMinor || evidence.currency !== input.currency
    || evidence.chargeAmountMinor !== input.amountMinor || evidence.chargeCurrency !== input.currency || !evidence.paid || !evidence.captured
    || !evidence.refundsComplete || !evidence.disputesComplete || evidence.disputes.some(row => row.chargeRef !== evidence.providerChargeRef || !["won", "warning_closed"].includes(row.status))) return false;
  if (new Set(evidence.disputes.map(row => row.providerRef)).size !== evidence.disputes.length) return false;
  const seen = new Set<string>(); let returned = 0n;
  for (const refund of evidence.refunds) {
    if (seen.has(refund.providerRef) || refund.paymentProviderRef !== input.paymentRef || refund.chargeRef !== evidence.providerChargeRef
      || refund.currency !== input.currency || refund.amountMinor === null || !Number.isSafeInteger(refund.amountMinor) || refund.amountMinor <= 0
      || !["succeeded", "failed", "canceled"].includes(refund.status ?? "")) return false;
    seen.add(refund.providerRef); if (refund.status === "succeeded") returned += BigInt(refund.amountMinor);
  }
  return Number.isSafeInteger(input.refundedMinor) && input.refundedMinor >= 0 && input.refundedMinor <= input.amountMinor
    && returned === BigInt(input.refundedMinor) && evidence.amountRefundedMinor === input.refundedMinor;
}

