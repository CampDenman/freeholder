// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.26: Stripe Connect payouts. Sellers get an Express account and finish
// Stripe's own hosted onboarding, so Stripe — not this site — verifies who
// they are. The site's balance pays each seller with a Transfer (separate
// charges and transfers), reversed on refund. Connect webhooks report when
// an account can be paid.
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/core/env";
import { AdapterError } from "../types";
import { object, paymentFetch } from "../payments/http";
import { payoutJson } from "./http";
import type { PayoutAccountStatus, PayoutProvider } from "./types";

export interface StripeConnectOptions {
  secretKey?: string;
  webhookSecrets?: string[];
  apiBase?: string;
  fetch?: typeof fetch;
  toleranceSeconds?: number;
}

const text = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Ready only when Stripe will accept transfers to the account and pay it out. */
export function stripeAccountStatus(account: Record<string, unknown>): PayoutAccountStatus {
  const requirements = object(account.requirements);
  const disabled = text(requirements?.disabled_reason);
  if (disabled?.startsWith("rejected")) return "disabled";
  const transfers = text(object(account.capabilities)?.transfers);
  return account.payouts_enabled === true && transfers === "active" ? "ready" : "pending";
}

export function createStripeConnect(options: StripeConnectOptions = {}): PayoutProvider {
  const current = env();
  const secretKey = options.secretKey ?? current.STRIPE_SECRET_KEY;
  const webhookSecrets = options.webhookSecrets ?? [current.STRIPE_CONNECT_WEBHOOK_SECRET].filter((v): v is string => Boolean(v));
  const apiBase = (options.apiBase ?? "https://api.stripe.com").replace(/\/+$/, "");
  const fetcher = options.fetch ?? fetch;
  const tolerance = options.toleranceSeconds ?? 300;

  async function api(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<Record<string, unknown>> {
    if (!secretKey) throw new AdapterError("payments", "stripe_connect", "unavailable", "Stripe is not configured.");
    const { idempotencyKey, ...rest } = init;
    const response = await paymentFetch(fetcher, `${apiBase}${path}`, {
      ...rest,
      headers: {
        authorization: `Bearer ${secretKey}`,
        "stripe-version": "2026-02-25.clover",
        ...(rest.body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        ...rest.headers,
      },
    });
    return payoutJson("stripe_connect", response);
  }

  return {
    id: "stripe_connect",
    missing: () => [!secretKey ? "STRIPE_SECRET_KEY" : undefined, webhookSecrets.length === 0 ? "STRIPE_CONNECT_WEBHOOK_SECRET" : undefined].filter((v): v is string => Boolean(v)),
    onboarding: { kind: "hosted" },
    async onboard(seller, _input, urls, existing) {
      let accountId = existing ?? undefined;
      if (!accountId) {
        const account = await api("/v1/accounts", {
          method: "POST",
          idempotencyKey: `freeholder-account-${seller.userId}`,
          body: new URLSearchParams({
            type: "express",
            email: seller.email,
            "capabilities[transfers][requested]": "true",
            "business_profile[name]": seller.displayName.slice(0, 100),
            "metadata[freeholder_user_id]": seller.userId,
          }),
        });
        accountId = text(account.id);
        if (!accountId) throw new AdapterError("payments", "stripe_connect", "provider_failure", "Stripe did not create an account.");
      }
      const link = await api("/v1/account_links", {
        method: "POST",
        body: new URLSearchParams({ account: accountId, refresh_url: urls.refreshUrl, return_url: urls.returnUrl, type: "account_onboarding" }),
      });
      const url = text(link.url);
      if (!url) throw new AdapterError("payments", "stripe_connect", "provider_failure", "Stripe did not return an onboarding link.");
      return { externalAccountId: accountId, url, status: "pending" };
    },
    async accountStatus(accountId) {
      return stripeAccountStatus(await api(`/v1/accounts/${encodeURIComponent(accountId)}`, { method: "GET" }));
    },
    async transfer(request) {
      const value = await api("/v1/transfers", {
        method: "POST",
        idempotencyKey: `freeholder-payout-${request.idempotencyKey}`,
        body: new URLSearchParams({
          amount: String(request.amountMinor),
          currency: request.currency.toLowerCase(),
          destination: request.externalAccountId,
          description: request.description.slice(0, 250),
          transfer_group: `freeholder-payout-${request.idempotencyKey}`,
          "metadata[freeholder_payout_id]": request.payoutId,
        }),
      });
      const reference = text(value.id);
      if (!reference) throw new AdapterError("payments", "stripe_connect", "provider_failure", "Stripe did not return a transfer.");
      // A transfer lands in the connected account's balance at once.
      return { reference, settled: true };
    },
    async reverse(request) {
      const value = await api(`/v1/transfers/${encodeURIComponent(request.reference)}/reversals`, {
        method: "POST",
        idempotencyKey: `freeholder-reversal-${request.idempotencyKey}`,
        body: new URLSearchParams({ amount: String(request.amountMinor), "metadata[freeholder_payout_id]": request.payoutId }),
      });
      const reference = text(value.id);
      if (!reference) throw new AdapterError("payments", "stripe_connect", "provider_failure", "Stripe did not return a reversal.");
      return { reference };
    },
    async webhook(request) {
      if (webhookSecrets.length === 0) throw new AdapterError("payments", "stripe_connect", "unavailable", "Stripe Connect webhooks are not configured.");
      const header = request.headers["stripe-signature"];
      if (!header) throw new AdapterError("payments", "stripe_connect", "authentication", "Stripe signature is missing.");
      const parts = header.split(",").map((p) => p.trim().split("=", 2));
      const timestamp = Number(parts.find(([k]) => k === "t")?.[1]);
      const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v).filter((v): v is string => Boolean(v));
      const received = Date.parse(request.receivedAt);
      if (!Number.isSafeInteger(timestamp) || !Number.isFinite(received) || Math.abs(received / 1000 - timestamp) > tolerance) {
        throw new AdapterError("payments", "stripe_connect", "authentication", "Stripe signature timestamp is outside the accepted window.");
      }
      const signed = Buffer.concat([Buffer.from(`${timestamp}.`), Buffer.from(request.body)]);
      const valid = webhookSecrets.some((secret) => {
        const expected = createHmac("sha256", secret).update(signed).digest();
        return signatures.some((s) => /^[0-9a-f]{64}$/i.test(s) && timingSafeEqual(Buffer.from(s, "hex"), expected));
      });
      if (!valid) throw new AdapterError("payments", "stripe_connect", "authentication", "Stripe signature is invalid.");
      let event: Record<string, unknown> | undefined;
      try {
        event = object(JSON.parse(Buffer.from(request.body).toString("utf8")));
      } catch {
        event = undefined;
      }
      if (!event) throw new AdapterError("payments", "stripe_connect", "invalid_request", "Stripe sent an invalid event.");
      const data = object(object(event.data)?.object);
      if (event.type === "account.updated" && data && text(data.id)) {
        return [{ kind: "account", externalAccountId: text(data.id)!, status: stripeAccountStatus(data) }];
      }
      return [];
    },
  };
}
