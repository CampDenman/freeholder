// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Stripe Checkout/refund edge with exact-byte HMAC webhook verification.

import { createHmac, timingSafeEqual } from "node:crypto";
import { AdapterError } from "../types";
import { env } from "@/core/env";
import { number, object, paymentFetch, providerJson, text } from "./http";
import type {
  CheckoutCaptureResult,
  OffSessionChargeResult,
  PaymentAdapter,
  PaymentAdapterCapabilities,
  PaymentMethodOffer,
  PaymentProviderEvent,
  RecurringScheduleResult,
  SavedPaymentMethodEvidence,
} from "./types";

const capabilities: PaymentAdapterCapabilities = {
  refunds: true,
  partialRefunds: true,
  savedMethods: true,
  subscriptions: true,
  offSessionCharges: true,
  disputes: true,
  payouts: false,
  inPerson: false,
  strongCustomerAuthentication: true,
  sellerMerchantCharges: true,
};

function accountHeaders(id?: string): Record<string, string> {
  if (!id) return {};
  if (id.length > 200 || !/^acct_[A-Za-z0-9]+$/.test(id)) throw new AdapterError("payments", "stripe", "invalid_request", "That seller payment account is invalid.");
  return { "stripe-account": id };
}

function applicationFee(form: URLSearchParams, key: string, value: number | undefined, accountId: string | undefined, amountMinor?: number): void {
  if (value === undefined || value === 0) return;
  if (!accountId || !Number.isFinite(value) || value < 0 || (amountMinor !== undefined ? !Number.isSafeInteger(value) || value >= amountMinor : !validFeePercent(value))) throw new AdapterError("payments", "stripe", "invalid_request", "That seller application fee is outside its valid range.");
  form.set(key, String(value));
}

function validFeePercent(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 && /^\d+(?:\.\d{1,2})?$/.test(String(value));
}

function feePercent(value: unknown): number | undefined {
  if (value === null) return 0;
  return validFeePercent(value) ? value : undefined;
}

export interface StripePaymentOptions {
  secretKey?: string;
  webhookSecrets?: readonly string[];
  apiBase?: string;
  fetch?: typeof fetch;
  toleranceSeconds?: number;
}

function stripeTime(value: unknown): string {
  const seconds = number(value);
  if (seconds === undefined) {
    throw new AdapterError("payments", "stripe", "invalid_request", "Stripe sent an invalid event time.");
  }
  return new Date(seconds * 1_000).toISOString();
}

function stripeOptionalTime(value: unknown): string | undefined {
  return number(value) === undefined ? undefined : stripeTime(value);
}

function stripeMethod(value: Record<string, unknown>): SavedPaymentMethodEvidence | undefined {
  const id = text(value.id);
  const type = text(value.type);
  if (!id || !type) return undefined;
  const card = object(value.card);
  const usBank = object(value.us_bank_account);
  if (card) {
    return {
      providerRef: id,
      providerCustomerRef: text(value.customer),
      kind: "card",
      label: `${text(card.brand) ?? "Card"} ending ${text(card.last4) ?? "••••"}`,
      brand: text(card.brand),
      last4: text(card.last4),
      expiryMonth: number(card.exp_month),
      expiryYear: number(card.exp_year),
    };
  }
  if (usBank) {
    return {
      providerRef: id,
      providerCustomerRef: text(value.customer),
      kind: "bank_debit",
      label: `${text(usBank.bank_name) ?? "Bank account"} ending ${text(usBank.last4) ?? "••••"}`,
      brand: text(usBank.bank_name),
      last4: text(usBank.last4),
    };
  }
  return {
    providerRef: id,
    providerCustomerRef: text(value.customer),
    kind: type.includes("bank") || type.includes("debit") ? "bank_debit" : "other",
    label: type.replaceAll("_", " "),
  };
}

function stripeEvents(payload: Record<string, unknown>): PaymentProviderEvent[] {
  const id = text(payload.id);
  const type = text(payload.type);
  const created = stripeTime(payload.created);
  const data = object(payload.data);
  const value = object(data?.object);
  if (!id || !type || !value) {
    throw new AdapterError("payments", "stripe", "invalid_request", "Stripe sent a malformed event.");
  }
  const metadata = object(value.metadata);
  const invoiceId = text(metadata?.freeholder_invoice_id);
  const contactId = text(metadata?.freeholder_contact_id);
  const customer = typeof value.customer === "string" ? value.customer : text(object(value.customer)?.id);
  const currency = text(value.currency)?.toUpperCase();
  const amount = number(value.amount_received) ?? number(value.amount) ?? number(value.amount_total);

  if (type.startsWith("payout.")) {
    const providerRef = text(value.id);
    const payoutAmount = number(value.amount);
    const status = text(value.status);
    if (!providerRef || payoutAmount === undefined || !currency || !status) return [];
    const common = {
      id,
      providerRef,
      amountMinor: payoutAmount,
      currency,
      occurredAt: created,
      expectedAt: stripeOptionalTime(value.arrival_date),
      statementRef: text(value.statement_descriptor),
      failureReason: text(value.failure_message) ?? text(value.failure_code),
    };
    if (status === "paid") return [{ ...common, kind: "payout_paid" }];
    if (status === "in_transit") return [{ ...common, kind: "payout_in_transit" }];
    if (status === "failed") return [{ ...common, kind: "payout_failed" }];
    if (status === "canceled") return [{ ...common, kind: "payout_cancelled" }];
    if (status === "pending") return [{ ...common, kind: "payout_pending" }];
    return [];
  }

  if (type.startsWith("payment_intent.")) {
    const providerRef = text(value.id);
    if (!providerRef) return [];
    if (type === "payment_intent.processing") return [{ id, kind: "payment_processing", providerRef, amountMinor: amount, currency, occurredAt: created, invoiceId, contactId, providerCustomerRef: customer }];
    if (type === "payment_intent.succeeded") return [{ id, kind: "payment_succeeded", providerRef, amountMinor: amount, currency, occurredAt: created, invoiceId, contactId, providerCustomerRef: customer }];
    // A failed attempt can return the same PaymentIntent to requires_payment_method
    // and later succeed inside Checkout. The terminal session events below own
    // failure so an ordinary card retry cannot poison the Freeholder payment.
    if (type === "payment_intent.payment_failed") return [];
    if (type === "payment_intent.canceled") return [{ id, kind: "payment_cancelled", providerRef, amountMinor: amount, currency, occurredAt: created }];
    return [];
  }

  if (type.startsWith("checkout.session.")) {
    const checkoutRef = text(value.id);
    if (!checkoutRef) return [];
    const providerRef = typeof value.payment_intent === "string" ? value.payment_intent : checkoutRef;
    const common = { id, providerRef, checkoutRef, amountMinor: number(value.amount_total), currency, occurredAt: created, invoiceId, contactId, providerCustomerRef: customer };
    // Setup mode never moves money. verifyWebhook resolves and validates the
    // SetupIntent before this normalizer extracts its saved method.
    if (value.mode === "setup") {
      if (type !== "checkout.session.completed" || value.payment_status !== "no_payment_required" || !contactId) return [];
      const setupIntent = object(value.setup_intent);
      const methodSource = object(setupIntent?.payment_method) ?? object(value.payment_method);
      const method = methodSource ? stripeMethod(methodSource) : undefined;
      if (!method) return [];
      return [{
        id,
        kind: "saved_method_added",
        contactId,
        providerCustomerRef: customer ?? method.providerCustomerRef,
        method: { ...method, providerCustomerRef: method.providerCustomerRef ?? customer },
        occurredAt: created,
      }];
    }
    if (type === "checkout.session.async_payment_succeeded" || (type === "checkout.session.completed" && value.payment_status === "paid")) {
      return [{ ...common, kind: "payment_succeeded" }];
    }
    if (type === "checkout.session.async_payment_failed") return [{ ...common, kind: "payment_failed" }];
    if (type === "checkout.session.expired") return [{ ...common, kind: "payment_cancelled" }];
    return [];
  }

  if (type.startsWith("refund.")) {
    const providerRef = text(value.id);
    const paymentProviderRef = text(value.payment_intent) ?? text(value.charge);
    if (!providerRef || !paymentProviderRef) return [];
    const common = { id, providerRef, paymentProviderRef, amountMinor: number(value.amount), currency, occurredAt: created };
    if (value.status === "succeeded") return [{ ...common, kind: "refund_succeeded" }];
    if (value.status === "failed" || type === "refund.failed") return [{ ...common, kind: "refund_failed" }];
    if (value.status === "pending" || value.status === "requires_action") return [{ ...common, kind: "refund_processing" }];
    return [];
  }

  if (type.startsWith("charge.dispute.")) {
    const providerRef = text(value.id);
    const paymentProviderRef = text(value.payment_intent) ?? text(value.charge);
    if (!providerRef || !paymentProviderRef) return [];
    const status = text(value.status);
    const common = {
      id,
      providerRef,
      paymentProviderRef,
      amountMinor: number(value.amount),
      currency,
      occurredAt: created,
      reason: text(value.reason),
      evidenceDueAt: stripeOptionalTime(object(value.evidence_details)?.due_by),
    };
    if (status === "won") return [{ ...common, kind: "dispute_won" }];
    if (status === "lost") return [{ ...common, kind: "dispute_lost" }];
    return [{ ...common, kind: "dispute_opened" }];
  }

  if (type === "payment_method.attached" || type === "payment_method.detached") {
    const method = stripeMethod(value);
    if (!method) return [];
    return [{
      id,
      kind: type === "payment_method.attached" ? "saved_method_added" : "saved_method_removed",
      providerCustomerRef: method.providerCustomerRef,
      contactId,
      method,
      occurredAt: created,
    }];
  }

  if (type === "invoice.paid" || type === "invoice.payment_failed") {
    const subscriptionSource = value.subscription ?? object(object(value.parent)?.subscription_details)?.subscription;
    const subscriptionRef =
      typeof subscriptionSource === "string"
        ? subscriptionSource
        : text(object(subscriptionSource)?.id);
    if (!subscriptionRef) return [];
    const lineData = object(value.lines)?.data;
    const firstLine = Array.isArray(lineData) ? object(lineData[0]) : undefined;
    const linePeriod = object(firstLine?.period);
    return [{
      id,
      kind: type === "invoice.paid" ? "subscription_period_paid" : "subscription_period_failed",
      providerRef: subscriptionRef,
      occurredAt: created,
      amountMinor: number(value.amount_paid) ?? amount,
      currency,
      periodStart: stripeOptionalTime(linePeriod?.start ?? value.period_start ?? object(value.period)?.start),
      periodEnd: stripeOptionalTime(linePeriod?.end ?? value.period_end ?? object(value.period)?.end),
      invoiceProviderRef: text(value.id),
    }];
  }
  if (type === "customer.subscription.deleted") {
    const providerRef = text(value.id);
    if (!providerRef) return [];
    return [{
      id,
      kind: "subscription_cancelled",
      providerRef,
      occurredAt: created,
    }];
  }
  return [];
}

/** Normalize only after the caller verifies Stripe's exact-byte signature. */
export function stripePaymentEvents(payload: Record<string, unknown>): PaymentProviderEvent[] {
  const account = payload.account;
  if (account !== undefined && (typeof account !== "string" || !/^acct_[A-Za-z0-9]+$/.test(account) || account.length > 200)) throw new AdapterError("payments", "stripe", "invalid_request", "Stripe sent an invalid account scope.");
  const value = object(object(payload.data)?.object);
  return stripeEvents(payload).map(event => {
    if (!account) return event;
    if (event.kind === "payment_succeeded" && String(payload.type).startsWith("checkout.session.")) {
      // A Checkout Session does not prove the application's collected fee.
      // The PaymentIntent event (or a scoped API read) completes settlement.
      return { ...event, providerAccountId: account, kind: "payment_processing" };
    }
    const fee = value?.application_fee_amount === null ? 0 : number(value?.application_fee_amount);
    return { ...event, providerAccountId: account, ...(event.kind.startsWith("payment_") && fee !== undefined ? { applicationFeeMinor: fee } : {}) };
  });
}

export function createStripePayments(options: StripePaymentOptions = {}): PaymentAdapter {
  const current = env();
  const secretKey = options.secretKey ?? current.STRIPE_SECRET_KEY;
  const webhookSecrets = options.webhookSecrets ?? [current.STRIPE_WEBHOOK_SECRET, current.STRIPE_WEBHOOK_SECRET_PREVIOUS].filter((value): value is string => Boolean(value));
  const apiBase = (options.apiBase ?? "https://api.stripe.com").replace(/\/+$/, "");
  const fetcher = options.fetch ?? fetch;
  const tolerance = options.toleranceSeconds ?? 300;
  const missing = [!secretKey ? "STRIPE_SECRET_KEY" : undefined, webhookSecrets.length === 0 ? "STRIPE_WEBHOOK_SECRET" : undefined].filter(Boolean);

  async function api(path: string, init: RequestInit, providerAccountId?: string): Promise<Record<string, unknown>> {
    if (!secretKey) throw new AdapterError("payments", "stripe", "unavailable", "Stripe is not configured.");
    const response = await paymentFetch(fetcher, `${apiBase}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${secretKey}`, "stripe-version": "2026-02-25.clover", ...init.headers, ...accountHeaders(providerAccountId) },
    });
    return providerJson("stripe", response);
  }

  return {
    id: "stripe",
    status: {
      family: "payments",
      id: "stripe",
      available: missing.length === 0,
      message: missing.length === 0 ? "Stripe checkout, refunds, saved methods, disputes, payout tracking, and authenticated feedback are configured." : `Stripe is missing ${missing.join(" and ")}.`,
    },
    capabilities: () => ({ ...capabilities }),
    async supportedCurrencies() { return []; },
    async supportedMethods(context) {
      const methods: PaymentMethodOffer[] = [{ id: "card", label: "Card or supported wallet", kind: "card", recurring: true }];
      if (context.country === "US" && context.currency === "USD") methods.push({ id: "us_bank_account", label: "US bank account", kind: "bank_debit", recurring: true });
      if (context.country === "CA" && context.currency === "CAD") methods.push({ id: "acss_debit", label: "Canadian bank debit", kind: "bank_debit", recurring: true });
      if (context.currency === "EUR") methods.push({ id: "sepa_debit", label: "SEPA debit", kind: "bank_debit", recurring: true });
      return methods;
    },
    async createCheckout(invoice) {
      const form = new URLSearchParams({
        mode: "payment",
        client_reference_id: invoice.invoiceId,
        success_url: invoice.successUrl,
        cancel_url: invoice.cancelUrl,
        "line_items[0][price_data][currency]": invoice.currency.toLowerCase(),
        "line_items[0][price_data][unit_amount]": String(invoice.amountMinor),
        "line_items[0][price_data][product_data][name]": invoice.description.slice(0, 250),
        "line_items[0][quantity]": "1",
        "metadata[freeholder_invoice_id]": invoice.invoiceId,
        "metadata[freeholder_contact_id]": invoice.contactId,
        "payment_intent_data[metadata][freeholder_invoice_id]": invoice.invoiceId,
        "payment_intent_data[metadata][freeholder_contact_id]": invoice.contactId,
      });
      if (invoice.providerCustomerRef) form.set("customer", invoice.providerCustomerRef);
      else form.set("customer_email", invoice.customer.email);
      if (invoice.saveMethod) {
        form.set("payment_intent_data[setup_future_usage]", "off_session");
        if (!invoice.providerCustomerRef) form.set("customer_creation", "always");
      }
      for (const method of invoice.methodIds ?? []) form.append("payment_method_types[]", method);
      applicationFee(form, "payment_intent_data[application_fee_amount]", invoice.applicationFeeMinor, invoice.providerAccountId, invoice.amountMinor);
      const value = await api("/v1/checkout/sessions", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "idempotency-key": invoice.idempotencyKey },
        body: form,
      }, invoice.providerAccountId);
      const providerRef = text(value.id);
      const url = text(value.url);
      if (!providerRef || !url) throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not return a checkout address.");
      return {
        providerRef,
        ...(invoice.providerAccountId ? { providerAccountId: invoice.providerAccountId } : {}),
        paymentRef: typeof value.payment_intent === "string" ? value.payment_intent : undefined,
        url,
        expiresAt: number(value.expires_at) === undefined ? undefined : stripeTime(value.expires_at),
      };
    },
    async createMethodSetup(request) {
      const form = new URLSearchParams({
        mode: "setup",
        client_reference_id: request.subscriptionId,
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
        "metadata[freeholder_contact_id]": request.contactId,
        "metadata[freeholder_subscription_id]": request.subscriptionId,
        "setup_intent_data[metadata][freeholder_contact_id]": request.contactId,
        "setup_intent_data[metadata][freeholder_subscription_id]": request.subscriptionId,
      });
      if (request.providerCustomerRef) form.set("customer", request.providerCustomerRef);
      else {
        form.set("customer_email", request.customer.email);
        form.set("customer_creation", "always");
      }
      if (request.customer.name) form.set("metadata[freeholder_customer_name]", request.customer.name.slice(0, 200));
      const value = await api("/v1/checkout/sessions", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "idempotency-key": request.idempotencyKey },
        body: form,
      }, request.providerAccountId);
      const providerRef = text(value.id);
      const url = text(value.url);
      const providerCustomerRef = typeof value.customer === "string" ? value.customer : text(object(value.customer)?.id);
      if (!providerRef || !url || !providerCustomerRef) {
        throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not return a card-setup address.");
      }
      return {
        providerRef,
        ...(request.providerAccountId ? { providerAccountId: request.providerAccountId } : {}),
        url,
        expiresAt: number(value.expires_at) === undefined ? undefined : stripeTime(value.expires_at),
        providerCustomerRef,
      };
    },
    async captureCheckout(request): Promise<CheckoutCaptureResult> {
      const expansion = request.providerAccountId ? "?expand%5B%5D=payment_intent" : "";
      const value = await api(`/v1/checkout/sessions/${encodeURIComponent(request.checkoutRef)}${expansion}`, { method: "GET" }, request.providerAccountId);
      const intent = object(value.payment_intent);
      const providerRef = typeof value.payment_intent === "string" ? value.payment_intent : text(intent?.id) ?? request.checkoutRef;
      const fee = intent?.application_fee_amount === null ? 0 : number(intent?.application_fee_amount);
      if (request.providerAccountId && value.payment_status === "paid" && fee === undefined) throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not confirm the seller charge's application fee.");
      return {
        providerRef,
        ...(request.providerAccountId ? { providerAccountId: request.providerAccountId } : {}),
        status: value.payment_status === "paid" ? "succeeded" : value.status === "expired" ? "failed" : "pending",
        amountMinor: number(value.amount_total),
        currency: text(value.currency)?.toUpperCase(),
        ...(request.providerAccountId && fee !== undefined ? { applicationFeeMinor: fee } : {}),
      };
    },
    async refund(request) {
      const form = new URLSearchParams({ payment_intent: request.providerRef, amount: String(request.amountMinor) });
      if (request.reason) form.set("metadata[freeholder_reason]", request.reason.slice(0, 500));
      if (request.refundApplicationFee) {
        if (!request.providerAccountId) throw new AdapterError("payments", "stripe", "invalid_request", "A platform-fee refund needs its original seller account.");
        form.set("refund_application_fee", "true");
      }
      const value = await api("/v1/refunds", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "idempotency-key": request.idempotencyKey }, body: form }, request.providerAccountId);
      const providerRef = text(value.id);
      if (!providerRef) throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not return a refund reference.");
      return { providerRef, ...(request.providerAccountId ? { providerAccountId: request.providerAccountId } : {}), status: value.status === "succeeded" ? "succeeded" : value.status === "failed" || value.status === "canceled" ? "failed" : "pending" };
    },
    async eraseCustomer(request) {
      const reference=request.providerCustomerRef;
      if(!/^cus_[A-Za-z0-9]+$/.test(reference) || reference.length>200)throw new AdapterError("payments","stripe","invalid_request","The original provider customer reference is invalid.");
      // Deleted Stripe customers remain retrievable. A retry confirms the
      // actual tombstone instead of treating arbitrary HTTP errors as erasure.
      const existing=await api(`/v1/customers/${encodeURIComponent(reference)}`,{method:"GET"},request.providerAccountId);
      if(existing.id!==reference)throw new AdapterError("payments","stripe","provider_failure","Stripe did not identify the original erasure customer.",true);
      if(existing.deleted===true)return;
      const deleted=await api(`/v1/customers/${encodeURIComponent(reference)}`,{method:"DELETE",headers:{"idempotency-key":request.idempotencyKey}},request.providerAccountId);
      if(deleted.id!==reference || deleted.deleted!==true)throw new AdapterError("payments","stripe","provider_failure","Stripe did not acknowledge customer erasure.",true);
    },
    async revokeSavedMethod(request) {
      await api(`/v1/payment_methods/${encodeURIComponent(request.providerRef)}/detach`, { method: "POST", headers: { "idempotency-key": request.idempotencyKey } }, request.providerAccountId);
    },
    async chargeSavedMethod(request): Promise<OffSessionChargeResult> {
      const form = new URLSearchParams({
        amount: String(request.amountMinor),
        currency: request.currency.toLowerCase(),
        payment_method: request.methodRef,
        confirm: "true",
        off_session: "true",
        "metadata[freeholder_invoice_id]": request.invoiceId,
        "metadata[freeholder_contact_id]": request.contactId,
        description: request.description.slice(0, 1000),
      });
      if (request.customerRef) form.set("customer", request.customerRef);
      applicationFee(form, "application_fee_amount", request.applicationFeeMinor, request.providerAccountId, request.amountMinor);
      const value = await api("/v1/payment_intents", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "idempotency-key": request.idempotencyKey,
        },
        body: form,
      }, request.providerAccountId);
      const providerRef = text(value.id);
      if (!providerRef) {
        throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not return a payment reference.");
      }
      const status =
        value.status === "succeeded"
          ? "succeeded"
          : value.status === "processing"
            ? "pending"
            : "failed";
      const fee = value.application_fee_amount === null ? 0 : number(value.application_fee_amount);
      if (request.providerAccountId && value.status === "succeeded" && fee === undefined) throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not confirm the seller charge application fee.");
      return {
        providerRef,
        ...(request.providerAccountId ? { providerAccountId: request.providerAccountId, applicationFeeMinor: fee } : {}),
        status,
        amountMinor: number(value.amount),
        currency: text(value.currency)?.toUpperCase(),
        occurredAt: stripeOptionalTime(value.created),
        failureMessage: text(object(value.last_payment_error)?.message),
      };
    },
    async createRecurringSchedule(request): Promise<RecurringScheduleResult> {
      const feeFields = new URLSearchParams();
      applicationFee(feeFields, "application_fee_percent", request.applicationFeePercent, request.providerAccountId);
      const product = await api("/v1/products", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "idempotency-key": `${request.idempotencyKey}:product` }, body: new URLSearchParams({ name: request.description.slice(0, 250) }) }, request.providerAccountId);
      const productId = text(product.id);
      if (!productId) throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not return a product reference.");
      const form = new URLSearchParams({
        customer: request.customerRef,
        default_payment_method: request.methodRef,
        collection_method: "charge_automatically",
        "items[0][price_data][currency]": request.currency.toLowerCase(),
        "items[0][price_data][unit_amount]": String(request.amountMinor),
        "items[0][price_data][recurring][interval]": request.interval,
        "items[0][price_data][recurring][interval_count]": String(request.intervalCount),
        "items[0][price_data][product]": productId,
        "metadata[freeholder_subscription_id]": request.metadata.subscriptionId,
        "metadata[freeholder_contact_id]": request.metadata.contactId,
        "metadata[freeholder_plan_id]": request.metadata.planId,
      });
      if (request.firstBillingAt) {
        form.set("billing_cycle_anchor", String(Math.floor(new Date(request.firstBillingAt).getTime() / 1000)));
        form.set("proration_behavior", "none");
      }
      for (const [key, value] of feeFields) form.set(key, value);
      const value = await api("/v1/subscriptions", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "idempotency-key": request.idempotencyKey,
        },
        body: form,
      }, request.providerAccountId);
      const providerRef = text(value.id);
      if (!providerRef) {
        throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not return a subscription reference.");
      }
      const actualFee = feePercent(value.application_fee_percent);
      if (request.providerAccountId && actualFee !== (request.applicationFeePercent ?? 0)) throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not confirm the seller subscription application fee.");
      return { providerRef, customerRef: request.customerRef, ...(request.providerAccountId ? { providerAccountId: request.providerAccountId, applicationFeePercent: actualFee } : {}) };
    },
    async updateRecurringSchedule(request): Promise<RecurringScheduleResult> {
      const feeFields = new URLSearchParams();
      applicationFee(feeFields, "application_fee_percent", request.applicationFeePercent, request.providerAccountId);
      const current = await api(`/v1/subscriptions/${encodeURIComponent(request.providerRef)}`, {
        method: "GET",
      }, request.providerAccountId);
      const items = object(current.items);
      const first = Array.isArray(items?.data) ? object(items.data[0]) : undefined;
      const itemId = text(first?.id);
      const price = object(first?.price);
      const productId = text(price?.product) ?? text(object(price?.product)?.id);
      if (!itemId || !productId) throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not return the current subscription item and product.");
      const form = new URLSearchParams({
        proration_behavior: request.proration === "create_prorations" ? "create_prorations" : "none",
        "items[0][price_data][currency]": request.currency.toLowerCase(),
        "items[0][price_data][unit_amount]": String(request.amountMinor),
        "items[0][price_data][recurring][interval]": request.interval,
        "items[0][price_data][recurring][interval_count]": String(request.intervalCount),
        "items[0][price_data][product]": productId,
      });
      if (itemId) form.set("items[0][id]", itemId);
      for (const [key, value] of feeFields) form.set(key, value);
      const value = await api(`/v1/subscriptions/${encodeURIComponent(request.providerRef)}`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "idempotency-key": request.idempotencyKey,
        },
        body: form,
      }, request.providerAccountId);
      const actualFee = feePercent(value.application_fee_percent);
      if (request.providerAccountId && actualFee !== (request.applicationFeePercent ?? 0)) throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not confirm the seller subscription application fee.");
      return { providerRef: text(value.id) ?? request.providerRef, ...(request.providerAccountId ? { providerAccountId: request.providerAccountId, applicationFeePercent: actualFee } : {}) };
    },
    async cancelRecurringSchedule(request) {
      await api(`/v1/subscriptions/${encodeURIComponent(request.providerRef)}`, {
        method: "DELETE",
        headers: { "idempotency-key": request.idempotencyKey },
      }, request.providerAccountId);
    },
    async verifyWebhook(request) {
      if (webhookSecrets.length === 0) throw new AdapterError("payments", "stripe", "unavailable", "Stripe webhook verification is not configured.");
      const header = request.headers["stripe-signature"];
      if (!header) throw new AdapterError("payments", "stripe", "authentication", "Stripe signature is missing.");
      const components = header.split(",").map((part) => part.trim().split("=", 2));
      const timestamp = Number(components.find(([key]) => key === "t")?.[1]);
      const signatures = components.filter(([key]) => key === "v1").map(([, value]) => value).filter((value): value is string => Boolean(value));
      const received = Date.parse(request.receivedAt);
      if (!Number.isSafeInteger(timestamp) || !Number.isFinite(received) || Math.abs(received / 1_000 - timestamp) > tolerance) {
        throw new AdapterError("payments", "stripe", "authentication", "Stripe signature timestamp is outside the accepted window.");
      }
      const raw = Buffer.from(request.body);
      const signed = Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), raw]);
      const valid = webhookSecrets.some((secret) => {
        const expected = createHmac("sha256", secret).update(signed).digest();
        return signatures.some((signature) => {
          if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
          const actual = Buffer.from(signature, "hex");
          return actual.length === expected.length && timingSafeEqual(actual, expected);
        });
      });
      if (!valid) throw new AdapterError("payments", "stripe", "authentication", "Stripe signature is invalid.");
      let payload: unknown;
      try { payload = JSON.parse(raw.toString("utf8")); } catch { throw new AdapterError("payments", "stripe", "invalid_request", "Stripe sent invalid JSON."); }
      const parsed = object(payload);
      if (!parsed) throw new AdapterError("payments", "stripe", "invalid_request", "Stripe sent an invalid event.");
      const events = stripePaymentEvents(parsed);
      const value = object(object(parsed.data)?.object);
      const metadata=object(value?.metadata);
      // A partially tagged setup cannot reach the expanded-method normalizer
      // without the complete binding used by our setup flow.
      if(value?.mode==="setup" && (!text(metadata?.freeholder_contact_id) || !text(metadata?.freeholder_subscription_id))) return [];
      if(parsed.type==="checkout.session.completed" && value?.mode==="setup" && value.payment_status==="no_payment_required"
        && text(metadata?.freeholder_contact_id) && text(metadata?.freeholder_subscription_id)){
        // Real Checkout events normally contain a SetupIntent ID, not its
        // expanded payment method. Retrieve only after exact-byte HMAC and
        // account validation, outside any business-service transaction.
        const unproven=()=>new AdapterError("payments","stripe","provider_failure","Stripe did not prove this saved payment method on its original account.",true);
        const setupRef=text(value.setup_intent) ?? text(object(value.setup_intent)?.id);
        const customer=text(value.customer) ?? text(object(value.customer)?.id);
        if(!setupRef || !/^seti_[A-Za-z0-9]+$/.test(setupRef) || setupRef.length>200 || !customer) throw unproven();
        const query=new URLSearchParams({"expand[]":"payment_method"});
        const intent=await api(`/v1/setup_intents/${encodeURIComponent(setupRef)}?${query}`,{method:"GET"},text(parsed.account));
        const actualCustomer=text(intent.customer) ?? text(object(intent.customer)?.id);
        const actualMetadata=object(intent.metadata);
        const method=object(intent.payment_method);
        const methodCustomer=text(method?.customer) ?? text(object(method?.customer)?.id);
        if(intent.id!==setupRef || intent.status!=="succeeded" || intent.usage!=="off_session" || actualCustomer!==customer || methodCustomer!==customer
          || text(actualMetadata?.freeholder_contact_id)!==text(metadata?.freeholder_contact_id)
          || text(actualMetadata?.freeholder_subscription_id)!==text(metadata?.freeholder_subscription_id)
          || !method || !stripeMethod(method)) throw unproven();
        return stripePaymentEvents({...parsed,data:{...object(parsed.data),object:{...value,setup_intent:{...intent,payment_method:{...method,customer}}}}});
      }
      // A signed invoice says that its balance is paid. It does not prove
      // which connected PaymentIntent paid it or the fee actually taken.
      // Read that evidence on the original account, outside every DB TX.
      const paid = events.find(event => event.kind === "subscription_period_paid" && event.providerAccountId);
      if (!paid || paid.kind !== "subscription_period_paid" || !paid.providerAccountId) return events;
      const invoiceRef = text(value?.id);
      const amount = number(value?.amount_paid);
      const currency = text(value?.currency)?.toUpperCase();
      // Stripe can emit a zero invoice while starting a trial. It does not
      // buy another paid period and must never advance subscription access.
      if (amount === 0 && number(value?.total) === 0) return events.filter(event => event !== paid);
      const unproven = () => new AdapterError("payments", "stripe", "provider_failure", "Stripe did not prove this recurring seller payment and its application fee.");
      if (!invoiceRef || amount === undefined || amount <= 0 || !currency || value?.paid_out_of_band === true) throw unproven();
      const query = new URLSearchParams({ invoice: invoiceRef, status: "paid", limit: "2" });
      const list = await api(`/v1/invoice_payments?${query}`, { method: "GET" }, paid.providerAccountId);
      const records = list.data;
      if (list.has_more !== false || !Array.isArray(records) || records.length !== 1) throw unproven();
      const record = object(records[0]);
      const invoicePayment = object(record?.payment);
      const intentRef = text(invoicePayment?.payment_intent) ?? text(object(invoicePayment?.payment_intent)?.id);
      const linkedInvoice = text(record?.invoice) ?? text(object(record?.invoice)?.id);
      if (!record || record.status !== "paid" || linkedInvoice !== invoiceRef || record.amount_paid !== amount || record.amount_requested !== amount || text(record.currency)?.toUpperCase() !== currency || invoicePayment?.type !== "payment_intent" || !intentRef) throw unproven();
      const intent = await api(`/v1/payment_intents/${encodeURIComponent(intentRef)}`, { method: "GET" }, paid.providerAccountId);
      const fee = intent.application_fee_amount === null ? 0 : number(intent.application_fee_amount);
      if (intent.id !== intentRef || intent.status !== "succeeded" || number(intent.amount_received) !== amount || text(intent.currency)?.toUpperCase() !== currency || fee === undefined || fee < 0 || fee >= amount) throw unproven();
      const invoiceCustomer = text(value?.customer) ?? text(object(value?.customer)?.id);
      const intentCustomer = text(intent.customer) ?? text(object(intent.customer)?.id);
      if (!invoiceCustomer || intentCustomer !== invoiceCustomer) throw unproven();
      return events.map(event => event === paid ? { ...paid, paymentProviderRef: intentRef, applicationFeeMinor: fee, amountMinor: amount, currency } : event);
    },
  };
}
