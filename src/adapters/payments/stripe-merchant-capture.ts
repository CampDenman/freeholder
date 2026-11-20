// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.26/C12.38: retain positive provider money independently of route proof.
import { AdapterError } from "../types";
import { number, object, text } from "./http";
import { assertMerchantAttempt, merchantChargeScope, merchantIntentEvidence } from "./stripe-merchant-scope";
import type { CheckoutCaptureRequest, CheckoutCaptureResult } from "./types";

export function stripeCheckoutEvidence(request: CheckoutCaptureRequest, value: Record<string, unknown>): CheckoutCaptureResult {
  const intent = object(value.payment_intent);
  const providerRef = typeof value.payment_intent === "string" ? value.payment_intent : text(intent?.id) ?? request.checkoutRef;
  const fee = intent?.application_fee_amount === null ? 0 : number(intent?.application_fee_amount);
  if (!request.providerPlatformAccountId) {
    if (request.providerAccountId && value.payment_status === "paid" && fee === undefined) throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not confirm the seller charge's application fee.");
    return { providerRef, ...merchantChargeScope(request), status: value.payment_status === "paid" ? "succeeded" : value.status === "expired" ? "failed" : "pending",
      amountMinor: number(value.amount_total), currency: text(value.currency)?.toUpperCase(),
      ...(request.providerAccountId && fee !== undefined ? { applicationFeeMinor: fee } : {}) };
  }
  assertMerchantAttempt(request, request.paymentAttemptId, value.metadata);
  if (value.id !== request.checkoutRef) throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not identify the original checkout.", true);
  const chargeOrigin = { ...(request.providerApiVersion ? { providerApiVersion: request.providerApiVersion } : {}), providerPlatformAccountId: request.providerPlatformAccountId, ...(request.providerAccountId ? { providerAccountId: request.providerAccountId } : {}) };
  if (intent?.status === "succeeded") {
    let customerChargeVerified = /^pi_[A-Za-z0-9]+$/.test(providerRef) && intent.id === providerRef;
    try { assertMerchantAttempt(request, request.paymentAttemptId, intent.metadata); } catch { customerChargeVerified = false; }
    const amountMinor = number(intent.amount_received), currency = text(intent.currency)?.toUpperCase();
    if (amountMinor === undefined || amountMinor < 0 || !currency || !/^[A-Z]{3}$/.test(currency)) throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not return the original paid amount and currency.", true);
    return { providerRef, ...merchantIntentEvidence(request, intent), status: "succeeded", amountMinor, currency, customerChargeVerified,
      ...(typeof intent.latest_charge === "string" ? { providerChargeRef: intent.latest_charge } : text(object(intent.latest_charge)?.id) ? { providerChargeRef: text(object(intent.latest_charge)?.id) } : {}),
      ...(!customerChargeVerified || fee === undefined || fee < 0 || intent.amount_received !== value.amount_total || intent.currency !== value.currency ? { merchantRouteVerified: false } : {}),
      ...(fee !== undefined && fee >= 0 ? { applicationFeeMinor: fee } : {}) };
  }
  if (value.payment_status === "paid" && /^pi_[A-Za-z0-9]+$/.test(providerRef)) {
    // The authenticated original Session reported positive payment even if
    // its intent is incomplete or contradictory. Keep that fact, block new
    // collection, and require a proven charge before applying the balance.
    return { providerRef, ...chargeOrigin, status: "succeeded", amountMinor: number(value.amount_total), currency: text(value.currency)?.toUpperCase(), customerChargeVerified: false, merchantRouteVerified: false };
  }
  const zeroIntent = value.payment_intent === null || (intent && intent.amount_received === 0 && ["canceled", "requires_payment_method", "requires_confirmation", "requires_action"].includes(String(intent.status)));
  const terminal = value.status === "expired" && value.payment_status === "unpaid" && Boolean(zeroIntent);
  return { providerRef, ...chargeOrigin, status: terminal ? "failed" : "pending", amountMinor: number(value.amount_total), currency: text(value.currency)?.toUpperCase(), customerChargeVerified: false, merchantRouteVerified: false };
}
