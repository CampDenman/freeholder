// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Paystack hosted transactions, verification, refunds, and SHA-512 webhooks.

import { env } from "@/core/env";
import { AdapterError } from "../types";
import { number, object, paymentFetch, providerJson, text } from "./http";
import {
  bodyEventId,
  deterministicProviderRef,
  parseProviderJson,
  providerIdentifier,
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
  disputes: false,
  payouts: false,
  inPerson: false,
  strongCustomerAuthentication: true,
};

export interface PaystackPaymentOptions {
  secretKey?: string;
  apiBase?: string;
  fetch?: typeof fetch;
}

function paystackData(payload: Record<string, unknown>): Record<string, unknown> {
  const data = object(payload.data);
  if (!data) throw new AdapterError("payments", "paystack", "provider_failure", "Paystack returned a malformed response.");
  return data;
}

function metadata(value: unknown): { invoiceId?: string; contactId?: string } {
  const record = object(value);
  return {
    invoiceId: text(record?.freeholder_invoice_id),
    contactId: text(record?.freeholder_contact_id),
  };
}

function paystackEvents(payload: Record<string, unknown>, body: Uint8Array): PaymentProviderEvent[] {
  const type = text(payload.event);
  const data = object(payload.data);
  if (!type || !data) throw new AdapterError("payments", "paystack", "invalid_request", "Paystack sent a malformed event.");
  const id = bodyEventId("paystack", body, type);

  if (type === "charge.success") {
    const providerRef = text(data.reference);
    if (!providerRef) return [];
    return [{
      id,
      kind: "payment_succeeded",
      providerRef,
      checkoutRef: providerRef,
      amountMinor: number(data.amount),
      currency: text(data.currency)?.toUpperCase(),
      occurredAt: providerTime("Paystack", data.paid_at ?? data.paidAt ?? data.created_at),
      ...metadata(data.metadata),
    }];
  }

  if (type.startsWith("refund.")) {
    const providerRef = text(data.refund_reference) ?? providerIdentifier(data.id);
    const transaction = object(data.transaction);
    const paymentProviderRef = text(data.transaction_reference) ?? text(transaction?.reference);
    if (!providerRef || !paymentProviderRef) return [];
    const common = {
      id,
      providerRef,
      paymentProviderRef,
      amountMinor: number(data.amount),
      currency: text(data.currency)?.toUpperCase(),
      occurredAt: providerTime("Paystack", data.updated_at ?? data.updatedAt ?? data.created_at ?? data.createdAt),
    };
    if (type === "refund.processed" || data.status === "processed") return [{ ...common, kind: "refund_succeeded" }];
    if (type === "refund.failed" || data.status === "failed" || data.status === "needs-attention") return [{ ...common, kind: "refund_failed" }];
    return [{ ...common, kind: "refund_processing" }];
  }
  return [];
}

export function createPaystackPayments(options: PaystackPaymentOptions = {}): PaymentAdapter {
  const current = env();
  const secretKey = options.secretKey ?? current.PAYSTACK_SECRET_KEY;
  const apiBase = (options.apiBase ?? "https://api.paystack.co").replace(/\/+$/, "");
  const fetcher = options.fetch ?? fetch;

  async function api(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    if (!secretKey) throw new AdapterError("payments", "paystack", "unavailable", "Paystack is not configured.");
    const response = await paymentFetch(fetcher, `${apiBase}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${secretKey}`, ...init.headers },
    });
    return providerJson("paystack", response);
  }

  return {
    id: "paystack",
    status: {
      family: "payments",
      id: "paystack",
      available: Boolean(secretKey),
      message: secretKey
        ? "Paystack hosted transactions, refunds, verification, and authenticated feedback are configured."
        : "Paystack is missing PAYSTACK_SECRET_KEY.",
    },
    capabilities: () => ({ ...capabilities }),
    async supportedCurrencies() { return []; },
    async supportedMethods(context) {
      return [{
        id: "paystack_checkout",
        label: ["NG", "GH", "ZA", "KE", "CI", "EG", "RW"].includes(context.country)
          ? "Card, bank, transfer, or mobile money"
          : "Paystack-supported checkout method",
        kind: "other",
        recurring: false,
      }];
    },
    async createCheckout(invoice) {
      const reference = deterministicProviderRef("fh_", invoice.idempotencyKey, 64);
      const value = paystackData(await api("/transaction/initialize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: invoice.customer.email,
          amount: String(invoice.amountMinor),
          currency: invoice.currency,
          reference,
          callback_url: invoice.successUrl,
          metadata: {
            freeholder_invoice_id: invoice.invoiceId,
            freeholder_contact_id: invoice.contactId,
            cancel_url: invoice.cancelUrl,
          },
        }),
      }));
      const providerRef = text(value.reference) ?? reference;
      const url = text(value.authorization_url);
      if (!url) throw new AdapterError("payments", "paystack", "provider_failure", "Paystack did not return a checkout address.");
      return { providerRef, url };
    },
    async captureCheckout(request) {
      const data = paystackData(await api(`/transaction/verify/${encodeURIComponent(request.checkoutRef)}`, { method: "GET" }));
      return {
        // Transaction IDs can exceed JavaScript's safe integer range in JSON;
        // Paystack explicitly accepts the unique transaction reference here.
        providerRef: text(data.reference) ?? request.checkoutRef,
        status: data.status === "success" ? "succeeded" : data.status === "failed" || data.status === "abandoned" || data.status === "reversed" ? "failed" : "pending",
        amountMinor: number(data.amount),
        currency: text(data.currency)?.toUpperCase(),
        occurredAt: providerTime("Paystack", data.paid_at ?? data.paidAt ?? data.created_at),
      };
    },
    async refund(request) {
      const data = paystackData(await api("/refund", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // Paystack's transaction reference prevents a second charge. Refund
          // creation has no documented idempotency field; this header preserves
          // the caller key if the account enables provider-side request replay.
          "x-paystack-idempotency-key": request.idempotencyKey,
        },
        body: JSON.stringify({
          transaction: request.providerRef,
          amount: request.amountMinor,
          currency: request.currency,
          customer_note: request.reason?.slice(0, 255),
          merchant_note: request.reason?.slice(0, 255),
        }),
      }));
      const providerRef = text(data.refund_reference) ?? providerIdentifier(data.id);
      if (!providerRef) throw new AdapterError("payments", "paystack", "provider_failure", "Paystack did not return a refund reference.");
      return { providerRef, status: data.status === "processed" ? "succeeded" : data.status === "failed" || data.status === "needs-attention" ? "failed" : "pending" };
    },
    async revokeSavedMethod() { unsupportedSavedMethod("Paystack"); },
    async verifyWebhook(request) {
      if (!secretKey) throw new AdapterError("payments", "paystack", "unavailable", "Paystack webhook verification is not configured.");
      verifyProviderHmac({
        provider: "Paystack",
        algorithm: "sha512",
        secrets: [secretKey],
        signed: request.body,
        signature: request.headers["x-paystack-signature"],
        encoding: "hex",
      });
      return paystackEvents(parseProviderJson("Paystack", request.body), request.body);
    },
  };
}
