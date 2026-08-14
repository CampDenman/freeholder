// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Stripe Checkout/refund edge with exact-byte HMAC webhook verification.

import { createHmac, timingSafeEqual } from "node:crypto";
import { AdapterError } from "../types";
import { env } from "@/core/env";
import { number, object, paymentFetch, providerJson, text } from "./http";
import type {
  CheckoutCaptureResult,
  PaymentAdapter,
  PaymentAdapterCapabilities,
  PaymentMethodOffer,
  PaymentProviderEvent,
  SavedPaymentMethodEvidence,
} from "./types";

const capabilities: PaymentAdapterCapabilities = {
  refunds: true,
  partialRefunds: true,
  savedMethods: true,
  subscriptions: false,
  disputes: true,
  payouts: false,
  inPerson: false,
  strongCustomerAuthentication: true,
};

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
  return [];
}

export function createStripePayments(options: StripePaymentOptions = {}): PaymentAdapter {
  const current = env();
  const secretKey = options.secretKey ?? current.STRIPE_SECRET_KEY;
  const webhookSecrets = options.webhookSecrets ?? [current.STRIPE_WEBHOOK_SECRET, current.STRIPE_WEBHOOK_SECRET_PREVIOUS].filter((value): value is string => Boolean(value));
  const apiBase = (options.apiBase ?? "https://api.stripe.com").replace(/\/+$/, "");
  const fetcher = options.fetch ?? fetch;
  const tolerance = options.toleranceSeconds ?? 300;
  const missing = [!secretKey ? "STRIPE_SECRET_KEY" : undefined, webhookSecrets.length === 0 ? "STRIPE_WEBHOOK_SECRET" : undefined].filter(Boolean);

  async function api(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    if (!secretKey) throw new AdapterError("payments", "stripe", "unavailable", "Stripe is not configured.");
    const response = await paymentFetch(fetcher, `${apiBase}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${secretKey}`, "stripe-version": "2026-02-25.clover", ...init.headers },
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
      const value = await api("/v1/checkout/sessions", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "idempotency-key": invoice.idempotencyKey },
        body: form,
      });
      const providerRef = text(value.id);
      const url = text(value.url);
      if (!providerRef || !url) throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not return a checkout address.");
      return {
        providerRef,
        paymentRef: typeof value.payment_intent === "string" ? value.payment_intent : undefined,
        url,
        expiresAt: number(value.expires_at) === undefined ? undefined : stripeTime(value.expires_at),
      };
    },
    async captureCheckout(request): Promise<CheckoutCaptureResult> {
      const value = await api(`/v1/checkout/sessions/${encodeURIComponent(request.checkoutRef)}`, { method: "GET" });
      const providerRef = typeof value.payment_intent === "string" ? value.payment_intent : request.checkoutRef;
      return {
        providerRef,
        status: value.payment_status === "paid" ? "succeeded" : value.status === "expired" ? "failed" : "pending",
        amountMinor: number(value.amount_total),
        currency: text(value.currency)?.toUpperCase(),
      };
    },
    async refund(request) {
      const form = new URLSearchParams({ payment_intent: request.providerRef, amount: String(request.amountMinor) });
      if (request.reason) form.set("metadata[freeholder_reason]", request.reason.slice(0, 500));
      const value = await api("/v1/refunds", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "idempotency-key": request.idempotencyKey }, body: form });
      const providerRef = text(value.id);
      if (!providerRef) throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not return a refund reference.");
      return { providerRef, status: value.status === "succeeded" ? "succeeded" : value.status === "failed" || value.status === "canceled" ? "failed" : "pending" };
    },
    async revokeSavedMethod(request) {
      await api(`/v1/payment_methods/${encodeURIComponent(request.providerRef)}/detach`, { method: "POST", headers: { "idempotency-key": request.idempotencyKey } });
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
      return stripeEvents(parsed);
    },
  };
}
