// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.27: PayPal Payouts. A seller gives the PayPal email they want to be
// paid at; each due payout is a one-item payout batch whose sender ids are
// the ledger's payout id, so PayPal never pays it twice. A retry carries the
// same PayPal-Request-Id, so PayPal answers with the original batch; past
// that, a duplicate sender_batch_id is refused with a link to the original
// batch, which is read as the answer. PayPal confirms by webhook. A payout a seller has claimed cannot be
// pulled back, so a refund after payment goes to the site owner to settle.
import { env } from "@/core/env";
import { AdapterError } from "../types";
import { minorToDecimal } from "../payments/currency";
import { object, paymentFetch, providerJson } from "../payments/http";
import { payoutJson } from "./http";
import type { PayoutProvider, PayoutWebhookEvent } from "./types";

export interface PayPalPayoutOptions {
  clientId?: string;
  clientSecret?: string;
  webhookId?: string;
  environment?: "sandbox" | "live";
  apiBase?: string;
  fetch?: typeof fetch;
}

const text = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
/** The original batch's id, from a duplicate-batch refusal's link to it. */
function duplicateOf(body: unknown): string | undefined {
  const links = object(body)?.links;
  if (!Array.isArray(links)) return undefined;
  for (const link of links) {
    const href = text(object(link)?.href);
    const match = href ? /\/v1\/payments\/payouts\/([A-Za-z0-9_-]{1,64})(?:[/?#]|$)/.exec(href) : null;
    if (match) return match[1];
  }
  return undefined;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

export function createPayPalPayouts(options: PayPalPayoutOptions = {}): PayoutProvider {
  const current = env();
  const clientId = options.clientId ?? current.PAYPAL_CLIENT_ID;
  const clientSecret = options.clientSecret ?? current.PAYPAL_CLIENT_SECRET;
  const webhookId = options.webhookId ?? current.PAYPAL_WEBHOOK_ID;
  const environment = options.environment ?? current.PAYPAL_ENVIRONMENT;
  const apiBase = (options.apiBase ?? (environment === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com")).replace(/\/+$/, "");
  const fetcher = options.fetch ?? fetch;

  async function token(): Promise<string> {
    if (!clientId || !clientSecret) throw new AdapterError("payments", "paypal_payouts", "unavailable", "PayPal is not configured.");
    const response = await paymentFetch(fetcher, `${apiBase}/v1/oauth2/token`, {
      method: "POST",
      headers: { authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    const value = text((await providerJson("paypal_payouts", response)).access_token);
    if (!value) throw new AdapterError("payments", "paypal_payouts", "authentication", "PayPal did not issue an access token.");
    return value;
  }

  async function post(path: string, body: unknown, requestId?: string): Promise<Response> {
    return paymentFetch(fetcher, `${apiBase}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json", accept: "application/json", ...(requestId ? { "paypal-request-id": requestId } : {}) },
      body: JSON.stringify(body),
    });
  }

  async function api(path: string, body: unknown): Promise<Record<string, unknown>> {
    return payoutJson("paypal_payouts", await post(path, body));
  }

  return {
    id: "paypal_payouts",
    missing: () => [!clientId ? "PAYPAL_CLIENT_ID" : undefined, !clientSecret ? "PAYPAL_CLIENT_SECRET" : undefined, !webhookId ? "PAYPAL_WEBHOOK_ID" : undefined].filter((v): v is string => Boolean(v)),
    onboarding: { kind: "form", fields: ["paypalEmail"] },
    async onboard(_seller, input) {
      const email = input.paypalEmail?.trim().toLowerCase() ?? "";
      if (!EMAIL.test(email)) throw new AdapterError("payments", "paypal_payouts", "invalid_request", "Enter the email address of your PayPal account.");
      // PayPal checks the receiver when it pays; an address it cannot pay is reported back by webhook.
      return { externalAccountId: email, status: "ready" };
    },
    async accountStatus(email) {
      return EMAIL.test(email) ? "ready" : "disabled";
    },
    async transfer(request) {
      const response = await post("/v1/payments/payouts", {
        sender_batch_header: { sender_batch_id: request.idempotencyKey, email_subject: "You have been paid", recipient_type: "EMAIL" },
        items: [
          {
            recipient_type: "EMAIL",
            amount: { value: minorToDecimal(request.amountMinor, request.currency), currency: request.currency.toUpperCase() },
            receiver: request.externalAccountId,
            note: request.description.slice(0, 4000),
            sender_item_id: request.payoutId,
          },
        ],
      }, `freeholder-payout-${request.idempotencyKey}`);
      if (!response.ok && response.status < 500) {
        // A refused duplicate sender_batch_id links to the original batch: that batch is this payout.
        const original = await response.clone().json().then(duplicateOf, () => undefined);
        if (original) return { reference: original, settled: false };
      }
      const value = await payoutJson("paypal_payouts", response);
      const reference = text(object(value.batch_header)?.payout_batch_id);
      if (!reference) throw new AdapterError("payments", "paypal_payouts", "provider_failure", "PayPal did not accept the payout.");
      return { reference, settled: false };
    },
    async reverse() {
      return { unsupported: "PayPal cannot take back a payout the seller has received; settle the refund with the seller." };
    },
    async webhook(request) {
      if (!webhookId) throw new AdapterError("payments", "paypal_payouts", "unavailable", "PayPal webhooks are not configured.");
      let event: Record<string, unknown> | undefined;
      try {
        event = object(JSON.parse(Buffer.from(request.body).toString("utf8")));
      } catch {
        event = undefined;
      }
      if (!event) throw new AdapterError("payments", "paypal_payouts", "invalid_request", "PayPal sent an invalid event.");
      const h = request.headers;
      const verified = await api("/v1/notifications/verify-webhook-signature", {
        auth_algo: h["paypal-auth-algo"],
        cert_url: h["paypal-cert-url"],
        transmission_id: h["paypal-transmission-id"],
        transmission_sig: h["paypal-transmission-sig"],
        transmission_time: h["paypal-transmission-time"],
        webhook_id: webhookId,
        webhook_event: event,
      });
      if (verified.verification_status !== "SUCCESS") throw new AdapterError("payments", "paypal_payouts", "authentication", "PayPal could not verify that event.");
      const resource = object(event.resource);
      const batch = text(resource?.payout_batch_id);
      const ours = text(object(resource?.payout_item)?.sender_item_id);
      const payoutId = ours ? { payoutId: ours } : {};
      const type = text(event.event_type) ?? "";
      const events: PayoutWebhookEvent[] = [];
      if (batch && type === "PAYMENT.PAYOUTS-ITEM.SUCCEEDED") events.push({ kind: "transfer", reference: batch, ...payoutId, state: "settled" });
      if (batch && /^PAYMENT\.PAYOUTS-ITEM\.(FAILED|RETURNED|BLOCKED|DENIED|CANCELED|UNCLAIMED)$/.test(type)) {
        events.push({ kind: "transfer", reference: batch, ...payoutId, state: "failed", error: type.split(".").at(-1)!.toLowerCase() });
      }
      return events;
    },
  };
}
