// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.01 contract proof: every optional edge is typed and disabled honestly.

import { describe, expect, it } from "vitest";
import { AdapterRegistry } from "@/adapters/registry";
import { AdapterError, type RawProviderRequest } from "@/adapters/types";
import { aiAdapters } from "@/adapters/ai";
import { calendarAdapters } from "@/adapters/calendar";
import { carrierAdapters } from "@/adapters/carrier";
import { createNoBulkMail } from "@/adapters/mail/none";
import { paymentAdapters } from "@/adapters/payments";
import { pointOfSaleAdapters } from "@/adapters/point-of-sale";
import { smsAdapters } from "@/adapters/sms";
import { socialAdapters } from "@/adapters/social";
import { taxAdapters } from "@/adapters/tax";

const rawRequest: RawProviderRequest = {
  headers: { "x-provider-signature": "must-not-be-trusted" },
  body: new Uint8Array([1, 2, 3]),
  receivedAt: "2026-08-14T12:00:00.000Z",
};

async function unavailable(promise: Promise<unknown>, family: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: "AdapterError",
    family,
    adapterId: "none",
    code: "unavailable",
    retryable: false,
  });
}

describe("C5.01 adapter registry", () => {
  it("keeps adapter families isolated, unique, deterministic, and availability-aware", () => {
    const registry = new AdapterRegistry("payments", [paymentAdapters.get("none")]);
    expect(registry.list().map((adapter) => adapter.id)).toEqual(["none"]);
    expect(registry.available()).toEqual([]);
    expect(() => registry.get("stripe")).toThrow('Unknown payments adapter "stripe"');
    expect(() => registry.register(paymentAdapters.get("none"))).toThrow(
      'payments adapter "none" is already registered',
    );
    expect(() =>
      registry.register(taxAdapters.get("none") as never),
    ).toThrow("is a tax adapter, not payments");
  });

  it("uses one safe error shape that contains no raw provider material", () => {
    const error = new AdapterError(
      "payments",
      "provider",
      "provider_failure",
      "The provider refused this operation.",
      true,
    );
    expect(error).toMatchObject({ retryable: true, code: "provider_failure" });
    expect(error.message).not.toContain("must-not-be-trusted");
    expect(error.message).not.toContain("1,2,3");
  });
});

describe("C5.01 honest none adapters", () => {
  it("never offers or completes an online payment", async () => {
    const adapter = paymentAdapters.get("none");
    expect(adapter.status.available).toBe(false);
    expect(adapter.capabilities()).toEqual({
      refunds: false,
      partialRefunds: false,
      savedMethods: false,
      subscriptions: false,
      disputes: false,
      payouts: false,
      inPerson: false,
      strongCustomerAuthentication: false,
    });
    await expect(adapter.supportedCurrencies()).resolves.toEqual([]);
    await expect(
      adapter.supportedMethods({ country: "CA", currency: "CAD", recurring: false }),
    ).resolves.toEqual([]);
    await unavailable(
      adapter.createCheckout({
        invoiceId: "invoice-id",
        invoiceNumber: "INV-1",
        contactId: "contact-id",
        currency: "CAD",
        amountMinor: 2500,
        description: "Order",
        customer: { email: "buyer@example.test" },
        successUrl: "https://example.test/paid",
        cancelUrl: "https://example.test/cancelled",
        idempotencyKey: "invoice:1",
      }),
      "payments",
    );
    await unavailable(
      adapter.refund({
        paymentId: "payment-id",
        providerRef: "provider-ref",
        currency: "CAD",
        amountMinor: 100,
        idempotencyKey: "refund:1",
      }),
      "payments",
    );
    await unavailable(adapter.verifyWebhook(rawRequest), "payments");
  });

  it("refuses to reinterpret missing tax as a zero quote", async () => {
    const adapter = taxAdapters.get("none");
    expect(adapter.status.message).toContain("cannot assume");
    await unavailable(
      adapter.quote({
        currency: "CAD",
        pricesIncludeTax: false,
        origin: { country: "CA", region: "BC" },
        destination: { country: "CA", region: "BC" },
        items: [{
          id: "line-1",
          quantity: 1,
          unitAmountMinor: 1000,
          discountMinor: 0,
          category: "standard",
          requiresShipping: true,
        }],
        shippingMinor: 0,
        occurredAt: "2026-08-14T12:00:00.000Z",
      }),
      "tax",
    );
  });

  it("refuses calendar, AI, social, carrier, and POS work instead of fabricating refs", async () => {
    await unavailable(
      calendarAdapters.get("none").listBusy({
        calendarRef: "calendar",
        startsAt: "2026-08-14T12:00:00.000Z",
        endsAt: "2026-08-14T13:00:00.000Z",
      }),
      "calendar",
    );
    await unavailable(
      aiAdapters.get("none").generate({
        purpose: "product-copy",
        system: "Draft only.",
        input: "A product",
        maxOutputTokens: 100,
        idempotencyKey: "ai:1",
      }),
      "ai",
    );
    await unavailable(
      socialAdapters.get("none").publish({
        accountRef: "account",
        text: "New product",
        media: [],
        idempotencyKey: "social:1",
      }),
      "social",
    );
    await unavailable(
      carrierAdapters.get("none").quote({
        from: {
          name: "Seller",
          street1: "1 Main St",
          city: "Victoria",
          region: "BC",
          postalCode: "V8V 1V1",
          country: "CA",
        },
        to: {
          name: "Buyer",
          street1: "2 Main St",
          city: "Vancouver",
          region: "BC",
          postalCode: "V5K 0A1",
          country: "CA",
        },
        parcels: [{
          weightGrams: 500,
          lengthMillimetres: 200,
          widthMillimetres: 100,
          heightMillimetres: 50,
        }],
        currency: "CAD",
      }),
      "carrier",
    );
    await unavailable(
      pointOfSaleAdapters.get("none").collect({
        invoiceId: "invoice",
        locationId: "location",
        currency: "CAD",
        amountMinor: 2500,
        idempotencyKey: "pos:1",
      }),
      "point_of_sale",
    );
  });

  it("records SMS and bulk-mail non-delivery without claiming a send", async () => {
    const sms = smsAdapters.get("none");
    await expect(
      sms.send({
        to: "+12505550100",
        title: "Receipt",
        body: "Paid",
        deliveryId: "delivery-1",
      }),
    ).resolves.toMatchObject({ delivers: false, providerRef: null });
    await unavailable(sms.verifyWebhook(rawRequest), "sms");

    const bulk = createNoBulkMail();
    expect(bulk.delivers).toBe(false);
    await expect(
      bulk.send({ to: "buyer@example.test", subject: "News", text: "Hello" }),
    ).rejects.toThrow("Bulk mail is not configured");
  });
});
