// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: fully returned unapplied cash is independent of invoice/payment fiction.
import type { MerchantReturnedCashScope, MerchantReturnedCashEvidence } from "@/adapters/payments/merchant-returned-cash-types";
import { STRIPE_REFUND_REFERENCE } from "@/adapters/payments/stripe-refund-reference";
export type { MerchantReturnedCashScope, MerchantReturnedCashEvidence } from "@/adapters/payments/merchant-returned-cash-types";
export type MerchantReturnedCashDebt = "original_cash" | "customer_refund" | "commission" | "recipient" | "dispute" | "unfinished_creator" | "changed_inventory";
const currency = (value: unknown): value is string => typeof value === "string" && /^[A-Z]{3}$/.test(value);
const minor = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const reference = (value: string | null | undefined, prefix: string) => typeof value === "string" && value.length <= 200 && new RegExp(`^${prefix}_[A-Za-z0-9_]+$`).test(value);

/** Authenticated provider reads supply the facts; this function cannot verify
 * authentication, physical caller completion or inventory completeness itself.
 * Those separate durable phases must bind their real receipts to this result.
 */
export function merchantReturnedCashProof(input: { original: MerchantReturnedCashScope; evidence: MerchantReturnedCashEvidence;
  creatorsQuiesced: boolean; inventoryStable: boolean }): { settled: boolean; debt: MerchantReturnedCashDebt[] } {
  const { original, evidence } = input, debt = new Set<MerchantReturnedCashDebt>();
  if (!minor(original.amountMinor) || original.amountMinor <= 0 || !currency(original.currency)) throw new RangeError("Use the actual original positive cash amount and currency.");
  if (!input.creatorsQuiesced) debt.add("unfinished_creator");
  if (!input.inventoryStable) debt.add("changed_inventory");
  if (original.providerPlatformAccountId !== evidence.providerPlatformAccountId || original.chargeAccountId !== evidence.chargeAccountId
    || original.providerApiVersion !== evidence.providerApiVersion || original.paymentProviderRef !== evidence.paymentProviderRef
    || !reference(evidence.paymentProviderRef, "pi") || !reference(evidence.providerChargeRef, "ch")
    || original.originalChargeRef && original.originalChargeRef !== evidence.providerChargeRef
    || !["succeeded", "canceled"].includes(evidence.paymentIntentStatus) || evidence.amountCapturableMinor !== 0
    || evidence.chargePaymentProviderRef !== original.paymentProviderRef || evidence.chargeAmountMinor !== original.amountMinor || evidence.chargeCurrency !== original.currency
    || evidence.amountMinor !== original.amountMinor || evidence.currency !== original.currency || evidence.paid !== true || evidence.captured !== true) debt.add("original_cash");
  const refs = new Set<string>();
  let returned = 0n;
  if (!evidence.refundsComplete || evidence.refunded !== true || evidence.amountRefundedMinor !== original.amountMinor) debt.add("customer_refund");
  for (const refund of evidence.refunds) {
    if (!STRIPE_REFUND_REFERENCE.test(refund.providerRef) || refund.providerRef.length > 200 || refs.has(refund.providerRef) || refund.paymentProviderRef !== original.paymentProviderRef
      || refund.chargeRef !== evidence.providerChargeRef || !minor(refund.amountMinor) || refund.amountMinor <= 0 || refund.currency !== original.currency) {
      debt.add("customer_refund"); continue;
    }
    refs.add(refund.providerRef);
    if (refund.status === "succeeded") returned += BigInt(refund.amountMinor);
    else if (refund.status !== "failed" && refund.status !== "canceled") debt.add("customer_refund");
  }
  if (returned !== BigInt(original.amountMinor)) debt.add("customer_refund");
  const fee = evidence.fee;
  if (!evidence.feeFieldObserved || original.originalFeeRef && original.originalFeeRef !== fee?.providerRef) debt.add("commission");
  if (fee && (!reference(fee.providerRef, "fee") || fee.originatingChargeRef !== evidence.providerChargeRef || !reference(fee.accountId, "acct")
    || !minor(fee.amountMinor) || !minor(fee.refundedMinor) || fee.refundedMinor !== fee.amountMinor || !currency(fee.currency))) debt.add("commission");
  const transfer = evidence.transfer;
  if (!evidence.transferFieldObserved || original.originalTransferRef && original.originalTransferRef !== transfer?.providerRef) debt.add("recipient");
  // The actual transfer is reversed in its actual currency. No assumed FX or
  // current seller account substitutes for its original source/recipient.
  if (transfer && (!reference(transfer.providerRef, "tr") || transfer.sourceChargeRef !== evidence.providerChargeRef || !reference(transfer.destinationAccountId, "acct")
    || !minor(transfer.amountMinor) || !minor(transfer.reversedMinor) || transfer.amountMinor !== transfer.reversedMinor
    || transfer.reversed !== true || !currency(transfer.currency))) debt.add("recipient");
  if (!evidence.disputesComplete) debt.add("dispute");
  const disputeIds = new Set<string>();
  for (const dispute of evidence.disputes) {
    if (!reference(dispute.providerRef, "du") || disputeIds.has(dispute.providerRef) || dispute.chargeRef !== evidence.providerChargeRef
      || !["won", "warning_closed"].includes(dispute.status)) debt.add("dispute");
    disputeIds.add(dispute.providerRef);
  }
  return { settled: debt.size === 0, debt: [...debt] };
}
