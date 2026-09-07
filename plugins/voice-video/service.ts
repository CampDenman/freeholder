// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { listed, okResult, row, uuid } from "@/core/contract";
import {
  defineOrchestratedService,
  defineService,
  getService,
  ServiceError,
} from "@/core/service";
import { attachPluginContactColumn } from "@/core/plugins/spine";
import { voiceVideoProvider } from "./adapter";
import { voiceVideoArtifacts } from "./schema";

attachPluginContactColumn({
  table: "voice_video_artifacts",
  schema: voiceVideoArtifacts,
  label: "A voice or video artifact",
  scope: "plugins.voice-video",
});

const artifactRow = row({
  id: uuid,
  contactId: uuid,
  kind: z.string(),
  provider: z.string(),
  title: z.string(),
  status: z.string(),
  externalRef: z.string().nullable(),
  conversationId: uuid.nullable(),
  lastError: z.string().nullable(),
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
    kind: z.enum(["voice", "video"]),
    provider: z.string().min(1),
    title: z.string().min(1).max(160),
    artifactId: z.string().uuid().optional(),
  }),
  output: row({
    artifactId: uuid,
    contactId: uuid,
    kind: z.enum(["voice", "video"]),
    provider: z.string(),
    title: z.string(),
  }),
  handler: async (input, ctx) => {
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
        })
        .where(eq(voiceVideoArtifacts.id, existing.id));
      return {
        artifactId: existing.id,
        contactId: existing.contactId,
        kind: input.kind,
        provider: input.provider,
        title: input.title,
      };
    }
    const [created] = await ctx.tx
      .insert(voiceVideoArtifacts)
      .values({
        contactId: input.contactId,
        kind: input.kind,
        provider: input.provider,
        title: input.title,
        status: "pending",
      })
      .returning();
    ctx.setSubject("voice_video_artifact", created!.id);
    return {
      artifactId: created!.id,
      contactId: created!.contactId,
      kind: input.kind,
      provider: created!.provider,
      title: created!.title,
    };
  },
});

const applyCapture = defineService({
  name: "voiceVideo.applyCapture",
  summary: "Attach a provider recording to the contact's conversation.",
  kind: "mutation",
  permission: "scoped",
  external: false,
  writeClass: "write",
  input: z.object({
    artifactId: z.string().uuid(),
    externalRef: z.string().max(200).optional(),
    conversationId: z.string().uuid().optional(),
    lastError: z.string().max(500).optional(),
  }),
  output: okResult,
  handler: async (input, ctx) => {
    if (input.externalRef) {
      await ctx.tx
        .update(voiceVideoArtifacts)
        .set({
          status: "recorded",
          externalRef: input.externalRef,
          conversationId: input.conversationId ?? null,
          lastError: null,
        })
        .where(eq(voiceVideoArtifacts.id, input.artifactId));
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
    kind: z.enum(["voice", "video"]),
    provider: z.string().min(1),
    title: z.string().min(1).max(160),
    artifactId: z.string().uuid().optional(),
  }),
  output: artifactRow,
  handler: async (input, actor) => {
    const claimed = await claimCapture.call(input, { kind: "system" });
    try {
      const captured = await voiceVideoProvider().capture({
        kind: claimed.kind,
        provider: claimed.provider,
        title: claimed.title,
      });
      const recorded = (await getService("conversations.record").call(
        {
          contactId: claimed.contactId,
          direction: "inbound",
          channel: "chat",
          body: captured.transcript,
          providerRef: captured.externalRef,
        },
        actor,
      )) as { conversation: { id: string } };
      await applyCapture.call(
        {
          artifactId: claimed.artifactId,
          externalRef: captured.externalRef,
          conversationId: recorded.conversation.id,
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

export default [claimCapture, applyCapture, recordVoiceVideoArtifact, listVoiceVideoArtifacts];
