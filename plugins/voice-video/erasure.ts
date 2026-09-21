// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.13/C1.08: provider cleanup survives local deletion and process failure.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { defineJob, enqueueJob } from "@/core/jobs";
import { completeErasureJob } from "@/core/privacy/service";
import { storage } from "@/adapters/storage";
import type { Tx } from "@/core/service";
import { voiceVideoProvider } from "./adapter";
import { voiceVideoArtifacts, voiceVideoRooms } from "./schema";

const scope = "plugins.voice-video.rooms";
const artifactScope = "plugins.voice-video";
const payload = z.object({ requestId: z.uuid(), originalJobId: z.uuid(), provider: z.string(), externalRef: z.string().nullable(),
  providerRoomId: z.uuid().nullable(), accountDomain: z.string().nullable() });
const storagePayload = z.object({ requestId: z.uuid(), originalJobId: z.uuid(), keys: z.array(z.string().min(1)).min(1) });

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

export const eraseImportedCopies = defineJob({
  name: "voiceVideo.eraseImportedCopies",
  summary: "Delete owner-storage copies of erased recordings, then acknowledge the privacy task.",
  concurrency: 1, leaseSeconds: 300,
  retry: { limit: 40, delaySeconds: 60, backoff: true, maxDelaySeconds: 3600 },
  handler: async (data, context) => {
    if (!context) throw new Error("Owner-storage erasure requires a durable job identity.");
    const input = storagePayload.parse(data);
    await context.throwIfCancelled();
    // Deleting an already-absent object is a successful retry, matching the
    // provider worker. A storage failure throws and the durable retry
    // re-runs; the receipt stays in progress until every copy is gone.
    for (const key of input.keys) await storage().delete(key);
    await context.throwIfCancelled();
    await completeErasureJob.call({ requestId: input.requestId, scope: artifactScope, jobId: input.originalJobId }, { kind: "system" });
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

export async function queueArtifactStorageErasure(tx: Tx, contactId: string, context: { requestId: string }): Promise<{ pendingJobs: string[] }> {
  const artifacts = await tx.select().from(voiceVideoArtifacts).where(eq(voiceVideoArtifacts.contactId, contactId)).for("update");
  const pendingJobs: string[] = [];
  for (const artifact of artifacts) {
    // Only the recording row owns storage keys; its transcript copy is one of them.
    const keys = [artifact.storageKey, artifact.transcriptStorageKey].filter((key): key is string => Boolean(key));
    if (!keys.length) continue;
    // An in-flight import must finish applying before its copies are deleted;
    // wait out its lease exactly like the provider cleanup does.
    const startAfter = Math.max(60, Math.ceil(((artifact.providerLeaseExpiresAt?.getTime() ?? 0) - Date.now()) / 1000) + 60);
    const originalJobId = randomUUID();
    const job = await enqueueJob(tx, eraseImportedCopies.name, {
      requestId: context.requestId, originalJobId, keys,
    }, { id: originalJobId, idempotencyKey: `erase-storage:${context.requestId}:${artifact.id}`, startAfter });
    pendingJobs.push(job.id);
  }
  return { pendingJobs };
}
