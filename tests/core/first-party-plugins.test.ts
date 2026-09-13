// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// First-party plugins: human surfaces, provider sync, failure recovery (C3.13).
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import manifests from "@/modules";
import { isPluginManifest } from "@/core/plugin";
import { ready } from "@/core/runtime";
import { createContact, mergeContacts } from "@/core/contacts/service";
import { timelineEvents } from "@/core/contacts/schema";
import { db } from "@/core/db";
import { getConversation } from "@/core/messaging/service";
import { getService } from "@/core/service";
import { listInvoices } from "@/modules/invoicing/invoice-service";
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
  failMarketplaceListAfterPages,
  marketplaceListOrderCalls,
  resetStagedMarketplaceOrders,
  stageMarketplaceOrders,
} from "../../plugins/marketplace/adapter";
import {
  connectMarketplaceChannel,
  listMarketplaceChannels,
  listMarketplaceOrders,
  syncMarketplaceChannel,
} from "../../plugins/marketplace/service";
import {
  joinVoiceVideoRoom,
  listVoiceVideoArtifacts,
  listVoiceVideoJoins,
  listVoiceVideoRooms,
  missVoiceVideoRoom,
  recordVoiceVideoArtifact,
  startVoiceVideoRoom,
  stopVoiceVideoRoom,
} from "../../plugins/voice-video/service";
import {
  createCommunityPostBySlug,
  createCommunityRoom,
  createCommunitySpace,
  getCommunityFeedBySlug,
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
      expect(manifest.migrations).toContain("0000_reviewed-baseline.sql");
      if (name === "community") {
        expect(manifest.migrations).toContain("0001_community_rooms.sql");
      }
      if (name === "voice-video") {
        expect(manifest.migrations).toContain("0002_voice_video_rooms.sql");
      }
      if (name === "print-on-demand") {
        expect(manifest.migrations).toContain("0003_print_on_demand_fulfillment.sql");
        expect(manifest.requires).toContain("catalog");
      }
      if (name === "marketplace") {
        expect(manifest.migrations).toContain("0004_marketplace_channel_sync.sql");
      }
    }
  });
});

describe.runIf(hasDatabase)("first-party plugin sync and recovery (C3.13)", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    resetStagedMarketplaceOrders();
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

  it("refuses a marketplace handshake and retries the same channel", async () => {
    const failed = await connectMarketplaceChannel.call(
      { name: "fail-shop", provider: "shopify" },
      OWNER,
    );
    expect(failed.status).toBe("failed");
    expect(failed.lastError).toMatch(/refused/i);
    expect(await listMarketplaceChannels.call({}, OWNER)).toHaveLength(1);
    const recovered = await connectMarketplaceChannel.call(
      { name: "Harbour shop", provider: "shopify", channelId: failed.id },
      OWNER,
    );
    expect(recovered.id).toBe(failed.id);
    expect(recovered.status).toBe("connected");
    expect(recovered.lastError).toBeNull();
    expect(await listMarketplaceChannels.call({}, OWNER)).toHaveLength(1);
  });

  it("pages two staged orders onto invoices and repoints them on merge", async () => {
    stageMarketplaceOrders("shopify", [
      {
        externalRef: "shopify-1001",
        description: "Harbour print",
        amountMinor: 2_500,
        currency: "USD",
        buyerEmail: "ada.market@demo.freeholder.test",
        buyerName: "Ada Market",
      },
      {
        externalRef: "shopify-1002",
        description: "Sitting frame",
        amountMinor: 4_000,
        currency: "USD",
        buyerEmail: "ada.dup@demo.freeholder.test",
        buyerName: "Ada Duplicate",
      },
    ]);
    const connected = await connectMarketplaceChannel.call(
      { name: "Harbour shop", provider: "shopify" },
      OWNER,
    );
    expect(connected.status).toBe("connected");
    const synced = await syncMarketplaceChannel.call({ channelId: connected.id }, OWNER);
    expect(synced.imported).toBe(2);
    expect(synced.lastError).toBeNull();
    expect(marketplaceListOrderCalls()).toBe(2);
    const channel = (await listMarketplaceChannels.call({}, OWNER))[0];
    expect(channel?.lastSyncedAt).toBeTruthy();
    expect(channel?.syncCursor).toBeNull();
    expect(channel?.status).toBe("connected");

    const imported = await listMarketplaceOrders.call({ channelId: connected.id }, OWNER);
    expect(imported).toHaveLength(2);
    const contactIds = [...new Set(imported.map((row) => row.contactId))];
    expect(contactIds).toHaveLength(2);
    const invoices = (await listInvoices.call({}, OWNER)).filter((row) =>
      row.idempotencyKey.startsWith(`marketplace:${connected.id}:`),
    );
    expect(invoices).toHaveLength(2);
    expect(invoices.map((row) => row.idempotencyKey).sort()).toEqual(
      [`marketplace:${connected.id}:shopify-1001`, `marketplace:${connected.id}:shopify-1002`].sort(),
    );
    expect(invoices.map((row) => row.sourceId).sort()).toEqual(
      [`marketplace:${connected.id}:shopify-1001`, `marketplace:${connected.id}:shopify-1002`].sort(),
    );
    expect(invoices.map((row) => row.contactId).sort()).toEqual([...contactIds].sort());
    expect(invoices.every((row) => row.sourceType === "order")).toBe(true);

    const again = await syncMarketplaceChannel.call({ channelId: connected.id }, OWNER);
    expect(again.imported).toBe(0);
    expect(await listMarketplaceOrders.call({ channelId: connected.id }, OWNER)).toHaveLength(2);

    const [keep, drop] = contactIds;
    await mergeContacts.call({ survivingId: keep!, duplicateId: drop! }, OWNER);
    const merged = await listMarketplaceOrders.call({ channelId: connected.id }, OWNER);
    expect(merged).toHaveLength(2);
    expect(merged.every((row) => row.contactId === keep)).toBe(true);
    const keptInvoices = await listInvoices.call({ contactId: keep }, OWNER);
    expect(
      keptInvoices.filter((row) => row.idempotencyKey.startsWith(`marketplace:${connected.id}:`)),
    ).toHaveLength(2);
  });

  it("keeps Shopify and Etsy invoices distinct when they share an order number", async () => {
    const order = {
      externalRef: "1001",
      description: "Shared number",
      amountMinor: 2_500,
      currency: "USD",
      buyerEmail: "shopify.buyer@demo.freeholder.test",
      buyerName: "Shopify Buyer",
    };
    stageMarketplaceOrders("shopify", [order]);
    stageMarketplaceOrders("etsy", [
      { ...order, buyerEmail: "etsy.buyer@demo.freeholder.test", buyerName: "Etsy Buyer", amountMinor: 4_000 },
    ]);
    const shopify = await connectMarketplaceChannel.call(
      { name: "Harbour shop", provider: "shopify" },
      OWNER,
    );
    const etsy = await connectMarketplaceChannel.call({ name: "Harbour etsy", provider: "etsy" }, OWNER);
    expect((await syncMarketplaceChannel.call({ channelId: shopify.id }, OWNER)).imported).toBe(1);
    expect((await syncMarketplaceChannel.call({ channelId: etsy.id }, OWNER)).imported).toBe(1);
    const invoices = (await listInvoices.call({}, OWNER)).filter((row) =>
      row.idempotencyKey.startsWith("marketplace:"),
    );
    expect(invoices).toHaveLength(2);
    expect(invoices.map((row) => row.idempotencyKey).sort()).toEqual(
      [`marketplace:${etsy.id}:1001`, `marketplace:${shopify.id}:1001`].sort(),
    );
    expect(new Set(invoices.map((row) => row.contactId)).size).toBe(2);
  });

  it("fails a listOrders page in place and retries from the saved cursor", async () => {
    stageMarketplaceOrders("shopify", [
      {
        externalRef: "page-1",
        description: "First page",
        amountMinor: 1_000,
        currency: "USD",
        buyerEmail: "page.one@demo.freeholder.test",
        buyerName: "Page One",
      },
      {
        externalRef: "page-2",
        description: "Second page",
        amountMinor: 2_000,
        currency: "USD",
        buyerEmail: "page.two@demo.freeholder.test",
        buyerName: "Page Two",
      },
    ]);
    const connected = await connectMarketplaceChannel.call(
      { name: "Harbour shop", provider: "shopify" },
      OWNER,
    );
    failMarketplaceListAfterPages(1);
    const failed = await syncMarketplaceChannel.call({ channelId: connected.id }, OWNER);
    expect(failed.imported).toBe(1);
    expect(failed.lastError).toMatch(/could not list/i);
    const paused = (await listMarketplaceChannels.call({}, OWNER))[0];
    expect(paused?.status).toBe("connected");
    expect(paused?.syncCursor).toBe("1");
    expect(await listMarketplaceOrders.call({ channelId: connected.id }, OWNER)).toHaveLength(1);

    failMarketplaceListAfterPages(null);
    const retried = await syncMarketplaceChannel.call({ channelId: connected.id }, OWNER);
    expect(retried.imported).toBe(1);
    expect(retried.lastError).toBeNull();
    expect(await listMarketplaceOrders.call({ channelId: connected.id }, OWNER)).toHaveLength(2);
    expect((await listMarketplaceChannels.call({}, OWNER))[0]?.syncCursor).toBeNull();
  });

  it("refuses a fail- staged list and retries the same channel", async () => {
    stageMarketplaceOrders("shopify", [
      {
        externalRef: "fail-list",
        description: "Should not import",
        amountMinor: 1_000,
        currency: "USD",
        buyerEmail: "fail.list@demo.freeholder.test",
        buyerName: "Fail List",
      },
    ]);
    const connected = await connectMarketplaceChannel.call(
      { name: "Harbour shop", provider: "shopify" },
      OWNER,
    );
    const failed = await syncMarketplaceChannel.call({ channelId: connected.id }, OWNER);
    expect(failed.imported).toBe(0);
    expect(failed.lastError).toMatch(/could not list/i);
    expect((await listMarketplaceChannels.call({}, OWNER))[0]?.status).toBe("connected");
    expect(await listMarketplaceOrders.call({ channelId: connected.id }, OWNER)).toHaveLength(0);

    resetStagedMarketplaceOrders();
    stageMarketplaceOrders("shopify", [
      {
        externalRef: "ok-1",
        description: "Recovered",
        amountMinor: 1_500,
        currency: "USD",
        buyerEmail: "ok.list@demo.freeholder.test",
        buyerName: "Ok List",
      },
    ]);
    const retried = await syncMarketplaceChannel.call({ channelId: connected.id }, OWNER);
    expect(retried.imported).toBe(1);
    expect(retried.lastError).toBeNull();
    expect(await listMarketplaceOrders.call({ channelId: connected.id }, OWNER)).toHaveLength(1);
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
    expect(recorded.transcript).toMatch(/Sitting recap/);
    const artifacts = await listVoiceVideoArtifacts.call({}, OWNER);
    expect(artifacts).toHaveLength(2);
    const transcript = artifacts.find((row) => row.kind === "transcript");
    expect(transcript?.conversationId).toBe(recorded.conversationId);
    expect(transcript?.transcript).toBe(recorded.transcript);
    const thread = await getConversation.call({ id: recorded.conversationId! }, OWNER);
    expect(thread?.messages.some((message) => message.body === recorded.transcript)).toBe(true);
    const ready = await db()
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.eventType, "voiceVideo.recordingReady"));
    expect(ready.some((event) => event.contactId === person.id)).toBe(true);
  });

  it("starts a room, records a join, and marks a missed call on the timeline", async () => {
    const person = await createContact.call(
      { name: "Rae", email: "rae@demo.freeholder.test" },
      OWNER,
    );
    const failed = await startVoiceVideoRoom.call(
      {
        contactId: person.id,
        kind: "voice",
        provider: "fixture",
        title: "fail-room",
      },
      OWNER,
    );
    expect(failed.status).toBe("failed");
    const live = await startVoiceVideoRoom.call(
      {
        contactId: person.id,
        kind: "voice",
        provider: "fixture",
        title: "Sitting consult",
        roomId: failed.id,
      },
      OWNER,
    );
    expect(live.status).toBe("live");
    expect(live.conversationId).toBeTruthy();
    const joined = await joinVoiceVideoRoom.call(
      { roomId: live.id, contactId: person.id },
      OWNER,
    );
    expect(joined.contactId).toBe(person.id);
    expect(joined.conversationId).toBe(live.conversationId);
    const guest = await createContact.call(
      { name: "Bea", email: "bea@demo.freeholder.test" },
      OWNER,
    );
    const guestJoin = await joinVoiceVideoRoom.call(
      { roomId: live.id, contactId: guest.id },
      OWNER,
    );
    expect(guestJoin.contactId).toBe(guest.id);
    expect(guestJoin.conversationId).toBeTruthy();
    expect(guestJoin.conversationId).not.toBe(live.conversationId);
    const guestThread = await getConversation.call({ id: guestJoin.conversationId! }, OWNER);
    expect(guestThread?.contactId).toBe(guest.id);
    expect(guestThread?.messages.some((message) => message.body.startsWith("Joined call:"))).toBe(
      true,
    );
    const duplicate = await failure(
      joinVoiceVideoRoom.call({ roomId: live.id, contactId: person.id }, OWNER),
    );
    expect(duplicate.code).toBe("conflict");
    const missed = await missVoiceVideoRoom.call({ roomId: live.id }, OWNER);
    expect(missed.status).toBe("missed");
    const events = await db()
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.contactId, person.id));
    expect(events.some((event) => event.eventType === "voiceVideo.missedCall")).toBe(true);
    const thread = await getConversation.call({ id: live.conversationId! }, OWNER);
    expect(thread?.messages.some((message) => message.body.startsWith("Missed call:"))).toBe(true);
  });

  it("stops a room onto a recording and transcript, then merges contact pointers", async () => {
    const keep = await createContact.call(
      { name: "Jordan Hale", email: "jordan.keep@demo.freeholder.test" },
      OWNER,
    );
    const drop = await createContact.call(
      { name: "Jordan Hale", email: "jordan.drop@demo.freeholder.test" },
      OWNER,
    );
    const room = await startVoiceVideoRoom.call(
      {
        contactId: drop.id,
        kind: "video",
        provider: "fixture",
        title: "Sitting recap",
      },
      OWNER,
    );
    await joinVoiceVideoRoom.call({ roomId: room.id, contactId: drop.id }, OWNER);
    const alreadyRecorded = await recordVoiceVideoArtifact.call(
      {
        contactId: drop.id,
        kind: "video",
        provider: "fixture",
        title: "Sitting recap",
        roomId: room.id,
      },
      OWNER,
    );
    expect(alreadyRecorded.status).toBe("recorded");
    const ended = await stopVoiceVideoRoom.call({ roomId: room.id }, OWNER);
    expect(ended.status).toBe("ended");
    const artifacts = await listVoiceVideoArtifacts.call({}, OWNER);
    const recordings = artifacts.filter((row) => row.kind !== "transcript" && row.roomId === room.id);
    expect(recordings).toHaveLength(1);
    const recording = recordings[0];
    const transcript = artifacts.find((row) => row.kind === "transcript");
    expect(recording?.conversationId).toBe(ended.conversationId);
    expect(transcript?.conversationId).toBe(ended.conversationId);
    expect(transcript?.contactId).toBe(drop.id);
    const thread = await getConversation.call({ id: ended.conversationId! }, OWNER);
    expect(thread?.messages.some((message) => message.body === recording?.transcript)).toBe(true);

    await mergeContacts.call({ survivingId: keep.id, duplicateId: drop.id }, OWNER);
    expect((await listVoiceVideoRooms.call({}, OWNER))[0]?.contactId).toBe(keep.id);
    expect((await listVoiceVideoJoins.call({ roomId: room.id }, OWNER))[0]?.contactId).toBe(keep.id);
    expect((await listVoiceVideoArtifacts.call({}, OWNER)).every((row) => row.contactId === keep.id)).toBe(
      true,
    );
  });

  it("keeps one join when both people in a room are merged", async () => {
    const host = await createContact.call(
      { name: "Host", email: "host.room@demo.freeholder.test" },
      OWNER,
    );
    const keep = await createContact.call(
      { name: "Sam Keep", email: "sam.keep@demo.freeholder.test" },
      OWNER,
    );
    const drop = await createContact.call(
      { name: "Sam Drop", email: "sam.drop@demo.freeholder.test" },
      OWNER,
    );
    const room = await startVoiceVideoRoom.call(
      {
        contactId: host.id,
        kind: "voice",
        provider: "fixture",
        title: "Pair call",
      },
      OWNER,
    );
    await joinVoiceVideoRoom.call({ roomId: room.id, contactId: keep.id }, OWNER);
    await joinVoiceVideoRoom.call({ roomId: room.id, contactId: drop.id }, OWNER);
    expect(await listVoiceVideoJoins.call({ roomId: room.id }, OWNER)).toHaveLength(2);
    await mergeContacts.call({ survivingId: keep.id, duplicateId: drop.id }, OWNER);
    const joins = await listVoiceVideoJoins.call({ roomId: room.id }, OWNER);
    expect(joins).toHaveLength(1);
    expect(joins[0]?.contactId).toBe(keep.id);
  });

  it("keeps a vendor room ref when the contact thread cannot be written", async () => {
    const person = await createContact.call(
      { name: "Lea", email: "lea@demo.freeholder.test" },
      OWNER,
    );
    const failed = await startVoiceVideoRoom.call(
      {
        contactId: person.id,
        kind: "voice",
        provider: "fixture",
        title: "fail-thread",
      },
      OWNER,
    );
    await getService("voiceVideo.applyStart").call(
      {
        roomId: failed.id,
        externalRef: "vv-room:leaked",
        lastError: "The contact thread could not be written.",
      },
      { kind: "system" },
    );
    const stored = (await listVoiceVideoRooms.call({}, OWNER)).find((row) => row.id === failed.id);
    expect(stored?.status).toBe("failed");
    expect(stored?.externalRef).toBe("vv-room:leaked");
    const restart = await failure(
      startVoiceVideoRoom.call(
        {
          contactId: person.id,
          kind: "voice",
          provider: "fixture",
          title: "Sitting consult",
          roomId: failed.id,
        },
        OWNER,
      ),
    );
    expect(restart.code).toBe("conflict");
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

    const room = await createCommunityRoom.call(
      { spaceId: space.id, slug: "lounge", title: "Lounge" },
      OWNER,
    );
    expect(room.spaceId).toBe(space.id);
    await createCommunityPostBySlug.call(
      {
        slug: "harbour",
        roomSlug: "lounge",
        email: "member@demo.freeholder.test",
        name: "Member",
        body: "Hello harbour.",
      },
      { kind: "anonymous" },
    );
    const openFeed = await getCommunityFeedBySlug.call(
      { slug: "harbour" },
      { kind: "anonymous" },
    );
    expect(openFeed.canRead).toBe(true);
    expect(openFeed.posts.map((post) => post.body)).toEqual(["Hello harbour."]);

    const gatedFeed = await getCommunityFeedBySlug.call(
      { slug: "private" },
      { kind: "anonymous" },
    );
    expect(gatedFeed.canRead).toBe(false);
    expect(gatedFeed.posts).toHaveLength(0);
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
