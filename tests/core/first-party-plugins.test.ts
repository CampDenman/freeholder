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
import {
  addGiftRegistryItem,
  contributeToGiftRegistry,
  createGiftRegistry,
  getGiftRegistryBySlug,
  invoiceGiftRegistryItem,
} from "../../plugins/gift-registry/service";
import { listPodJobs, queuePodJob, submitPodJob } from "../../plugins/print-on-demand/service";
import {
  connectMarketplaceChannel,
  listMarketplaceChannels,
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
    }
  });
});

describe.runIf(hasDatabase)("first-party plugin sync and recovery (C3.13)", () => {
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

    const retryQueued = await queuePodJob.call({ sku: "mug-ok", provider: "printify" }, OWNER);
    const submitted = await submitPodJob.call({ jobId: retryQueued.id }, OWNER);
    expect(submitted.status).toBe("submitted");
    expect(submitted.externalRef).toMatch(/^pod:/);
    expect((await listPodJobs.call({}, OWNER)).length).toBe(2);
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
