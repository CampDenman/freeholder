// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.26–C12.27: each payout provider against recorded HTTP — the requests
// it sends (shapes taken from the providers' public API references), how it
// reads replies, and how it verifies webhooks. Not yet run against live
// sandboxes; that waits for test credentials.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createStripeConnect, stripeAccountStatus } from "@/adapters/payouts/stripe-connect";
import { createPayPalPayouts } from "@/adapters/payouts/paypal-payouts";
import { createRazorpayRoute } from "@/adapters/payouts/razorpay-route";

type Call = { url: string; method: string; headers: Record<string, string>; body: string };

function recorder(reply: (call: Call) => unknown) {
  const calls: Call[] = [];
  const fetcher = (async (input: string | URL, init: RequestInit = {}) => {
    const call: Call = { url: String(input), method: init.method ?? "GET", headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])), body: typeof init.body === "string" ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : "" };
    calls.push(call);
    const value = reply(call);
    const status = typeof value === "object" && value && "__status" in value ? (value as { __status: number }).__status : 200;
    return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, fetcher };
}

const seller = { userId: "00000000-0000-4000-8000-0000000000c2", email: "sam@example.test", displayName: "Sam" };
const urls = { returnUrl: "https://site.test/portal/payouts?setup=done", refreshUrl: "https://site.test/portal/payouts?setup=again" };
const body = (s: string) => new TextEncoder().encode(s);

describe("Stripe Connect payouts (C12.26)", () => {
  it("creates an Express account, links its hosted onboarding, transfers and reverses with idempotency keys", async () => {
    const { calls, fetcher } = recorder((c) => (c.url.endsWith("/v1/accounts") ? { id: "acct_1" } : c.url.endsWith("/v1/account_links") ? { url: "https://connect.stripe.test/setup/1" } : c.url.endsWith("/v1/transfers") ? { id: "tr_1" } : c.url.includes("/reversals") ? { id: "trr_1" } : {}));
    const stripe = createStripeConnect({ secretKey: "sk_test_x", webhookSecrets: ["whsec_x"], fetch: fetcher });
    expect(await stripe.onboard(seller, {}, urls)).toEqual({ externalAccountId: "acct_1", url: "https://connect.stripe.test/setup/1", status: "pending" });
    const account = new URLSearchParams(calls[0]!.body);
    expect([account.get("type"), account.get("email"), account.get("capabilities[transfers][requested]"), calls[0]!.headers["idempotency-key"]]).toEqual(["express", "sam@example.test", "true", `freeholder-account-${seller.userId}`]);
    expect(new URLSearchParams(calls[1]!.body).get("type")).toBe("account_onboarding");
    // An existing account only gets a fresh link.
    calls.length = 0;
    await stripe.onboard(seller, {}, urls, "acct_1");
    expect(calls.map((c) => c.url.replace("https://api.stripe.com", ""))).toEqual(["/v1/account_links"]);

    expect(await stripe.transfer({ externalAccountId: "acct_1", amountMinor: 3600, currency: "CAD", idempotencyKey: "t1", payoutId: "p1", description: "Payout p1" })).toEqual({ reference: "tr_1", settled: true });
    const transfer = calls.at(-1)!;
    expect([new URLSearchParams(transfer.body).get("amount"), new URLSearchParams(transfer.body).get("currency"), new URLSearchParams(transfer.body).get("destination"), transfer.headers["idempotency-key"]]).toEqual(["3600", "cad", "acct_1", "freeholder-payout-t1"]);
    expect(await stripe.reverse({ reference: "tr_1", amountMinor: 3600, currency: "CAD", idempotencyKey: "t1", payoutId: "p1" })).toEqual({ reference: "trr_1" });
    expect(calls.at(-1)!.url).toBe("https://api.stripe.com/v1/transfers/tr_1/reversals");
  });

  it("is ready only when transfers are active and payouts enabled, and verifies Connect webhooks", async () => {
    expect(stripeAccountStatus({ payouts_enabled: true, capabilities: { transfers: "active" } })).toBe("ready");
    expect(stripeAccountStatus({ payouts_enabled: false, capabilities: { transfers: "inactive" } })).toBe("pending");
    expect(stripeAccountStatus({ requirements: { disabled_reason: "rejected.fraud" } })).toBe("disabled");
    const stripe = createStripeConnect({ secretKey: "sk_test_x", webhookSecrets: ["whsec_x"], fetch: recorder(() => ({})).fetcher });
    const event = JSON.stringify({ type: "account.updated", data: { object: { id: "acct_1", payouts_enabled: true, capabilities: { transfers: "active" } } } });
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", "whsec_x").update(`${t}.${event}`).digest("hex");
    const now = new Date().toISOString();
    expect(await stripe.webhook({ headers: { "stripe-signature": `t=${t},v1=${sig}` }, body: body(event), receivedAt: now })).toEqual([{ kind: "account", externalAccountId: "acct_1", status: "ready" }]);
    await expect(stripe.webhook({ headers: { "stripe-signature": `t=${t},v1=${"0".repeat(64)}` }, body: body(event), receivedAt: now })).rejects.toThrow(/invalid/);
    await expect(stripe.webhook({ headers: { "stripe-signature": `t=${t - 3600},v1=${sig}` }, body: body(event), receivedAt: now })).rejects.toThrow(/window/);
  });
});

describe("PayPal Payouts (C12.27)", () => {
  it("pays a seller's PayPal email in one idempotent batch, settles by verified webhook, and cannot reverse", async () => {
    const { calls, fetcher } = recorder((c) =>
      c.url.endsWith("/v1/oauth2/token") ? { access_token: "tok" }
      : c.url.endsWith("/v1/payments/payouts") ? { batch_header: { payout_batch_id: "BATCH1" } }
      : c.url.endsWith("/verify-webhook-signature") ? { verification_status: (JSON.parse(c.body) as { transmission_sig?: string }).transmission_sig === "good" ? "SUCCESS" : "FAILURE" }
      : {},
    );
    const paypal = createPayPalPayouts({ clientId: "id", clientSecret: "secret", webhookId: "WH1", environment: "sandbox", fetch: fetcher });
    await expect(paypal.onboard(seller, { paypalEmail: "not-an-email" }, urls)).rejects.toThrow(/PayPal account/);
    expect(await paypal.onboard(seller, { paypalEmail: "Sam@Example.test" }, urls)).toEqual({ externalAccountId: "sam@example.test", status: "ready" });
    expect(await paypal.transfer({ externalAccountId: "sam@example.test", amountMinor: 1234, currency: "CAD", idempotencyKey: "t1", payoutId: "p1", description: "Payout p1" })).toEqual({ reference: "BATCH1", settled: false });
    const payout = JSON.parse(calls.at(-1)!.body) as { sender_batch_header: { sender_batch_id: string }; items: { amount: { value: string; currency: string }; receiver: string; sender_item_id: string }[] };
    expect(payout.sender_batch_header.sender_batch_id).toBe("t1");
    expect(calls.at(-1)!.headers["paypal-request-id"]).toBe("freeholder-payout-t1");
    expect(payout.items[0]).toMatchObject({ amount: { value: "12.34", currency: "CAD" }, receiver: "sam@example.test", sender_item_id: "p1" });
    expect(calls.at(-1)!.url).toBe("https://api-m.sandbox.paypal.com/v1/payments/payouts");
    expect("unsupported" in (await paypal.reverse({ reference: "BATCH1", amountMinor: 1234, currency: "CAD", idempotencyKey: "t1", payoutId: "p1" }))).toBe(true);

    const event = JSON.stringify({ event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", resource: { payout_batch_id: "BATCH1", payout_item: { sender_item_id: "p1" } } });
    expect(await paypal.webhook({ headers: { "paypal-transmission-sig": "good" }, body: body(event), receivedAt: new Date().toISOString() })).toEqual([{ kind: "transfer", reference: "BATCH1", payoutId: "p1", state: "settled" }]);
    expect((JSON.parse(calls.at(-1)!.body) as { webhook_id: string }).webhook_id).toBe("WH1");
    await expect(paypal.webhook({ headers: { "paypal-transmission-sig": "bad" }, body: body(event), receivedAt: new Date().toISOString() })).rejects.toThrow(/verify/);
    const returned = JSON.stringify({ event_type: "PAYMENT.PAYOUTS-ITEM.RETURNED", resource: { payout_batch_id: "BATCH1" } });
    expect(await paypal.webhook({ headers: { "paypal-transmission-sig": "good" }, body: body(returned), receivedAt: new Date().toISOString() })).toEqual([{ kind: "transfer", reference: "BATCH1", state: "failed", error: "returned" }]);
  });

  it("reads a refused duplicate batch as the original payout, not a failure", async () => {
    const { fetcher } = recorder((c) =>
      c.url.endsWith("/v1/oauth2/token") ? { access_token: "tok" }
      : { __status: 400, name: "USER_BUSINESS_ERROR", message: "Batch with given sender_batch_id already exists", links: [{ href: "https://api-m.sandbox.paypal.com/v1/payments/payouts/BATCH9", rel: "self", method: "GET" }] },
    );
    const paypal = createPayPalPayouts({ clientId: "id", clientSecret: "secret", webhookId: "WH1", environment: "sandbox", fetch: fetcher });
    expect(await paypal.transfer({ externalAccountId: "sam@example.test", amountMinor: 1234, currency: "CAD", idempotencyKey: "t1", payoutId: "p1", description: "Payout p1" })).toEqual({ reference: "BATCH9", settled: false });
    const refused = createPayPalPayouts({ clientId: "id", clientSecret: "secret", webhookId: "WH1", environment: "sandbox", fetch: recorder((c) => (c.url.endsWith("/v1/oauth2/token") ? { access_token: "tok" } : { __status: 422, name: "INSUFFICIENT_FUNDS" })).fetcher });
    await expect(refused.transfer({ externalAccountId: "sam@example.test", amountMinor: 1234, currency: "CAD", idempotencyKey: "t1", payoutId: "p1", description: "Payout p1" })).rejects.toThrow(/INSUFFICIENT_FUNDS/);
  });
});

describe("Razorpay Route (C12.27)", () => {
  const details = { legalName: "Sam Rao", phone: "9000000000", street: "1 MG Road", city: "Bengaluru", state: "Karnataka", postalCode: "560001", beneficiaryName: "Sam Rao", accountNumber: "1234567890", ifsc: "HDFC0001234" };

  it("creates a linked account with Route and settlement details, transfers and reverses", async () => {
    const { calls, fetcher } = recorder((c) =>
      c.url.endsWith("/v2/accounts") ? { id: "acc_1" }
      : c.url.endsWith("/v2/accounts/acc_1/products") ? { id: "acc_prd_1" }
      : c.url.endsWith("/products/acc_prd_1") ? { activation_status: c.method === "PATCH" ? "under_review" : "activated" }
      : c.url.endsWith("/v1/transfers") ? { id: "trf_1", status: "processed" }
      : c.url.includes("/reversals") ? { id: "rvrsl_1" }
      : {},
    );
    const razorpay = createRazorpayRoute({ keyId: "rzp_test_x", keySecret: "secret", webhookSecrets: ["whs"], fetch: fetcher });
    await expect(razorpay.onboard(seller, { ...details, ifsc: "BAD" }, urls)).rejects.toThrow(/IFSC/);
    expect(calls).toHaveLength(0);
    expect(await razorpay.onboard(seller, details, urls)).toEqual({ externalAccountId: "acc_1:acc_prd_1", status: "pending" });
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://api.razorpay.com", "")}`)).toEqual(["POST /v2/accounts", "POST /v2/accounts/acc_1/products", "PATCH /v2/accounts/acc_1/products/acc_prd_1"]);
    expect(JSON.parse(calls[0]!.body)).toMatchObject({ type: "route", email: "sam@example.test", business_type: "individual" });
    expect(JSON.parse(calls[2]!.body)).toMatchObject({ settlements: { account_number: "1234567890", ifsc_code: "HDFC0001234", beneficiary_name: "Sam Rao" } });
    expect(calls[0]!.headers.authorization).toBe(`Basic ${Buffer.from("rzp_test_x:secret").toString("base64")}`);
    expect(await razorpay.accountStatus("acc_1:acc_prd_1")).toBe("ready");
    expect(await razorpay.transfer({ externalAccountId: "acc_1:acc_prd_1", amountMinor: 50000, currency: "INR", idempotencyKey: "t1", payoutId: "p1", description: "Payout p1" })).toEqual({ reference: "trf_1", settled: true });
    expect(JSON.parse(calls.at(-1)!.body)).toMatchObject({ account: "acc_1", amount: 50000, currency: "INR", notes: { freeholder_payout_id: "p1" } });
    // Razorpay's documented idempotency header: a retry returns the first transfer.
    expect(calls.at(-1)!.headers["x-transfer-idempotency"]).toBe("t1");
    // 409: the same key is still being processed — the outcome is unknown, not refused.
    const busy = createRazorpayRoute({ keyId: "k", keySecret: "s", webhookSecrets: ["whs"], fetch: recorder(() => ({ __status: 409, error: { code: "BAD_REQUEST_ERROR" } })).fetcher });
    await expect(busy.transfer({ externalAccountId: "acc_1:acc_prd_1", amountMinor: 50000, currency: "INR", idempotencyKey: "t1", payoutId: "p1", description: "Payout p1" })).rejects.toMatchObject({ code: "provider_failure", retryable: true });
    expect(await razorpay.reverse({ reference: "trf_1", amountMinor: 50000, currency: "INR", idempotencyKey: "t1", payoutId: "p1" })).toEqual({ reference: "rvrsl_1" });
  });

  it("verifies webhooks and reads activation and transfer events", async () => {
    const razorpay = createRazorpayRoute({ keyId: "k", keySecret: "s", webhookSecrets: ["whs"], fetch: recorder(() => ({})).fetcher });
    const sign = (s: string) => createHmac("sha256", "whs").update(s).digest("hex");
    const activated = JSON.stringify({ event: "product.route.activated", payload: { account: { entity: { id: "acc_1" } }, merchant_product: { entity: { id: "acc_prd_1", activation_status: "activated" } } } });
    expect(await razorpay.webhook({ headers: { "x-razorpay-signature": sign(activated) }, body: body(activated), receivedAt: "" })).toEqual([{ kind: "account", externalAccountId: "acc_1:acc_prd_1", status: "ready" }]);
    const failed = JSON.stringify({ event: "transfer.failed", payload: { transfer: { entity: { id: "trf_1", notes: { freeholder_payout_id: "p1" } } } } });
    expect(await razorpay.webhook({ headers: { "x-razorpay-signature": sign(failed) }, body: body(failed), receivedAt: "" })).toEqual([{ kind: "transfer", reference: "trf_1", payoutId: "p1", state: "failed", error: "failed" }]);
    await expect(razorpay.webhook({ headers: { "x-razorpay-signature": sign("other") }, body: body(failed), receivedAt: "" })).rejects.toThrow(/invalid/);
  });
});
