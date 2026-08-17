// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Stripe Terminal and tap-to-pay representation. Card numbers never reach us.

import { AdapterError } from "../types";
import { env } from "@/core/env";
import { paymentFetch, providerJson, text } from "../payments/http";
import type { PointOfSaleAdapter, PointOfSalePayment, PointOfSaleProviderEvent } from "./types";

export interface StripePointOfSaleOptions {
  secretKey?: string;
  apiBase?: string;
  fetch?: typeof fetch;
}

export function createStripePointOfSale(options: StripePointOfSaleOptions = {}): PointOfSaleAdapter {
  const secretKey = options.secretKey ?? env().STRIPE_SECRET_KEY;
  const apiBase = (options.apiBase ?? "https://api.stripe.com").replace(/\/+$/, "");
  const fetcher = options.fetch ?? fetch;

  async function api(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    if (!secretKey) throw new AdapterError("point_of_sale", "stripe", "unavailable", "Stripe Terminal is not configured.");
    const response = await paymentFetch(fetcher, `${apiBase}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${secretKey}`,
        "stripe-version": "2026-02-25.clover",
        ...init.headers,
      },
    });
    return providerJson("stripe", response);
  }

  return {
    id: "stripe",
    status: {
      family: "point_of_sale",
      id: "stripe",
      available: Boolean(secretKey),
      message: secretKey
        ? "Stripe Terminal readers and tap-to-pay can collect in-person card payments."
        : "Stripe Terminal needs STRIPE_SECRET_KEY.",
    },
    capabilities: () => ({
      countertop: Boolean(secretKey),
      tapToPay: Boolean(secretKey),
      cashRecording: false,
      refunds: Boolean(secretKey),
    }),
    async collect(request) {
      const form = new URLSearchParams({
        amount: String(request.amountMinor),
        currency: request.currency.toLowerCase(),
        "payment_method_types[0]": "card_present",
        capture_method: "automatic",
        "metadata[invoice_id]": request.invoiceId,
        "metadata[location_id]": request.locationId,
        "metadata[freeholder_pos]": "stripe",
      });
      const intent = await api("/v1/payment_intents", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "idempotency-key": request.idempotencyKey,
        },
        body: form,
      });
      const providerRef = text(intent.id);
      if (!providerRef) {
        throw new AdapterError("point_of_sale", "stripe", "provider_failure", "Stripe did not return a PaymentIntent.");
      }
      if (request.readerRef) {
        await api(`/v1/terminal/readers/${encodeURIComponent(request.readerRef)}/process_payment_intent`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ payment_intent: providerRef }),
        });
        return { providerRef, status: "processing" satisfies PointOfSalePayment["status"] };
      }
      return {
        providerRef,
        status: "requires_reader" satisfies PointOfSalePayment["status"],
        readerActionToken: text(intent.client_secret) ?? undefined,
      };
    },
    async refund(request) {
      const refund = await api("/v1/refunds", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "idempotency-key": request.idempotencyKey,
        },
        body: new URLSearchParams({
          payment_intent: request.providerRef,
          amount: String(request.amountMinor),
        }),
      });
      const providerRef = text(refund.id);
      if (!providerRef) {
        throw new AdapterError("point_of_sale", "stripe", "provider_failure", "Stripe did not return a refund.");
      }
      const status = text(refund.status);
      return {
        providerRef,
        status: status === "succeeded" ? "succeeded" : status === "failed" ? "failed" : "pending",
      };
    },
    async verifyWebhook() {
      return [] as PointOfSaleProviderEvent[];
    },
  };
}
