// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { listed, okResult, row, uuid } from "@/core/contract";
import { isUniqueViolation } from "@/core/db";
import {
  defineOrchestratedService,
  defineService,
  getService,
  ServiceError,
  type Actor,
} from "@/core/service";
import { attachPluginContactColumn } from "@/core/plugins/spine";
import { voiceVideoProvider } from "./adapter";
import { voiceVideoArtifacts, voiceVideoJoins, voiceVideoRooms } from "./schema";

attachPluginContactColumn({
  table: "voice_video_rooms",
  schema: voiceVideoRooms,
  label: "A voice or video room",
  scope: "plugins.voice-video.rooms",
});
attachPluginContactColumn({
  table: "voice_video_joins",
  schema: voiceVideoJoins,
  label: "A voice or video join",
  scope: "plugins.voice-video.joins",
});
attachPluginContactColumn({
  table: "voice_video_artifacts",
  schema: voiceVideoArtifacts,
  label: "A voice or video artifact",
  scope: "plugins.voice-video",
});

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
});

async function recordOnThread(
  actor: Actor,
  input: {
    contactId: string;
    body: string;
    conversationId?: string | null;
    providerRef?: string;
  },
) {
  return (await getService("conversations.record").call(
    {
      contactId: input.contactId,
      direction: "inbound" as const,
      channel: "chat" as const,
      body: input.body,
      sentBy: "system" as const,
      conversationId: input.conversationId ?? undefined,
      providerRef: input.providerRef,
    },
    actor,
  )) as { conversation: { id: string } };
}

const claimStart = defineService({
  name: "voiceVideo.claimStart",
  summary: "Stage a voice or video room before the provider opens it.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  writeClass: "write",
  input: z.object({
    contactId: z.string().uuid(),
    kind: kindEnum,
    provider: z.string().min(1),
    title: z.string().min(1).max(160),
    roomId: z.string().uuid().optional(),
  }),
  output: row({
    roomId: uuid,
    contactId: uuid,
    kind: kindEnum,
    provider: z.string(),
    title: z.string(),
  }),
  handler: async (input, ctx) => {
    if (input.roomId) {
      const [existing] = await ctx.tx
        .select()
        .from(voiceVideoRooms)
        .where(eq(voiceVideoRooms.id, input.roomId))
        .limit(1);
      if (!existing) throw new ServiceError("not_found", "No such room.");
      if (existing.status === "live") {
        throw new ServiceError("conflict", "That room is already open.");
      }
      if (existing.status === "ended" || existing.status === "missed") {
        throw new ServiceError("conflict", "That room has already finished.");
      }
      if (existing.status === "pending" || existing.status === "stopping") {
        throw new ServiceError("conflict", "That room is already being opened.");
      }
      await ctx.tx
        .update(voiceVideoRooms)
        .set({
          status: "pending",
          lastError: null,
          title: input.title,
          provider: input.provider,
          kind: input.kind,
        })
        .where(eq(voiceVideoRooms.id, existing.id));
      return {
        roomId: existing.id,
        contactId: existing.contactId,
        kind: input.kind,
        provider: input.provider,
        title: input.title,
      };
    }
    const [created] = await ctx.tx
      .insert(voiceVideoRooms)
      .values({
        contactId: input.contactId,
        kind: input.kind,
        provider: input.provider,
        title: input.title,
        status: "pending",
      })
      .returning();
    ctx.setSubject("voice_video_room", created!.id);
    return {
      roomId: created!.id,
      contactId: created!.contactId,
      kind: input.kind,
      provider: created!.provider,
      title: created!.title,
    };
  },
});

const applyStart = defineService({
  name: "voiceVideo.applyStart",
  summary: "Record whether the provider opened the room.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  writeClass: "write",
  input: z.object({
    roomId: z.string().uuid(),
    externalRef: z.string().max(200).optional(),
    conversationId: z.string().uuid().optional(),
    lastError: z.string().max(500).optional(),
  }),
  output: okResult,
  handler: async (input, ctx) => {
    if (input.externalRef) {
      await ctx.tx
        .update(voiceVideoRooms)
        .set({
          status: "live",
          externalRef: input.externalRef,
          conversationId: input.conversationId ?? null,
          lastError: null,
        })
        .where(eq(voiceVideoRooms.id, input.roomId));
      ctx.queueEvent("voiceVideo.roomStarted", { id: input.roomId });
    } else {
      await ctx.tx
        .update(voiceVideoRooms)
        .set({
          status: "failed",
          lastError: input.lastError ?? "The call provider could not open that room.",
        })
        .where(eq(voiceVideoRooms.id, input.roomId));
    }
    return { ok: true as const };
  },
});

export const startVoiceVideoRoom = defineOrchestratedService({
  name: "voiceVideo.startRoom",
  summary: "Open a voice or video room on the contact's conversation.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    contactId: z.string().uuid(),
    kind: kindEnum,
    provider: z.string().min(1),
    title: z.string().min(1).max(160),
    roomId: z.string().uuid().optional(),
  }),
  output: roomRow,
  handler: async (input, actor) => {
    const claimed = await claimStart.call(input, { kind: "system" });
    try {
      const started = await voiceVideoProvider().startRoom({
        kind: claimed.kind,
        provider: claimed.provider,
        title: claimed.title,
      });
      const recorded = await recordOnThread(actor, {
        contactId: claimed.contactId,
        body: `Call started: ${claimed.title}`,
        providerRef: `vv-start:${claimed.roomId}`,
      });
      await applyStart.call(
        {
          roomId: claimed.roomId,
          externalRef: started.externalRef,
          conversationId: recorded.conversation.id,
        },
        { kind: "system" },
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "The call provider could not open that room.";
      await applyStart.call(
        { roomId: claimed.roomId, lastError: message.slice(0, 500) },
        { kind: "system" },
      );
    }
    const found = (await listVoiceVideoRooms.call({}, { kind: "system" })).find(
      (row) => row.id === claimed.roomId,
    );
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
      conversationId: room.conversationId ?? undefined,
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
  summary: "Lock a live or failed room before capturing the recording.",
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
    failedArtifactId: uuid.nullable(),
  }),
  handler: async (input, ctx) => {
    const [room] = await ctx.tx
      .select()
      .from(voiceVideoRooms)
      .where(eq(voiceVideoRooms.id, input.roomId))
      .limit(1);
    if (!room) throw new ServiceError("not_found", "No such room.");
    if (room.status === "ended") {
      throw new ServiceError("conflict", "That room has already been recorded.");
    }
    if (room.status === "missed") {
      throw new ServiceError("conflict", "That room was marked missed.");
    }
    if (room.status === "stopping") {
      throw new ServiceError("conflict", "That room is already being recorded.");
    }
    if (room.status === "pending") {
      throw new ServiceError("conflict", "That room is still opening.");
    }
    if (room.status === "failed" && !room.externalRef) {
      throw new ServiceError("conflict", "Open that room before recording it.");
    }
    const failedArtifact = (
      await ctx.tx.select().from(voiceVideoArtifacts).where(eq(voiceVideoArtifacts.roomId, room.id))
    ).find((row) => row.status === "failed" && row.kind !== "transcript");
    await ctx.tx
      .update(voiceVideoRooms)
      .set({ status: "stopping", lastError: null })
      .where(eq(voiceVideoRooms.id, room.id));
    return {
      roomId: room.id,
      contactId: room.contactId,
      conversationId: room.conversationId,
      kind: room.kind === "video" ? ("video" as const) : ("voice" as const),
      provider: room.provider,
      title: room.title,
      externalRef: room.externalRef,
      failedArtifactId: failedArtifact?.id ?? null,
    };
  },
});

const applyStop = defineService({
  name: "voiceVideo.applyStop",
  summary: "Close the room after the provider stores the recording.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  writeClass: "write",
  input: z.object({
    roomId: z.string().uuid(),
    status: z.enum(["ended", "failed"]),
    conversationId: z.string().uuid().optional(),
    lastError: z.string().max(500).optional(),
  }),
  output: okResult,
  handler: async (input, ctx) => {
    await ctx.tx
      .update(voiceVideoRooms)
      .set({
        status: input.status,
        conversationId: input.conversationId ?? undefined,
        lastError: input.status === "failed" ? (input.lastError ?? "The call provider could not store that recording.") : null,
      })
      .where(eq(voiceVideoRooms.id, input.roomId));
    if (input.status === "ended") {
      ctx.queueEvent("voiceVideo.roomEnded", { id: input.roomId });
    }
    return { ok: true as const };
  },
});

const claimCapture = defineService({
  name: "voiceVideo.claimCapture",
  summary: "Stage a voice or video artifact before the provider stores it.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  writeClass: "write",
  input: z.object({
    contactId: z.string().uuid(),
    kind: kindEnum,
    provider: z.string().min(1),
    title: z.string().min(1).max(160),
    artifactId: z.string().uuid().optional(),
    roomId: z.string().uuid().optional(),
  }),
  output: row({
    artifactId: uuid,
    contactId: uuid,
    kind: kindEnum,
    provider: z.string(),
    title: z.string(),
    roomId: uuid.nullable(),
    conversationId: uuid.nullable(),
    externalRef: z.string().nullable(),
  }),
  handler: async (input, ctx) => {
    const roomId = input.roomId;
    let roomConversationId: string | null = null;
    if (roomId) {
      const [room] = await ctx.tx
        .select({ conversationId: voiceVideoRooms.conversationId })
        .from(voiceVideoRooms)
        .where(eq(voiceVideoRooms.id, roomId))
        .limit(1);
      if (!room) throw new ServiceError("not_found", "No such room.");
      roomConversationId = room.conversationId;
    }
    if (input.artifactId) {
      const [existing] = await ctx.tx
        .select()
        .from(voiceVideoArtifacts)
        .where(eq(voiceVideoArtifacts.id, input.artifactId))
        .limit(1);
      if (!existing) throw new ServiceError("not_found", "No such recording.");
      if (existing.status === "recorded") {
        throw new ServiceError("conflict", "That recording is already stored.");
      }
      await ctx.tx
        .update(voiceVideoArtifacts)
        .set({
          status: "pending",
          lastError: null,
          title: input.title,
          provider: input.provider,
          kind: input.kind,
          roomId: roomId ?? existing.roomId,
          conversationId: roomConversationId ?? existing.conversationId,
        })
        .where(eq(voiceVideoArtifacts.id, existing.id));
      return {
        artifactId: existing.id,
        contactId: existing.contactId,
        kind: input.kind,
        provider: input.provider,
        title: input.title,
        roomId: roomId ?? existing.roomId,
        conversationId: roomConversationId ?? existing.conversationId,
        externalRef: existing.externalRef,
      };
    }
    const [created] = await ctx.tx
      .insert(voiceVideoArtifacts)
      .values({
        contactId: input.contactId,
        roomId: roomId ?? null,
        kind: input.kind,
        provider: input.provider,
        title: input.title,
        status: "pending",
        conversationId: roomConversationId,
      })
      .returning();
    ctx.setSubject("voice_video_artifact", created!.id);
    return {
      artifactId: created!.id,
      contactId: created!.contactId,
      kind: input.kind,
      provider: created!.provider,
      title: created!.title,
      roomId: created!.roomId,
      conversationId: created!.conversationId,
      externalRef: created!.externalRef,
    };
  },
});

const applyCapture = defineService({
  name: "voiceVideo.applyCapture",
  summary: "Attach a provider recording and transcript to the contact's conversation.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  writeClass: "write",
  input: z.object({
    artifactId: z.string().uuid(),
    externalRef: z.string().max(200).optional(),
    conversationId: z.string().uuid().optional(),
    transcript: z.string().max(100_000).optional(),
    durationSeconds: z.number().int().nonnegative().optional(),
    lastError: z.string().max(500).optional(),
  }),
  output: okResult,
  handler: async (input, ctx) => {
    const [artifact] = await ctx.tx
      .select()
      .from(voiceVideoArtifacts)
      .where(eq(voiceVideoArtifacts.id, input.artifactId))
      .limit(1);
    if (!artifact) throw new ServiceError("not_found", "No such recording.");
    if (input.externalRef) {
      await ctx.tx
        .update(voiceVideoArtifacts)
        .set({
          status: "recorded",
          externalRef: input.externalRef,
          conversationId: input.conversationId ?? null,
          transcript: input.transcript ?? null,
          durationSeconds: input.durationSeconds ?? null,
          lastError: null,
        })
        .where(eq(voiceVideoArtifacts.id, input.artifactId));
      const [transcript] = await ctx.tx
        .insert(voiceVideoArtifacts)
        .values({
          contactId: artifact.contactId,
          roomId: artifact.roomId,
          kind: "transcript",
          provider: artifact.provider,
          title: artifact.title,
          status: "recorded",
          externalRef: `vv-transcript:${input.artifactId}`,
          conversationId: input.conversationId ?? null,
          transcript: input.transcript ?? null,
        })
        .returning();
      await ctx.emitTimeline({
        contactId: artifact.contactId,
        eventType: "voiceVideo.recordingReady",
        subjectType: "voice_video_artifact",
        subjectId: artifact.id,
        payload: {
          conversationId: input.conversationId ?? null,
          roomId: artifact.roomId,
          transcriptId: transcript!.id,
          kind: artifact.kind,
        },
      });
      ctx.queueEvent("voiceVideo.recorded", { id: input.artifactId });
    } else {
      await ctx.tx
        .update(voiceVideoArtifacts)
        .set({
          status: "failed",
          lastError: input.lastError ?? "The call provider could not store that recording.",
        })
        .where(eq(voiceVideoArtifacts.id, input.artifactId));
    }
    return { ok: true as const };
  },
});

export const recordVoiceVideoArtifact = defineOrchestratedService({
  name: "voiceVideo.record",
  summary: "Capture a voice or video artifact and attach it to the contact's thread.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    contactId: z.string().uuid(),
    kind: kindEnum,
    provider: z.string().min(1),
    title: z.string().min(1).max(160),
    artifactId: z.string().uuid().optional(),
    roomId: z.string().uuid().optional(),
  }),
  output: artifactRow,
  handler: async (input, actor) => {
    const claimed = await claimCapture.call(input, { kind: "system" });
    try {
      const captured = await voiceVideoProvider().capture({
        kind: claimed.kind,
        provider: claimed.provider,
        title: claimed.title,
        externalRef: claimed.externalRef ?? undefined,
      });
      const recorded = await recordOnThread(actor, {
        contactId: claimed.contactId,
        body: captured.transcript,
        conversationId: claimed.conversationId,
        providerRef: `vv-recording:${claimed.artifactId}`,
      });
      await applyCapture.call(
        {
          artifactId: claimed.artifactId,
          externalRef: captured.externalRef,
          conversationId: recorded.conversation.id,
          transcript: captured.transcript,
          durationSeconds: captured.durationSeconds,
        },
        { kind: "system" },
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "The call provider could not store that recording.";
      await applyCapture.call(
        { artifactId: claimed.artifactId, lastError: message.slice(0, 500) },
        { kind: "system" },
      );
    }
    const found = (await listVoiceVideoArtifacts.call({}, { kind: "system" })).find(
      (row) => row.id === claimed.artifactId,
    );
    if (!found) throw new ServiceError("not_found", "No such recording.");
    return found;
  },
});

export const stopVoiceVideoRoom = defineOrchestratedService({
  name: "voiceVideo.stopRoom",
  summary: "Stop a live room and attach the recording and transcript to the thread.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ roomId: z.string().uuid() }),
  output: roomRow,
  handler: async (input, actor) => {
    const claimed = await claimStop.call(input, { kind: "system" });
    try {
      const recorded = await recordVoiceVideoArtifact.call(
        {
          contactId: claimed.contactId,
          kind: claimed.kind,
          provider: claimed.provider,
          title: claimed.title,
          artifactId: claimed.failedArtifactId ?? undefined,
          roomId: claimed.roomId,
        },
        actor,
      );
      await applyStop.call(
        {
          roomId: claimed.roomId,
          status: recorded.status === "recorded" ? "ended" : "failed",
          conversationId: recorded.conversationId ?? claimed.conversationId ?? undefined,
          lastError: recorded.lastError ?? undefined,
        },
        { kind: "system" },
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "The call provider could not store that recording.";
      await applyStop.call(
        { roomId: claimed.roomId, status: "failed", lastError: message.slice(0, 500) },
        { kind: "system" },
      );
    }
    const found = (await listVoiceVideoRooms.call({}, { kind: "system" })).find(
      (row) => row.id === claimed.roomId,
    );
    if (!found) throw new ServiceError("not_found", "No such room.");
    return found;
  },
});

export const missVoiceVideoRoom = defineService({
  name: "voiceVideo.missRoom",
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
      .limit(1);
    if (!room) throw new ServiceError("not_found", "No such room.");
    if (room.status !== "live") {
      throw new ServiceError("conflict", "Only a live room can be marked missed.");
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

export default [
  claimStart,
  applyStart,
  startVoiceVideoRoom,
  joinVoiceVideoRoom,
  claimStop,
  applyStop,
  stopVoiceVideoRoom,
  missVoiceVideoRoom,
  claimCapture,
  applyCapture,
  recordVoiceVideoArtifact,
  listVoiceVideoRooms,
  listVoiceVideoJoins,
  listVoiceVideoArtifacts,
];
