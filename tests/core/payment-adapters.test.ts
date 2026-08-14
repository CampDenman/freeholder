// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.06-C5.07 provider contract, wire format, and hostile signature proof.

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AdapterError } from "@/adapters/types";
import { decimalToMinor, minorToDecimal } from "@/adapters/payments/currency";
import { createFlutterwavePayments } from "@/adapters/payments/flutterwave";
import { createManualPayments } from "@/adapters/payments/manual";
import { createMolliePayments } from "@/adapters/payments/mollie";
import { createPayPalPayments } from "@/adapters/payments/paypal";
import { createPaystackPayments } from "@/adapters/payments/paystack";
import { HOSTED_PAYMENT_PROVIDER_IDS } from "@/adapters/payments/providers";
import { createRazorpayPayments } from "@/adapters/payments/razorpay";
import { createSquarePayments } from "@/adapters/payments/square";
import { createStripePayments } from "@/adapters/payments/stripe";
import { paymentAdapters } from "@/adapters/payments";
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

    const payoutPayload = { id: "evt_payout", type: "payout.paid", created: at, data: { object: { id: "po_1", amount: 9_200, currency: "cad", status: "paid", arrival_date: at + 86_400, statement_descriptor: "FREEHOLDER" } } };
    const payoutRaw = JSON.stringify(payoutPayload);
    const payoutSignature = createHmac("sha256", secret).update(`${at}.${payoutRaw}`).digest("hex");
    await expect(adapter.verifyWebhook({ headers: { "stripe-signature": `t=${at},v1=${payoutSignature}` }, body: bytes(payoutRaw), receivedAt: new Date(at * 1_000).toISOString() })).resolves.toEqual([
      expect.objectContaining({ kind: "payout_paid", providerRef: "po_1", amountMinor: 9_200, currency: "CAD", statementRef: "FREEHOLDER" }),
    ]);
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

describe("C5.07 payment-provider contract", () => {
  it("registers every hosted provider once and advertises no payout or in-person behavior", () => {
    const ids = paymentAdapters.list().map((adapter) => adapter.id);
    expect(ids).toEqual(["none", "manual", ...HOSTED_PAYMENT_PROVIDER_IDS].sort());
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of HOSTED_PAYMENT_PROVIDER_IDS) {
      expect(paymentAdapters.get(id).capabilities()).toMatchObject({ payouts: false, inPerson: false });
    }
  });
});

describe("Square payment adapter", () => {
  it("uses idempotent Payment Links, order rechecks, refunds, and exact URL-plus-body signatures", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input);
      calls.push({ url, init });
      if (url.endsWith("/v2/online-checkout/payment-links")) {
        return Response.json({ payment_link: { id: "LINK-1", order_id: "ORDER-1", url: "https://square.test/link" } });
      }
      if (url.endsWith("/v2/orders/ORDER-1")) {
        return Response.json({ order: { id: "ORDER-1", state: "COMPLETED", total_money: { amount: 12_345, currency: "CAD" }, tenders: [{ payment_id: "PAYMENT-1" }], updated_at: "2026-08-14T12:00:00Z" } });
      }
      if (url.endsWith("/v2/refunds")) return Response.json({ refund: { id: "REFUND-1", status: "PENDING" } });
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const notificationUrl = "https://shop.example.test/api/payments/webhooks/square";
    const adapter = createSquarePayments({
      accessToken: "square-private",
      locationId: "LOCATION-1",
      webhookSignatureKeys: ["old-square", "new-square"],
      apiBase: "https://square.example.test",
      notificationUrl,
      fetch: fetcher,
    });

    await expect(adapter.createCheckout(invoice)).resolves.toMatchObject({ providerRef: "ORDER-1", url: "https://square.test/link" });
    const create = calls[0]!;
    expect(create.init?.headers).toMatchObject({ "square-version": "2026-07-15" });
    expect(JSON.parse(bodyText(create.init?.body))).toMatchObject({
      idempotency_key: "checkout-1",
      quick_pay: { price_money: { amount: 12_345, currency: "CAD" }, location_id: "LOCATION-1" },
      payment_note: `freeholder:${invoice.invoiceId}:${invoice.contactId}`,
    });
    await expect(adapter.captureCheckout({ checkoutRef: "ORDER-1", idempotencyKey: "capture-1" })).resolves.toMatchObject({ providerRef: "PAYMENT-1", status: "succeeded", amountMinor: 12_345 });
    await expect(adapter.refund({ paymentId: "local", providerRef: "PAYMENT-1", currency: "CAD", amountMinor: 345, reason: "Returned", idempotencyKey: "refund-1" })).resolves.toEqual({ providerRef: "REFUND-1", status: "pending" });

    const payload = JSON.stringify({
      event_id: "square-event-1",
      type: "payment.updated",
      created_at: "2026-08-14T12:00:00Z",
      data: { object: { payment: { id: "PAYMENT-1", order_id: "ORDER-1", status: "COMPLETED", amount_money: { amount: 12_345, currency: "CAD" }, note: `freeholder:${invoice.invoiceId}:${invoice.contactId}`, updated_at: "2026-08-14T12:00:00Z" } } },
    });
    const signature = createHmac("sha256", "new-square").update(`${notificationUrl}${payload}`).digest("base64");
    const request = { headers: { "x-square-hmacsha256-signature": signature }, body: bytes(payload), receivedAt: "2026-08-14T12:00:01Z" };
    await expect(adapter.verifyWebhook(request)).resolves.toEqual([
      expect.objectContaining({ id: "square-event-1", kind: "payment_succeeded", providerRef: "PAYMENT-1", checkoutRef: "ORDER-1", invoiceId: invoice.invoiceId }),
    ]);
    const refundPayload = JSON.stringify({
      event_id: "square-refund-1",
      type: "refund.updated",
      created_at: "2026-08-14T12:01:00Z",
      data: { object: { refund: { id: "REFUND-1", payment_id: "PAYMENT-1", status: "PENDING", amount_money: { amount: 345, currency: "CAD" }, updated_at: "2026-08-14T12:01:00Z" } } },
    });
    const refundSignature = createHmac("sha256", "new-square").update(`${notificationUrl}${refundPayload}`).digest("base64");
    await expect(adapter.verifyWebhook({ headers: { "x-square-hmacsha256-signature": refundSignature }, body: bytes(refundPayload), receivedAt: "2026-08-14T12:01:01Z" })).resolves.toEqual([
      expect.objectContaining({ id: "square-refund-1", kind: "refund_processing", providerRef: "REFUND-1", paymentProviderRef: "PAYMENT-1", amountMinor: 345 }),
    ]);
    const payoutPayload = JSON.stringify({
      event_id: "square-payout-1",
      type: "payout.paid",
      created_at: "2026-08-15T12:00:00Z",
      data: { object: { payout: { id: "PAYOUT-1", status: "PAID", amount_money: { amount: 12_000, currency: "CAD" }, arrival_date: "2026-08-16", updated_at: "2026-08-15T12:00:00Z" } } },
    });
    const payoutSignature = createHmac("sha256", "new-square").update(`${notificationUrl}${payoutPayload}`).digest("base64");
    await expect(adapter.verifyWebhook({ headers: { "x-square-hmacsha256-signature": payoutSignature }, body: bytes(payoutPayload), receivedAt: "2026-08-15T12:00:01Z" })).resolves.toEqual([
      expect.objectContaining({ id: "square-payout-1", kind: "payout_paid", providerRef: "PAYOUT-1", amountMinor: 12_000, currency: "CAD" }),
    ]);
    await expect(adapter.verifyWebhook({ ...request, body: bytes(`${payload} `) })).rejects.toMatchObject({ code: "authentication" });
  });
});

describe("Mollie payment adapter", () => {
  it("creates decimal checkouts and authenticates classic callbacks by fetching private API state", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const paid = {
      id: "tr_payment1",
      status: "paid",
      amount: { currency: "CAD", value: "123.45" },
      paidAt: "2026-08-14T12:00:00Z",
      metadata: { freeholder_invoice_id: invoice.invoiceId, freeholder_contact_id: invoice.contactId },
      _embedded: { refunds: [{ id: "re_mollie1", status: "processing", amount: { currency: "CAD", value: "3.45" }, createdAt: "2026-08-14T12:01:00Z" }] },
    };
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input);
      calls.push({ url, init });
      if (url.endsWith("/v2/payments") && init?.method === "POST") return Response.json({ id: "tr_payment1", _links: { checkout: { href: "https://mollie.test/checkout" } } });
      if (url.includes("/v2/payments/tr_payment1?embed=refunds")) return Response.json(paid);
      if (url.endsWith("/v2/payments/tr_payment1")) return Response.json(paid);
      if (url.endsWith("/v2/payments/tr_payment1/refunds")) return Response.json({ id: "re_mollie1", status: "processing" });
      return new Response("unknown payment", { status: 404 });
    }) as typeof fetch;
    const adapter = createMolliePayments({ apiKey: "test_private", webhookSecrets: ["mollie-hook"], apiBase: "https://mollie.example.test", webhookUrl: "https://shop.example.test/api/payments/webhooks/mollie", fetch: fetcher });

    await expect(adapter.createCheckout(invoice)).resolves.toMatchObject({ providerRef: "tr_payment1", url: "https://mollie.test/checkout" });
    const created: unknown = JSON.parse(bodyText(calls[0]?.init?.body));
    expect(created).toMatchObject({ amount: { currency: "CAD", value: "123.45" }, webhookUrl: "https://shop.example.test/api/payments/webhooks/mollie" });
    await expect(adapter.captureCheckout({ checkoutRef: "tr_payment1", idempotencyKey: "capture-1" })).resolves.toMatchObject({ status: "succeeded", amountMinor: 12_345 });
    await expect(adapter.refund({ paymentId: "local", providerRef: "tr_payment1", currency: "CAD", amountMinor: 345, idempotencyKey: "refund-1" })).resolves.toEqual({ providerRef: "re_mollie1", status: "pending" });

    const events = await adapter.verifyWebhook({ headers: { "content-type": "application/x-www-form-urlencoded" }, body: bytes("id=tr_payment1"), receivedAt: "2026-08-14T12:02:00Z" });
    expect(events).toEqual([
      expect.objectContaining({ kind: "payment_succeeded", providerRef: "tr_payment1", amountMinor: 12_345, invoiceId: invoice.invoiceId }),
      expect.objectContaining({ kind: "refund_processing", providerRef: "re_mollie1", paymentProviderRef: "tr_payment1", amountMinor: 345 }),
    ]);
    const signedPayload = JSON.stringify({ resource: "payment", id: "tr_payment1" });
    const signed = createHmac("sha256", "mollie-hook").update(signedPayload).digest("hex");
    await expect(adapter.verifyWebhook({ headers: { "x-mollie-signature": `sha256=${signed}` }, body: bytes(signedPayload), receivedAt: "2026-08-14T12:02:00Z" })).resolves.toEqual(events);
    await expect(adapter.verifyWebhook({ headers: {}, body: bytes("id=tr_forged"), receivedAt: "2026-08-14T12:02:00Z" })).rejects.toBeInstanceOf(AdapterError);
    expect(calls.find((call) => call.url.includes("tr_payment1?embed=refunds"))?.init?.headers).toMatchObject({ authorization: "Bearer test_private" });
  });
});

describe("Razorpay payment adapter", () => {
  it("recovers unique-reference links and verifies payment/refund/dispute events", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input);
      calls.push({ url, init });
      if (url.includes("/v1/payment_links?reference_id=")) return Response.json({ payment_links: [] });
      if (url.endsWith("/v1/payment_links") && init?.method === "POST") return Response.json({ id: "plink_1", short_url: "https://rzp.test/link", status: "created", created_at: 1_777_000_000 });
      if (url.endsWith("/v1/payment_links/plink_1")) return Response.json({ id: "plink_1", status: "paid", amount: 12_345, amount_paid: 12_345, currency: "CAD", payments: [{ payment_id: "pay_1", status: "captured" }], updated_at: 1_777_000_100 });
      if (url.endsWith("/v1/payments/pay_1/refund")) return Response.json({ id: "rfnd_1", status: "pending" });
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const adapter = createRazorpayPayments({ keyId: "rzp-id", keySecret: "rzp-secret", webhookSecrets: ["rzp-hook"], apiBase: "https://razorpay.example.test", fetch: fetcher });
    await expect(adapter.createCheckout(invoice)).resolves.toMatchObject({ providerRef: "plink_1", url: "https://rzp.test/link" });
    expect(calls[0]?.url).toContain("reference_id=fh_");
    await expect(adapter.captureCheckout({ checkoutRef: "plink_1", idempotencyKey: "capture-1" })).resolves.toMatchObject({ providerRef: "pay_1", status: "succeeded", amountMinor: 12_345 });
    await expect(adapter.refund({ paymentId: "local", providerRef: "pay_1", currency: "CAD", amountMinor: 345, idempotencyKey: "refund-1" })).resolves.toEqual({ providerRef: "rfnd_1", status: "pending" });

    const payload = JSON.stringify({
      event: "payment_link.paid",
      created_at: 1_777_000_100,
      payload: {
        payment: { entity: { id: "pay_1", status: "captured", amount: 12_345, currency: "CAD", created_at: 1_777_000_100 } },
        payment_link: { entity: { id: "plink_1", status: "paid", amount_paid: 12_345, currency: "CAD", updated_at: 1_777_000_100, notes: { freeholder_invoice_id: invoice.invoiceId, freeholder_contact_id: invoice.contactId } } },
      },
    });
    const signature = createHmac("sha256", "rzp-hook").update(payload).digest("hex");
    const request = { headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": "rzp-event-1" }, body: bytes(payload), receivedAt: "2026-08-14T12:00:00Z" };
    await expect(adapter.verifyWebhook(request)).resolves.toEqual([
      expect.objectContaining({ id: "rzp-event-1", kind: "payment_succeeded", providerRef: "pay_1", checkoutRef: "plink_1", invoiceId: invoice.invoiceId }),
    ]);
    const refundPayload = JSON.stringify({ event: "refund.processed", created_at: 1_777_000_200, payload: { refund: { entity: { id: "rfnd_1", payment_id: "pay_1", status: "processed", amount: 345, currency: "CAD", created_at: 1_777_000_200 } } } });
    const refundSignature = createHmac("sha256", "rzp-hook").update(refundPayload).digest("hex");
    await expect(adapter.verifyWebhook({ headers: { "x-razorpay-signature": refundSignature, "x-razorpay-event-id": "rzp-refund-event" }, body: bytes(refundPayload), receivedAt: "2026-08-14T12:00:00Z" })).resolves.toEqual([
      expect.objectContaining({ kind: "refund_succeeded", providerRef: "rfnd_1", paymentProviderRef: "pay_1", amountMinor: 345 }),
    ]);
    const disputePayload = JSON.stringify({ event: "payment.dispute.created", created_at: 1_777_000_300, payload: { payment: { entity: { id: "pay_1" } }, dispute: { entity: { id: "disp_1", payment_id: "pay_1", status: "open", amount: 500, currency: "CAD", reason_code: "not_received", respond_by: 1_777_086_700, created_at: 1_777_000_300 } } } });
    const disputeSignature = createHmac("sha256", "rzp-hook").update(disputePayload).digest("hex");
    await expect(adapter.verifyWebhook({ headers: { "x-razorpay-signature": disputeSignature, "x-razorpay-event-id": "rzp-dispute-event" }, body: bytes(disputePayload), receivedAt: "2026-08-14T12:00:00Z" })).resolves.toEqual([
      expect.objectContaining({ kind: "dispute_opened", providerRef: "disp_1", paymentProviderRef: "pay_1", reason: "not_received" }),
    ]);
    await expect(adapter.verifyWebhook({ ...request, body: bytes(`${payload}\n`) })).rejects.toMatchObject({ code: "authentication" });
  });
});

describe("Paystack payment adapter", () => {
  it("keeps transaction references exact and verifies SHA-512 settlement feedback", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let reference = "";
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input);
      calls.push({ url, init });
      if (url.endsWith("/transaction/initialize")) {
        const body = JSON.parse(bodyText(init?.body)) as { reference: string };
        reference = body.reference;
        return Response.json({ status: true, data: { reference, authorization_url: "https://paystack.test/checkout" } });
      }
      if (url.includes("/transaction/verify/")) return Response.json({ status: true, data: { reference, status: "success", amount: 12_345, currency: "CAD", paid_at: "2026-08-14T12:00:00Z" } });
      if (url.endsWith("/refund")) return Response.json({ status: true, data: { id: 81, status: "pending" } });
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const adapter = createPaystackPayments({ secretKey: "paystack-private", apiBase: "https://paystack.example.test", fetch: fetcher });
    await expect(adapter.createCheckout(invoice)).resolves.toMatchObject({ url: "https://paystack.test/checkout" });
    expect(reference).toMatch(/^fh_[0-9a-f]+$/);
    await expect(adapter.captureCheckout({ checkoutRef: reference, idempotencyKey: "capture-1" })).resolves.toMatchObject({ providerRef: reference, status: "succeeded", amountMinor: 12_345 });
    await expect(adapter.refund({ paymentId: "local", providerRef: reference, currency: "CAD", amountMinor: 345, idempotencyKey: "refund-1" })).resolves.toEqual({ providerRef: "81", status: "pending" });

    const payload = JSON.stringify({ event: "charge.success", data: { reference, status: "success", amount: 12_345, currency: "CAD", paid_at: "2026-08-14T12:00:00Z", metadata: { freeholder_invoice_id: invoice.invoiceId, freeholder_contact_id: invoice.contactId } } });
    const signature = createHmac("sha512", "paystack-private").update(payload).digest("hex");
    await expect(adapter.verifyWebhook({ headers: { "x-paystack-signature": signature }, body: bytes(payload), receivedAt: "2026-08-14T12:00:01Z" })).resolves.toEqual([
      expect.objectContaining({ kind: "payment_succeeded", providerRef: reference, amountMinor: 12_345, invoiceId: invoice.invoiceId }),
    ]);
    const refundPayload = JSON.stringify({ event: "refund.processed", data: { refund_reference: "refund-81", transaction_reference: reference, status: "processed", amount: 345, currency: "CAD", updated_at: "2026-08-14T12:03:00Z" } });
    const refundSignature = createHmac("sha512", "paystack-private").update(refundPayload).digest("hex");
    await expect(adapter.verifyWebhook({ headers: { "x-paystack-signature": refundSignature }, body: bytes(refundPayload), receivedAt: "2026-08-14T12:03:01Z" })).resolves.toEqual([
      expect.objectContaining({ kind: "refund_succeeded", providerRef: "refund-81", paymentProviderRef: reference, amountMinor: 345 }),
    ]);
  });
});

describe("Flutterwave payment adapter", () => {
  it("re-fetches signed successful charges before settlement and requires verified IDs for refunds", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let reference = "";
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input);
      calls.push({ url, init });
      if (url.endsWith("/payments")) {
        const body = JSON.parse(bodyText(init?.body)) as { tx_ref: string };
        reference = body.tx_ref;
        return Response.json({ status: "success", data: { link: "https://flutterwave.test/checkout" } });
      }
      if (url.includes("/transactions/verify_by_reference")) return Response.json({ status: "success", data: { id: 991, tx_ref: reference, status: "successful", amount: 123.45, currency: "CAD", created_at: "2026-08-14T12:00:00Z", meta: { freeholder_invoice_id: invoice.invoiceId, freeholder_contact_id: invoice.contactId } } });
      if (url.endsWith("/transactions/991/refund")) return Response.json({ status: "success", data: { id: 71, status: "completed" } });
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const adapter = createFlutterwavePayments({ secretKey: "flw-private", webhookSecrets: ["flw-hook"], apiBase: "https://flutterwave.example.test/v3", webhookUrl: "https://shop.example.test/api/payments/webhooks/flutterwave", fetch: fetcher });
    await expect(adapter.createCheckout(invoice)).resolves.toMatchObject({ url: "https://flutterwave.test/checkout" });
    await expect(adapter.captureCheckout({ checkoutRef: reference, idempotencyKey: "capture-1" })).resolves.toMatchObject({ providerRef: "991", status: "succeeded", amountMinor: 12_345 });
    await expect(adapter.refund({ paymentId: "local", providerRef: "991", currency: "CAD", amountMinor: 345, idempotencyKey: "refund-1" })).resolves.toEqual({ providerRef: "71", status: "pending" });

    const payload = JSON.stringify({ id: "flw-event-1", type: "charge.completed", data: { reference, status: "successful" } });
    const signature = createHmac("sha256", "flw-hook").update(payload).digest("base64");
    const before = calls.filter((call) => call.url.includes("verify_by_reference")).length;
    await expect(adapter.verifyWebhook({ headers: { "flutterwave-signature": signature }, body: bytes(payload), receivedAt: "2026-08-14T12:00:01Z" })).resolves.toEqual([
      expect.objectContaining({ id: "flw-event-1", kind: "payment_succeeded", providerRef: "991", checkoutRef: reference, amountMinor: 12_345, invoiceId: invoice.invoiceId }),
    ]);
    expect(calls.filter((call) => call.url.includes("verify_by_reference"))).toHaveLength(before + 1);
    const refundPayload = JSON.stringify({ id: "flw-refund-event", type: "refund.completed", data: { id: 71, transaction_id: 991, status: "completed-bank-transfer", amount_refunded: 3.45, currency: "CAD", updated_at: "2026-08-14T12:04:00Z" } });
    const refundSignature = createHmac("sha256", "flw-hook").update(refundPayload).digest("base64");
    await expect(adapter.verifyWebhook({ headers: { "flutterwave-signature": refundSignature }, body: bytes(refundPayload), receivedAt: "2026-08-14T12:04:01Z" })).resolves.toEqual([
      expect.objectContaining({ id: "flw-refund-event", kind: "refund_succeeded", providerRef: "71", paymentProviderRef: "991", amountMinor: 345 }),
    ]);
    await expect(adapter.refund({ paymentId: "local", providerRef: reference, currency: "CAD", amountMinor: 345, idempotencyKey: "refund-2" })).rejects.toMatchObject({ code: "invalid_request" });
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
