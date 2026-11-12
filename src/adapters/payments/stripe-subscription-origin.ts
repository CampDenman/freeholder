// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: scheduled money belongs to its actual original invoice, not invented attempt metadata.
import { AdapterError } from "../types";
import { object, text } from "./http";
import { validateMerchantChargeScope } from "./stripe-merchant-scope";
import type { MerchantChargeScope, PaymentAccountScope } from "./types";

export interface StripeSubscriptionPaymentOrigin {
  providerSubscriptionRef: string;
  providerInvoiceRef: string;
  providerPaymentIntentRef: string;
}
export type StripeSubscriptionRead = (path: string, init: RequestInit, scope: PaymentAccountScope) => Promise<Record<string, unknown>>;
const ref = (value: unknown) => text(value) ?? text(object(value)?.id);
function unproven(): never {
  throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not prove this original subscription invoice and payment link.", true);
}

/** The supplied API must verify the frozen platform before each original-account read. */
export async function proveStripeSubscriptionPayment(api: StripeSubscriptionRead, scope: MerchantChargeScope, origin: StripeSubscriptionPaymentOrigin): Promise<Record<string, unknown>> {
  validateMerchantChargeScope(scope);
  if (!scope.providerPlatformAccountId
    || !/^sub_[A-Za-z0-9]{1,195}$/.test(origin.providerSubscriptionRef)
    || !/^in_[A-Za-z0-9]{1,196}$/.test(origin.providerInvoiceRef)
    || !/^pi_[A-Za-z0-9]{1,196}$/.test(origin.providerPaymentIntentRef)) unproven();
  const invoice = await api(`/v1/invoices/${encodeURIComponent(origin.providerInvoiceRef)}`, { method: "GET" }, scope);
  const subscription = ref(invoice.subscription) ?? ref(object(object(invoice.parent)?.subscription_details)?.subscription);
  if (invoice.id !== origin.providerInvoiceRef || subscription !== origin.providerSubscriptionRef) unproven();
  // Older authenticated invoice objects carried the payment relation directly.
  // Newer API objects require the actual InvoicePayment relation instead.
  const direct = ref(invoice.payment_intent);
  if (direct) {
    if (direct !== origin.providerPaymentIntentRef) unproven();
  } else {
    const found = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | undefined, complete = false;
    for (let page = 0; page < 20; page++) {
      const query = new URLSearchParams({ invoice: origin.providerInvoiceRef, limit: "100" });
      if (cursor) query.set("starting_after", cursor);
      const result = await api(`/v1/invoice_payments?${query}`, { method: "GET" }, scope);
      if (!Array.isArray(result.data) || typeof result.has_more !== "boolean") unproven();
      for (const entry of result.data) {
        const payment = object(entry), relation = object(payment?.payment);
        if (!payment || !text(payment.id)) unproven();
        if (ref(payment.invoice) === origin.providerInvoiceRef && relation?.type === "payment_intent"
          && ref(relation.payment_intent) === origin.providerPaymentIntentRef) found.add(payment.id as string);
      }
      if (!result.has_more) { complete = true; break; }
      const next = ref(result.data.at(-1));
      if (!next || next.length > 200 || cursors.has(next)) unproven();
      cursors.add(next); cursor = next;
    }
    if (!complete || found.size !== 1) unproven();
  }
  const intent = await api(`/v1/payment_intents/${encodeURIComponent(origin.providerPaymentIntentRef)}`, { method: "GET" }, scope);
  if (intent.id !== origin.providerPaymentIntentRef) unproven();
  // A paid customer is still paid if later fee/recipient inspection disagrees.
  // Return the authenticated actual fact before any such auxiliary reads.
  return intent;
}
