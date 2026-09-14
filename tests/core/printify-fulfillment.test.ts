// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.13: real Printify HTTP contract composed with canonical paid-order fulfillment.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { getService } from "@/core/service";
import { createContact, mergeContacts } from "@/core/contacts/service";
import { createPayment, settlePayment } from "@/modules/invoicing/invoice-service";
import { addCartItem, applyVariantMatrix, checkoutCart, createPriceList, createProduct,
 createShippingMethod, createShippingZone, getFulfillment, getOrCreateCart,
 getProductVariants, payOrder, setPriceListEntry } from "@/modules/catalog/service";
import * as adapter from "../../plugins/print-on-demand/adapter";
import { podJobs } from "../../plugins/print-on-demand/schema";
import { mapPodSku, queueOrderLines, submitPodJob, refreshPodJob } from "../../plugins/print-on-demand/service";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("Printify fulfillment integration", { timeout: 30_000 }, () => {
 beforeEach(async () => { await ready(); await truncateSpine(); });
 afterEach(() => vi.restoreAllMocks());
 afterAll(closeDb);
    async function paidPrintOrder(slug: string) {
      const product = await createProduct.call(
        { name: slug, slug, kind: "physical" },
        OWNER,
      );
      const updated = await applyVariantMatrix.call(
        { productId: product.id, expectedVersion: product.version },
        OWNER,
      );
      const variant = (await getProductVariants.call({ productId: updated.id }, OWNER)).variants[0]!;
      const list = await createPriceList.call(
        { name: `${slug} retail`, currency: "CAD", kind: "retail" },
        OWNER,
      );
      await setPriceListEntry.call({ priceListId: list.id, variantId: variant.id, amount: "20.00" }, OWNER);
      const zone = await createShippingZone.call(
        { name: `${slug} world`, countries: [], regions: [], postalPatterns: [] },
        OWNER,
      );
      await createShippingMethod.call(
        { zoneId: zone.id, name: "Parcel", kind: "flat", currency: "CAD", amount: "5.00" },
        OWNER,
      );
      const contact = await createContact.call(
        { name: slug, email: `${slug}@example.test` },
        OWNER,
      );
      const basket = await getOrCreateCart.call({ contactId: contact.id, currency: "CAD" }, OWNER);
      await addCartItem.call({ cartId: basket.cart.id, variantId: variant.id, quantity: 1 }, OWNER);
      const placed = await checkoutCart.call(
        {
          cartId: basket.cart.id,
          contactId: contact.id,
          idempotencyKey: `pod-${slug}-${crypto.randomUUID()}`,
          acceptedTerms: true,
          shippingAddress: { name: "Ada Example", street1: "123 Test Street", country: "CA", region: "BC", postalCode: "V9N 1A1", city: "Courtenay" },
        },
        OWNER,
      );
      const payment = await createPayment.call(
        {
          invoiceId: placed.order.invoiceId!,
          provider: "manual",
          method: "bank_transfer",
          amountMinor: placed.order.totalMinor,
          idempotencyKey: `pay-${placed.order.id}`,
        },
        OWNER,
      );
      await settlePayment.call({ id: payment.id, providerRef: `manual:${placed.order.id}` }, OWNER);
      return payOrder.call({ id: placed.order.id }, OWNER);
    }

 it("submits a paid line and ships only after verified carrier evidence", async () => {
   let externalId = "";
   const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
     if (init?.method === "POST") {
       const body = JSON.parse(init.body as string) as { external_id: string; line_items: unknown[]; address_to: unknown };
       externalId = body.external_id;
       expect(body.line_items[0]).toMatchObject({ product_id: "product-1", variant_id: 123, quantity: 1 });
       expect(body.address_to).toMatchObject({ first_name: "Ada", last_name: "Example", address1: "123 Test Street", zip: "V9N 1A1" });
       return Response.json({ id: "vendor-order-1" });
     }
     return Response.json({ id: "vendor-order-1", metadata: { shop_order_id: externalId }, status: "fulfilled",
       shipments: [{ carrier: "Canada Post", number: "TRACK-123", url: "https://example.test/track/123" }] });
   });
   vi.spyOn(adapter, "podProvider").mockReturnValue(adapter.createPrintifyPodProvider({ token: "test-token", shopId: "42" }, fetcher));
   await mapPodSku.call({ sku: "real-print", provider: "printify", providerProductId: "product-1", providerVariantId: 123 }, OWNER);
   const paid = await paidPrintOrder("real-print");
   const [queued] = await queueOrderLines.call({ orderId: paid.order.id }, OWNER);
   const job = queued!.status === "submitted" ? queued! : await submitPodJob.call({ jobId: queued!.id }, OWNER);
   expect(job.status).toBe("submitted");
   expect(externalId).toBe(`freeholder:pod:${job.orderItemId}`);
   expect((await getFulfillment.call({ id: job.fulfillmentId! }, OWNER)).fulfillment.status).toBe("pending");
   const refreshed = await refreshPodJob.call({ jobId: job.id }, OWNER);
   expect(refreshed.status).toBe("fulfilled");
   expect(refreshed.shipments).toHaveLength(1);
   const shipped = (await getFulfillment.call({ id: job.fulfillmentId! }, OWNER)).fulfillment;
   expect(shipped.status).toBe("shipped");
   expect(shipped.trackingNumber).toBe("TRACK-123");
 });

 it("queues a paid line once when multiple workers discover its mapping together", async () => {
   const paid = await paidPrintOrder("parallel-print");
   await mapPodSku.call({ sku: "parallel-print", provider: "printify", providerProductId: "parallel-product", providerVariantId: 123 }, OWNER);
   const results = await Promise.all(Array.from({ length: 5 }, () => queueOrderLines.call({ orderId: paid.order.id }, OWNER)));
   expect(results.every(rows => rows.length === 1)).toBe(true);
   expect(new Set(results.map(rows => rows[0]!.id)).size).toBe(1);
   expect(new Set(results.map(rows => rows[0]!.fulfillmentId)).size).toBe(1);
 });

 it("repoints stored delivery jobs when their canonical contacts merge", async () => {
   const keep = await createContact.call({ name: "Keep", email: "print-keep@example.test" }, OWNER);
   const drop = await createContact.call({ name: "Drop", email: "print-drop@example.test" }, OWNER);
   const [job] = await db().insert(podJobs).values({ sku: "merge", provider: "printify", contactId: drop.id,
     payload: { buyerEmail: drop.email, shippingAddress: { street1: "Snapshot address" } } }).returning();
   await mergeContacts.call({ survivingId: keep.id, duplicateId: drop.id }, OWNER);
   const [saved] = await db().select().from(podJobs).where(eq(podJobs.id, job!.id));
   expect(saved!.contactId).toBe(keep.id);
   expect(saved!.payload).toEqual(job!.payload);
 });

 it("bounds scheduled work and excludes active leases and terminal shipments", async () => {
   await db().insert(podJobs).values(Array.from({ length: 55 }, (_, n) => ({ sku: `batch-${n}`, provider: "printify" })));
   const [active] = await db().insert(podJobs).values({ sku: "active", provider: "printify", providerLeaseToken: crypto.randomUUID(), providerLeaseExpiresAt: new Date(Date.now() + 60_000) }).returning();
   const [shipped] = await db().insert(podJobs).values({ sku: "shipped", provider: "printify", status: "fulfilled" }).returning();
   const batch = await getService("printOnDemand.workBatch").call({ kind: "submit" }, { kind: "system" }) as Array<{ id: string }>;
   expect(batch).toHaveLength(50);
   expect(batch.map(row => row.id)).not.toContain(active!.id);
   expect(batch.map(row => row.id)).not.toContain(shipped!.id);
   await expect(getService("printOnDemand.workBatch").call({ kind: "submit" }, OWNER)).rejects.toMatchObject({ code: "permission" });
 });

 it("reclaims an expired submission with the same identity and rejects its stale result", async () => {
   const [job] = await db().insert(podJobs).values({ sku: "recovery", provider: "printify" }).returning();
   const claim = getService("printOnDemand.claimSubmit");
   const first = await claim.call({ jobId: job!.id }, { kind: "system" }) as { leaseToken: string; externalId: string };
   await db().update(podJobs).set({ providerLeaseExpiresAt: new Date(Date.now() - 1000) }).where(eq(podJobs.id, job!.id));
   const second = await claim.call({ jobId: job!.id }, { kind: "system" }) as { leaseToken: string; externalId: string };
   expect(second.externalId).toBe(first.externalId);
   expect(second.leaseToken).not.toBe(first.leaseToken);
   await expect(getService("printOnDemand.applySubmit").call({ jobId: job!.id, leaseToken: first.leaseToken, externalRef: "stale" }, { kind: "system" })).rejects.toMatchObject({ code: "conflict" });
   await getService("printOnDemand.applySubmit").call({ jobId: job!.id, leaseToken: second.leaseToken, externalRef: "current" }, { kind: "system" });
   const [saved] = await db().select().from(podJobs).where(eq(podJobs.id, job!.id));
   expect(saved!.externalRef).toBe("current");
 });
});
