// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.26/C12.38: exact original-resource recovery, never inferred absence.
import { AdapterError } from "../types";
import { number, object, text } from "./http";
import { assertMerchantAttempt, merchantAttemptMetadata, merchantChargeScope, validateMerchantChargeScope } from "./stripe-merchant-scope";
import { stripeCheckoutEvidence } from "./stripe-merchant-capture";
import type { MerchantChargeScope, MerchantPaymentRecovery, MerchantPaymentRecoveryRequest } from "./types";

type Api = (path: string, init: RequestInit, scope: MerchantChargeScope) => Promise<Record<string, unknown>>;
const unproven = () => new AdapterError("payments", "stripe", "provider_failure", "The original merchant payment still needs provider reconciliation.", true);
function checkoutReference(value: string): string {
  if (!/^cs_[A-Za-z0-9_]+$/.test(value) || value.length > 200) throw new AdapterError("payments", "stripe", "invalid_request", "Use the exact original provider Checkout reference.");
  return value;
}
function validateRequest(request: MerchantPaymentRecoveryRequest): void {
  validateMerchantChargeScope(request);
  merchantAttemptMetadata(request, request.paymentAttemptId);
  if (!request.providerPlatformAccountId || !request.invoiceId || !request.contactId || !Number.isSafeInteger(request.amountMinor) || request.amountMinor <= 0
    || !/^[A-Z]{3}$/.test(request.currency) || !Number.isFinite(Date.parse(request.createdAt)) || !request.idempotencyKey || request.idempotencyKey.length > 240) throw unproven();
  if (request.checkoutRef) checkoutReference(request.checkoutRef);
}
function boundSession(request: MerchantPaymentRecoveryRequest, session: Record<string, unknown>): string {
  const reference = text(session.id);
  if (!reference) throw unproven();
  checkoutReference(reference);
  assertMerchantAttempt(request, request.paymentAttemptId, session.metadata);
  if (session.mode !== "payment" || session.client_reference_id !== request.invoiceId
    || !text(object(session.metadata)?.freeholder_contact_id)
    || number(session.amount_total) === undefined || (number(session.amount_total) ?? -1) < 0 || !/^[A-Z]{3}$/.test(text(session.currency)?.toUpperCase() ?? "")
    || (number(session.created) ?? -1) * 1000 < Date.parse(request.createdAt) - 120_000) throw unproven();
  return reference;
}

export function stripeMerchantRecovery(api: Api) {
  async function notifyPositive(request: MerchantPaymentRecoveryRequest, session: Record<string, unknown>) {
    const reference = boundSession(request, session);
    if (session.payment_status === "paid" || object(session.payment_intent)?.status === "succeeded") {
      const evidence = stripeCheckoutEvidence({ ...request, checkoutRef: reference }, session);
      if (evidence.status === "succeeded") await request.onPaymentObserved?.(reference, evidence);
    }
  }

  async function lookup(request: MerchantPaymentRecoveryRequest): Promise<Record<string, unknown> | readonly string[] | null> {
    validateRequest(request);
    if (request.checkoutRef) {
      const reference = checkoutReference(request.checkoutRef);
      const session = await api(`/v1/checkout/sessions/${encodeURIComponent(reference)}?expand%5B%5D=payment_intent`, { method: "GET" }, request);
      if (boundSession(request, session) !== reference) throw unproven();
      await notifyPositive(request, session);
      return session;
    }
    let cursor: string | undefined;
    const found: Record<string, unknown>[] = [];
    for (let page = 0; page < 10; page++) {
      const query = new URLSearchParams({ limit: "100", "created[gte]": String(Math.max(0, Math.floor(Date.parse(request.createdAt) / 1000) - 120)), ...(cursor ? { starting_after: cursor } : {}) });
      const result = await api(`/v1/checkout/sessions?${query}`, { method: "GET" }, request);
      if (!Array.isArray(result.data) || typeof result.has_more !== "boolean") throw unproven();
      for (const raw of result.data) {
        const session = object(raw);
        if (!session || !text(session.id)) throw unproven();
        const metadata = object(session.metadata);
        if (metadata?.freeholder_payment_id !== request.paymentAttemptId || metadata.freeholder_platform_account_id !== request.providerPlatformAccountId) continue;
        boundSession(request, session);
        await notifyPositive(request, session);
        found.push(session);
      }
      if (!result.has_more) {
        if (found.length > 1) return found.map(session => text(session.id)!);
        if (!found.length) return null; // Unresolved, never proof of no effect.
        return lookup({ ...request, checkoutRef: text(found[0]!.id)! });
      }
      const next = text(object(result.data.at(-1))?.id);
      if (!next || next === cursor) throw unproven();
      cursor = next;
    }
    throw unproven();
  }

  function resultFor(request: MerchantPaymentRecoveryRequest, session: Record<string, unknown>): MerchantPaymentRecovery {
    const checkoutRef = boundSession(request, session);
    const evidence = stripeCheckoutEvidence({ ...request, checkoutRef }, session);
    if (evidence.status === "succeeded") return { state: "paid", checkoutRef, evidence };
    if (evidence.status === "failed") {
      const intent = object(session.payment_intent);
      return { state: "not_paid", checkoutRef, ...(text(intent?.id) ? { paymentRef: text(intent?.id) } : {}), sessionStatus: "expired", intentStatus: text(intent?.status) ?? null, amountReceivedMinor: 0 };
    }
    if (session.status === "open") {
      if (session.amount_total !== request.amountMinor || text(session.currency)?.toUpperCase() !== request.currency) return { state: "pending", checkoutRef, evidence };
      const url = text(session.url), expires = number(session.expires_at);
      if (!url || !expires) throw unproven();
      const safe = new URL(url);
      if (safe.protocol !== "https:" || safe.username || safe.password) throw unproven();
      return { state: "open", checkout: { ...merchantChargeScope(request), providerRef: checkoutRef, paymentRef: typeof session.payment_intent === "string" ? session.payment_intent : text(object(session.payment_intent)?.id), url: safe.href, expiresAt: new Date(expires * 1000).toISOString() } };
    }
    return { state: "pending", checkoutRef, evidence };
  }

  return {
    async recoverMerchantPayment(request: MerchantPaymentRecoveryRequest): Promise<MerchantPaymentRecovery> {
      const found = await lookup(request);
      if (!found) return { state: "unresolved" };
      if (Array.isArray(found)) return { state: "ambiguous", checkoutRefs: found as string[] };
      return resultFor(request, found as Record<string, unknown>);
    },
    async retireMerchantPayment(request: MerchantPaymentRecoveryRequest): Promise<MerchantPaymentRecovery> {
      let found = await lookup(request);
      if (!found) return { state: "unresolved" };
      if (Array.isArray(found)) return { state: "ambiguous", checkoutRefs: found as string[] };
      let session = found as Record<string, unknown>;
      const checkoutRef = boundSession(request, session);
      if (session.payment_status === "paid" || object(session.payment_intent)?.status === "succeeded") return resultFor(request, session);
      if (session.status === "open") {
        session = await api(`/v1/checkout/sessions/${encodeURIComponent(checkoutRef)}/expire`, { method: "POST", headers: { "idempotency-key": `${request.idempotencyKey}:expire` } }, request);
        if (boundSession(request, session) !== checkoutRef || session.status !== "expired") throw unproven();
        await request.onRetirementAcknowledged?.({ checkoutRef, kind: "session_expired", ...(typeof session.payment_intent === "string" ? { paymentRef: session.payment_intent } : {}) });
        // Expiration responses are not expanded. Read the exact resource,
        // retaining the acknowledgement above even if this read fails.
        found = await lookup({ ...request, checkoutRef });
        if (!found || Array.isArray(found)) throw unproven();
        session = found as Record<string, unknown>;
      }
      const intent = object(session.payment_intent), intentRef = text(intent?.id);
      if (intentRef && intent?.status === "requires_capture") {
        // Stripe forbids generic cancellation of Checkout-owned intents.
        // requires_capture is its one documented direct-cancel exception.
        const cancelled = await api(`/v1/payment_intents/${encodeURIComponent(intentRef)}/cancel`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "idempotency-key": `${request.idempotencyKey}:cancel` }, body: new URLSearchParams({ cancellation_reason: "requested_by_customer" }) }, request);
        assertMerchantAttempt(request, request.paymentAttemptId, cancelled.metadata);
        if (cancelled.id !== intentRef || cancelled.status !== "canceled" || cancelled.amount_received !== 0) throw unproven();
        await request.onRetirementAcknowledged?.({ checkoutRef, paymentRef: intentRef, kind: "intent_canceled" });
        // A complete manual-capture Session plus a cancelled zero-received
        // intent is provider-terminal too; no new charge is created here.
        if (session.status !== "complete" && session.status !== "expired") throw unproven();
        return { state: "not_paid", checkoutRef, paymentRef: intentRef, sessionStatus: session.status, intentStatus: "canceled", amountReceivedMinor: 0 };
      }
      return resultFor(request, session);
    },
  };
}
