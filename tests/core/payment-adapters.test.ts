// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.06 provider contract, wire format, and hostile signature proof.

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AdapterError } from "@/adapters/types";
import { decimalToMinor, minorToDecimal } from "@/adapters/payments/currency";
import { createManualPayments } from "@/adapters/payments/manual";
import { createPayPalPayments } from "@/adapters/payments/paypal";
import { createStripePayments } from "@/adapters/payments/stripe";
import { paymentWebhookRoute } from "@/modules/invoicing/payment-webhook-route";

const invoice = {
  invoiceId: "10000000-0000-4000-8000-000000000001",
  invoiceNumber: "INV-000001",
  contactId: "20000000-0000-4000-8000-000000000002",
  currency: "CAD",
  amountMinor: 12_345,
  description: "Invoice INV-000001",
  customer: { email: "buyer@example.test", name: "Ada Buyer" },
  successUrl: "https://shop.example.test/pay/success",
  cancelUrl: "https://shop.example.test/pay/cancel",
  idempotencyKey: "checkout-1",
  saveMethod: true,
};

function bytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(Buffer.from(value, "utf8"));
}

function requestUrl(input: string | URL | Request): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function bodyText(body: BodyInit | null | undefined): string {
  if (body === null || body === undefined) return "";
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  throw new Error("test expected a textual request body");
}

describe("payment currency boundaries", () => {
  it("formats zero, two, three, and four decimal currencies without floating point", () => {
    expect(minorToDecimal(123, "JPY")).toBe("123");
    expect(minorToDecimal(123, "CAD")).toBe("1.23");
    expect(minorToDecimal(123, "KWD")).toBe("0.123");
    expect(minorToDecimal(123, "CLF")).toBe("0.0123");
    expect(decimalToMinor("1.23", "CAD")).toBe(123);
    expect(decimalToMinor("12", "JPY")).toBe(12);
    expect(() => decimalToMinor("1.234", "CAD")).toThrow(AdapterError);
    expect(() => minorToDecimal(1.5, "CAD")).toThrow(AdapterError);
  });
});

describe("manual payment adapter", () => {
  it("offers offline methods but refuses to fabricate a hosted checkout", async () => {
    const adapter = createManualPayments();
    expect(adapter.status.available).toBe(true);
    expect((await adapter.supportedMethods({ country: "CA", currency: "CAD", recurring: false })).map((method) => method.id)).toEqual([
      "cash", "bank_transfer", "cheque", "external_card", "other",
    ]);
    await expect(adapter.createCheckout(invoice)).rejects.toMatchObject({ code: "invalid_request" });
  });
});

describe("Stripe payment adapter", () => {
  it("creates idempotent Checkout requests and provider refunds without exposing secrets", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input);
      calls.push({ url, init });
      if (url.endsWith("/v1/checkout/sessions")) {
        return Response.json({ id: "cs_test_1", payment_intent: "pi_test_1", url: "https://checkout.stripe.test/session", expires_at: 1_800_000_000 });
      }
      if (url.endsWith("/v1/refunds")) return Response.json({ id: "re_test_1", status: "pending" });
      if (url.endsWith("/detach")) return Response.json({ id: "pm_test_1" });
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const adapter = createStripePayments({
      secretKey: "sk_test_private",
      webhookSecrets: ["whsec_current"],
      apiBase: "https://stripe.example.test",
      fetch: fetcher,
    });

    const checkout = await adapter.createCheckout({ ...invoice, methodIds: ["card"] });
    expect(checkout).toMatchObject({ providerRef: "cs_test_1", paymentRef: "pi_test_1" });
    const checkoutCall = calls[0]!;
    expect(checkoutCall.init?.headers).toMatchObject({ "idempotency-key": "checkout-1", "stripe-version": "2026-02-25.clover" });
    const form = new URLSearchParams(bodyText(checkoutCall.init?.body));
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("12345");
    expect(form.get("metadata[freeholder_invoice_id]")).toBe(invoice.invoiceId);
    expect(form.get("payment_intent_data[setup_future_usage]")).toBe("off_session");
    expect(adapter.capabilities()).toMatchObject({ subscriptions: false, payouts: false });
    expect(calls.map((call) => bodyText(call.init?.body)).join("\n")).not.toContain("sk_test_private");

    await expect(adapter.refund({ paymentId: "local", providerRef: "pi_test_1", currency: "CAD", amountMinor: 345, reason: "Returned", idempotencyKey: "refund-1" })).resolves.toEqual({ providerRef: "re_test_1", status: "pending" });
    await expect(adapter.revokeSavedMethod({ providerRef: "pm_test_1", idempotencyKey: "revoke-1" })).resolves.toBeUndefined();
  });

  it("accepts rotating signatures, maps settlement evidence, and refuses stale or forged bodies", async () => {
    const adapter = createStripePayments({ secretKey: "sk_test", webhookSecrets: ["old-secret", "new-secret"], toleranceSeconds: 300 });
    const payload = JSON.stringify({
      id: "evt_1",
      type: "payment_intent.succeeded",
      created: 1_700_000_000,
      data: { object: { id: "pi_1", amount_received: 1500, currency: "cad", customer: "cus_1", metadata: { freeholder_invoice_id: invoice.invoiceId, freeholder_contact_id: invoice.contactId } } },
    });
    const timestamp = 1_700_000_100;
    const signature = createHmac("sha256", "new-secret").update(`${timestamp}.${payload}`).digest("hex");
    const request = {
      headers: { "stripe-signature": `t=${timestamp},v1=${"0".repeat(64)},v1=${signature}` },
      body: bytes(payload),
      receivedAt: new Date(timestamp * 1_000).toISOString(),
    };
    await expect(adapter.verifyWebhook(request)).resolves.toEqual([
      expect.objectContaining({ id: "evt_1", kind: "payment_succeeded", providerRef: "pi_1", amountMinor: 1500, currency: "CAD", invoiceId: invoice.invoiceId }),
    ]);
    await expect(adapter.verifyWebhook({ ...request, receivedAt: new Date((timestamp + 301) * 1_000).toISOString() })).rejects.toMatchObject({ code: "authentication" });
    await expect(adapter.verifyWebhook({ ...request, body: bytes(`${payload} `) })).rejects.toMatchObject({ code: "authentication" });
  });

  it("normalizes disputes and masked saved methods", async () => {
    const secret = "whsec_test";
    const adapter = createStripePayments({ secretKey: "sk_test", webhookSecrets: [secret] });
    const at = Math.floor(Date.now() / 1_000);
    const disputePayload = { id: "evt_dispute", type: "charge.dispute.created", created: at, data: { object: { id: "dp_1", payment_intent: "pi_1", amount: 500, currency: "cad", status: "needs_response", reason: "fraudulent", evidence_details: { due_by: at + 86400 } } } };
    const disputeRaw = JSON.stringify(disputePayload);
    const disputeSignature = createHmac("sha256", secret).update(`${at}.${disputeRaw}`).digest("hex");
    const disputeEvents = await adapter.verifyWebhook({ headers: { "stripe-signature": `t=${at},v1=${disputeSignature}` }, body: bytes(disputeRaw), receivedAt: new Date(at * 1_000).toISOString() });
    expect(disputeEvents[0]).toMatchObject({ kind: "dispute_opened", providerRef: "dp_1", paymentProviderRef: "pi_1" });

    const methodPayload = { id: "evt_method", type: "payment_method.attached", created: at, data: { object: { id: "pm_1", type: "card", customer: "cus_1", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } } } };
    const methodRaw = JSON.stringify(methodPayload);
    const methodSignature = createHmac("sha256", secret).update(`${at}.${methodRaw}`).digest("hex");
    const methodEvents = await adapter.verifyWebhook({ headers: { "stripe-signature": `t=${at},v1=${methodSignature}` }, body: bytes(methodRaw), receivedAt: new Date(at * 1_000).toISOString() });
    expect(methodEvents[0]?.kind).toBe("saved_method_added");
    if (methodEvents[0]?.kind === "saved_method_added") {
      expect(methodEvents[0].method).toMatchObject({ providerRef: "pm_1", last4: "4242" });
    }
  });
});

describe("PayPal payment adapter", () => {
  it("uses OAuth, exact minor-unit formatting, idempotent Orders/Capture, and refunds", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input);
      calls.push({ url, init });
      if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "access-private" });
      if (url.endsWith("/v2/checkout/orders")) return Response.json({ id: "ORDER-1", links: [{ rel: "approve", href: "https://paypal.test/approve" }] });
      if (url.endsWith("/capture")) return Response.json({ purchase_units: [{ payments: { captures: [{ id: "CAPTURE-1", status: "COMPLETED", amount: { currency_code: "CAD", value: "123.45" }, update_time: "2026-08-14T12:00:00Z" }] } }] });
      if (url.includes("/refund")) return Response.json({ id: "REFUND-1", status: "PENDING" });
      if (url.includes("/v3/vault/payment-tokens/")) return new Response(null, { status: 204 });
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const adapter = createPayPalPayments({ clientId: "client-private", clientSecret: "secret-private", webhookId: "WH-1", environment: "sandbox", apiBase: "https://paypal.example.test", fetch: fetcher });
    await expect(adapter.createCheckout(invoice)).resolves.toMatchObject({ providerRef: "ORDER-1", url: "https://paypal.test/approve" });
    const order = calls.find((call) => call.url.endsWith("/v2/checkout/orders"))!;
    const body: unknown = JSON.parse(bodyText(order.init?.body));
    expect(body).toMatchObject({
      purchase_units: [{ amount: { currency_code: "CAD", value: "123.45" } }],
      payment_source: { paypal: { attributes: { vault: { store_in_vault: "ON_SUCCESS" } } } },
    });
    expect(order.init?.headers).toMatchObject({ "paypal-request-id": "checkout-1" });
    await expect(adapter.captureCheckout({ checkoutRef: "ORDER-1", idempotencyKey: "capture-1" })).resolves.toMatchObject({ providerRef: "CAPTURE-1", status: "succeeded", amountMinor: 12_345 });
    await expect(adapter.refund({ paymentId: "local", providerRef: "CAPTURE-1", currency: "CAD", amountMinor: 345, idempotencyKey: "refund-1" })).resolves.toEqual({ providerRef: "REFUND-1", status: "pending" });
    await expect(adapter.revokeSavedMethod({ providerRef: "TOKEN-1", idempotencyKey: "revoke-1" })).resolves.toBeUndefined();
    const requestBodies = calls.map((call) => bodyText(call.init?.body)).join("\n");
    expect(requestBodies).not.toContain("access-private");
    expect(requestBodies).not.toContain("secret-private");
  });

  it("posts the exact event and signature headers to PayPal verification before mapping it", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input);
      calls.push({ url, init });
      if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "token" });
      if (url.endsWith("/verify-webhook-signature")) return Response.json({ verification_status: "SUCCESS" });
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const adapter = createPayPalPayments({ clientId: "client", clientSecret: "secret", webhookId: "WH-1", apiBase: "https://paypal.example.test", fetch: fetcher });
    const payload = {
      id: "WH-EVT-1",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      create_time: "2026-08-14T12:00:00Z",
      resource: {
        id: "CAPTURE-1",
        custom_id: invoice.invoiceId,
        amount: { currency_code: "CAD", value: "123.45" },
        supplementary_data: { related_ids: { order_id: "ORDER-1" } },
        payment_source: { paypal: { attributes: { vault: { id: "TOKEN-1" } } } },
        customer: { id: "CUSTOMER-1" },
      },
    };
    const headers = {
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-cert-url": "https://api.paypal.com/cert.pem",
      "paypal-transmission-id": "tx-1",
      "paypal-transmission-sig": "signature",
      "paypal-transmission-time": "2026-08-14T12:00:01Z",
    };
    const verifiedEvents = await adapter.verifyWebhook({ headers, body: bytes(JSON.stringify(payload)), receivedAt: "2026-08-14T12:00:02Z" });
    expect(verifiedEvents[0]).toMatchObject({ kind: "payment_succeeded", providerRef: "CAPTURE-1", checkoutRef: "ORDER-1", invoiceId: invoice.invoiceId, amountMinor: 12_345 });
    if (verifiedEvents[0]?.kind === "payment_succeeded") expect(verifiedEvents[0].savedMethod).toMatchObject({ providerRef: "TOKEN-1" });
    const verification = calls.find((call) => call.url.endsWith("/verify-webhook-signature"))!;
    const verificationBody: unknown = JSON.parse(bodyText(verification.init?.body));
    expect(verificationBody).toMatchObject({ auth_algo: headers["paypal-auth-algo"], webhook_id: "WH-1", webhook_event: payload });

    const rejecting = createPayPalPayments({
      clientId: "client",
      clientSecret: "secret",
      webhookId: "WH-1",
      apiBase: "https://paypal.example.test",
      fetch: async (input: string | URL | Request) => requestUrl(input).endsWith("/oauth2/token") ? Response.json({ access_token: "token" }) : Response.json({ verification_status: "FAILURE" }),
    });
    await expect(rejecting.verifyWebhook({ headers, body: bytes(JSON.stringify(payload)), receivedAt: "2026-08-14T12:00:02Z" })).rejects.toMatchObject({ code: "authentication" });
  });
});

describe("payment webhook boundary", () => {
  it("rejects announced and actual bodies over one MiB before provider verification", async () => {
    const route = paymentWebhookRoute("stripe");
    const announced = await route(new Request("https://shop.example.test/api/payments/webhooks/stripe", {
      method: "POST",
      headers: { "content-length": "1048577" },
      body: "{}",
    }));
    expect(announced.status).toBe(413);

    const actual = await route(new Request("https://shop.example.test/api/payments/webhooks/stripe", {
      method: "POST",
      body: new Uint8Array(1_048_577),
    }));
    expect(actual.status).toBe(413);
  });
});
