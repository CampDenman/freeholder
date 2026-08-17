// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.24 Terminal/tap-to-pay representation and cash collection.

import { describe, expect, it } from "vitest";
import { createManualPointOfSale } from "@/adapters/point-of-sale/manual";
import { createStripePointOfSale } from "@/adapters/point-of-sale/stripe";
import { pointOfSaleAdapters } from "@/adapters/point-of-sale";

const request = {
  invoiceId: "10000000-0000-4000-8000-000000000001",
  locationId: "20000000-0000-4000-8000-000000000002",
  currency: "CAD",
  amountMinor: 2_500,
  idempotencyKey: "pos-1",
};

describe("point-of-sale adapters", () => {
  it("keeps the none adapter honest and registers cash plus Stripe Terminal", () => {
    expect(pointOfSaleAdapters.get("none").status.available).toBe(false);
    expect(pointOfSaleAdapters.get("manual").capabilities()).toMatchObject({
      cashRecording: true,
      tapToPay: false,
    });
    expect(pointOfSaleAdapters.get("stripe").capabilities().cashRecording).toBe(false);
  });

  it("records cash immediately without inventing a reader", async () => {
    const collected = await createManualPointOfSale().collect(request);
    expect(collected).toMatchObject({ status: "succeeded", providerRef: "pos-cash:pos-1" });
  });

  it("creates a Stripe PaymentIntent for a reader or tap-to-pay", async () => {
    const calls: string[] = [];
    const adapter = createStripePointOfSale({
      secretKey: "sk_test_pos",
      apiBase: "https://api.stripe.test",
      fetch: async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        calls.push(url);
        const body = typeof init?.body === "string" ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : "";
        if (url.endsWith("/v1/payment_intents")) {
          expect(body).toContain("card_present");
          expect(body).toContain("amount=2500");
          return new Response(
            JSON.stringify({ id: "pi_pos_1", client_secret: "pi_pos_1_secret" }),
            { status: 200 },
          );
        }
        if (url.includes("/v1/terminal/readers/")) {
          return new Response(JSON.stringify({ id: "tmr_1" }), { status: 200 });
        }
        if (url.endsWith("/v1/refunds")) {
          return new Response(JSON.stringify({ id: "re_pos_1", status: "succeeded" }), { status: 200 });
        }
        return new Response("{}", { status: 404 });
      },
    });
    expect(adapter.status.available).toBe(true);
    expect(adapter.capabilities()).toMatchObject({ countertop: true, tapToPay: true, refunds: true });
    const waiting = await adapter.collect(request);
    expect(waiting).toMatchObject({
      providerRef: "pi_pos_1",
      status: "requires_reader",
      readerActionToken: "pi_pos_1_secret",
    });
    const processing = await adapter.collect({ ...request, readerRef: "tmr_studio", idempotencyKey: "pos-2" });
    expect(processing.status).toBe("processing");
    expect(calls.some((url) => url.includes("/terminal/readers/tmr_studio/"))).toBe(true);
    const refunded = await adapter.refund({
      providerRef: "pi_pos_1",
      currency: "CAD",
      amountMinor: 2_500,
      idempotencyKey: "pos-refund-1",
    });
    expect(refunded).toMatchObject({ providerRef: "re_pos_1", status: "succeeded" });
  });
});
