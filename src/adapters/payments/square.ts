// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Square Payment Links, payment/refund convergence, and exact-byte HMAC proof.

import { env } from "@/core/env";
import { AdapterError } from "../types";
import { number, object, paymentFetch, providerJson, text } from "./http";
import {
  deterministicProviderRef,
  parseProviderJson,
  providerTime,
  unsupportedSavedMethod,
  verifyProviderHmac,
} from "./provider-helpers";
import type {
  CheckoutCaptureResult,
  PaymentAdapter,
  PaymentAdapterCapabilities,
  PaymentProviderEvent,
} from "./types";

const capabilities: PaymentAdapterCapabilities = {
  refunds: true,
  partialRefunds: true,
  savedMethods: false,
  subscriptions: false,
  disputes: false,
  payouts: false,
  inPerson: false,
  strongCustomerAuthentication: true,
};

export interface SquarePaymentOptions {
  accessToken?: string;
  locationId?: string;
  webhookSignatureKeys?: readonly string[];
  environment?: "sandbox" | "live";
  apiBase?: string;
  notificationUrl?: string;
  fetch?: typeof fetch;
}

function squareMoney(value: unknown): { amountMinor?: number; currency?: string } {
  const money = object(value);
  return { amountMinor: number(money?.amount), currency: text(money?.currency)?.toUpperCase() };
}

function freeholderNote(value: unknown): { invoiceId?: string; contactId?: string } {
  const note = text(value);
  const match = note ? /^freeholder:([^:]+):([^:]+)$/.exec(note) : undefined;
  return { invoiceId: match?.[1], contactId: match?.[2] };
}

function squareEvents(payload: Record<string, unknown>): PaymentProviderEvent[] {
  const id = text(payload.event_id) ?? text(payload.id);
  const type = text(payload.type);
  const occurredAt = providerTime("Square", payload.created_at);
  const value = object(object(payload.data)?.object);
  if (!id || !type || !value) {
    throw new AdapterError("payments", "square", "invalid_request", "Square sent a malformed event.");
  }

  const payout = object(value.payout);
  if (payout && type.startsWith("payout.")) {
    const providerRef = text(payout.id);
    const money = squareMoney(payout.amount_money);
    const status = text(payout.status);
    if (!providerRef || money.amountMinor === undefined || !money.currency || !status) return [];
    const arrival = text(payout.arrival_date);
    const common = {
      id,
      providerRef,
      amountMinor: money.amountMinor,
      currency: money.currency,
      occurredAt: providerTime("Square", payout.updated_at ?? payout.created_at, occurredAt),
      expectedAt: arrival ? new Date(`${arrival}T00:00:00.000Z`).toISOString() : undefined,
    };
    if (status === "PAID") return [{ ...common, kind: "payout_paid" }];
    if (status === "SENT") return [{ ...common, kind: "payout_in_transit" }];
    if (status === "FAILED") return [{ ...common, kind: "payout_failed", failureReason: "Square reported that the payout failed." }];
    if (status === "CANCELED") return [{ ...common, kind: "payout_cancelled" }];
    return [{ ...common, kind: "payout_pending" }];
  }

  const payment = object(value.payment);
  if (payment && type.startsWith("payment.")) {
    const providerRef = text(payment.id);
    if (!providerRef) return [];
    const status = text(payment.status);
    const common = {
      id,
      providerRef,
      checkoutRef: text(payment.order_id),
      ...squareMoney(payment.amount_money),
      occurredAt: providerTime("Square", payment.updated_at ?? payment.created_at, occurredAt),
      ...freeholderNote(payment.note),
    };
    if (status === "COMPLETED") return [{ ...common, kind: "payment_succeeded" }];
    if (status === "FAILED") return [{ ...common, kind: "payment_failed" }];
    if (status === "CANCELED") return [{ ...common, kind: "payment_cancelled" }];
    if (status === "APPROVED" || status === "PENDING") return [{ ...common, kind: "payment_processing" }];
    return [];
  }

  const refund = object(value.refund);
  if (refund && type.startsWith("refund.")) {
    const providerRef = text(refund.id);
    const paymentProviderRef = text(refund.payment_id);
    if (!providerRef || !paymentProviderRef) return [];
    const common = {
      id,
      providerRef,
      paymentProviderRef,
      ...squareMoney(refund.amount_money),
      occurredAt: providerTime("Square", refund.updated_at ?? refund.created_at, occurredAt),
    };
    if (refund.status === "COMPLETED") return [{ ...common, kind: "refund_succeeded" }];
    if (refund.status === "FAILED" || refund.status === "REJECTED") return [{ ...common, kind: "refund_failed" }];
    return [{ ...common, kind: "refund_processing" }];
  }
  return [];
}

export function createSquarePayments(options: SquarePaymentOptions = {}): PaymentAdapter {
  const current = env();
  const accessToken = options.accessToken ?? current.SQUARE_ACCESS_TOKEN;
  const locationId = options.locationId ?? current.SQUARE_LOCATION_ID;
  const signatureKeys = options.webhookSignatureKeys ?? [
    current.SQUARE_WEBHOOK_SIGNATURE_KEY,
    current.SQUARE_WEBHOOK_SIGNATURE_KEY_PREVIOUS,
  ].filter((value): value is string => Boolean(value));
  const environment = options.environment ?? current.SQUARE_ENVIRONMENT;
  const apiBase = (options.apiBase ?? (environment === "live" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com")).replace(/\/+$/, "");
  const notificationUrl = options.notificationUrl ?? `${current.APP_URL.replace(/\/+$/, "")}/api/payments/webhooks/square`;
  const fetcher = options.fetch ?? fetch;
  const missing = [
    !accessToken ? "SQUARE_ACCESS_TOKEN" : undefined,
    !locationId ? "SQUARE_LOCATION_ID" : undefined,
    signatureKeys.length === 0 ? "SQUARE_WEBHOOK_SIGNATURE_KEY" : undefined,
  ].filter(Boolean);

  async function api(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    if (!accessToken) throw new AdapterError("payments", "square", "unavailable", "Square is not configured.");
    const response = await paymentFetch(fetcher, `${apiBase}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "square-version": "2026-07-15",
        ...init.headers,
      },
    });
    return providerJson("square", response);
  }

  return {
    id: "square",
    status: {
      family: "payments",
      id: "square",
      available: missing.length === 0,
      message: missing.length === 0
        ? "Square Payment Links, refunds, payout tracking, and authenticated feedback are configured."
        : `Square is missing ${missing.join(" and ")}.`,
    },
    capabilities: () => ({ ...capabilities }),
    async supportedCurrencies() { return []; },
    async supportedMethods() {
      return [{ id: "square_checkout", label: "Card, wallet, or Square-supported method", kind: "card", recurring: false }];
    },
    async createCheckout(invoice) {
      if (!locationId) throw new AdapterError("payments", "square", "unavailable", "Square location is not configured.");
      const value = await api("/v2/online-checkout/payment-links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotency_key: invoice.idempotencyKey.length <= 192
            ? invoice.idempotencyKey
            : deterministicProviderRef("fh_", invoice.idempotencyKey, 192),
          description: invoice.description.slice(0, 4_096),
          quick_pay: {
            name: invoice.description.slice(0, 255),
            price_money: { amount: invoice.amountMinor, currency: invoice.currency },
            location_id: locationId,
          },
          checkout_options: { redirect_url: invoice.successUrl },
          pre_populated_data: { buyer_email: invoice.customer.email },
          payment_note: `freeholder:${invoice.invoiceId}:${invoice.contactId}`.slice(0, 500),
        }),
      });
      const link = object(value.payment_link);
      const providerRef = text(link?.order_id);
      const url = text(link?.url) ?? text(link?.long_url);
      if (!providerRef || !url) {
        throw new AdapterError("payments", "square", "provider_failure", "Square did not return a checkout address and order reference.");
      }
      return { providerRef, url };
    },
    async captureCheckout(request): Promise<CheckoutCaptureResult> {
      const value = await api(`/v2/orders/${encodeURIComponent(request.checkoutRef)}`, { method: "GET" });
      const order = object(value.order);
      if (!order) throw new AdapterError("payments", "square", "provider_failure", "Square did not return the checkout order.");
      const tenders = Array.isArray(order.tenders) ? order.tenders.map(object).filter(Boolean) : [];
      const tender = tenders.find((candidate) => text(candidate?.payment_id)) ?? tenders[0];
      return {
        providerRef: text(tender?.payment_id) ?? request.checkoutRef,
        status: order.state === "COMPLETED" ? "succeeded" : order.state === "CANCELED" ? "failed" : "pending",
        ...squareMoney(order.total_money),
        occurredAt: providerTime("Square", order.updated_at ?? order.created_at),
      };
    },
    async refund(request) {
      const value = await api("/v2/refunds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotency_key: deterministicProviderRef("fh_", request.idempotencyKey, 45),
          amount_money: { amount: request.amountMinor, currency: request.currency },
          payment_id: request.providerRef,
          ...(request.reason ? { reason: request.reason.slice(0, 192) } : {}),
        }),
      });
      const refund = object(value.refund);
      const providerRef = text(refund?.id);
      if (!providerRef) throw new AdapterError("payments", "square", "provider_failure", "Square did not return a refund reference.");
      return {
        providerRef,
        status: refund?.status === "COMPLETED" ? "succeeded" : refund?.status === "FAILED" || refund?.status === "REJECTED" ? "failed" : "pending",
      };
    },
    async revokeSavedMethod() { unsupportedSavedMethod("Square"); },
    async verifyWebhook(request) {
      if (signatureKeys.length === 0) throw new AdapterError("payments", "square", "unavailable", "Square webhook verification is not configured.");
      verifyProviderHmac({
        provider: "Square",
        algorithm: "sha256",
        secrets: signatureKeys,
        signed: Buffer.concat([Buffer.from(notificationUrl, "utf8"), Buffer.from(request.body)]),
        signature: request.headers["x-square-hmacsha256-signature"],
        encoding: "base64",
      });
      return squareEvents(parseProviderJson("Square", request.body));
    },
  };
}
