// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: a downstream corrupt artifact cannot erase an actual refund ACK.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { InvoiceForCharge } from "@/adapters/payments";
import { createStripePayments } from "@/adapters/payments/stripe";
import { db } from "@/core/db";
import { eq } from "drizzle-orm";
import { createDataRequest, fulfillDataRequest, verifyDataRequest } from "@/core/privacy/service";
import { dataRequestArtifacts, dataRequests } from "@/core/privacy/schema";
import { outboxEvents } from "@/core/events/schema";
import { merchantTaxProfiles } from "@/modules/invoicing/merchant-tax-schema";
import { refunds, payments } from "@/modules/invoicing/schema";
import { merchantRefundObservations } from "@/modules/invoicing/merchant-refund-schema";
import { ORIGINAL_REFUND_EVIDENCE_EVENT } from "@/modules/invoicing/merchant-refund-privacy-repair";
import { env } from "@/core/env";
import { ready } from "@/core/runtime";
import { beginPaymentCheckout, completePaymentCheckout, submitProviderRefund } from "@/modules/invoicing/payment-provider-service";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
import { seedMerchantCheckout80 } from "../helpers/merchant-checkout80";
const signal = () => { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; };
describe.runIf(hasDatabase)("original merchant refund outbox receipt repair80", { timeout: 60000 }, () => {
  let fixture: Awaited<ReturnType<typeof seedMerchantCheckout80>> | undefined;
  beforeAll(ready, 60000); beforeEach(truncateSpine);
  afterEach(() => { fixture?.cleanup(); fixture = undefined; vi.restoreAllMocks(); }); afterAll(closeDb);
  it("retains an actual refund and its repair outbox when the original erasure artifact is corrupted", async () => {
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
    try {
      expect(await Promise.race([entered.promise.then(() => "entered"), first.then(() => "ended")])).toBe("entered");
      const [profile] = await db().select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id, fixture.profiles[0]!.profileId));
      const erasure = await createDataRequest.call({ contactId: profile!.contactId!, request: { kind: "erasure" } }, OWNER);
      await verifyDataRequest.call({ id: erasure.id, method: "Verified synthetic original merchant request while its actual refund callback is pending" }, OWNER);
      await fulfillDataRequest.call({ id: erasure.id, confirmation: "ERASE" }, OWNER);
      const [artifact] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, erasure.id));
      const corrupt = { ...artifact!.body as Record<string, unknown>, note: "Synthetic original receipt corruption; retain its exact previous checksum" };
      await db().update(dataRequestArtifacts).set({ body: corrupt }).where(eq(dataRequestArtifacts.id, artifact!.id));
      release.resolve();
      const result = await first;
      expect(result).toHaveProperty("value");
      if ("value" in result) expect(result.value).toMatchObject({ status: "succeeded", amountMinor: 500, providerRef: "re_originalPaused" });
      expect((await db().select().from(refunds))[0]).toMatchObject({ status: "succeeded", amountMinor: 500 });
      expect((await db().select().from(payments).where(eq(payments.id, begun.payment.id)))[0]).toMatchObject({ refundedMinor: 500 });
      expect((await db().select().from(merchantRefundObservations))[0]).toMatchObject({ status: "succeeded", amountMinor: 500, bindingVerified: true });
      const repairEvents = await db().select().from(outboxEvents).where(eq(outboxEvents.eventName, ORIGINAL_REFUND_EVIDENCE_EVENT));
      expect(repairEvents.some(event => event.status === "pending" && event.lastError)).toBe(true);
      expect((await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.id, artifact!.id)))[0]).toMatchObject({ body: corrupt, sha256: artifact!.sha256 });
      expect((await db().select().from(dataRequests).where(eq(dataRequests.id, erasure.id)))[0]).toMatchObject({ status: "in_progress", fulfilledAt: null,
        resolution: "New source evidence requires recovery of the exact original erasure receipt before completion." });
      expect(bodies).toHaveLength(1);
    } finally { release.resolve(); await first; }

  });
});
