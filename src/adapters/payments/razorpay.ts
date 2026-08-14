// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Razorpay Payment Links with reference recovery, refunds, and signed feedback.

import { env } from "@/core/env";
import { AdapterError } from "../types";
import { number, object, paymentFetch, providerJson, text } from "./http";
import {
  bodyEventId,
  deterministicProviderRef,
  parseProviderJson,
  providerTime,
  unsupportedSavedMethod,
  verifyProviderHmac,
} from "./provider-helpers";
import type { PaymentAdapter, PaymentAdapterCapabilities, PaymentProviderEvent } from "./types";

const capabilities: PaymentAdapterCapabilities = {
  refunds: true,
  partialRefunds: true,
  savedMethods: false,
  subscriptions: false,
  disputes: true,
  payouts: false,
  inPerson: false,
  strongCustomerAuthentication: true,
};

export interface RazorpayPaymentOptions {
  keyId?: string;
  keySecret?: string;
  webhookSecrets?: readonly string[];
  apiBase?: string;
  fetch?: typeof fetch;
}

function entity(payload: Record<string, unknown>, name: string): Record<string, unknown> | undefined {
  return object(object(object(payload.payload)?.[name])?.entity);
}

function notes(value: unknown): { invoiceId?: string; contactId?: string } {
  const record = object(value);
  return {
    invoiceId: text(record?.freeholder_invoice_id),
    contactId: text(record?.freeholder_contact_id),
  };
}

function razorpayEvents(payload: Record<string, unknown>, requestBody: Uint8Array, headerId?: string): PaymentProviderEvent[] {
  const type = text(payload.event);
  const eventId = headerId ?? bodyEventId("razorpay", requestBody, type ?? "event");
  const created = providerTime("Razorpay", payload.created_at);
  if (!type) throw new AdapterError("payments", "razorpay", "invalid_request", "Razorpay sent a malformed event.");

  const payment = entity(payload, "payment");
  const link = entity(payload, "payment_link");
  if (type.startsWith("payment_link.") || (type.startsWith("payment.") && !type.startsWith("payment.dispute."))) {
    const providerRef = text(payment?.id) ?? text(link?.id);
    if (!providerRef) return [];
    const status = text(payment?.status) ?? text(link?.status);
    const common = {
      id: eventId,
      providerRef,
      checkoutRef: text(link?.id) ?? text(payment?.invoice_id),
      amountMinor: number(payment?.amount) ?? number(link?.amount_paid) ?? number(link?.amount),
      currency: text(payment?.currency)?.toUpperCase() ?? text(link?.currency)?.toUpperCase(),
      occurredAt: providerTime("Razorpay", link?.updated_at ?? payment?.created_at, created),
      ...notes(link?.notes ?? payment?.notes),
    };
    if (type === "payment_link.paid" || type === "payment.captured" || status === "captured") return [{ ...common, kind: "payment_succeeded" }];
    if (type === "payment.failed" || status === "failed") return [{ ...common, kind: "payment_failed" }];
    if (type === "payment_link.cancelled" || type === "payment_link.expired") return [{ ...common, kind: "payment_cancelled" }];
    if (type === "payment.authorized" || type === "payment_link.partially_paid" || status === "authorized") return [{ ...common, kind: "payment_processing" }];
    return [];
  }

  const refund = entity(payload, "refund");
  if (refund && type.startsWith("refund.")) {
    const providerRef = text(refund.id);
    const paymentProviderRef = text(refund.payment_id);
    if (!providerRef || !paymentProviderRef) return [];
    const common = {
      id: eventId,
      providerRef,
      paymentProviderRef,
      amountMinor: number(refund.amount),
      currency: text(refund.currency)?.toUpperCase(),
      occurredAt: providerTime("Razorpay", refund.created_at, created),
    };
    if (type === "refund.processed" || refund.status === "processed") return [{ ...common, kind: "refund_succeeded" }];
    if (type === "refund.failed" || refund.status === "failed") return [{ ...common, kind: "refund_failed" }];
    return [{ ...common, kind: "refund_processing" }];
  }

  const dispute = entity(payload, "dispute");
  if (dispute && type.startsWith("payment.dispute.")) {
    const providerRef = text(dispute.id);
    const paymentProviderRef = text(dispute.payment_id) ?? text(payment?.id);
    if (!providerRef || !paymentProviderRef) return [];
    const common = {
      id: eventId,
      providerRef,
      paymentProviderRef,
      amountMinor: number(dispute.amount),
      currency: text(dispute.currency)?.toUpperCase(),
      occurredAt: providerTime("Razorpay", dispute.created_at, created),
      reason: text(dispute.reason_code),
      evidenceDueAt: number(dispute.respond_by) === undefined ? undefined : providerTime("Razorpay", dispute.respond_by),
    };
    if (type === "payment.dispute.won" || dispute.status === "won") return [{ ...common, kind: "dispute_won" }];
    if (type === "payment.dispute.lost" || dispute.status === "lost") return [{ ...common, kind: "dispute_lost" }];
    return [{ ...common, kind: "dispute_opened" }];
  }
  return [];
}

function checkout(link: Record<string, unknown>) {
  const providerRef = text(link.id);
  const url = text(link.short_url);
  if (!providerRef || !url) throw new AdapterError("payments", "razorpay", "provider_failure", "Razorpay did not return a checkout address.");
  return { providerRef, url, expiresAt: number(link.expire_by) === undefined ? undefined : providerTime("Razorpay", link.expire_by) };
}

export function createRazorpayPayments(options: RazorpayPaymentOptions = {}): PaymentAdapter {
  const current = env();
  const keyId = options.keyId ?? current.RAZORPAY_KEY_ID;
  const keySecret = options.keySecret ?? current.RAZORPAY_KEY_SECRET;
  const webhookSecrets = options.webhookSecrets ?? [
    current.RAZORPAY_WEBHOOK_SECRET,
    current.RAZORPAY_WEBHOOK_SECRET_PREVIOUS,
  ].filter((value): value is string => Boolean(value));
  const apiBase = (options.apiBase ?? "https://api.razorpay.com").replace(/\/+$/, "");
  const fetcher = options.fetch ?? fetch;
  const missing = [
    !keyId ? "RAZORPAY_KEY_ID" : undefined,
    !keySecret ? "RAZORPAY_KEY_SECRET" : undefined,
    webhookSecrets.length === 0 ? "RAZORPAY_WEBHOOK_SECRET" : undefined,
  ].filter(Boolean);

  async function api(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    if (!keyId || !keySecret) throw new AdapterError("payments", "razorpay", "unavailable", "Razorpay is not configured.");
    const response = await paymentFetch(fetcher, `${apiBase}${path}`, {
      ...init,
      headers: { authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`, ...init.headers },
    });
    return providerJson("razorpay", response);
  }

  return {
    id: "razorpay",
    status: {
      family: "payments",
      id: "razorpay",
      available: missing.length === 0,
      message: missing.length === 0
        ? "Razorpay Payment Links, refunds, disputes, and authenticated feedback are configured."
        : `Razorpay is missing ${missing.join(" and ")}.`,
    },
    capabilities: () => ({ ...capabilities }),
    async supportedCurrencies() { return []; },
    async supportedMethods(context) {
      return [{
        id: "razorpay_checkout",
        label: context.country === "IN" ? "Card, UPI, wallet, or netbanking" : "Razorpay-supported checkout method",
        kind: context.country === "IN" ? "bank_redirect" : "other",
        recurring: false,
      }];
    },
    async createCheckout(invoice) {
      const reference = deterministicProviderRef("fh_", invoice.idempotencyKey, 40);
      // Razorpay rejects a duplicate reference instead of accepting an
      // idempotency header. Recover the existing link before creating one.
      const existing = await api(`/v1/payment_links?reference_id=${encodeURIComponent(reference)}`, { method: "GET" });
      const links = Array.isArray(existing.payment_links) ? existing.payment_links.map(object).filter(Boolean) : [];
      if (links[0]) return checkout(links[0]);
      const value = await api("/v1/payment_links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount: invoice.amountMinor,
          currency: invoice.currency,
          accept_partial: false,
          reference_id: reference,
          description: invoice.description.slice(0, 2_048),
          customer: { name: invoice.customer.name, email: invoice.customer.email },
          notify: { sms: false, email: false },
          reminder_enable: false,
          callback_url: invoice.successUrl,
          callback_method: "get",
          notes: {
            freeholder_invoice_id: invoice.invoiceId,
            freeholder_contact_id: invoice.contactId,
          },
        }),
      });
      return checkout(value);
    },
    async captureCheckout(request) {
      const link = await api(`/v1/payment_links/${encodeURIComponent(request.checkoutRef)}`, { method: "GET" });
      const payments = Array.isArray(link.payments) ? link.payments.map(object).filter(Boolean) : [];
      const payment = payments.find((candidate) => candidate?.status === "captured") ?? payments[0];
      const providerRef = text(payment?.payment_id) ?? text(payment?.id) ?? request.checkoutRef;
      return {
        providerRef,
        status: link.status === "paid" ? "succeeded" : link.status === "cancelled" || link.status === "expired" ? "failed" : "pending",
        amountMinor: number(link.amount_paid) ?? number(link.amount),
        currency: text(link.currency)?.toUpperCase(),
        occurredAt: providerTime("Razorpay", link.updated_at ?? link.created_at),
      };
    },
    async refund(request) {
      const value = await api(`/v1/payments/${encodeURIComponent(request.providerRef)}/refund`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount: request.amountMinor,
          receipt: deterministicProviderRef("fh_", request.idempotencyKey, 40),
          notes: request.reason ? { freeholder_reason: request.reason.slice(0, 256) } : undefined,
        }),
      });
      const providerRef = text(value.id);
      if (!providerRef) throw new AdapterError("payments", "razorpay", "provider_failure", "Razorpay did not return a refund reference.");
      return { providerRef, status: value.status === "processed" ? "succeeded" : value.status === "failed" ? "failed" : "pending" };
    },
    async revokeSavedMethod() { unsupportedSavedMethod("Razorpay"); },
    async verifyWebhook(request) {
      if (webhookSecrets.length === 0) throw new AdapterError("payments", "razorpay", "unavailable", "Razorpay webhook verification is not configured.");
      verifyProviderHmac({
        provider: "Razorpay",
        algorithm: "sha256",
        secrets: webhookSecrets,
        signed: request.body,
        signature: request.headers["x-razorpay-signature"],
        encoding: "hex",
      });
      return razorpayEvents(parseProviderJson("Razorpay", request.body), request.body, request.headers["x-razorpay-event-id"]);
    },
  };
}
