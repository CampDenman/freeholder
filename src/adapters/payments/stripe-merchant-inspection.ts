// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Original customer collection is retained before auxiliary settlement reads.
import { AdapterError } from "../types";
import { proveStripeSubscriptionPayment } from "./stripe-subscription-origin";
import { number, object, text } from "./http";
import { assertMerchantAttempt, merchantAttemptMetadata, merchantIntentEvidence, validateMerchantChargeScope } from "./stripe-merchant-scope";
import type { CheckoutCaptureResult, MerchantPaymentInspectionRequest, PaymentAccountScope } from "./types";

type Read = (path: string, scope: PaymentAccountScope) => Promise<Record<string, unknown>>;
const ref = (value: unknown) => typeof value === "string" ? value : text(object(value)?.id);

export async function inspectStripeMerchantPayment(input: MerchantPaymentInspectionRequest, read: Read): Promise<CheckoutCaptureResult> {
  if (input.providerApiVersion && input.subscriptionOrigin?.providerApiVersion && input.providerApiVersion !== input.subscriptionOrigin.providerApiVersion) throw new AdapterError("payments", "stripe", "invalid_request", "The scheduled inspection protocol does not match its original scope.");
  const request = { ...input, ...(input.subscriptionOrigin?.providerApiVersion ? { providerApiVersion: input.subscriptionOrigin.providerApiVersion } : {}) };
  validateMerchantChargeScope(request);
  if (!/^pi_[A-Za-z0-9]+$/.test(request.providerRef)) throw new AdapterError("payments", "stripe", "invalid_request", "Inspect the original PaymentIntent reference.");
  if (request.subscriptionOrigin && (request.paymentAttemptId || request.subscriptionOrigin.providerPaymentIntentRef !== request.providerRef)) throw new AdapterError("payments", "stripe", "invalid_request", "Use one exact original charge origin for inspection.");
  if (!request.subscriptionOrigin) merchantAttemptMetadata(request, request.paymentAttemptId);
  const intent = request.subscriptionOrigin
    ? await proveStripeSubscriptionPayment((path, _init, scope) => read(path, scope), request, request.subscriptionOrigin)
    : await read(`/v1/payment_intents/${encodeURIComponent(request.providerRef)}`, request);
  let customerChargeVerified = intent.status === "succeeded";
  if (!request.subscriptionOrigin) { try { assertMerchantAttempt(request, request.paymentAttemptId, intent.metadata); } catch { customerChargeVerified = false; } }
  if (intent.id !== request.providerRef) throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not return the original PaymentIntent.", true);
  const amountMinor = number(intent.amount_received), currency = text(intent.currency)?.toUpperCase();
  if (amountMinor === undefined || amountMinor < 0 || !currency || !/^[A-Z]{3}$/.test(currency)) throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not return the original actual money amount.", true);
  const fee = intent.application_fee_amount === null ? 0 : number(intent.application_fee_amount);
  let evidence: CheckoutCaptureResult = {
    ...merchantIntentEvidence(request, intent), providerRef: request.providerRef,
    status: intent.status === "succeeded" ? "succeeded" : intent.status === "canceled" ? "failed" : "pending",
    amountMinor, currency, customerChargeVerified,
    merchantSettlementVerified: false,
    ...(fee !== undefined ? { applicationFeeMinor: fee } : {}),
    ...(ref(intent.latest_charge) ? { providerChargeRef: ref(intent.latest_charge) } : {}),
  };
  // This callback must commit before any later provider request can fail.
  if (evidence.status === "succeeded") await request.onPaymentObserved?.(evidence);
  if (evidence.status !== "succeeded" || !customerChargeVerified || !evidence.providerChargeRef) return evidence;
  const charge = await read(`/v1/charges/${encodeURIComponent(evidence.providerChargeRef)}`, request);
  if (charge.id !== evidence.providerChargeRef || ref(charge.payment_intent) !== request.providerRef || charge.paid !== true || charge.captured !== true
    || charge.status !== "succeeded" || charge.amount_captured !== amountMinor || text(charge.currency)?.toUpperCase() !== currency) return { ...evidence, merchantRouteVerified: false };
  const applicationFeeRef = ref(charge.application_fee), transferRef = ref(charge.transfer);
  evidence = { ...evidence, ...(applicationFeeRef ? { applicationFeeRef } : {}), ...(transferRef ? { transferRef } : {}) };
  await request.onPaymentObserved?.(evidence);
  let feeVerified = fee === 0 && charge.application_fee === null;
  if (applicationFeeRef) {
    // Application fees belong to the original platform even for direct charges.
    const actualFee = await read(`/v1/application_fees/${encodeURIComponent(applicationFeeRef)}`, { providerPlatformAccountId: request.providerPlatformAccountId, ...(request.providerApiVersion ? { providerApiVersion: request.providerApiVersion } : {}) });
    const originalCharge = request.destinationAccountId ? ref(actualFee.originating_transaction) : ref(actualFee.charge);
    const actualFeeAmount = number(actualFee.amount), actualFeeCurrency = text(actualFee.currency)?.toUpperCase();
    const recipient = request.destinationAccountId ?? request.providerAccountId;
    if (actualFee.id === applicationFeeRef && ref(actualFee.account) === recipient && originalCharge === evidence.providerChargeRef
      && actualFeeAmount !== undefined && actualFeeAmount >= 0 && actualFeeCurrency && /^[A-Z]{3}$/.test(actualFeeCurrency)) {
      evidence = { ...evidence, observedApplicationFeeMinor: actualFeeAmount, applicationFeeCurrency: actualFeeCurrency,
        ...(number(actualFee.amount_refunded) !== undefined ? { observedFeeRefundedMinor: number(actualFee.amount_refunded) } : {}) };
      // Currency disagreement remains visible; never refund using invented FX.
      feeVerified = actualFeeCurrency === currency && actualFeeAmount === fee;
      await request.onPaymentObserved?.(evidence);
    }
  }
  let transferVerified = !request.destinationAccountId;
  if (request.destinationAccountId && transferRef) {
    const transfer = await read(`/v1/transfers/${encodeURIComponent(transferRef)}`, { providerPlatformAccountId: request.providerPlatformAccountId, ...(request.providerApiVersion ? { providerApiVersion: request.providerApiVersion } : {}) });
    transferVerified = transfer.id === transferRef && ref(transfer.destination) === request.destinationAccountId
      && ref(transfer.source_transaction) === evidence.providerChargeRef && transfer.amount === amountMinor
      && text(transfer.currency)?.toUpperCase() === currency && transfer.amount_reversed === 0 && transfer.reversed === false;
  }
  evidence = { ...evidence, merchantSettlementVerified: evidence.merchantRouteVerified === true && feeVerified && transferVerified };
  await request.onPaymentObserved?.(evidence);
  return evidence;
}
