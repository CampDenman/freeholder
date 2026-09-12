// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// First-party plugins: human surfaces, provider sync, failure recovery (C3.13).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import manifests from "@/modules";
import { isPluginManifest } from "@/core/plugin";
import { ready } from "@/core/runtime";
import { createContact, mergeContacts } from "@/core/contacts/service";
import { listInvoices } from "@/modules/invoicing/invoice-service";
import {
  addGiftRegistryItem,
  contributeToGiftRegistry,
  createGiftRegistry,
  getGiftRegistryBySlug,
  invoiceGiftRegistryItem,
} from "../../plugins/gift-registry/service";
import { listPodJobs, queuePodJob, submitPodJob } from "../../plugins/print-on-demand/service";
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
      if (name === "marketplace") {
        expect(manifest.migrations).toContain("0168_marketplace_channel_sync.sql");
      }
    }
  });
});

describe.runIf(hasDatabase)("first-party plugin sync and recovery (C3.13)", () => {
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

    const retryQueued = await queuePodJob.call({ sku: "mug-ok", provider: "printify" }, OWNER);
    const submitted = await submitPodJob.call({ jobId: retryQueued.id }, OWNER);
    expect(submitted.status).toBe("submitted");
    expect(submitted.externalRef).toMatch(/^pod:/);
    expect((await listPodJobs.call({}, OWNER)).length).toBe(2);
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
