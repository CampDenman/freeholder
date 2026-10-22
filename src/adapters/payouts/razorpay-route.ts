// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.27: Razorpay Route payouts, for sites in India. A seller becomes a
// linked account with the Route product and their bank account for
// settlement; Razorpay reviews and activates it. The site's balance pays
// each due payout with a direct transfer, reversed on refund. Transfers
// carry the payout id as Razorpay's X-Transfer-Idempotency key, so a retry
// after a timeout returns the first transfer instead of paying again. Bank details
// pass straight through to Razorpay and are not stored here.
import { env } from "@/core/env";
import { AdapterError } from "../types";
import { object, paymentFetch, providerJson } from "../payments/http";
import { verifyProviderHmac } from "../payments/provider-helpers";
import type { PayoutAccountStatus, PayoutProvider, PayoutWebhookEvent } from "./types";

export interface RazorpayRouteOptions {
  keyId?: string;
  keySecret?: string;
  webhookSecrets?: string[];
  apiBase?: string;
  fetch?: typeof fetch;
}

const text = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

export function razorpayActivation(status: string | undefined): PayoutAccountStatus {
  if (status === "activated") return "ready";
  if (status === "suspended") return "disabled";
  return "pending";
}

export function createRazorpayRoute(options: RazorpayRouteOptions = {}): PayoutProvider {
  const current = env();
  const keyId = options.keyId ?? current.RAZORPAY_KEY_ID;
  const keySecret = options.keySecret ?? current.RAZORPAY_KEY_SECRET;
  const webhookSecrets = options.webhookSecrets ?? [current.RAZORPAY_WEBHOOK_SECRET, current.RAZORPAY_WEBHOOK_SECRET_PREVIOUS].filter((v): v is string => Boolean(v));
  const apiBase = (options.apiBase ?? "https://api.razorpay.com").replace(/\/+$/, "");
  const fetcher = options.fetch ?? fetch;

  async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
    if (!keyId || !keySecret) throw new AdapterError("payments", "razorpay_route", "unavailable", "Razorpay is not configured.");
    const response = await paymentFetch(fetcher, `${apiBase}${path}`, {
      method,
      headers: { authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`, ...(body ? { "content-type": "application/json" } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return providerJson("razorpay_route", response);
  }

  /** The stored id is "accountId:productId": both are needed to read activation. */
  const split = (externalAccountId: string) => {
    const [account, product] = externalAccountId.split(":");
    if (!account || !product) throw new AdapterError("payments", "razorpay_route", "invalid_request", "That Razorpay account is incomplete.");
    return { account, product };
  };

  return {
    id: "razorpay_route",
    missing: () => [!keyId ? "RAZORPAY_KEY_ID" : undefined, !keySecret ? "RAZORPAY_KEY_SECRET" : undefined, webhookSecrets.length === 0 ? "RAZORPAY_WEBHOOK_SECRET" : undefined].filter((v): v is string => Boolean(v)),
    onboarding: { kind: "form", fields: ["legalName", "phone", "street", "city", "state", "postalCode", "beneficiaryName", "accountNumber", "ifsc"] },
    async onboard(seller, input) {
      const required = ["legalName", "phone", "street", "city", "state", "postalCode", "beneficiaryName", "accountNumber", "ifsc"] as const;
      for (const field of required) if (!input[field]?.trim()) throw new AdapterError("payments", "razorpay_route", "invalid_request", "Fill in every field to set up Razorpay payouts.");
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(input.ifsc!.trim().toUpperCase())) throw new AdapterError("payments", "razorpay_route", "invalid_request", "That IFSC code is not valid.");
      const account = await api("POST", "/v2/accounts", {
        email: seller.email,
        phone: input.phone!.trim(),
        type: "route",
        reference_id: seller.userId.replaceAll("-", "").slice(0, 20),
        legal_business_name: input.legalName!.trim(),
        business_type: "individual",
        contact_name: input.legalName!.trim(),
        profile: {
          category: "others",
          subcategory: "others",
          addresses: { registered: { street1: input.street!.trim(), city: input.city!.trim(), state: input.state!.trim(), postal_code: input.postalCode!.trim(), country: "IN" } },
        },
      });
      const accountId = text(account.id);
      if (!accountId) throw new AdapterError("payments", "razorpay_route", "provider_failure", "Razorpay did not create a linked account.");
      const product = await api("POST", `/v2/accounts/${encodeURIComponent(accountId)}/products`, { product_name: "route", tnc_accepted: true });
      const productId = text(product.id);
      if (!productId) throw new AdapterError("payments", "razorpay_route", "provider_failure", "Razorpay did not add Route to the account.");
      const configured = await api("PATCH", `/v2/accounts/${encodeURIComponent(accountId)}/products/${encodeURIComponent(productId)}`, {
        settlements: { account_number: input.accountNumber!.trim(), ifsc_code: input.ifsc!.trim().toUpperCase(), beneficiary_name: input.beneficiaryName!.trim() },
        tnc_accepted: true,
      });
      return { externalAccountId: `${accountId}:${productId}`, status: razorpayActivation(text(configured.activation_status)) };
    },
    async accountStatus(externalAccountId) {
      const { account, product } = split(externalAccountId);
      return razorpayActivation(text((await api("GET", `/v2/accounts/${encodeURIComponent(account)}/products/${encodeURIComponent(product)}`)).activation_status));
    },
    async transfer(request) {
      const { account } = split(request.externalAccountId);
      const value = await api("POST", "/v1/transfers", {
        account,
        amount: request.amountMinor,
        currency: request.currency.toUpperCase(),
        notes: { freeholder_payout_id: request.idempotencyKey, description: request.description.slice(0, 250) },
      }, { "x-transfer-idempotency": request.idempotencyKey });
      const reference = text(value.id);
      if (!reference) throw new AdapterError("payments", "razorpay_route", "provider_failure", "Razorpay did not return a transfer.");
      return { reference, settled: text(value.status) === "processed" };
    },
    async reverse(request) {
      const value = await api("POST", `/v1/transfers/${encodeURIComponent(request.reference)}/reversals`, { amount: request.amountMinor, notes: { freeholder_payout_id: request.idempotencyKey } });
      const reference = text(value.id);
      if (!reference) throw new AdapterError("payments", "razorpay_route", "provider_failure", "Razorpay did not return a reversal.");
      return { reference };
    },
    async webhook(request) {
      if (webhookSecrets.length === 0) throw new AdapterError("payments", "razorpay_route", "unavailable", "Razorpay webhooks are not configured.");
      verifyProviderHmac({ provider: "Razorpay", algorithm: "sha256", secrets: webhookSecrets, signed: request.body, signature: request.headers["x-razorpay-signature"], encoding: "hex" });
      let event: Record<string, unknown> | undefined;
      try {
        event = object(JSON.parse(Buffer.from(request.body).toString("utf8")));
      } catch {
        event = undefined;
      }
      if (!event) throw new AdapterError("payments", "razorpay_route", "invalid_request", "Razorpay sent an invalid event.");
      const payload = object(event.payload);
      const type = text(event.event) ?? "";
      const events: PayoutWebhookEvent[] = [];
      const transfer = object(object(payload?.transfer)?.entity);
      if (transfer && text(transfer.id)) {
        const ours = text(object(transfer.notes)?.freeholder_payout_id);
        const payoutId = ours ? { payoutId: ours } : {};
        if (type === "transfer.processed") events.push({ kind: "transfer", reference: text(transfer.id)!, ...payoutId, state: "settled" });
        if (type === "transfer.failed") events.push({ kind: "transfer", reference: text(transfer.id)!, ...payoutId, state: "failed", error: "failed" });
      }
      const product = object(object(payload?.merchant_product)?.entity);
      const accountId = text(object(object(payload?.account)?.entity)?.id) ?? text(product?.merchant_id);
      if (type.startsWith("product.route.") && accountId && text(product?.id)) {
        events.push({ kind: "account", externalAccountId: `${accountId}:${text(product!.id)!}`, status: razorpayActivation(text(product!.activation_status) ?? type.slice("product.route.".length)) });
      }
      return events;
    },
  };
}
