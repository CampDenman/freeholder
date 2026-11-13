// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: a destination's SetupIntent belongs to the original platform.
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createStripePayments } from "@/adapters/payments/stripe";
import type { MethodSetupRequest } from "@/adapters/payments";

const request: MethodSetupRequest = {
  setupAttemptId: "00000000-0000-4000-8000-000000000080", subscriptionId: "00000000-0000-4000-8000-000000000081",
  contactId: "00000000-0000-4000-8000-000000000082", currency: "CAD", customer: { email: "fictional@example.test" },
  providerPlatformAccountId: "acct_originalPlatform", destinationAccountId: "acct_originalSeller", settlementMerchantAccountId: "acct_originalSeller",
  providerCustomerRef: "cus_original", successUrl: "https://shop.example.test/return", cancelUrl: "https://shop.example.test/cancel", idempotencyKey: "original-setup-80",
};
const metadata = { freeholder_setup_attempt_id: request.setupAttemptId, freeholder_subscription_id: request.subscriptionId, freeholder_contact_id: request.contactId,
  freeholder_platform_account_id: request.providerPlatformAccountId, freeholder_setup_settlement_account_id: request.settlementMerchantAccountId };
const now = Math.floor(Date.now() / 1000);
const session = { id: "cs_original", mode: "setup", status: "complete", payment_status: "no_payment_required", currency: "cad", customer: "cus_original", metadata, setup_intent: "seti_original", created: now, url: "https://checkout.example.test/original" };
const intent = { id: "seti_original", status: "succeeded", usage: "off_session", customer: "cus_original", metadata, created: now, on_behalf_of: "acct_originalSeller",
  payment_method: { id: "pm_original", customer: "cus_original", type: "card", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } } };
const requestUrl = (input: Parameters<typeof fetch>[0]) => new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
function provider(patch: Record<string, unknown> = {}, platform = "acct_originalPlatform") {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = requestUrl(input);
    if (url.pathname === "/v1/account") return Response.json({ id: platform });
    expect(new Headers(init?.headers).has("stripe-account")).toBe(false);
    if (url.pathname === "/v1/customers") return Response.json({ id: "cus_original" });
    if (url.pathname.startsWith("/v1/setup_intents/")) return Response.json({ ...intent, ...patch });
    return Response.json(session);
  });
  return { adapter: createStripePayments({ secretKey: "sk_fictional", webhookSecrets: ["whsec_fictional"], apiBase: "https://stripe.example.test", fetch: fetcher }), fetcher };
}
describe("new subscription setup original scope (C12.38)", () => {
  it("verifies the original platform before creating a destination setup customer", async () => {
    const { adapter, fetcher } = provider();
    expect(await adapter.createSetupCustomer!(request)).toEqual({ providerCustomerRef: "cus_original", providerPlatformAccountId: "acct_originalPlatform" });
    expect(fetcher.mock.calls.map(([url]) => requestUrl(url).pathname)).toEqual(["/v1/account", "/v1/customers"]);
  });
  it("sets actual SetupIntent settlement without moving its customer to the recipient namespace", async () => {
    const { adapter, fetcher } = provider();
    expect(await adapter.createMethodSetup!(request)).toMatchObject({ providerRef: "cs_original", providerPlatformAccountId: "acct_originalPlatform" });
    const [, init] = fetcher.mock.calls.at(-1)!;
    const body = init!.body as URLSearchParams;
    expect(body.get("setup_intent_data[on_behalf_of]")).toBe("acct_originalSeller");
    expect(body.get("metadata[freeholder_platform_account_id]")).toBe("acct_originalPlatform");
    expect([...body.keys()].some(key => key.includes("transfer_data"))).toBe(false);
  });
  it("refuses a replacement authenticated platform before any customer or session POST", async () => {
    const { adapter, fetcher } = provider({}, "acct_replacementPlatform");
    await expect(adapter.createMethodSetup!(request)).rejects.toMatchObject({ code: "authentication" });
    expect(fetcher.mock.calls).toHaveLength(1);
    expect(fetcher.mock.calls[0]![1]!.method).toBe("GET");
  });
  it.each([{ on_behalf_of: "acct_replacementSeller" }, { metadata: { ...metadata, freeholder_platform_account_id: "acct_replacementPlatform" } }])("refuses a completed setup whose actual original scope differs %j", async patch => {
    const { adapter } = provider(patch);
    await expect(adapter.recoverMethodSetup!({ ...request, providerRef: "cs_original", createdAt: new Date((now - 10) * 1000).toISOString() })).rejects.toMatchObject({ code: "provider_failure" });
  });
  it("retains verified platform and actual SetupIntent settlement in authenticated setup feedback", async () => {
    const { adapter } = provider();
    const body = JSON.stringify({ id: "evt_original", type: "checkout.session.completed", created: now, data: { object: session } });
    const signature = createHmac("sha256", "whsec_fictional").update(`${now}.${body}`).digest("hex");
    const events = await adapter.verifyWebhook({ body: new TextEncoder().encode(body), headers: { "stripe-signature": `t=${now},v1=${signature}` }, receivedAt: new Date(now * 1000).toISOString() });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "saved_method_added", providerPlatformAccountId: "acct_originalPlatform", setup: { settlementMerchantAccountId: "acct_originalSeller" } });
    expect(events[0]!.providerAccountId).toBeUndefined();
  });
});
