// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// First-party plugins: human surfaces, provider sync, failure recovery (C3.13).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import manifests from "@/modules";
import { isPluginManifest } from "@/core/plugin";
import { ready } from "@/core/runtime";
import { createContact } from "@/core/contacts/service";
import {
  addGiftRegistryItem,
  contributeToGiftRegistry,
  createGiftRegistry,
  getGiftRegistryBySlug,
  invoiceGiftRegistryItem,
} from "../../plugins/gift-registry/service";
import {
  listPodJobs,
  mapPodSku,
  queueOrderLines,
  queuePodJob,
  submitPodJob,
} from "../../plugins/print-on-demand/service";
import {
  addCartItem,
  applyVariantMatrix,
  checkoutCart,
  createPriceList,
  createProduct,
  createShippingMethod,
  createShippingZone,
  getFulfillment,
  getOrCreateCart,
  getOrder,
  getProductVariants,
  payOrder,
  setPriceListEntry,
} from "@/modules/catalog/service";
import { createPayment, settlePayment } from "@/modules/invoicing/invoice-service";
import {
  connectMarketplaceChannel,
  listMarketplaceChannels,
  syncMarketplaceChannel,
} from "../../plugins/marketplace/service";
import { listVoiceVideoArtifacts, recordVoiceVideoArtifact } from "../../plugins/voice-video/service";
import {
  createCommunitySpace,
  getCommunitySpaceBySlug,
  joinCommunity,
  joinCommunityBySlug,
} from "../../plugins/community/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const FIRST_PARTY = [
  "gift-registry",
  "print-on-demand",
  "community",
  "voice-video",
  "marketplace",
];

describe("first-party plugins (C3.13)", () => {
  it("ships each assigned plugin as definePlugin", () => {
    for (const name of FIRST_PARTY) {
      const manifest = manifests.find((item) => item.name === name);
      expect(manifest, name).toBeTruthy();
      if (!manifest || !isPluginManifest(manifest)) {
        throw new Error(`${name} is not a plugin`);
      }
      expect(manifest.requires).toContain("core");
      expect(manifest.migrations).toContain("0163_first_party_plugin_surfaces.sql");
      if (name === "print-on-demand") {
        expect(manifest.migrations).toContain("0168_print_on_demand_fulfillment.sql");
        expect(manifest.requires).toContain("catalog");
      }
    }
  });
});

describe.runIf(hasDatabase)("first-party plugin sync and recovery (C3.13)", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
  });
  afterAll(closeDb);

  it("invoices a gift through the spine and recovers a failed print job", async () => {
    const person = await createContact.call(
      { name: "Jordan Hale", email: "jordan.hale@demo.freeholder.test" },
      OWNER,
    );
    const registry = await createGiftRegistry.call(
      { contactId: person.id, title: "Sitting gifts", slug: "sitting-gifts" },
      OWNER,
    );
    const conflict = await failure(
      createGiftRegistry.call(
        { contactId: person.id, title: "Copy", slug: "sitting-gifts" },
        OWNER,
      ),
    );
    expect(conflict.code).toBe("conflict");

    const item = await addGiftRegistryItem.call(
      { registryId: registry.id, title: "Print", amountCents: 4_500, currency: "USD" },
      OWNER,
    );
    const invoiced = await invoiceGiftRegistryItem.call({ itemId: item.id }, OWNER);
    expect(invoiced.status).toBe("invoiced");
    expect(invoiced.invoiceId).toBeTruthy();

    const publicPage = await getGiftRegistryBySlug.call(
      { slug: "sitting-gifts" },
      { kind: "anonymous" },
    );
    expect(publicPage.registry.title).toBe("Sitting gifts");

    const queued = await queuePodJob.call({ sku: "fail-mug", provider: "printify" }, OWNER);
    const failed = await submitPodJob.call({ jobId: queued.id }, OWNER);
    expect(failed.status).toBe("failed");
    expect(failed.lastError).toMatch(/refused/i);

    const retried = await submitPodJob.call({ jobId: queued.id }, OWNER);
    expect(retried.id).toBe(queued.id);
    expect(retried.status).toBe("failed");
    expect(retried.lastError).toMatch(/refused/i);
    expect((await listPodJobs.call({}, OWNER)).length).toBe(1);
  });

  it("fulfills a mapped catalog order through the print plugin and retries a fail- SKU in place", async () => {
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
          shippingAddress: { country: "CA", city: "Courtenay" },
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

    await mapPodSku.call(
      { sku: "mug-ok", provider: "printify", providerProductId: "printify-mug-1" },
      OWNER,
    );
    await mapPodSku.call(
      { sku: "fail-mug", provider: "printify", providerProductId: "fail-printify-mug" },
      OWNER,
    );

    const paid = await paidPrintOrder("mug-ok");
    const jobs = await queueOrderLines.call({ orderId: paid.order.id }, OWNER);
    expect(jobs).toHaveLength(1);
    const job =
      jobs[0]!.status === "queued" || jobs[0]!.status === "failed"
        ? await submitPodJob.call({ jobId: jobs[0]!.id }, OWNER)
        : jobs[0]!;
    expect(job.status).toBe("submitted");
    expect(job.orderId).toBe(paid.order.id);
    expect(job.fulfillmentId).toBeTruthy();
    expect(job.externalRef).toBe("pod:printify:printify-mug-1");
    const shipment = await getFulfillment.call({ id: job.fulfillmentId! }, OWNER);
    expect(shipment.fulfillment.status).toBe("shipped");
    expect(shipment.fulfillment.trackingNumber).toBe(job.externalRef);
    expect((await getOrder.call({ id: paid.order.id }, OWNER)).order.status).toBe("fulfilled");

    const refused = await paidPrintOrder("fail-mug");
    const failedJobs = await queueOrderLines.call({ orderId: refused.order.id }, OWNER);
    expect(failedJobs).toHaveLength(1);
    const failed =
      failedJobs[0]!.status === "failed"
        ? failedJobs[0]!
        : await submitPodJob.call({ jobId: failedJobs[0]!.id }, OWNER);
    expect(failed.status).toBe("failed");
    expect(failed.lastError).toMatch(/refused/i);
    const retried = await submitPodJob.call({ jobId: failed.id }, OWNER);
    expect(retried.id).toBe(failed.id);
    expect(retried.status).toBe("failed");
    expect((await listPodJobs.call({}, OWNER)).filter((row) => row.orderId === refused.order.id)).toHaveLength(1);
    const open = await getFulfillment.call({ id: retried.fulfillmentId! }, OWNER);
    expect(open.fulfillment.status).toBe("pending");
    expect((await getOrder.call({ id: refused.order.id }, OWNER)).order.status).toBe("fulfilling");
  });

  it("connects a marketplace, recovers a refused handshake, and imports an order", async () => {
    const failed = await connectMarketplaceChannel.call(
      { name: "fail-shop", provider: "shopify" },
      OWNER,
    );
    expect(failed.status).toBe("failed");
    const recovered = await connectMarketplaceChannel.call(
      { name: "Harbour shop", provider: "shopify", channelId: failed.id },
      OWNER,
    );
    expect(recovered.status).toBe("connected");
    const synced = await syncMarketplaceChannel.call({ channelId: recovered.id }, OWNER);
    expect(synced.imported).toBe(1);
    expect(synced.lastError).toBeNull();
    expect((await listMarketplaceChannels.call({}, OWNER))[0]?.lastSyncedAt).toBeTruthy();
  });

  it("attaches a voice artifact to the contact thread and retries a provider failure", async () => {
    const person = await createContact.call(
      { name: "Ada", email: "ada@demo.freeholder.test" },
      OWNER,
    );
    const failed = await recordVoiceVideoArtifact.call(
      {
        contactId: person.id,
        kind: "voice",
        provider: "fixture",
        title: "fail-call",
      },
      OWNER,
    );
    expect(failed.status).toBe("failed");
    const recorded = await recordVoiceVideoArtifact.call(
      {
        contactId: person.id,
        kind: "voice",
        provider: "fixture",
        title: "Sitting recap",
        artifactId: failed.id,
      },
      OWNER,
    );
    expect(recorded.status).toBe("recorded");
    expect(recorded.conversationId).toBeTruthy();
    expect((await listVoiceVideoArtifacts.call({}, OWNER)).length).toBe(1);
  });

  it("lets a visitor join an open community and refuses a duplicate", async () => {
    const space = await createCommunitySpace.call(
      { slug: "harbour", title: "Harbour circle", access: "open" },
      OWNER,
    );
    const joined = await joinCommunityBySlug.call(
      { slug: "harbour", email: "member@demo.freeholder.test", name: "Member" },
      { kind: "anonymous" },
    );
    expect(joined.spaceId).toBe(space.id);
    const duplicate = await failure(
      joinCommunityBySlug.call(
        { slug: "harbour", email: "member@demo.freeholder.test", name: "Member" },
        { kind: "anonymous" },
      ),
    );
    expect(duplicate.code).toBe("conflict");

    const gated = await createCommunitySpace.call(
      { slug: "private", title: "Private circle", access: "gated" },
      OWNER,
    );
    const refused = await failure(
      joinCommunityBySlug.call(
        { slug: "private", email: "outsider@demo.freeholder.test", name: "Outsider" },
        { kind: "anonymous" },
      ),
    );
    expect(refused.code).toBe("permission");
    const staffJoin = await joinCommunity.call(
      { spaceId: gated.id, contactId: joined.contactId },
      OWNER,
    );
    expect(staffJoin.spaceId).toBe(gated.id);
    const publicPage = await getCommunitySpaceBySlug.call(
      { slug: "harbour" },
      { kind: "anonymous" },
    );
    expect(publicPage.memberCount).toBe(1);
  });

  it("raises a public gift contribution onto an invoice", async () => {
    const person = await createContact.call(
      { name: "Owner", email: "owner-gifts@demo.freeholder.test" },
      OWNER,
    );
    const registry = await createGiftRegistry.call(
      { contactId: person.id, title: "Public gifts", slug: "public-gifts" },
      OWNER,
    );
    const item = await addGiftRegistryItem.call(
      { registryId: registry.id, title: "Frame", amountCents: 2_000, currency: "USD" },
      OWNER,
    );
    const contributed = await contributeToGiftRegistry.call(
      {
        slug: "public-gifts",
        itemId: item.id,
        email: "giver@demo.freeholder.test",
        name: "Giver",
      },
      { kind: "anonymous" },
    );
    expect(contributed.status).toBe("invoiced");
    expect(contributed.invoiceId).toBeTruthy();
  });
});
