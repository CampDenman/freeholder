// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.13/C1.08: provider cleanup survives local deletion and process failure.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { defineJob, enqueueJob } from "@/core/jobs";
import { completeErasureJob } from "@/core/privacy/service";
import type { Tx } from "@/core/service";
import { voiceVideoProvider } from "./adapter";
import { voiceVideoRooms } from "./schema";

const scope = "plugins.voice-video.rooms";
const payload = z.object({ requestId: z.uuid(), originalJobId: z.uuid(), provider: z.string(), externalRef: z.string().nullable(),
  providerRoomId: z.uuid().nullable(), accountDomain: z.string().nullable() });

export const eraseProviderRecordings = defineJob({
  name: "voiceVideo.eraseProviderRecordings",
  summary: "Erase a closed room's provider recordings and transcripts, then acknowledge its privacy task.",
  concurrency: 1, leaseSeconds: 300,
  retry: { limit: 40, delaySeconds: 60, backoff: true, maxDelaySeconds: 3600 },
  handler: async (data, context) => {
    if (!context) throw new Error("Provider erasure requires a durable job identity.");
    const input = payload.parse(data);
    await context.throwIfCancelled();
    await voiceVideoProvider().eraseRoomRecordings(input);
    await context.throwIfCancelled();
    await completeErasureJob.call({ requestId: input.requestId, scope, jobId: input.originalJobId }, { kind: "system" });
    return { erased: true };
  },
});

export async function queueRoomErasure(tx: Tx, contactId: string, context: { requestId: string }): Promise<{ pendingJobs: string[] }> {
  const rooms = await tx.select().from(voiceVideoRooms).where(eq(voiceVideoRooms.contactId, contactId)).for("update");
  const pendingJobs: string[] = [];
  for (const room of rooms) {
    if (!room.externalRef && !room.providerDomain && !room.providerRoomId) continue;
    // Configured Daily starts have a domain even if their apply result was lost.
    // Deterministic room naming recovers that case without retaining a contact.
    const externalRef = room.externalRef ?? (room.providerDomain ? `${room.providerDomain}/fh-${room.id}` : null);
    // Let already claimed provider operations exhaust their lease before
    // cleanup inspects the final inventory. Local apply is fenced by deletion.
    const startAfter = Math.max(60, Math.ceil(((room.providerLeaseExpiresAt?.getTime() ?? 0) - Date.now()) / 1000) + 60);
    const originalJobId = randomUUID();
    const job = await enqueueJob(tx, eraseProviderRecordings.name, {
      requestId: context.requestId, originalJobId, provider: room.provider, externalRef,
      providerRoomId: room.providerRoomId, accountDomain: room.providerDomain,
    }, { id: originalJobId, idempotencyKey: `erase:${context.requestId}:${room.id}`, startAfter });
    pendingJobs.push(job.id);
  }
  return { pendingJobs };
}
