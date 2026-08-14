// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PayPal Orders/Captures/Vault edge with provider-authenticated webhooks.

import { AdapterError } from "../types";
import { env } from "@/core/env";
import { decimalToMinor, minorToDecimal } from "./currency";
import { object, paymentFetch, providerJson, text } from "./http";
import type {
  PaymentAdapter,
  PaymentAdapterCapabilities,
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

export interface PayPalPaymentOptions {
  clientId?: string;
  clientSecret?: string;
  webhookId?: string;
  environment?: "sandbox" | "live";
  apiBase?: string;
  fetch?: typeof fetch;
}

function paypalAmount(value: unknown): { amountMinor?: number; currency?: string } {
  const amount = object(value);
  const currency = text(amount?.currency_code)?.toUpperCase();
  const decimal = text(amount?.value);
  if (!currency || !decimal) return {};
  return { amountMinor: decimalToMinor(decimal, currency), currency };
}

function eventTime(value: unknown): string {
  const parsed = text(value);
  if (!parsed || !Number.isFinite(Date.parse(parsed))) {
    throw new AdapterError("payments", "paypal", "invalid_request", "PayPal sent an invalid event time.");
  }
  return new Date(parsed).toISOString();
}

function optionalEventTime(value: unknown): string | undefined {
  const parsed = text(value);
  return parsed && Number.isFinite(Date.parse(parsed)) ? new Date(parsed).toISOString() : undefined;
}

function linkId(value: Record<string, unknown>, resource: string): string | undefined {
  const links = Array.isArray(value.links) ? value.links : [];
  for (const item of links) {
    const href = text(object(item)?.href);
    if (!href) continue;
    const match = new RegExp(`/${resource}/([^/?#]+)`).exec(href);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return undefined;
}

function captureOrderId(value: Record<string, unknown>): string | undefined {
  return text(object(object(value.supplementary_data)?.related_ids)?.order_id);
}

function paypalVaultEvidence(value: Record<string, unknown>): SavedPaymentMethodEvidence | undefined {
  const source = object(value.payment_source);
  const paypal = object(source?.paypal);
  const card = object(source?.card);
  const selected = paypal ?? card;
  const vault = object(object(selected?.attributes)?.vault);
  const providerRef = text(vault?.id) ?? text(value.id);
  if (!providerRef) return undefined;
  if (card) {
    return {
      providerRef,
      providerCustomerRef: text(object(value.customer)?.id),
      kind: "card",
      label: `${text(card.brand) ?? "Card"} ending ${text(card.last_digits) ?? "••••"}`,
      brand: text(card.brand),
      last4: text(card.last_digits),
      expiryMonth: (() => {
        const expiry = text(card.expiry);
        return expiry ? Number(expiry.slice(5, 7)) : undefined;
      })(),
      expiryYear: (() => {
        const expiry = text(card.expiry);
        return expiry ? Number(expiry.slice(0, 4)) : undefined;
      })(),
    };
  }
  return {
    providerRef,
    providerCustomerRef: text(object(value.customer)?.id),
    kind: "wallet",
    label: "PayPal wallet",
  };
}

function paypalEvents(payload: Record<string, unknown>): PaymentProviderEvent[] {
  const id = text(payload.id);
  const type = text(payload.event_type);
  const occurredAt = eventTime(payload.create_time);
  const value = object(payload.resource);
  if (!id || !type || !value) throw new AdapterError("payments", "paypal", "invalid_request", "PayPal sent a malformed event.");
  const amount = paypalAmount(value.amount);

  if (type.startsWith("PAYMENT.CAPTURE.")) {
    const providerRef = text(value.id);
    if (!providerRef) return [];
    const checkoutRef = captureOrderId(value);
    const common = { id, providerRef, checkoutRef, ...amount, occurredAt, invoiceId: text(value.custom_id) };
    if (type === "PAYMENT.CAPTURE.COMPLETED") {
      const method = paypalVaultEvidence(value);
      return [{
        ...common,
        kind: "payment_succeeded",
        providerCustomerRef: method?.providerCustomerRef,
        savedMethod: method,
      }];
    }
    if (type === "PAYMENT.CAPTURE.PENDING") return [{ ...common, kind: "payment_processing" }];
    if (["PAYMENT.CAPTURE.DECLINED", "PAYMENT.CAPTURE.DENIED", "PAYMENT.CAPTURE.REVERSED"].includes(type)) return [{ ...common, kind: "payment_failed" }];
    return [];
  }

  if (type === "CHECKOUT.ORDER.VOIDED") {
    const providerRef = text(value.id);
    return providerRef ? [{ id, kind: "payment_cancelled", providerRef, checkoutRef: providerRef, occurredAt }] : [];
  }

  if (type.startsWith("PAYMENT.REFUND.")) {
    const providerRef = text(value.id);
    const paymentProviderRef = linkId(value, "captures") ?? text(object(object(value.supplementary_data)?.related_ids)?.capture_id);
    if (!providerRef || !paymentProviderRef) return [];
    const common = { id, providerRef, paymentProviderRef, ...amount, occurredAt };
    if (type === "PAYMENT.REFUND.COMPLETED") return [{ ...common, kind: "refund_succeeded" }];
    if (type === "PAYMENT.REFUND.FAILED" || type === "PAYMENT.REFUND.CANCELLED") return [{ ...common, kind: "refund_failed" }];
    return [{ ...common, kind: "refund_processing" }];
  }

  if (type.startsWith("CUSTOMER.DISPUTE.")) {
    const providerRef = text(value.dispute_id) ?? text(value.id);
    const transactions = Array.isArray(value.disputed_transactions) ? value.disputed_transactions : [];
    const transaction = object(transactions[0]);
    const paymentProviderRef = text(transaction?.seller_transaction_id);
    if (!providerRef || !paymentProviderRef) return [];
    const disputeAmount = paypalAmount(value.dispute_amount);
    const outcome = text(object(value.dispute_outcome)?.outcome_code) ?? "";
    const common = {
      id,
      providerRef,
      paymentProviderRef,
      ...disputeAmount,
      occurredAt,
      reason: text(value.reason),
      evidenceDueAt: optionalEventTime(value.seller_response_due_date),
    };
    if (type === "CUSTOMER.DISPUTE.RESOLVED" && outcome.includes("SELLER")) return [{ ...common, kind: "dispute_won" }];
    if (type === "CUSTOMER.DISPUTE.RESOLVED" && outcome.includes("BUYER")) return [{ ...common, kind: "dispute_lost" }];
    return [{ ...common, kind: "dispute_opened" }];
  }

  if (type === "VAULT.PAYMENT-TOKEN.CREATED" || type === "VAULT.PAYMENT-TOKEN.DELETED") {
    const method = paypalVaultEvidence(value);
    if (!method) return [];
    return [{
      id,
      kind: type.endsWith("CREATED") ? "saved_method_added" : "saved_method_removed",
      providerCustomerRef: method.providerCustomerRef,
      method,
      occurredAt,
    }];
  }
  return [];
}

export function createPayPalPayments(options: PayPalPaymentOptions = {}): PaymentAdapter {
  const current = env();
  const clientId = options.clientId ?? current.PAYPAL_CLIENT_ID;
  const clientSecret = options.clientSecret ?? current.PAYPAL_CLIENT_SECRET;
  const webhookId = options.webhookId ?? current.PAYPAL_WEBHOOK_ID;
  const environment = options.environment ?? current.PAYPAL_ENVIRONMENT;
  const apiBase = (options.apiBase ?? (environment === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com")).replace(/\/+$/, "");
  const fetcher = options.fetch ?? fetch;
  const missing = [!clientId ? "PAYPAL_CLIENT_ID" : undefined, !clientSecret ? "PAYPAL_CLIENT_SECRET" : undefined, !webhookId ? "PAYPAL_WEBHOOK_ID" : undefined].filter(Boolean);

  async function accessToken(): Promise<string> {
    if (!clientId || !clientSecret) throw new AdapterError("payments", "paypal", "unavailable", "PayPal is not configured.");
    const response = await paymentFetch(fetcher, `${apiBase}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const value = await providerJson("paypal", response);
    const token = text(value.access_token);
    if (!token) throw new AdapterError("payments", "paypal", "authentication", "PayPal did not issue an access token.");
    return token;
  }

  async function api(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const token = await accessToken();
    const response = await paymentFetch(fetcher, `${apiBase}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, accept: "application/json", ...init.headers },
    });
    return providerJson("paypal", response);
  }

  return {
    id: "paypal",
    status: {
      family: "payments",
      id: "paypal",
      available: missing.length === 0,
      message: missing.length === 0 ? `PayPal ${environment} checkout, refunds, vault, disputes, and authenticated feedback are configured.` : `PayPal is missing ${missing.join(", ")}.`,
    },
    capabilities: () => ({ ...capabilities }),
    async supportedCurrencies() { return []; },
    async supportedMethods() { return [{ id: "paypal", label: "PayPal", kind: "wallet", recurring: true }]; },
    async createCheckout(invoice) {
      const paymentSource: Record<string, unknown> = {
        paypal: {
          experience_context: {
            return_url: invoice.successUrl,
            cancel_url: invoice.cancelUrl,
            user_action: "PAY_NOW",
            shipping_preference: "GET_FROM_FILE",
          },
          ...(invoice.saveMethod ? { attributes: { vault: { store_in_vault: "ON_SUCCESS", usage_type: "MERCHANT" } } } : {}),
        },
      };
      const value = await api("/v2/checkout/orders", {
        method: "POST",
        headers: { "content-type": "application/json", "paypal-request-id": invoice.idempotencyKey, prefer: "return=representation" },
        body: JSON.stringify({
          intent: "CAPTURE",
          payment_source: paymentSource,
          purchase_units: [{
            reference_id: invoice.invoiceId,
            invoice_id: invoice.invoiceNumber,
            // Capture webhooks retain custom_id, making an early event
            // recoverable through the invoice even before its capture ref is
            // committed locally. Contact ownership is derived from that invoice.
            custom_id: invoice.invoiceId,
            description: invoice.description.slice(0, 127),
            amount: { currency_code: invoice.currency, value: minorToDecimal(invoice.amountMinor, invoice.currency) },
          }],
        }),
      });
      const providerRef = text(value.id);
      const links = Array.isArray(value.links) ? value.links : [];
      const approval = links.map(object).find((link) => link?.rel === "approve" || link?.rel === "payer-action");
      const url = text(approval?.href);
      if (!providerRef || !url) throw new AdapterError("payments", "paypal", "provider_failure", "PayPal did not return an approval address.");
      return { providerRef, url };
    },
    async captureCheckout(request) {
      const value = await api(`/v2/checkout/orders/${encodeURIComponent(request.checkoutRef)}/capture`, {
        method: "POST",
        headers: { "content-type": "application/json", "paypal-request-id": request.idempotencyKey, prefer: "return=representation" },
        body: "{}",
      });
      const units = Array.isArray(value.purchase_units) ? value.purchase_units : [];
      const payments = object(object(units[0])?.payments);
      const captures = Array.isArray(payments?.captures) ? payments.captures : [];
      const capture = object(captures[0]);
      const providerRef = text(capture?.id) ?? text(value.id) ?? request.checkoutRef;
      const amount = paypalAmount(capture?.amount);
      return {
        providerRef,
        status: capture?.status === "COMPLETED" ? "succeeded" : capture?.status === "DECLINED" || capture?.status === "DENIED" ? "failed" : "pending",
        ...amount,
        occurredAt: optionalEventTime(capture?.update_time ?? value.update_time),
      };
    },
    async refund(request) {
      const value = await api(`/v2/payments/captures/${encodeURIComponent(request.providerRef)}/refund`, {
        method: "POST",
        headers: { "content-type": "application/json", "paypal-request-id": request.idempotencyKey, prefer: "return=representation" },
        body: JSON.stringify({
          amount: { currency_code: request.currency, value: minorToDecimal(request.amountMinor, request.currency) },
          ...(request.reason ? { note_to_payer: request.reason.slice(0, 255) } : {}),
        }),
      });
      const providerRef = text(value.id);
      if (!providerRef) throw new AdapterError("payments", "paypal", "provider_failure", "PayPal did not return a refund reference.");
      return { providerRef, status: value.status === "COMPLETED" ? "succeeded" : value.status === "FAILED" || value.status === "CANCELLED" ? "failed" : "pending" };
    },
    async revokeSavedMethod(request) {
      await api(`/v3/vault/payment-tokens/${encodeURIComponent(request.providerRef)}`, {
        method: "DELETE",
        headers: { "paypal-request-id": request.idempotencyKey },
      });
    },
    async verifyWebhook(request) {
      if (!webhookId) throw new AdapterError("payments", "paypal", "unavailable", "PayPal webhook verification is not configured.");
      const required = {
        auth_algo: request.headers["paypal-auth-algo"],
        cert_url: request.headers["paypal-cert-url"],
        transmission_id: request.headers["paypal-transmission-id"],
        transmission_sig: request.headers["paypal-transmission-sig"],
        transmission_time: request.headers["paypal-transmission-time"],
      };
      if (Object.values(required).some((value) => !value)) throw new AdapterError("payments", "paypal", "authentication", "PayPal signature headers are incomplete.");
      let event: unknown;
      try { event = JSON.parse(Buffer.from(request.body).toString("utf8")); } catch { throw new AdapterError("payments", "paypal", "invalid_request", "PayPal sent invalid JSON."); }
      const payload = object(event);
      if (!payload) throw new AdapterError("payments", "paypal", "invalid_request", "PayPal sent an invalid event.");
      const verified = await api("/v1/notifications/verify-webhook-signature", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...required, webhook_id: webhookId, webhook_event: payload }),
      });
      if (verified.verification_status !== "SUCCESS") throw new AdapterError("payments", "paypal", "authentication", "PayPal signature is invalid.");
      return paypalEvents(payload);
    },
  };
}
