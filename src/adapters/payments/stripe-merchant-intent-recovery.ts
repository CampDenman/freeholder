// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: original saved-card recovery has no fictitious Checkout Session.
import { AdapterError } from "../types";
import { number, object, text } from "./http";
import { assertMerchantAttempt, merchantAttemptMetadata, merchantIntentEvidence, validateMerchantChargeScope } from "./stripe-merchant-scope";
import type { CheckoutCaptureResult, MerchantChargeScope, MerchantIntentRecovery, MerchantIntentRecoveryRequest } from "./types";

type Api = (path: string, init: RequestInit, scope: MerchantChargeScope) => Promise<Record<string, unknown>>;
const unresolved = () => new AdapterError("payments", "stripe", "provider_failure", "The original saved-card payment needs exact provider reconciliation.", true);
function reference(value: unknown): string {
  const id = text(value);
  if (!id || !/^pi_[A-Za-z0-9_]+$/.test(id) || id.length > 200) throw unresolved();
  return id;
}
function validate(request: MerchantIntentRecoveryRequest): void {
  validateMerchantChargeScope(request);
  merchantAttemptMetadata(request, request.paymentAttemptId);
  if (!request.invoiceId || !request.contactId || !Number.isSafeInteger(request.amountMinor) || request.amountMinor <= 0 || !/^[A-Z]{3}$/.test(request.currency)
    || !Number.isFinite(Date.parse(request.createdAt)) || !request.idempotencyKey || request.idempotencyKey.length > 240) throw unresolved();
  if (request.paymentRef) reference(request.paymentRef);
}
function originalOwner(request: MerchantIntentRecoveryRequest, intent: Record<string, unknown>): boolean {
  const metadata = object(intent.metadata);
  return metadata?.freeholder_invoice_id === request.invoiceId && metadata.freeholder_contact_id === request.contactId;
}
function bind(request: MerchantIntentRecoveryRequest, intent: Record<string, unknown>, exact = false): string {
  const id = reference(intent.id);
  assertMerchantAttempt(request, request.paymentAttemptId, intent.metadata);
  if (request.paymentRef && request.paymentRef !== id) throw unresolved();
  if (exact && (!originalOwner(request, intent) || intent.amount !== request.amountMinor || text(intent.currency)?.toUpperCase() !== request.currency
    || (number(intent.created) ?? -1) * 1000 < Date.parse(request.createdAt) - 120000)) throw unresolved();
  return id;
}
function evidence(request: MerchantIntentRecoveryRequest, intent: Record<string, unknown>): CheckoutCaptureResult {
  const providerRef = bind(request, intent), amountMinor = number(intent.amount_received), currency = text(intent.currency)?.toUpperCase();
  if (typeof amountMinor !== "number" || !Number.isSafeInteger(amountMinor) || amountMinor < 0 || !currency || !/^[A-Z]{3}$/.test(currency)) throw unresolved();
  const positive = intent.status === "succeeded" || amountMinor > 0;
  return { providerRef, ...merchantIntentEvidence(request, intent), amountMinor, currency,
    status: positive ? "succeeded" : intent.status === "canceled" ? "failed" : "pending",
    // Captured money is retained above even while this original intent can
    // still collect more. Only its succeeded protocol state may release the
    // ordinary paid projection and the next merchant portion.
    customerChargeVerified: intent.status === "succeeded" && originalOwner(request, intent),
    ...(!originalOwner(request, intent) || intent.status !== "succeeded" ? { merchantRouteVerified: false, merchantSettlementVerified: false } : {}),
    ...(typeof intent.latest_charge === "string" ? { providerChargeRef: intent.latest_charge } : {}) };
}

export function stripeMerchantIntentRecovery(api: Api) {
  async function observe(request: MerchantIntentRecoveryRequest, intent: Record<string, unknown>) {
    const actual = evidence(request, intent);
    if (actual.status === "succeeded") await request.onPaymentObserved?.(actual);
  }
  async function lookup(request: MerchantIntentRecoveryRequest): Promise<Record<string, unknown> | readonly string[] | null> {
    validate(request);
    if (request.paymentRef) {
      const intent = await api(`/v1/payment_intents/${encodeURIComponent(reference(request.paymentRef))}`, { method: "GET" }, request);
      bind(request, intent); await observe(request, intent); return intent;
    }
    let cursor: string | undefined;
    const found: Record<string, unknown>[] = [];
    for (let page = 0; page < 10; page++) {
      const query = new URLSearchParams({ limit: "100", "created[gte]": String(Math.max(0, Math.floor(Date.parse(request.createdAt) / 1000) - 120)), ...(cursor ? { starting_after: cursor } : {}) });
      const result = await api(`/v1/payment_intents?${query}`, { method: "GET" }, request);
      if (!Array.isArray(result.data) || typeof result.has_more !== "boolean") throw unresolved();
      for (const raw of result.data) {
        const intent = object(raw), metadata = object(intent?.metadata);
        if (!intent || !text(intent.id)) throw unresolved();
        if (metadata?.freeholder_payment_id !== request.paymentAttemptId || metadata.freeholder_platform_account_id !== request.providerPlatformAccountId) continue;
        bind(request, intent); await observe(request, intent); found.push(intent);
      }
      if (!result.has_more) {
        if (!found.length) return null;
        if (found.length > 1) return found.map(intent => reference(intent.id));
        return lookup({ ...request, paymentRef: reference(found[0]!.id) });
      }
      const next = text(object(result.data.at(-1))?.id);
      if (!next || next === cursor) throw unresolved();
      cursor = next;
    }
    throw unresolved();
  }
  function resultFor(request: MerchantIntentRecoveryRequest, intent: Record<string, unknown>): MerchantIntentRecovery {
    const paymentRef = bind(request, intent), actual = evidence(request, intent);
    if (actual.status === "succeeded") return { state: "paid", paymentRef, evidence: actual };
    bind(request, intent, true);
    if (intent.status === "canceled" && intent.amount_received === 0) return { state: "not_paid", paymentRef, intentStatus: "canceled", amountReceivedMinor: 0 };
    return { state: "pending", paymentRef, evidence: actual };
  }
  return {
    async recoverMerchantIntent(request: MerchantIntentRecoveryRequest): Promise<MerchantIntentRecovery> {
      const found = await lookup(request);
      if (!found) return { state: "unresolved" };
      if (Array.isArray(found)) return { state: "ambiguous", paymentRefs: found as string[] };
      return resultFor(request, found as Record<string, unknown>);
    },
    async retireMerchantIntent(request: MerchantIntentRecoveryRequest): Promise<MerchantIntentRecovery> {
      const found = await lookup(request);
      if (!found) return { state: "unresolved" };
      if (Array.isArray(found)) return { state: "ambiguous", paymentRefs: found as string[] };
      const intent = found as Record<string, unknown>, actual = resultFor(request, intent);
      if (actual.state === "paid" || actual.state === "not_paid") return actual;
      const paymentRef = bind(request, intent, true);
      if (!["requires_payment_method", "requires_capture", "requires_confirmation", "requires_action", "processing"].includes(String(intent.status))) return actual;
      const canceled = await api(`/v1/payment_intents/${encodeURIComponent(paymentRef)}/cancel`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "idempotency-key": `${request.idempotencyKey}:cancel` }, body: new URLSearchParams({ cancellation_reason: "requested_by_customer" }) }, request);
      bind({ ...request, paymentRef }, canceled);
      await observe(request, canceled);
      if (canceled.status !== "canceled" || canceled.amount_received !== 0) return resultFor(request, canceled);
      await request.onRetirementAcknowledged?.({ paymentRef, kind: "intent_canceled" });
      // The physical ACK remains durable even if the final original read fails.
      const confirmed = await lookup({ ...request, paymentRef });
      if (!confirmed || Array.isArray(confirmed)) throw unresolved();
      return resultFor(request, confirmed as Record<string, unknown>);
    },
  };
}
