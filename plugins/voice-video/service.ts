// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { createHash, randomUUID } from "node:crypto";
import { env } from "@/core/env";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { isUniqueViolation } from "@/core/db";
import {
  defineOrchestratedService,
  defineService,
  getService,
  ServiceError,
} from "@/core/service";
import {
  attachPluginContactColumn,
  attachPluginUniqueContactColumn,
} from "@/core/plugins/spine";
import {
  clipSnippet,
  matchesIlike,
  registerSearchSource,
} from "@/core/search/registry";
import { queueRoomErasure } from "./erasure";
import { voiceVideoProvider } from "./adapter";
import { voiceVideoArtifacts, voiceVideoJoins, voiceVideoRooms } from "./schema";

attachPluginContactColumn({
  table: "voice_video_rooms",
  schema: voiceVideoRooms,
  label: "A voice or video room",
  scope: "plugins.voice-video.rooms",
  retentionScopes: ["plugins.voice-video", "plugins.voice-video.joins"],
  beforeErase: queueRoomErasure,
});
attachPluginUniqueContactColumn({
  table: "voice_video_joins",
  schema: voiceVideoJoins,
  parent: voiceVideoJoins.roomId,
  label: "A voice or video join",
  scope: "plugins.voice-video.joins",
});
attachPluginContactColumn({
  table: "voice_video_artifacts",
  schema: voiceVideoArtifacts,
  label: "A voice or video artifact",
  scope: "plugins.voice-video",
});

const PROVIDER_LEASE_MS = 10 * 60 * 1000;
const ROOM_LIFETIME_SECONDS = 24 * 60 * 60;
const kindEnum = z.enum(["voice", "video"]);

const roomRow = row({
  id: uuid,
  contactId: uuid,
  conversationId: uuid.nullable(),
  kind: z.string(),
  provider: z.string(),
  title: z.string(),
  status: z.string(),
  externalRef: z.string().nullable(),
  lastError: z.string().nullable(),
  providerLeaseExpiresAt: timestamp.nullable(),
});

const joinRow = row({
  id: uuid,
  roomId: uuid,
  contactId: uuid,
  conversationId: uuid.nullable(),
  status: z.string(),
});

const artifactRow = row({
  id: uuid,
  contactId: uuid,
  roomId: uuid.nullable(),
  kind: z.string(),
  provider: z.string(),
  title: z.string(),
  status: z.string(),
  externalRef: z.string().nullable(),
  conversationId: uuid.nullable(),
  transcript: z.string().nullable(),
  durationSeconds: z.number().int().nullable(),
  lastError: z.string().nullable(),
  providerLeaseExpiresAt: timestamp.nullable(),
});

const claimStart = defineService({
  name: "voiceVideo.claimStart", summary: "Lease a private provider room before opening it.",
  kind: "mutation", permission: "scoped", external: false, writeClass: "write",
  input: z.object({ contactId: uuid, kind: kindEnum, provider: z.string().min(1), title: z.string().min(1).max(160), roomId: uuid.optional() }),
  output: z.object({ roomId: uuid, contactId: uuid, kind: kindEnum, provider: z.string(), title: z.string(),
    leaseToken: uuid, accountDomain: z.string().nullable(), expiresAt: z.number().int() }),
  handler: async (input, ctx) => {
    const leaseToken = randomUUID();
    const providerLeaseExpiresAt = new Date(Date.now() + PROVIDER_LEASE_MS);
    if (input.roomId) {
      const [existing] = await ctx.tx.select().from(voiceVideoRooms).where(eq(voiceVideoRooms.id, input.roomId)).limit(1).for("update");
      if (!existing) throw new ServiceError("not_found", "No such room.");
      if (["live", "ended", "missed", "stopping"].includes(existing.status)) throw new ServiceError("conflict", "That room is already open or finished.");
      if (existing.providerLeaseToken && existing.providerLeaseExpiresAt && existing.providerLeaseExpiresAt > new Date()) throw new ServiceError("conflict", "That room is already being opened.");
      if (existing.externalRef) throw new ServiceError("conflict", "That room already has a provider session. Stop it instead.");
      const accountDomain = existing.providerDomain ?? (existing.provider === "daily" ? env().DAILY_DOMAIN ?? null : null);
      await ctx.tx.update(voiceVideoRooms).set({ status: "pending", lastError: null, title: input.title,
        providerDomain: accountDomain, providerLeaseToken: leaseToken, providerLeaseExpiresAt }).where(eq(voiceVideoRooms.id, existing.id));
      return { roomId: existing.id, contactId: existing.contactId, kind: kindEnum.parse(existing.kind), provider: existing.provider,
        title: input.title, leaseToken, accountDomain, expiresAt: Math.floor(existing.createdAt.getTime() / 1000) + ROOM_LIFETIME_SECONDS };
    }
    const accountDomain = input.provider === "daily" ? env().DAILY_DOMAIN ?? null : null;
    const [created] = await ctx.tx.insert(voiceVideoRooms).values({ contactId: input.contactId, kind: input.kind, provider: input.provider,
      title: input.title, status: "pending", providerDomain: accountDomain, providerLeaseToken: leaseToken, providerLeaseExpiresAt }).returning();
    ctx.setSubject("voice_video_room", created!.id);
    return { roomId: created!.id, contactId: created!.contactId, kind: input.kind, provider: input.provider, title: input.title,
      leaseToken, accountDomain, expiresAt: Math.floor(created!.createdAt.getTime() / 1000) + ROOM_LIFETIME_SECONDS };
  },
});

const applyStart = defineService({
  name: "voiceVideo.applyStart", summary: "Apply a verified room and its conversation entry atomically.",
  kind: "mutation", permission: "scoped", external: false, writeClass: "write",
  input: z.object({ roomId: uuid, leaseToken: uuid, externalRef: z.string().max(200).optional(), providerRoomId: uuid.optional(), lastError: z.string().max(500).optional() }),
  output: okResult,
  handler: async (input, ctx) => {
    const [room] = await ctx.tx.select().from(voiceVideoRooms).where(eq(voiceVideoRooms.id, input.roomId)).limit(1).for("update");
    if (!room || room.providerLeaseToken !== input.leaseToken || !room.providerLeaseExpiresAt || room.providerLeaseExpiresAt <= new Date()) throw new ServiceError("conflict", "That room operation no longer owns its lease.");
    let conversationId = room.conversationId;
    if (input.externalRef && !input.lastError) {
      const recorded = await ctx.call(getService("conversations.record"), { contactId: room.contactId, direction: "outbound", channel: "chat",
        body: `Call room opened: ${room.title}`, sentBy: "system", providerRef: `vv-start:${room.id}`,
        ...(conversationId ? { conversationId } : {}) }) as { conversation: { id: string } };
      conversationId = recorded.conversation.id;
    }
    await ctx.tx.update(voiceVideoRooms).set({ status: input.externalRef && !input.lastError ? "live" : "failed",
      lastError: input.lastError ?? (input.externalRef ? null : "The call provider could not open that room."),
      conversationId, providerLeaseToken: null, providerLeaseExpiresAt: null,
      ...(input.externalRef ? { externalRef: input.externalRef } : {}),
      ...(input.providerRoomId ? { providerRoomId: input.providerRoomId } : {}),
    }).where(eq(voiceVideoRooms.id, room.id));
    if (input.externalRef && !input.lastError) ctx.queueEvent("voiceVideo.roomStarted", { id: room.id });
    return { ok: true as const };
  },
});

export const startVoiceVideoRoom = defineOrchestratedService({
  name: "voiceVideo.startRoom", summary: "Open a private voice or video room on the contact's conversation.",
  kind: "mutation", permission: "scoped", writeClass: "write",
  input: z.object({ contactId: uuid, kind: kindEnum, provider: z.string().min(1), title: z.string().min(1).max(160), roomId: uuid.optional() }),
  output: roomRow,
  handler: async (input) => {
    const claimed = await claimStart.call(input, { kind: "system" });
    let started: { externalRef: string; providerRoomId: string } | undefined;
    try {
      started = await voiceVideoProvider().startRoom(claimed);
      await applyStart.call({ roomId: claimed.roomId, leaseToken: claimed.leaseToken, ...started }, { kind: "system" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The call provider could not open that room.";
      await applyStart.call({ roomId: claimed.roomId, leaseToken: claimed.leaseToken, lastError: message.slice(0, 500), ...started }, { kind: "system" });
    }
    const found = (await listVoiceVideoRooms.call({}, { kind: "system" })).find(row => row.id === claimed.roomId);
    if (!found) throw new ServiceError("not_found", "No such room.");
    return found;
  },
});

export const joinVoiceVideoRoom = defineService({
  name: "voiceVideo.joinRoom",
  summary: "Record a contact joining a live room.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    roomId: z.string().uuid(),
    contactId: z.string().uuid(),
  }),
  output: joinRow,
  handler: async (input, ctx) => {
    const [room] = await ctx.tx
      .select()
      .from(voiceVideoRooms)
      .where(eq(voiceVideoRooms.id, input.roomId))
      .limit(1);
    if (!room) throw new ServiceError("not_found", "No such room.");
    if (room.status !== "live") {
      throw new ServiceError("conflict", "Join a room while it is live.");
    }
    const recorded = (await ctx.call(getService("conversations.record"), {
      contactId: input.contactId,
      direction: "inbound",
      channel: "chat",
      body: `Joined call: ${room.title}`,
      sentBy: "system",
      conversationId:
        input.contactId === room.contactId ? (room.conversationId ?? undefined) : undefined,
      providerRef: `vv-join:${room.id}:${input.contactId}`,
    })) as { conversation: { id: string } };
    try {
      const [created] = await ctx.tx
        .insert(voiceVideoJoins)
        .values({
          roomId: room.id,
          contactId: input.contactId,
          conversationId: recorded.conversation.id,
          status: "joined",
        })
        .returning();
      ctx.setSubject("voice_video_join", created!.id);
      ctx.queueEvent("voiceVideo.roomJoined", {
        id: created!.id,
        roomId: room.id,
        contactId: created!.contactId,
      });
      return created!;
    } catch (error) {
      if (isUniqueViolation(error, "voice_video_joins_room_contact_idx")) {
        throw new ServiceError("conflict", "That person is already in this room.");
      }
      throw error;
    }
  },
});

const claimStop = defineService({
  name: "voiceVideo.claimStop",
  summary: "Lease a live or failed room before ending the provider call.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  writeClass: "write",
  input: z.object({ roomId: z.string().uuid() }),
  output: row({
    roomId: uuid,
    contactId: uuid,
    conversationId: uuid.nullable(),
    kind: kindEnum,
    provider: z.string(),
    title: z.string(),
    externalRef: z.string().nullable(),
    recordedArtifactId: uuid.nullable(),
    failedArtifactId: uuid.nullable(),
    providerRoomId: uuid.nullable(),
    accountDomain: z.string().nullable(),
    leaseToken: uuid,
  }),
  handler: async (input, ctx) => {
    const [room] = await ctx.tx
      .select()
      .from(voiceVideoRooms)
      .where(eq(voiceVideoRooms.id, input.roomId))
      .limit(1).for("update");
    if (!room) throw new ServiceError("not_found", "No such room.");
    if (room.status === "ended") {
      throw new ServiceError("conflict", "That room has already been recorded.");
    }
    if (room.status === "missed") {
      throw new ServiceError("conflict", "That room was marked missed.");
    }
    if (room.providerLeaseToken && room.providerLeaseExpiresAt && room.providerLeaseExpiresAt > new Date()) {
      throw new ServiceError("conflict", "That room is already being recorded.");
    }
    if (room.status === "pending") {
      throw new ServiceError("conflict", "That room is still opening.");
    }
    if (room.status === "failed" && !room.externalRef) {
      throw new ServiceError("conflict", "Open that room before recording it.");
    }
    const artifacts = await ctx.tx
      .select()
      .from(voiceVideoArtifacts)
      .where(eq(voiceVideoArtifacts.roomId, room.id));
    const recordedArtifact = artifacts.find(
      (row) => row.status === "recorded" && row.kind !== "transcript",
    );
    const failedArtifact = artifacts.find(
      (row) => row.status === "failed" && row.kind !== "transcript",
    );
    const leaseToken = randomUUID();
    await ctx.tx
      .update(voiceVideoRooms)
      .set({ status: "stopping", lastError: null, providerLeaseToken: leaseToken, providerLeaseExpiresAt: new Date(Date.now() + PROVIDER_LEASE_MS) })
      .where(eq(voiceVideoRooms.id, room.id));
    return {
      roomId: room.id,
      contactId: room.contactId,
      conversationId: room.conversationId,
      kind: room.kind === "video" ? ("video" as const) : ("voice" as const),
      provider: room.provider,
      title: room.title,
      externalRef: room.externalRef,
      recordedArtifactId: recordedArtifact?.id ?? null,
      failedArtifactId: failedArtifact?.id ?? null,
      providerRoomId: room.providerRoomId,
      accountDomain: room.providerDomain,
      leaseToken,
    };
  },
});

const applyStop = defineService({
  name: "voiceVideo.applyStop",
  summary: "Close the room after the provider confirms that participants have left.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  writeClass: "write",
  input: z.object({
    roomId: z.string().uuid(),
    leaseToken: uuid,
    status: z.enum(["ended", "failed"]),
    conversationId: z.string().uuid().optional(),
    lastError: z.string().max(500).optional(),
  }),
  output: okResult,
  handler: async (input, ctx) => {
    const [room] = await ctx.tx.select().from(voiceVideoRooms).where(eq(voiceVideoRooms.id, input.roomId)).limit(1).for("update");
    if (!room || room.providerLeaseToken !== input.leaseToken || !room.providerLeaseExpiresAt || room.providerLeaseExpiresAt <= new Date()) throw new ServiceError("conflict", "That room shutdown no longer owns its lease.");
    await ctx.tx
      .update(voiceVideoRooms)
      .set({
        status: input.status,
        providerLeaseToken: null, providerLeaseExpiresAt: null,
        conversationId: input.conversationId ?? undefined,
        lastError: input.status === "failed" ? (input.lastError ?? "The call provider could not close that room.") : null,
      })
      .where(eq(voiceVideoRooms.id, input.roomId));
    if (input.status === "ended") {
      ctx.queueEvent("voiceVideo.roomEnded", { id: input.roomId });
    }
    return { ok: true as const };
  },
});

const captureInput = z.object({ contactId: uuid, kind: kindEnum, provider: z.string().min(1), title: z.string().min(1).max(160),
  artifactId: uuid.optional(), roomId: uuid.optional(), refresh: z.boolean().default(false) });

const claimCapture = defineService({
  name: "voiceVideo.claimCapture", summary: "Lease one recording on its canonical room and contact.",
  kind: "mutation", permission: "scoped", external: false, writeClass: "write", input: captureInput,
  output: z.object({ artifactId: uuid, contactId: uuid, kind: kindEnum, provider: z.string(), title: z.string(), roomId: uuid.nullable(),
    conversationId: uuid.nullable(), externalRef: z.string().nullable(), transcript: z.string().nullable(), durationSeconds: z.number().int().nullable(),
    leaseToken: uuid, roomExternalRef: z.string().nullable(), providerRoomId: uuid.nullable(), accountDomain: z.string().nullable() }),
  handler: async (input, ctx) => {
    let existing = input.artifactId ? (await ctx.tx.select().from(voiceVideoArtifacts).where(eq(voiceVideoArtifacts.id, input.artifactId)).limit(1))[0] : undefined;
    if (input.artifactId && !existing) throw new ServiceError("not_found", "No such recording.");
    if (existing && (existing.contactId !== input.contactId || (input.roomId && existing.roomId !== input.roomId))) throw new ServiceError("conflict", "A recording keeps its original contact and room.");
    const roomId = existing?.roomId ?? input.roomId ?? null;
    if (roomId) await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`vv-recording:${roomId}`}, 0))`);
    const room = roomId ? (await ctx.tx.select().from(voiceVideoRooms).where(eq(voiceVideoRooms.id, roomId)).limit(1))[0] : undefined;
    if (roomId && !room) throw new ServiceError("not_found", "No such room.");
    if (room && (room.contactId !== input.contactId || room.provider !== input.provider || room.kind !== input.kind)) throw new ServiceError("conflict", "Use this room's original contact, provider and recording kind.");
    if (existing) existing = (await ctx.tx.select().from(voiceVideoArtifacts).where(eq(voiceVideoArtifacts.id, existing.id)).limit(1).for("update"))[0];
    else if (roomId) existing = (await ctx.tx.select().from(voiceVideoArtifacts).where(and(eq(voiceVideoArtifacts.roomId, roomId), ne(voiceVideoArtifacts.kind, "transcript"))).limit(1).for("update"))[0];
    if (input.artifactId && !existing) throw new ServiceError("not_found", "No such recording.");
    if (existing?.status === "recorded" && !input.refresh) throw new ServiceError("conflict", "That recording is already stored. Refresh it to check its transcript.");
    if (existing?.providerLeaseToken && existing.providerLeaseExpiresAt && existing.providerLeaseExpiresAt > new Date()) throw new ServiceError("conflict", "That recording is already being stored.");
    const leaseToken = randomUUID();
    const lease = { providerLeaseToken: leaseToken, providerLeaseExpiresAt: new Date(Date.now() + PROVIDER_LEASE_MS) };
    const saved = existing
      ? (await ctx.tx.update(voiceVideoArtifacts).set({ ...lease, status: "pending", lastError: null, title: input.title }).where(eq(voiceVideoArtifacts.id, existing.id)).returning())[0]!
      : (await ctx.tx.insert(voiceVideoArtifacts).values({ ...lease, contactId: input.contactId, roomId, kind: input.kind,
        provider: input.provider, title: input.title, status: "pending", conversationId: room?.conversationId ?? null }).returning())[0]!;
    ctx.setSubject("voice_video_artifact", saved.id);
    return { artifactId: saved.id, contactId: saved.contactId, kind: kindEnum.parse(saved.kind), provider: saved.provider, title: saved.title,
      roomId: saved.roomId, conversationId: saved.conversationId, externalRef: saved.externalRef, transcript: saved.transcript,
      durationSeconds: saved.durationSeconds, leaseToken, roomExternalRef: room?.externalRef ?? null,
      providerRoomId: room?.providerRoomId ?? null, accountDomain: room?.providerDomain ?? null };
  },
});

const applyCapture = defineService({
  name: "voiceVideo.applyCapture", summary: "Atomically attach verified recording evidence and actual transcript text to the conversation.",
  kind: "mutation", permission: "scoped", external: false, writeClass: "write",
  input: z.object({ artifactId: uuid, leaseToken: uuid, externalRef: z.string().max(200).optional(),
    transcript: z.string().max(100_000).nullable().optional(), durationSeconds: z.number().int().nonnegative().optional(), lastError: z.string().max(500).optional() }),
  output: okResult,
  handler: async (input, ctx) => {
    const [artifact] = await ctx.tx.select().from(voiceVideoArtifacts).where(eq(voiceVideoArtifacts.id, input.artifactId)).limit(1).for("update");
    if (!artifact || artifact.providerLeaseToken !== input.leaseToken || !artifact.providerLeaseExpiresAt || artifact.providerLeaseExpiresAt <= new Date()) throw new ServiceError("conflict", "That recording operation no longer owns its lease.");
    if (input.externalRef && !input.lastError) {
      const recorded = await ctx.call(getService("conversations.record"), { contactId: artifact.contactId, direction: "outbound", channel: "chat", sentBy: "system",
        body: `Recording available: ${artifact.title}`, providerRef: `vv-recording:${artifact.id}`,
        ...(artifact.conversationId ? { conversationId: artifact.conversationId } : {}) }) as { conversation: { id: string } };
      const conversationId = recorded.conversation.id;
      const transcriptText = input.transcript ?? artifact.transcript;
      let transcriptId: string | null = null;
      if (transcriptText) {
        const digest = createHash("sha256").update(transcriptText).digest("hex").slice(0, 24);
        await ctx.call(getService("conversations.record"), { contactId: artifact.contactId, direction: "outbound", channel: "chat", sentBy: "system",
          body: transcriptText, conversationId, providerRef: `vv-transcript:${artifact.id}:${digest}` });
        const transcriptRef = `vv-transcript:${artifact.id}`;
        const [existing] = await ctx.tx.select().from(voiceVideoArtifacts).where(eq(voiceVideoArtifacts.externalRef, transcriptRef)).limit(1);
        const [transcript] = existing
          ? await ctx.tx.update(voiceVideoArtifacts).set({ transcript: transcriptText, conversationId }).where(eq(voiceVideoArtifacts.id, existing.id)).returning({ id: voiceVideoArtifacts.id })
          : await ctx.tx.insert(voiceVideoArtifacts).values({ contactId: artifact.contactId, roomId: artifact.roomId, kind: "transcript", provider: artifact.provider,
            title: artifact.title, status: "recorded", externalRef: transcriptRef, conversationId, transcript: transcriptText }).returning({ id: voiceVideoArtifacts.id });
        transcriptId = transcript!.id;
      }
      await ctx.tx.update(voiceVideoArtifacts).set({ status: "recorded", externalRef: input.externalRef, conversationId,
        transcript: transcriptText, durationSeconds: input.durationSeconds ?? artifact.durationSeconds, lastError: null,
        providerLeaseToken: null, providerLeaseExpiresAt: null }).where(eq(voiceVideoArtifacts.id, artifact.id));
      await ctx.emitTimeline({ contactId: artifact.contactId, eventType: "voiceVideo.recordingReady", subjectType: "voice_video_artifact", subjectId: artifact.id,
        payload: { conversationId, roomId: artifact.roomId, transcriptId, kind: artifact.kind } });
      ctx.queueEvent("voiceVideo.recorded", { id: artifact.id });
    } else {
      await ctx.tx.update(voiceVideoArtifacts).set({ status: "failed", lastError: input.lastError ?? "The recording could not be verified.",
        providerLeaseToken: null, providerLeaseExpiresAt: null,
        ...(input.externalRef ? { externalRef: input.externalRef } : {}),
        ...(input.transcript ? { transcript: input.transcript } : {}),
        ...(input.durationSeconds !== undefined ? { durationSeconds: input.durationSeconds } : {}),
      }).where(eq(voiceVideoArtifacts.id, artifact.id));
    }
    return { ok: true as const };
  },
});

export const recordVoiceVideoArtifact = defineOrchestratedService({
  name: "voiceVideo.record", summary: "Verify a processed provider recording and refresh its actual transcript.",
  kind: "mutation", permission: "scoped", writeClass: "write", input: captureInput, output: artifactRow,
  handler: async (input) => {
    const claimed = await claimCapture.call(input, { kind: "system" });
    let captured: { externalRef: string; transcript: string | null; durationSeconds: number } | undefined;
    try {
      captured = await voiceVideoProvider().capture({ kind: claimed.kind, provider: claimed.provider, title: claimed.title,
        externalRef: claimed.externalRef ?? undefined, roomExternalRef: claimed.roomExternalRef,
        providerRoomId: claimed.providerRoomId, accountDomain: claimed.accountDomain });
      await applyCapture.call({ artifactId: claimed.artifactId, leaseToken: claimed.leaseToken, ...captured }, { kind: "system" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The recording could not be verified.";
      await applyCapture.call({ artifactId: claimed.artifactId, leaseToken: claimed.leaseToken, lastError: message.slice(0, 500), ...captured }, { kind: "system" });
    }
    const found = (await listVoiceVideoArtifacts.call({}, { kind: "system" })).find(row => row.id === claimed.artifactId);
    if (!found) throw new ServiceError("not_found", "No such recording.");
    return found;
  },
});

export const stopVoiceVideoRoom = defineOrchestratedService({
  name: "voiceVideo.stopRoom", summary: "End the provider call, then check for its processed recording.",
  kind: "mutation", permission: "scoped", writeClass: "write",
  input: z.object({ roomId: uuid, capture: z.boolean().default(true) }), output: roomRow,
  handler: async (input, actor) => {
    const claimed = await claimStop.call(input, { kind: "system" });
    try {
      await voiceVideoProvider().endRoom({ provider: claimed.provider, externalRef: claimed.externalRef,
        providerRoomId: claimed.providerRoomId, accountDomain: claimed.accountDomain });
      await applyStop.call({ roomId: claimed.roomId, leaseToken: claimed.leaseToken, status: "ended" }, { kind: "system" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The call provider could not end this room.";
      await applyStop.call({ roomId: claimed.roomId, leaseToken: claimed.leaseToken, status: "failed", lastError: message.slice(0, 500) }, { kind: "system" });
      const failed = (await listVoiceVideoRooms.call({}, { kind: "system" })).find(row => row.id === claimed.roomId);
      if (!failed) throw new ServiceError("not_found", "No such room.");
      return failed;
    }
    // Call shutdown and recording processing are different provider facts.
    // A recording that is still processing must not turn an ended call live.
    if (input.capture && !claimed.recordedArtifactId) await recordVoiceVideoArtifact.call({ contactId: claimed.contactId, kind: claimed.kind,
      provider: claimed.provider, title: claimed.title, artifactId: claimed.failedArtifactId ?? undefined, roomId: claimed.roomId }, actor);
    const found = (await listVoiceVideoRooms.call({}, { kind: "system" })).find(row => row.id === claimed.roomId);
    if (!found) throw new ServiceError("not_found", "No such room.");
    return found;
  },
});

const applyMiss = defineService({
  name: "voiceVideo.applyMiss",
  external: false,
  summary: "Mark a live room as a missed call on the contact timeline.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ roomId: z.string().uuid() }),
  output: roomRow,
  handler: async (input, ctx) => {
    const [room] = await ctx.tx
      .select()
      .from(voiceVideoRooms)
      .where(eq(voiceVideoRooms.id, input.roomId))
      .limit(1).for("update");
    if (!room) throw new ServiceError("not_found", "No such room.");
    if (room.status !== "ended") {
      throw new ServiceError("conflict", "Close the provider room before marking it missed.");
    }
    const recorded = (await ctx.call(getService("conversations.record"), {
      contactId: room.contactId,
      direction: "inbound",
      channel: "chat",
      body: `Missed call: ${room.title}`,
      sentBy: "system",
      conversationId: room.conversationId ?? undefined,
      providerRef: `vv-missed:${room.id}`,
    })) as { conversation: { id: string } };
    const [updated] = await ctx.tx
      .update(voiceVideoRooms)
      .set({
        status: "missed",
        conversationId: recorded.conversation.id,
        lastError: null,
      })
      .where(eq(voiceVideoRooms.id, room.id))
      .returning();
    await ctx.emitTimeline({
      contactId: room.contactId,
      eventType: "voiceVideo.missedCall",
      subjectType: "voice_video_room",
      subjectId: room.id,
      payload: { conversationId: recorded.conversation.id, title: room.title },
    });
    ctx.setSubject("voice_video_room", room.id);
    ctx.queueEvent("voiceVideo.missedCall", { id: room.id, contactId: room.contactId });
    return updated!;
  },
});

export const missVoiceVideoRoom = defineOrchestratedService({
  name: "voiceVideo.missRoom", summary: "Close the provider room and record a missed call on the contact timeline.",
  kind: "mutation", permission: "scoped", writeClass: "write",
  input: z.object({ roomId: uuid }), output: roomRow,
  handler: async (input, actor) => {
    const room = await stopVoiceVideoRoom.call({ ...input, capture: false }, actor);
    if (room.status !== "ended") return room;
    return applyMiss.call(input, { kind: "system" });
  },
});

const roomAccessSource = defineService({
  name: "voiceVideo.roomAccessSource", summary: "Read canonical provider identity for an authorized room or recording operation.",
  kind: "query", permission: "system", input: z.object({ roomId: uuid.optional(), artifactId: uuid.optional() }),
  output: z.object({ roomId: uuid, provider: z.string(), externalRef: z.string().nullable(), providerRoomId: uuid.nullable(),
    accountDomain: z.string().nullable(), status: z.string(), guestName: z.string(), guestId: uuid, recordingId: z.string().nullable() }),
  handler: async (input, ctx) => {
    const artifact = input.artifactId ? (await ctx.tx.select().from(voiceVideoArtifacts).where(eq(voiceVideoArtifacts.id, input.artifactId)).limit(1))[0] : undefined;
    if (input.artifactId && (!artifact || artifact.status !== "recorded" || artifact.kind === "transcript")) throw new ServiceError("not_found", "No verified recording is available.");
    const roomId = artifact?.roomId ?? input.roomId;
    if (!roomId || (input.roomId && artifact && artifact.roomId !== input.roomId)) throw new ServiceError("not_found", "No provider room is attached to that recording.");
    const [room] = await ctx.tx.select().from(voiceVideoRooms).where(eq(voiceVideoRooms.id, roomId)).limit(1);
    if (!room) throw new ServiceError("not_found", "No such room.");
    const contact = await ctx.call(getService("contacts.get"), { id: room.contactId }) as { name: string } | null;
    return { roomId, provider: room.provider, externalRef: room.externalRef, providerRoomId: room.providerRoomId,
      accountDomain: room.providerDomain, status: room.status, guestName: contact?.name || "Guest", guestId: room.contactId, recordingId: artifact?.externalRef ?? null };
  },
});

export const createVoiceVideoMeetingLink = defineOrchestratedService({
  name: "voiceVideo.meetingLink", summary: "Issue a short-lived private meeting link for the host or invited contact.",
  kind: "mutation", permission: "scoped", writeClass: "write",
  input: z.object({ roomId: uuid, audience: z.enum(["host", "guest"]), hostName: z.string().trim().min(1).max(200).default("Host") }),
  output: z.object({ roomUrl: z.string().url(), meetingToken: z.string(), expiresAt: z.number().int() }),
  handler: async (input, actor) => {
    const room = await roomAccessSource.call({ roomId: input.roomId }, { kind: "system" });
    if (room.status !== "live") throw new ServiceError("conflict", "Open this room before issuing an invitation.");
    const owner = input.audience === "host";
    return voiceVideoProvider().meetingToken({ ...room, owner, userName: owner ? input.hostName : room.guestName,
      userId: owner ? (actor.kind === "user" ? actor.userId : randomUUID()) : room.guestId });
  },
});

export const voiceVideoRecordingAccess = defineOrchestratedService({
  name: "voiceVideo.recordingAccess", summary: "Get an expiring download link for a verified provider recording.",
  kind: "query", permission: "scoped", input: z.object({ artifactId: uuid }),
  output: z.object({ downloadTokenUrl: z.string().url(), expiresAt: z.number().int() }),
  handler: async (input) => {
    const room = await roomAccessSource.call(input, { kind: "system" });
    if (!room.recordingId) throw new ServiceError("not_found", "No provider recording is attached.");
    return voiceVideoProvider().recordingAccess({ ...room, recordingId: room.recordingId });
  },
});

export const voiceVideoConfiguration = defineService({
  name: "voiceVideo.configuration", summary: "Show the configured Daily domain without exposing credentials.",
  kind: "query", permission: "scoped", input: z.object({}), output: z.object({ configured: z.boolean(), domain: z.string().nullable() }),
  handler: async () => { const settings = env(); return { configured: Boolean(settings.DAILY_API_KEY && settings.DAILY_DOMAIN), domain: settings.DAILY_DOMAIN ?? null }; },
});

export const listVoiceVideoRooms = defineService({
  name: "voiceVideo.listRooms",
  summary: "Voice and video rooms on this instance.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(roomRow),
  handler: (_input, ctx) =>
    ctx.tx.select().from(voiceVideoRooms).orderBy(desc(voiceVideoRooms.createdAt)),
});

export const listVoiceVideoJoins = defineService({
  name: "voiceVideo.listJoins",
  summary: "People who joined one room.",
  kind: "query",
  permission: "scoped",
  input: z.object({ roomId: z.string().uuid() }),
  output: listed(joinRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(voiceVideoJoins)
      .where(eq(voiceVideoJoins.roomId, input.roomId))
      .orderBy(desc(voiceVideoJoins.createdAt)),
});

export const listVoiceVideoArtifacts = defineService({
  name: "voiceVideo.list",
  summary: "Voice and video artifacts stored by this plugin.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(artifactRow),
  handler: (_input, ctx) =>
    ctx.tx.select().from(voiceVideoArtifacts).orderBy(desc(voiceVideoArtifacts.createdAt)),
});

registerSearchSource({
  kind: "voice_video_room",
  readService: "voiceVideo.listRooms",
  module: "voiceVideo",
  tables: ["voice_video_rooms"],
  search: async ({ tx, pattern, limit }) => {
    const rows = await tx
      .select({
        id: voiceVideoRooms.id,
        title: voiceVideoRooms.title,
        contactId: voiceVideoRooms.contactId,
      })
      .from(voiceVideoRooms)
      .where(matchesIlike(voiceVideoRooms.title, pattern))
      .orderBy(desc(voiceVideoRooms.updatedAt))
      .limit(limit);
    return rows.map((row) => ({
      kind: "voice_video_room",
      id: row.id,
      title: row.title,
      href: "/admin/voice-video",
      snippet: clipSnippet(row.title),
      contactId: row.contactId,
      module: "voiceVideo",
    }));
  },
});

export default [
  claimStart,
  applyStart,
  startVoiceVideoRoom,
  joinVoiceVideoRoom,
  claimStop,
  applyStop,
  stopVoiceVideoRoom,
  missVoiceVideoRoom,
  applyMiss,
  claimCapture,
  applyCapture,
  recordVoiceVideoArtifact,
  roomAccessSource,
  createVoiceVideoMeetingLink,
  voiceVideoRecordingAccess,
  voiceVideoConfiguration,
  listVoiceVideoRooms,
  listVoiceVideoJoins,
  listVoiceVideoArtifacts,
];
