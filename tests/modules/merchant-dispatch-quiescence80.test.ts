// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: exact original HTTP bodies never authorize two live creators.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { env } from "@/core/env";
import { createStripePayments } from "@/adapters/payments/stripe";
import { merchantPaymentDispatches, merchantPaymentDispatchFinishes, merchantPaymentResourceBindings } from "@/modules/invoicing/merchant-payment-recovery-schema";
import { reviewMerchantPaymentCallerStopped, reviewMerchantPaymentResourceOrigin } from "@/modules/invoicing/merchant-payment-request";
import { beginPaymentCheckout } from "@/modules/invoicing/payment-provider-service";
import { ANONYMOUS, closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
import { seedMerchantCheckout80 } from "../helpers/merchant-checkout80";

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}
describe.runIf(hasDatabase)("original merchant physical caller quiescence", { timeout: 60000 }, () => {
  let fixture: Awaited<ReturnType<typeof seedMerchantCheckout80>> | undefined;
  beforeAll(ready, 60000);
  beforeEach(truncateSpine);
  afterEach(() => { fixture?.cleanup(); fixture = undefined; vi.restoreAllMocks(); });
  afterAll(closeDb);

  it("does not dispatch a second identical creation while the original HTTP caller is paused", async () => {
    fixture = await seedMerchantCheckout80("destination");
    const placed = await fixture.checkout();
    const entered = signal(), duplicate = signal(), release = signal();
    const bodies: string[] = [], keys: Array<string | null> = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname === "/v1/account") return Response.json({ id: "acct_fixturePlatform" });
      if (url.pathname === "/v1/checkout/sessions" && init.method === "POST") {
        if (typeof init.body !== "string" && !(init.body instanceof URLSearchParams)) throw new Error("Expected the actual encoded form body");
        bodies.push(init.body.toString()); keys.push(new Headers(init.headers).get("idempotency-key"));
        if (bodies.length === 1) entered.resolve(); else duplicate.resolve();
        await release.promise;
        return Response.json({ id: "cs_originalPaused", url: "https://checkout.stripe.example/cs_originalPaused", expires_at: Math.floor(Date.now() / 1000) + 3600, payment_intent: null });
      }
      // A safe retry can inspect the still-unknown original operation; empty
      // inventory is unresolved, never permission to POST another creation.
      if (url.pathname === "/v1/checkout/sessions/cs_originalPaused" && init.method === "GET") {
        const form = new URLSearchParams(bodies[0]);
        const metadata = Object.fromEntries([...form.entries()].filter(([key]) => /^metadata\[[^\]]+\]$/.test(key)).map(([key, value]) => [key.slice(9, -1), value]));
        return Response.json({ id: "cs_originalPaused", mode: "payment", status: "open", payment_status: "unpaid", payment_intent: null,
          metadata, client_reference_id: form.get("client_reference_id"), amount_total: Number(form.get("line_items[0][price_data][unit_amount]")),
          currency: form.get("line_items[0][price_data][currency]"), created: Math.floor(Date.now() / 1000),
          url: "https://checkout.stripe.example/cs_originalPaused", expires_at: Math.floor(Date.now() / 1000) + 3600 });
      }
      if (url.pathname === "/v1/checkout/sessions" && init.method === "GET") return Response.json({ data: [], has_more: false });
      throw new Error(`Unexpected original provider request: ${init.method} ${url.pathname}`);
    });
    const stripe = createStripePayments({ secretKey: "sk_paused_creator_fixture", webhookSecrets: ["whsec_paused_creator_fixture"], apiBase: "https://stripe.example.test", fetch: fetcher });
    fixture.stripe.createCheckout = stripe.createCheckout.bind(stripe);
    fixture.stripe.recoverMerchantPayment = stripe.recoverMerchantPayment?.bind(stripe);
    const input = { invoiceId: placed.order.invoiceId!, provider: "stripe" as const, successUrl: new URL("/return", env().APP_URL).href, cancelUrl: new URL("/cancel", env().APP_URL).href, idempotencyKey: crypto.randomUUID() };
    const first = beginPaymentCheckout.call(input, OWNER).then(value => ({ value }), (error: unknown) => ({ error }));
    const firstArrival = await Promise.race([entered.promise.then(() => "entered" as const), first.then(() => "ended" as const)]);
    expect(firstArrival).toBe("entered");
    const second = beginPaymentCheckout.call(input, OWNER).then(value => ({ kind: "result" as const, value }), (error: unknown) => ({ kind: "error" as const, error }));
    try {
      const outcome = await Promise.race([second, duplicate.promise.then(() => ({ kind: "duplicate" as const }))]);
      if (bodies.length > 1) {
        // Establish the current-source failure is caller admission, rather
        // than a changed provider payload/key or a second logical payment.
        expect(bodies[1]).toBe(bodies[0]); expect(keys[1]).toBe(keys[0]);
      }
      expect(outcome.kind).toBe("error");
      if (outcome.kind === "error") expect(outcome.error).toMatchObject({ code: "conflict" });
      expect(bodies).toHaveLength(1);
      const [dispatch] = await db().select().from(merchantPaymentDispatches);
      expect(dispatch).toBeDefined();
      expect(await db().select().from(merchantPaymentDispatchFinishes)).toHaveLength(0);
      await expect(reviewMerchantPaymentCallerStopped.call({ dispatchId: dispatch!.id, expectedCallerId: dispatch!.caller.id,
        expectedRequestDigest: dispatch!.requestDigest, hostingEvidence: "Synthetic false stop review: the original process remains alive.",
        confirmation: "ORIGINAL PAYMENT CALLER STOP VERIFIED" }, OWNER)).rejects.toMatchObject({ code: "conflict" });
      await expect(reviewMerchantPaymentResourceOrigin.call({ dispatchId: dispatch!.id, expectedRequestDigest: dispatch!.requestDigest,
        resourceRef: "cs_originalPaused", providerRequestReference: "req_fixture", providerEvidence: "Synthetic original provider log cannot drain the currently paused caller.",
        confirmation: "ORIGINAL PROVIDER REQUEST VERIFIED" }, OWNER)).rejects.toMatchObject({ code: "conflict" });
      await expect(beginPaymentCheckout.call(input, ANONYMOUS)).rejects.toMatchObject({ code: "permission" });
    } finally {
      release.resolve();
      await Promise.all([first, second]); // No paused caller escapes this test.
    }
    const [dispatch] = await db().select().from(merchantPaymentDispatches);
    expect(await db().select().from(merchantPaymentDispatchFinishes).where(eq(merchantPaymentDispatchFinishes.dispatchId, dispatch!.id)))
      .toEqual([expect.objectContaining({ outcome: "returned", callerInstanceId: dispatch!.caller.id, providerRef: "cs_originalPaused" })]);
    expect(await db().select().from(merchantPaymentResourceBindings)).toEqual([expect.objectContaining({ origin: "physical_ack", resourceRef: "cs_originalPaused" })]);
    const completed = await first;
    expect(completed).toHaveProperty("value.checkout.providerRef", "cs_originalPaused");
    if (!("value" in completed)) throw completed.error;
    // Read-only recovery can resume the proven original checkout; it cannot
    // replay creation or infer a different resource from mutable metadata.
    expect((await beginPaymentCheckout.call(input, OWNER)).checkout.providerRef).toBe("cs_originalPaused");
    expect(bodies).toHaveLength(1);
  });
});
