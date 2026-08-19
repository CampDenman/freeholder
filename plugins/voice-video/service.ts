// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { desc } from "drizzle-orm";
import { z } from "zod";
import { listed, row, uuid } from "@/core/contract";
import { defineService } from "@/core/service";
import { attachPluginContactColumn } from "@/core/plugins/spine";
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
});

export const recordVoiceVideoArtifact = defineService({
  name: "voiceVideo.record",
  summary: "Record a voice or video artifact behind the plugin boundary.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    contactId: z.string().uuid(),
    kind: z.enum(["voice", "video"]),
    provider: z.string().min(1),
    title: z.string().min(1).max(160),
    externalRef: z.string().optional(),
  }),
  output: artifactRow,
  handler: async (input, ctx) => {
    const [row] = await ctx.tx.insert(voiceVideoArtifacts).values(input).returning();
    ctx.setSubject("voice_video_artifact", row!.id);
    ctx.queueEvent("voiceVideo.recorded", { id: row!.id, contactId: row!.contactId });
    return row!;
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

export default [recordVoiceVideoArtifact, listVoiceVideoArtifacts];
