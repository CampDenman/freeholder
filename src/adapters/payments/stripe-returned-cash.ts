// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: read-only original cash return proof; provider absence is never guessed.
import { AdapterError } from "../types";
import { number, object, text } from "./http";
import { validateMerchantChargeScope } from "./stripe-merchant-scope";
import { STRIPE_REFUND_REFERENCE } from "./stripe-refund-reference";
import type { MerchantReturnedCashEvidence } from "./merchant-returned-cash-types";
import type { MerchantReturnedCashInspectionRequest, PaymentAccountScope } from "./types";
type Api = (path: string, init: RequestInit, scope: PaymentAccountScope) => Promise<Record<string, unknown>>;
const unresolved = () => new AdapterError("payments", "stripe", "provider_failure", "The original cash return needs complete original-account evidence.", true);
const ref = (value: unknown, prefix: string): string | null => {
  const id = text(value) ?? text(object(value)?.id);
  return id && id.length <= 200 && (prefix === "re" ? STRIPE_REFUND_REFERENCE : new RegExp(`^${prefix}_[A-Za-z0-9_]+$`)).test(id) ? id : null;
};
const minor = (value: unknown): number | null => { const result = number(value); return result !== undefined && Number.isSafeInteger(result) && result >= 0 ? result : null; };
const currency = (value: unknown): string | null => { const result = text(value)?.toUpperCase(); return result && /^[A-Z]{3}$/.test(result) ? result : null; };
const bool = (value: unknown): boolean | null => typeof value === "boolean" ? value : null;
const status = (value: unknown): "pending" | "requires_action" | "succeeded" | "failed" | "canceled" | null => value === "pending" || value === "requires_action" || value === "succeeded" || value === "failed" || value === "canceled" ? value : null;

/** Original request admission and caller quiescence are separate shared-service
 * phases. This helper performs only authenticated original-scope GETs and never
 * dispatches a fee refund, transfer reversal, customer refund or new charge.
 */
export function stripeReturnedCash(api: Api) {
  return {
    async inspectMerchantReturnedCash(request: MerchantReturnedCashInspectionRequest): Promise<MerchantReturnedCashEvidence> {
      validateMerchantChargeScope(request);
      if (!ref(request.paymentProviderRef, "pi") || !request.providerPlatformAccountId || typeof request.onOriginalCashObserved !== "function"
        || typeof request.onRefundObserved !== "function" || typeof request.onReturnStateObserved !== "function") throw unresolved();
      const intent = await api(`/v1/payment_intents/${encodeURIComponent(request.paymentProviderRef)}`, { method: "GET" }, request);
      const actualIntent = ref(intent.id, "pi"), actualAmount = minor(intent.amount_received), actualCurrency = currency(intent.currency), chargeRef = ref(intent.latest_charge, "ch");
      if (!actualIntent || actualAmount === null || !actualCurrency) throw unresolved();
      // Primary positive money survives every later auxiliary read failure.
      await request.onOriginalCashObserved({ providerRef: actualIntent, status: intent.status === "succeeded" ? "succeeded" : intent.status === "canceled" ? "failed" : "pending",
        amountMinor: actualAmount, currency: actualCurrency, providerPlatformAccountId: request.providerPlatformAccountId,
        ...(request.providerAccountId ? { providerAccountId: request.providerAccountId } : {}), ...(request.providerApiVersion ? { providerApiVersion: request.providerApiVersion } : {}),
        ...(chargeRef ? { providerChargeRef: chargeRef } : {}), customerChargeVerified: false, merchantRouteVerified: false, merchantSettlementVerified: false });
      if (actualIntent !== request.paymentProviderRef || !chargeRef) throw unresolved();
      const charge = await api(`/v1/charges/${encodeURIComponent(chargeRef)}`, { method: "GET" }, request);
      const actualCharge = ref(charge.id, "ch");
      if (!actualCharge) throw unresolved();
      let evidence: MerchantReturnedCashEvidence = { providerPlatformAccountId: request.providerPlatformAccountId, chargeAccountId: request.providerAccountId ?? null,
        providerApiVersion: request.providerApiVersion ?? "2026-02-25.clover", paymentProviderRef: actualIntent, providerChargeRef: actualCharge,
        amountMinor: actualAmount, currency: actualCurrency, paymentIntentStatus: text(intent.status) ?? "unknown", amountCapturableMinor: minor(intent.amount_capturable), chargePaymentProviderRef: ref(charge.payment_intent, "pi"), chargeAmountMinor: minor(charge.amount_captured), chargeCurrency: currency(charge.currency),
        paid: bool(charge.paid), captured: bool(charge.captured), refunded: bool(charge.refunded), amountRefundedMinor: minor(charge.amount_refunded),
        feeFieldObserved: charge.application_fee === null, fee: null, transferFieldObserved: charge.transfer === null, transfer: null,
        refundsComplete: false, refunds: [], disputesComplete: false, disputes: [] };
      await request.onReturnStateObserved(evidence);
      if (actualCharge !== chargeRef || evidence.chargePaymentProviderRef !== actualIntent) throw unresolved();
      const seenRefunds = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const query = new URLSearchParams({ payment_intent: actualIntent, limit: "100", ...(cursor ? { starting_after: cursor } : {}) });
        const list = await api(`/v1/refunds?${query}`, { method: "GET" }, request);
        if (!Array.isArray(list.data) || typeof list.has_more !== "boolean") throw unresolved();
        for (const raw of list.data) {
          const value = object(raw), id = ref(value?.id, "re");
          if (!value || !id || seenRefunds.has(id)) throw unresolved();
          seenRefunds.add(id);
          const amountMinor = minor(value.amount), actualCurrency = currency(value.currency), providerStatus = status(value.status), paymentProviderRef = ref(value.payment_intent, "pi");
          // The complete raw proof retains missing linkage/amount/status; the
          // money callback is invoked only when actual money can be stated.
          evidence = { ...evidence, refunds: [...evidence.refunds, { providerRef: id, paymentProviderRef, chargeRef: ref(value.charge, "ch"), amountMinor, currency: actualCurrency, status: providerStatus }] };
          if (amountMinor !== null && amountMinor > 0 && actualCurrency) await request.onRefundObserved({ providerRef: id, paymentProviderRef,
            amountMinor, currency: actualCurrency, status: providerStatus === "succeeded" ? "succeeded" : providerStatus === "failed" || providerStatus === "canceled" ? "failed" : "pending",
            providerStatus, providerPlatformAccountId: request.providerPlatformAccountId, ...(request.providerAccountId ? { providerAccountId: request.providerAccountId } : {}),
            ...(request.providerApiVersion ? { providerApiVersion: request.providerApiVersion } : {}), ...(ref(value.charge, "ch") ? { providerChargeRef: ref(value.charge, "ch")! } : {}), bindingVerified: false });
          await request.onReturnStateObserved(evidence);
        }
        if (!list.has_more) { evidence = { ...evidence, refundsComplete: true }; await request.onReturnStateObserved(evidence); break; }
        const next = ref(object(list.data.at(-1))?.id, "re");
        if (!next || next === cursor || page === 9) throw unresolved();
        cursor = next;
      }
      const platformScope = { providerPlatformAccountId: request.providerPlatformAccountId, ...(request.providerApiVersion ? { providerApiVersion: request.providerApiVersion } : {}) };
      const feeRef = ref(charge.application_fee, "fee");
      if (feeRef) {
        const fee = await api(`/v1/application_fees/${encodeURIComponent(feeRef)}`, { method: "GET" }, platformScope);
        const actualRef = ref(fee.id, "fee");
        if (!actualRef) throw unresolved();
        evidence = { ...evidence, feeFieldObserved: true, fee: { providerRef: actualRef,
          originatingChargeRef: request.providerAccountId ? ref(fee.charge, "ch") : ref(fee.originating_transaction, "ch"), accountId: ref(fee.account, "acct"),
          amountMinor: minor(fee.amount), refundedMinor: minor(fee.amount_refunded), currency: currency(fee.currency) } };
        await request.onReturnStateObserved(evidence);
        if (actualRef !== feeRef) throw unresolved();
      }
      const transferRef = ref(charge.transfer, "tr");
      if (transferRef) {
        const transfer = await api(`/v1/transfers/${encodeURIComponent(transferRef)}`, { method: "GET" }, platformScope);
        const actualRef = ref(transfer.id, "tr");
        if (!actualRef) throw unresolved();
        evidence = { ...evidence, transferFieldObserved: true, transfer: { providerRef: actualRef, sourceChargeRef: ref(transfer.source_transaction, "ch"),
          destinationAccountId: ref(transfer.destination, "acct"), amountMinor: minor(transfer.amount), reversedMinor: minor(transfer.amount_reversed), currency: currency(transfer.currency), reversed: bool(transfer.reversed) } };
        await request.onReturnStateObserved(evidence);
        if (actualRef !== transferRef) throw unresolved();
      }
      const seenDisputes = new Set<string>();
      cursor = undefined;
      for (let page = 0; page < 10; page++) {
        const query = new URLSearchParams({ charge: actualCharge, limit: "100", ...(cursor ? { starting_after: cursor } : {}) });
        const list = await api(`/v1/disputes?${query}`, { method: "GET" }, request);
        if (!Array.isArray(list.data) || typeof list.has_more !== "boolean") throw unresolved();
        for (const raw of list.data) {
          const value = object(raw), id = ref(value?.id, "du");
          if (!value || !id || seenDisputes.has(id)) throw unresolved();
          seenDisputes.add(id);
          evidence = { ...evidence, disputes: [...evidence.disputes, { providerRef: id, chargeRef: ref(value.charge, "ch"), status: text(value.status) ?? "unknown" }] };
          await request.onReturnStateObserved(evidence);
        }
        if (!list.has_more) { evidence = { ...evidence, disputesComplete: true }; await request.onReturnStateObserved(evidence); break; }
        const next = ref(object(list.data.at(-1))?.id, "du");
        if (!next || next === cursor || page === 9) throw unresolved();
        cursor = next;
      }
      return evidence;
    },
  };
}
