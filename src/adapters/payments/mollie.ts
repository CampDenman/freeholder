// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Mollie hosted payments with API-authenticated classic webhook convergence.

import { env } from "@/core/env";
import { AdapterError } from "../types";
import { decimalToMinor, minorToDecimal } from "./currency";
import { object, paymentFetch, providerJson, text } from "./http";
import {
  parseProviderJson,
  providerTime,
  unsupportedSavedMethod,
  verifyProviderHmac,
} from "./provider-helpers";
import type {
  PaymentAdapter,
  PaymentAdapterCapabilities,
  PaymentMethodOffer,
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

export interface MolliePaymentOptions {
  apiKey?: string;
  webhookSecrets?: readonly string[];
  apiBase?: string;
  webhookUrl?: string;
  fetch?: typeof fetch;
}

function amount(value: unknown): { amountMinor?: number; currency?: string } {
  const money = object(value);
  const currency = text(money?.currency)?.toUpperCase();
  const decimal = text(money?.value);
  return {
    amountMinor: currency && decimal ? decimalToMinor(decimal, currency) : undefined,
    currency,
  };
}

function metadata(value: unknown): { invoiceId?: string; contactId?: string } {
  let candidate = value;
  if (typeof candidate === "string") {
    try { candidate = JSON.parse(candidate); } catch { return {}; }
  }
  const record = object(candidate);
  return {
    invoiceId: text(record?.freeholder_invoice_id),
    contactId: text(record?.freeholder_contact_id),
  };
}

function eventTime(value: Record<string, unknown>): string {
  return providerTime(
    "Mollie",
    value.paidAt ?? value.authorizedAt ?? value.failedAt ?? value.canceledAt
      ?? value.expiredAt ?? value.updatedAt ?? value.createdAt,
  );
}

function mollieEvents(payment: Record<string, unknown>): PaymentProviderEvent[] {
  const providerRef = text(payment.id);
  const status = text(payment.status);
  if (!providerRef || !status) {
    throw new AdapterError("payments", "mollie", "provider_failure", "Mollie returned a malformed payment during webhook verification.");
  }
  const occurredAt = eventTime(payment);
  const common = {
    id: `mollie:${providerRef}:payment:${status}:${occurredAt}`,
    providerRef,
    checkoutRef: providerRef,
    ...amount(payment.amount),
    occurredAt,
    ...metadata(payment.metadata),
  };
  const events: PaymentProviderEvent[] = [];
  if (status === "paid") events.push({ ...common, kind: "payment_succeeded" });
  else if (status === "failed") events.push({ ...common, kind: "payment_failed" });
  else if (status === "canceled" || status === "expired") events.push({ ...common, kind: "payment_cancelled" });
  else if (status === "open" || status === "pending" || status === "authorized") events.push({ ...common, kind: "payment_processing" });

  const embedded = object(payment._embedded);
  const refunds = Array.isArray(embedded?.refunds) ? embedded.refunds.map(object).filter(Boolean) : [];
  for (const refund of refunds) {
    const refundRef = text(refund?.id);
    const refundStatus = text(refund?.status);
    if (!refundRef || !refundStatus) continue;
    const refundAt = providerTime("Mollie", refund?.updatedAt ?? refund?.createdAt, occurredAt);
    const refundCommon = {
      id: `mollie:${refundRef}:refund:${refundStatus}:${refundAt}`,
      providerRef: refundRef,
      paymentProviderRef: providerRef,
      ...amount(refund?.amount),
      occurredAt: refundAt,
    };
    if (refundStatus === "refunded") events.push({ ...refundCommon, kind: "refund_succeeded" });
    else if (refundStatus === "failed" || refundStatus === "canceled") events.push({ ...refundCommon, kind: "refund_failed" });
    else events.push({ ...refundCommon, kind: "refund_processing" });
  }
  return events;
}

export function createMolliePayments(options: MolliePaymentOptions = {}): PaymentAdapter {
  const current = env();
  const apiKey = options.apiKey ?? current.MOLLIE_API_KEY;
  const webhookSecrets = options.webhookSecrets ?? [
    current.MOLLIE_WEBHOOK_SECRET,
    current.MOLLIE_WEBHOOK_SECRET_PREVIOUS,
  ].filter((value): value is string => Boolean(value));
  const apiBase = (options.apiBase ?? "https://api.mollie.com").replace(/\/+$/, "");
  const webhookUrl = options.webhookUrl ?? `${current.APP_URL.replace(/\/+$/, "")}/api/payments/webhooks/mollie`;
  const fetcher = options.fetch ?? fetch;

  async function api(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    if (!apiKey) throw new AdapterError("payments", "mollie", "unavailable", "Mollie is not configured.");
    const response = await paymentFetch(fetcher, `${apiBase}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${apiKey}`, ...init.headers },
    });
    return providerJson("mollie", response);
  }

  return {
    id: "mollie",
    status: {
      family: "payments",
      id: "mollie",
      available: Boolean(apiKey),
      message: apiKey
        ? "Mollie checkout, refunds, and API-verified classic payment feedback are configured."
        : "Mollie is missing MOLLIE_API_KEY.",
    },
    capabilities: () => ({ ...capabilities }),
    async supportedCurrencies() { return []; },
    async supportedMethods(context) {
      const methods: PaymentMethodOffer[] = [{ id: "creditcard", label: "Card", kind: "card", recurring: false }];
      if (context.currency === "EUR") {
        methods.push({ id: "ideal", label: "iDEAL", kind: "bank_redirect", recurring: false });
        methods.push({ id: "bancontact", label: "Bancontact", kind: "bank_redirect", recurring: false });
      }
      return methods;
    },
    async createCheckout(invoice) {
      const value = await api("/v2/payments", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": invoice.idempotencyKey },
        body: JSON.stringify({
          amount: { currency: invoice.currency, value: minorToDecimal(invoice.amountMinor, invoice.currency) },
          description: invoice.description.slice(0, 255),
          redirectUrl: invoice.successUrl,
          cancelUrl: invoice.cancelUrl,
          webhookUrl,
          metadata: {
            freeholder_invoice_id: invoice.invoiceId,
            freeholder_contact_id: invoice.contactId,
          },
          ...(invoice.methodIds?.length === 1 ? { method: invoice.methodIds[0] } : {}),
        }),
      });
      const providerRef = text(value.id);
      const url = text(object(object(value._links)?.checkout)?.href);
      if (!providerRef || !url) throw new AdapterError("payments", "mollie", "provider_failure", "Mollie did not return a checkout address.");
      return { providerRef, url };
    },
    async captureCheckout(request) {
      const payment = await api(`/v2/payments/${encodeURIComponent(request.checkoutRef)}`, { method: "GET" });
      const status = text(payment.status);
      return {
        providerRef: text(payment.id) ?? request.checkoutRef,
        status: status === "paid" ? "succeeded" : status === "failed" || status === "canceled" || status === "expired" ? "failed" : "pending",
        ...amount(payment.amount),
        occurredAt: eventTime(payment),
      };
    },
    async refund(request) {
      const value = await api(`/v2/payments/${encodeURIComponent(request.providerRef)}/refunds`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": request.idempotencyKey },
        body: JSON.stringify({
          amount: { currency: request.currency, value: minorToDecimal(request.amountMinor, request.currency) },
          ...(request.reason ? { description: request.reason.slice(0, 255) } : {}),
        }),
      });
      const providerRef = text(value.id);
      if (!providerRef) throw new AdapterError("payments", "mollie", "provider_failure", "Mollie did not return a refund reference.");
      return {
        providerRef,
        status: value.status === "refunded" ? "succeeded" : value.status === "failed" || value.status === "canceled" ? "failed" : "pending",
      };
    },
    async revokeSavedMethod() { unsupportedSavedMethod("Mollie"); },
    async verifyWebhook(request) {
      const signature = request.headers["x-mollie-signature"];
      let paymentId: string | undefined;
      if (signature) {
        if (webhookSecrets.length === 0) throw new AdapterError("payments", "mollie", "unavailable", "Mollie next-generation webhook verification is not configured.");
        verifyProviderHmac({
          provider: "Mollie",
          algorithm: "sha256",
          secrets: webhookSecrets,
          signed: request.body,
          signature,
          encoding: "hex",
          prefix: "sha256=",
        });
        const payload = parseProviderJson("Mollie", request.body);
        const entity = object(payload.entity) ?? object(payload.data);
        paymentId = text(entity?.id) ?? text(payload.entityId) ?? text(payload.entity_id);
        if (!paymentId && text(payload.resource) === "payment") paymentId = text(payload.id);
      } else {
        const form = new URLSearchParams(Buffer.from(request.body).toString("utf8"));
        paymentId = form.get("id") ?? undefined;
      }
      if (!paymentId || paymentId.length > 64 || !/^tr_[A-Za-z0-9]+$/.test(paymentId)) {
        throw new AdapterError("payments", "mollie", "invalid_request", "Mollie feedback did not identify a payment.");
      }
      // Classic callbacks deliberately carry no signature or status. Fetching
      // with the private API credential is the authenticity check Mollie requires.
      return mollieEvents(await api(`/v2/payments/${encodeURIComponent(paymentId)}?embed=refunds`, { method: "GET" }));
    },
  };
}
