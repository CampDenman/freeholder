// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: a complete empty lookup never proves an unknown refund did not occur.
import { AdapterError } from "../types";
import { number, object, text } from "./http";
import { stripeMerchantRefundBody } from "./stripe-merchant-refund-body";
import { STRIPE_REFUND_REFERENCE } from "./stripe-refund-reference";
import { validateMerchantChargeScope } from "./stripe-merchant-scope";
import type { MerchantChargeScope, MerchantRefundCreationRequest, MerchantRefundObservation, MerchantRefundRecovery, MerchantRefundRecoveryRequest } from "./types";

type Api = (path: string, init: RequestInit, scope: MerchantChargeScope) => Promise<Record<string, unknown>>;
const unresolved = () => new AdapterError("payments", "stripe", "provider_failure", "The original refund needs authenticated original-account reconciliation.", true);
const reference = (value: unknown, prefix: "re" | "pi" | "ch") => {
  const id = text(value) ?? text(object(value)?.id);
  if (!id || id.length > 200 || !(prefix === "re" ? STRIPE_REFUND_REFERENCE : new RegExp(`^${prefix}_[A-Za-z0-9_]+$`)).test(id)) throw unresolved();
  return id;
};
const auxiliaryReference = (value: unknown, prefix: "ch" | "trr" | "txn") => {
  const id = text(value) ?? text(object(value)?.id);
  return id && id.length <= 200 && new RegExp(`^${prefix}_[A-Za-z0-9_]+$`).test(id) ? id : undefined;
};
function originalMetadata(request: MerchantRefundRecoveryRequest, value: Record<string, unknown>): boolean {
  const metadata = object(value.metadata);
  return metadata?.freeholder_refund_id === request.refundAttemptId && metadata.freeholder_platform_account_id === request.providerPlatformAccountId;
}

export function stripeMerchantRefundRecovery(api: Api) {
  function evidence(request: MerchantRefundRecoveryRequest, value: Record<string, unknown>, originalAck: boolean): MerchantRefundObservation {
    const providerRef = reference(value.id, "re"), paymentProviderRef = value.payment_intent === null ? null : reference(value.payment_intent, "pi");
    const amountMinor = number(value.amount), currency = text(value.currency)?.toUpperCase(), metadata = object(value.metadata);
    if (amountMinor === undefined || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 || !currency || !/^[A-Z]{3}$/.test(currency)
      || value.status !== null && (typeof value.status !== "string" || !["pending", "requires_action", "succeeded", "failed", "canceled"].includes(value.status))) throw unresolved();
    return { providerRef, paymentProviderRef, amountMinor, currency,
      providerPlatformAccountId: request.providerPlatformAccountId,
      ...(request.providerAccountId ? { providerAccountId: request.providerAccountId } : {}),
      ...(request.providerApiVersion ? { providerApiVersion: request.providerApiVersion } : {}),
      ...(auxiliaryReference(value.charge, "ch") ? { providerChargeRef: auxiliaryReference(value.charge, "ch") } : {}),
      ...(auxiliaryReference(value.transfer_reversal, "trr") ? { transferReversalRef: auxiliaryReference(value.transfer_reversal, "trr") } : {}),
      ...(auxiliaryReference(value.source_transfer_reversal, "trr") ? { sourceTransferReversalRef: auxiliaryReference(value.source_transfer_reversal, "trr") } : {}),
      providerStatus: value.status as MerchantRefundObservation["providerStatus"],
      ...(typeof value.failure_reason === "string" && value.failure_reason.length <= 100 ? { failureReason: value.failure_reason } : {}),
      ...(auxiliaryReference(value.failure_balance_transaction, "txn") ? { failureBalanceTransactionRef: auxiliaryReference(value.failure_balance_transaction, "txn") } : {}),
      status: value.status === "succeeded" ? "succeeded" : value.status === "failed" || value.status === "canceled" ? "failed" : "pending",
      ...(value.status === "canceled" ? { failureCode: "provider_cancelled" as const } : {}),
      bindingVerified: paymentProviderRef === request.paymentProviderRef && amountMinor === request.amountMinor && currency === request.currency
        && (originalAck || originalMetadata(request, value) && (request.paymentId ? metadata?.freeholder_payment_id === request.paymentId
          : metadata?.freeholder_subscription_charge_receipt_id === request.subscriptionChargeReceiptId)) };
  }
  function validate(request: MerchantRefundRecoveryRequest): void {
    validateMerchantChargeScope(request);
    reference(request.paymentProviderRef, "pi");
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!request.providerPlatformAccountId || !uuid.test(request.refundAttemptId) || Boolean(request.paymentId) === Boolean(request.subscriptionChargeReceiptId)
      || (request.paymentId ? !uuid.test(request.paymentId) : !request.subscriptionChargeReceiptId || !uuid.test(request.subscriptionChargeReceiptId))
      || !Number.isSafeInteger(request.amountMinor) || request.amountMinor <= 0 || !/^[A-Z]{3}$/.test(request.currency)
      || typeof request.onRefundObserved !== "function") throw unresolved();
  }
  return {
    async createMerchantRefund(request: MerchantRefundCreationRequest): Promise<MerchantRefundObservation> {
      validate(request);
      if (!request.idempotencyKey || request.idempotencyKey.length > 240 || typeof request.onRefundResourceAcknowledged !== "function"
        || request.originalRefundRef || request.candidateRefundRef) throw unresolved();
      // Original cash is independently retained before this operation. Stripe
      // enforces the original PI's refundable captured balance. Recipient/fee
      // collection is separate and never blocks returning the customer's cash.
      const body = stripeMerchantRefundBody(request);
      if (body !== request.frozenBody) throw new AdapterError("payments", "stripe", "invalid_request", "The actual original refund body changed; restore its admitted transport before dispatch.");
      const value = await api("/v1/refunds", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "idempotency-key": request.idempotencyKey }, body }, request);
      const providerRef = reference(value.id, "re");
      await request.onRefundResourceAcknowledged(providerRef);
      const observed = evidence(request, value, true);
      await request.onRefundObserved(observed);
      return observed;
    },
    async recoverMerchantRefund(request: MerchantRefundRecoveryRequest): Promise<MerchantRefundRecovery> {
      validate(request);
      if (request.originalRefundRef && request.candidateRefundRef && request.originalRefundRef !== request.candidateRefundRef) throw unresolved();
      const exact = request.originalRefundRef ?? request.candidateRefundRef;
      if (exact) {
        const id = reference(exact, "re"), value = await api(`/v1/refunds/${encodeURIComponent(id)}`, { method: "GET" }, request);
        if (value.id !== id) throw unresolved();
        const observed = evidence(request, value, Boolean(request.originalRefundRef));
        await request.onRefundObserved(observed);
        if (!request.originalRefundRef && !originalMetadata(request, value)) throw unresolved();
        return { state: "observed", evidence: observed };
      }
      let cursor: string | undefined;
      const found: MerchantRefundObservation[] = [];
      for (let page = 0; page < 10; page++) {
        const query = new URLSearchParams({ payment_intent: request.paymentProviderRef, limit: "100", ...(cursor ? { starting_after: cursor } : {}) });
        const response = await api(`/v1/refunds?${query}`, { method: "GET" }, request);
        if (!Array.isArray(response.data) || typeof response.has_more !== "boolean") throw unresolved();
        for (const raw of response.data) {
          const value = object(raw);
          if (!value || !text(value.id)) throw unresolved();
          const observed = evidence(request, value, false);
          await request.onRefundObserved(observed); // Commit before any later page can fail.
          if (originalMetadata(request, value)) found.push(observed);
        }
        if (!response.has_more) {
          if (!found.length) return { state: "unresolved" };
          if (found.length > 1) return { state: "ambiguous", refundRefs: found.map(value => value.providerRef) };
          return { state: "observed", evidence: found[0]! };
        }
        const next = text(object(response.data.at(-1))?.id);
        if (!next || next === cursor) throw unresolved();
        cursor = next;
      }
      throw unresolved();
    },
  };
}
