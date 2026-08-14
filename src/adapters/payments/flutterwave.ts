// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Flutterwave Standard with verified settlement, refunds, and signed feedback.

import { env } from "@/core/env";
import { AdapterError } from "../types";
import { decimalToMinor, minorToDecimal } from "./currency";
import { object, paymentFetch, providerJson, text } from "./http";
import {
  bodyEventId,
  deterministicProviderRef,
  parseProviderJson,
  providerIdentifier,
  providerTime,
  unsupportedSavedMethod,
  verifyProviderHmac,
} from "./provider-helpers";
import type { PaymentAdapter, PaymentAdapterCapabilities } from "./types";

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

export interface FlutterwavePaymentOptions {
  secretKey?: string;
  webhookSecrets?: readonly string[];
  apiBase?: string;
  webhookUrl?: string;
  fetch?: typeof fetch;
}

function flutterwaveData(payload: Record<string, unknown>): Record<string, unknown> {
  const data = object(payload.data);
  if (!data) throw new AdapterError("payments", "flutterwave", "provider_failure", "Flutterwave returned a malformed response.");
  return data;
}

function majorAmount(value: unknown, currency: string | undefined): number | undefined {
  if (!currency) return undefined;
  const decimal = typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
  return decimal ? decimalToMinor(decimal, currency) : undefined;
}

function metadata(value: unknown): { invoiceId?: string; contactId?: string } {
  const record = object(value);
  return {
    invoiceId: text(record?.freeholder_invoice_id),
    contactId: text(record?.freeholder_contact_id),
  };
}

export function createFlutterwavePayments(options: FlutterwavePaymentOptions = {}): PaymentAdapter {
  const current = env();
  const secretKey = options.secretKey ?? current.FLUTTERWAVE_SECRET_KEY;
  const webhookSecrets = options.webhookSecrets ?? [
    current.FLUTTERWAVE_WEBHOOK_SECRET,
    current.FLUTTERWAVE_WEBHOOK_SECRET_PREVIOUS,
  ].filter((value): value is string => Boolean(value));
  const apiBase = (options.apiBase ?? "https://api.flutterwave.com/v3").replace(/\/+$/, "");
  const webhookUrl = options.webhookUrl ?? `${current.APP_URL.replace(/\/+$/, "")}/api/payments/webhooks/flutterwave`;
  const fetcher = options.fetch ?? fetch;
  const missing = [
    !secretKey ? "FLUTTERWAVE_SECRET_KEY" : undefined,
    webhookSecrets.length === 0 ? "FLUTTERWAVE_WEBHOOK_SECRET" : undefined,
  ].filter(Boolean);

  async function api(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    if (!secretKey) throw new AdapterError("payments", "flutterwave", "unavailable", "Flutterwave is not configured.");
    const response = await paymentFetch(fetcher, `${apiBase}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${secretKey}`, ...init.headers },
    });
    return providerJson("flutterwave", response);
  }

  async function verifiedTransaction(reference: string): Promise<Record<string, unknown>> {
    return flutterwaveData(await api(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`, { method: "GET" }));
  }

  function capture(data: Record<string, unknown>, fallback: string) {
    const currency = text(data.currency)?.toUpperCase();
    return {
      providerRef: providerIdentifier(data.id) ?? fallback,
      status: data.status === "successful" ? "succeeded" as const : data.status === "failed" ? "failed" as const : "pending" as const,
      amountMinor: majorAmount(data.amount, currency),
      currency,
      occurredAt: providerTime("Flutterwave", data.created_at ?? data.createdAt),
    };
  }

  return {
    id: "flutterwave",
    status: {
      family: "payments",
      id: "flutterwave",
      available: missing.length === 0,
      message: missing.length === 0
        ? "Flutterwave Standard, API-verified settlement, refunds, and authenticated feedback are configured."
        : `Flutterwave is missing ${missing.join(" and ")}.`,
    },
    capabilities: () => ({ ...capabilities }),
    async supportedCurrencies() { return []; },
    async supportedMethods(context) {
      return [{
        id: "flutterwave_checkout",
        label: ["NG", "GH", "KE", "ZA", "UG", "TZ", "RW"].includes(context.country)
          ? "Card, transfer, bank, or mobile money"
          : "Flutterwave-supported checkout method",
        kind: "other",
        recurring: false,
      }];
    },
    async createCheckout(invoice) {
      const txRef = deterministicProviderRef("fh_", invoice.idempotencyKey, 64);
      const data = flutterwaveData(await api("/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tx_ref: txRef,
          amount: minorToDecimal(invoice.amountMinor, invoice.currency),
          currency: invoice.currency,
          redirect_url: invoice.successUrl,
          customer: { email: invoice.customer.email, name: invoice.customer.name },
          customizations: { title: invoice.description.slice(0, 100), description: invoice.description.slice(0, 255) },
          meta: {
            freeholder_invoice_id: invoice.invoiceId,
            freeholder_contact_id: invoice.contactId,
            cancel_url: invoice.cancelUrl,
          },
        }),
      }));
      const url = text(data.link);
      if (!url) throw new AdapterError("payments", "flutterwave", "provider_failure", "Flutterwave did not return a checkout address.");
      return { providerRef: txRef, url };
    },
    async captureCheckout(request) {
      return capture(await verifiedTransaction(request.checkoutRef), request.checkoutRef);
    },
    async refund(request) {
      const transactionId = request.providerRef;
      if (!/^\d+$/.test(transactionId)) {
        throw new AdapterError("payments", "flutterwave", "invalid_request", "Flutterwave refunds require a verified transaction identifier.");
      }
      const data = flutterwaveData(await api(`/transactions/${encodeURIComponent(transactionId)}/refund`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": request.idempotencyKey },
        body: JSON.stringify({
          amount: Number(minorToDecimal(request.amountMinor, request.currency)),
          comments: request.reason?.slice(0, 255),
          callbackurl: webhookUrl,
        }),
      }));
      const providerRef = providerIdentifier(data.id) ?? text(data.flw_ref);
      if (!providerRef) throw new AdapterError("payments", "flutterwave", "provider_failure", "Flutterwave did not return a refund reference.");
      const status = text(data.status);
      return {
        providerRef,
        // Plain `completed` means accepted and pending disbursement in the v3
        // API. Only rail-specific completion or `succeeded` is final.
        status: status === "succeeded" || status?.startsWith("completed-")
          ? "succeeded"
          : status === "failed"
            ? "failed"
            : "pending",
      };
    },
    async revokeSavedMethod() { unsupportedSavedMethod("Flutterwave"); },
    async verifyWebhook(request) {
      if (webhookSecrets.length === 0) throw new AdapterError("payments", "flutterwave", "unavailable", "Flutterwave webhook verification is not configured.");
      verifyProviderHmac({
        provider: "Flutterwave",
        algorithm: "sha256",
        secrets: webhookSecrets,
        signed: request.body,
        signature: request.headers["flutterwave-signature"],
        encoding: "base64",
      });
      const payload = parseProviderJson("Flutterwave", request.body);
      const type = text(payload.type) ?? text(payload.event);
      const data = object(payload.data);
      if (!type || !data) throw new AdapterError("payments", "flutterwave", "invalid_request", "Flutterwave sent a malformed event.");
      const eventId = text(payload.id) ?? bodyEventId("flutterwave", request.body, type);

      if (type === "charge.completed" || type === "charge.successful") {
        const reference = text(data.tx_ref) ?? text(data.reference);
        if (!reference) return [];
        // Signature proves origin; the authenticated API re-fetch separately
        // proves final status, amount, currency, and merchant reference.
        const verified = await verifiedTransaction(reference);
        const result = capture(verified, reference);
        const common = {
          id: eventId,
          providerRef: result.providerRef,
          checkoutRef: text(verified.tx_ref) ?? reference,
          amountMinor: result.amountMinor,
          currency: result.currency,
          occurredAt: result.occurredAt,
          ...metadata(verified.meta ?? data.meta),
        };
        if (result.status === "succeeded") return [{ ...common, kind: "payment_succeeded" }];
        if (result.status === "failed") return [{ ...common, kind: "payment_failed" }];
        return [{ ...common, kind: "payment_processing" }];
      }

      if (type.startsWith("refund.")) {
        const providerRef = providerIdentifier(data.id) ?? text(data.refund_reference);
        const paymentProviderRef = providerIdentifier(data.transaction_id ?? data.TransactionId ?? data.tx_id);
        if (!providerRef || !paymentProviderRef) return [];
        const currency = text(data.currency)?.toUpperCase();
        const common = {
          id: eventId,
          providerRef,
          paymentProviderRef,
          amountMinor: majorAmount(data.amount_refunded ?? data.AmountRefunded ?? data.amount, currency),
          currency,
          occurredAt: providerTime("Flutterwave", data.updated_at ?? data.updatedAt ?? data.created_at ?? data.createdAt, request.receivedAt),
        };
        if (type === "refund.succeeded" || type === "refund.completed" || data.status === "succeeded" || text(data.status)?.startsWith("completed-")) return [{ ...common, kind: "refund_succeeded" }];
        if (type === "refund.failed" || data.status === "failed") return [{ ...common, kind: "refund_failed" }];
        return [{ ...common, kind: "refund_processing" }];
      }
      return [];
    },
  };
}
