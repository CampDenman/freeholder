// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: actual refund HTTP caller admission, without forcing duplicate money.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { InvoiceForCharge } from "@/adapters/payments";
import { createStripePayments } from "@/adapters/payments/stripe";
import { env } from "@/core/env";
import { ready } from "@/core/runtime";
import { beginPaymentCheckout, completePaymentCheckout, submitProviderRefund } from "@/modules/invoicing/payment-provider-service";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
import { seedMerchantCheckout80 } from "../helpers/merchant-checkout80";
const signal = () => { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; };
describe.runIf(hasDatabase)("original merchant refund caller quiescence80", { timeout: 60000 }, () => {
  let fixture: Awaited<ReturnType<typeof seedMerchantCheckout80>> | undefined;
  beforeAll(ready, 60000); beforeEach(truncateSpine);
  afterEach(() => { fixture?.cleanup(); fixture = undefined; vi.restoreAllMocks(); }); afterAll(closeDb);
  it("does not POST another identical refund while its original provider caller remains paused", async () => {
    fixture = await seedMerchantCheckout80("destination");
    const placed = await fixture.checkout(), originals = new Map<string, InvoiceForCharge>();
    fixture.stripe.createCheckout = async request => {
      originals.set("cs_refundOriginal", request);
      return { ...request, providerRef: "cs_refundOriginal", paymentRef: "pi_refundOriginal", url: "https://checkout.example.test/cs_refundOriginal" };
    };
    fixture.stripe.captureCheckout = async request => {
      const original = originals.get(request.checkoutRef)!;
      return { ...original, providerRef: "pi_refundOriginal", status: "succeeded", amountMinor: original.amountMinor, currency: original.currency,
        customerChargeVerified: true, merchantRouteVerified: true, merchantSettlementVerified: true, providerChargeRef: "ch_refundOriginal",
        applicationFeeRef: "fee_refundOriginal", transferRef: "tr_refundOriginal", observedApplicationFeeMinor: original.applicationFeeMinor,
        applicationFeeCurrency: original.currency, observedFeeRefundedMinor: 0 };
    };
    const begun = await beginPaymentCheckout.call({ invoiceId: placed.order.invoiceId!, provider: "stripe", successUrl: env().APP_URL, cancelUrl: env().APP_URL, idempotencyKey: randomUUID() }, OWNER);
    expect((await completePaymentCheckout.call({ paymentId: begun.payment.id, idempotencyKey: randomUUID() }, OWNER)).status).toBe("succeeded");
    const entered = signal(), duplicate = signal(), release = signal(), bodies: string[] = [], keys: Array<string | null> = [];
    const original = originals.get("cs_refundOriginal")!;
    const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname === "/v1/account") return Response.json({ id: "acct_fixturePlatform" });
      if (url.pathname === "/v1/payment_intents/pi_refundOriginal" && init.method === "GET") return Response.json({ id: "pi_refundOriginal", status: "succeeded", amount_received: original.amountMinor,
        currency: original.currency.toLowerCase(), metadata: { freeholder_payment_id: begun.payment.id, freeholder_platform_account_id: "acct_fixturePlatform" },
        transfer_data: { destination: "acct_fixtureSeller0" }, on_behalf_of: "acct_fixtureSeller0" });
      if (url.pathname === "/v1/refunds" && init.method === "POST") {
        if (typeof init.body !== "string" && !(init.body instanceof URLSearchParams)) throw new Error("Inspect the actual original encoded refund body.");
        bodies.push(init.body.toString()); keys.push(new Headers(init.headers).get("idempotency-key"));
        const ordinal = bodies.length;
        if (ordinal === 1) entered.resolve(); else duplicate.resolve();
        await release.promise;
        // Stripe can reject concurrent same-key work. This test demonstrates
        // two physical calls only; it does not invent a second money effect.
        return ordinal === 1 ? Response.json({ id: "re_originalPaused", payment_intent: "pi_refundOriginal", amount: 500, currency: "cad", status: "succeeded" })
          : Response.json({ error: { code: "idempotency_key_in_use", message: "The original request is still being processed." } }, { status: 409 });
      }
      if (url.pathname === "/v1/refunds" && init.method === "GET") return Response.json({ data: [], has_more: false });
      throw new Error(`Unexpected original refund request: ${init.method} ${url.pathname}`);
    });
    const stripe = createStripePayments({ secretKey: "sk_paused_refund_fixture", webhookSecrets: ["whsec_paused_refund_fixture"], apiBase: "https://stripe.example.test", fetch: fetcher });
    fixture.stripe.refund = stripe.refund.bind(stripe);
    fixture.stripe.createMerchantRefund = stripe.createMerchantRefund?.bind(stripe);
    fixture.stripe.recoverMerchantRefund = stripe.recoverMerchantRefund?.bind(stripe);
    const input = { paymentId: begun.payment.id, amountMinor: 500, reason: "Synthetic original refund caller control", idempotencyKey: randomUUID() };
    const first = submitProviderRefund.call(input, OWNER).then(value => ({ value }), (error: unknown) => ({ error }));
    expect(await Promise.race([entered.promise.then(() => "entered"), first.then(() => "ended")])).toBe("entered");
    const second = submitProviderRefund.call(input, OWNER).then(value => ({ kind: "result" as const, value }), (error: unknown) => ({ kind: "error" as const, error }));
    try {
      const outcome = await Promise.race([second, duplicate.promise.then(() => ({ kind: "duplicate" as const }))]);
      if (bodies.length > 1) { expect(bodies[1]).toBe(bodies[0]); expect(keys[1]).toBe(keys[0]); }
      expect(outcome.kind).toBe("error");
      if (outcome.kind === "error") expect(outcome.error).toMatchObject({ code: "conflict" });
      expect(bodies).toHaveLength(1);
    } finally { release.resolve(); await Promise.all([first, second]); }
  });
});
