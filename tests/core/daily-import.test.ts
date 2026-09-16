// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.13: owner-storage recording import with idempotent retries, erasure and
// retention integration. Follows tests/core/daily-flow.test.ts and
// tests/core/deferred-erasure.test.ts patterns.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { getService } from "@/core/service";
import { storage } from "@/adapters/storage";
import { createContact } from "@/core/contacts/service";
import { dataRequestArtifacts, dataRequests } from "@/core/privacy/schema";
import { createDataRequest, verifyDataRequest, fulfillDataRequest, addRetentionException } from "@/core/privacy/service";
import { getJob, stopJobs } from "@/core/jobs";
import * as adapter from "../../plugins/voice-video/adapter";
import { eraseImportedCopies, eraseProviderRecordings } from "../../plugins/voice-video/erasure";
import { fixtureVoiceVideoProvider } from "../../plugins/voice-video/adapter";
import { importVoiceVideoRecording, listVoiceVideoArtifacts, recordVoiceVideoArtifact, startVoiceVideoRoom, stopVoiceVideoRoom } from "../../plugins/voice-video/service";
import { voiceVideoArtifacts } from "../../plugins/voice-video/schema";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const SYSTEM = { kind: "system" } as const;

async function recordedArtifact(title = "Consultation") {
  const contact = await createContact.call({ name: "Recorded person", email: `${randomUUID()}@example.test` }, OWNER);
  const room = await startVoiceVideoRoom.call({ contactId: contact.id, kind: "video", provider: "daily", title }, OWNER);
  await stopVoiceVideoRoom.call({ roomId: room.id, capture: false }, OWNER);
  const artifact = await recordVoiceVideoArtifact.call({ contactId: contact.id, kind: "video", provider: "daily", title, roomId: room.id }, OWNER);
  return { contact, room, artifact };
}

async function eraseRequest(contactId: string) {
  const request = await createDataRequest.call({ contactId, request: { kind: "erasure" } }, OWNER);
  await verifyDataRequest.call({ id: request.id, method: "Verified customer request" }, OWNER);
  return request;
}

const jobContext = (id: string) => ({ id, name: "job", attempt: 1, signal: new AbortController().signal,
  leaseSeconds: 300, heartbeat: async () => true, isCancelled: async () => false, throwIfCancelled: async () => {} });

async function runErasureJobs(requestId: string, onProviderErase?: () => Promise<void>) {
  const [artifact] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, requestId));
  const body = artifact?.body as { outcomes: Array<{ scope: string; pendingJobs?: string[] }> } | undefined;
  expect(body).toBeTruthy();
  for (const outcome of body!.outcomes) {
    for (const jobId of outcome.pendingJobs ?? []) {
      const storageJob = await getJob(eraseImportedCopies.name, jobId);
      if (storageJob) {
        await eraseImportedCopies.handler(storageJob.data, jobContext(jobId));
        continue;
      }
      const providerJob = await getJob(eraseProviderRecordings.name, jobId);
      if (!providerJob) throw new Error(`Unknown erasure job ${jobId}`);
      const spy = onProviderErase ? vi.spyOn(fixtureVoiceVideoProvider, "eraseRoomRecordings").mockImplementation(onProviderErase) : undefined;
      try {
        await eraseProviderRecordings.handler(providerJob.data, jobContext(jobId));
      } finally {
        spy?.mockRestore();
      }
    }
  }
  const [after] = await db().select().from(dataRequests).where(eq(dataRequests.id, requestId));
  return after!;
}

describe.runIf(hasDatabase)("Daily owner-storage import", { timeout: 30_000 }, () => {
  beforeEach(async () => { await ready(); await truncateSpine(); });
  afterEach(async () => {
    vi.restoreAllMocks();
    const artifacts = await db().select().from(voiceVideoArtifacts);
    for (const artifact of artifacts) {
      for (const key of [artifact.storageKey, artifact.transcriptStorageKey]) {
        if (key) await storage().delete(key).catch(() => undefined);
      }
    }
  });
  afterAll(async () => { await stopJobs(); await closeDb(); });

  it("copies a verified recording and its transcript into owner storage automatically", async () => {
    const { artifact } = await recordedArtifact();
    expect(artifact).toMatchObject({ status: "recorded", importStatus: "imported", importError: null });
    expect(artifact.storageKey).toBeTruthy();
    expect(artifact.transcriptStorageKey).toBeTruthy();
    expect(artifact.importedAt).toBeInstanceOf(Date);
    expect(artifact.storageChecksumSha256).toMatch(/^[0-9a-f]{64}$/);
    const recording = await storage().get(artifact.storageKey!);
    expect(new TextDecoder().decode(recording)).toBe("fixture recording bytes");
    const transcript = await storage().get(artifact.transcriptStorageKey!);
    expect(new TextDecoder().decode(transcript)).toContain("video recording: Consultation");
    expect(recording!.byteLength).toBe((await storage().head(artifact.storageKey!))!.bytes);
  });

  it("does not duplicate objects when a stuck import retries", async () => {
    const { artifact } = await recordedArtifact();
    // Simulate a worker that died after putting objects but before applying:
    // the row is pending with an expired lease, the objects already exist.
    await db().update(voiceVideoArtifacts)
      .set({ importStatus: "pending", providerLeaseToken: randomUUID(), providerLeaseExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(voiceVideoArtifacts.id, artifact.id));
    const puts = vi.spyOn(storage(), "put");
    const retried = await importVoiceVideoRecording.call({ artifactId: artifact.id }, OWNER);
    expect(retried).toMatchObject({ id: artifact.id, importStatus: "imported", storageKey: artifact.storageKey, transcriptStorageKey: artifact.transcriptStorageKey });
    expect(puts).not.toHaveBeenCalled();
    expect((await listVoiceVideoArtifacts.call({}, OWNER)).filter((row) => row.kind !== "transcript")).toHaveLength(1);
  });

  it("rejects a stale import claim after its lease is reclaimed", async () => {
    const contact = await createContact.call({ name: "Lease person", email: `${randomUUID()}@example.test` }, OWNER);
    vi.spyOn(adapter, "voiceVideoProvider").mockReturnValue({
      ...fixtureVoiceVideoProvider,
      async downloadRecording() { throw new Error("Temporary provider outage"); },
    });
    const room = await startVoiceVideoRoom.call({ contactId: contact.id, kind: "video", provider: "daily", title: "Lease call" }, OWNER);
    await stopVoiceVideoRoom.call({ roomId: room.id, capture: false }, OWNER);
    const artifact = await recordVoiceVideoArtifact.call({ contactId: contact.id, kind: "video", provider: "daily", title: "Lease call", roomId: room.id }, OWNER);
    expect(artifact.importStatus).toBe("failed");
    const claim = await getService("voiceVideo.claimImport").call({ artifactId: artifact.id }, SYSTEM) as { artifactId: string; leaseToken: string };
    await db().update(voiceVideoArtifacts).set({ providerLeaseExpiresAt: new Date(0) }).where(eq(voiceVideoArtifacts.id, artifact.id));
    const second = await getService("voiceVideo.claimImport").call({ artifactId: artifact.id }, SYSTEM) as { leaseToken: string };
    expect(second.leaseToken).not.toBe(claim.leaseToken);
    await expect(getService("voiceVideo.applyImport").call({ artifactId: artifact.id, leaseToken: claim.leaseToken }, SYSTEM)).rejects.toMatchObject({ code: "conflict" });
  });

  it("keeps a failed import visible and retryable after a provider outage", async () => {
    const contact = await createContact.call({ name: "Outage person", email: `${randomUUID()}@example.test` }, OWNER);
    vi.spyOn(adapter, "voiceVideoProvider").mockReturnValue({
      ...fixtureVoiceVideoProvider,
      async downloadRecording() { throw new Error("Temporary provider outage"); },
    });
    const room = await startVoiceVideoRoom.call({ contactId: contact.id, kind: "video", provider: "daily", title: "Outage call" }, OWNER);
    await stopVoiceVideoRoom.call({ roomId: room.id, capture: false }, OWNER);
    const artifact = await recordVoiceVideoArtifact.call({ contactId: contact.id, kind: "video", provider: "daily", title: "Outage call", roomId: room.id }, OWNER);
    expect(artifact.status).toBe("recorded");
    expect(artifact).toMatchObject({ importStatus: "failed", importError: "Temporary provider outage", storageKey: null });
    vi.restoreAllMocks();
    const retried = await importVoiceVideoRecording.call({ artifactId: artifact.id }, OWNER);
    expect(retried).toMatchObject({ importStatus: "imported", importError: null });
    expect(await storage().head(retried.storageKey!)).toBeDefined();
  });

  it("waits for the recording to be verified before importing", async () => {
    const contact = await createContact.call({ name: "Pending person", email: `${randomUUID()}@example.test` }, OWNER);
    vi.spyOn(adapter, "voiceVideoProvider").mockReturnValue({
      ...fixtureVoiceVideoProvider,
      async capture() { throw new Error("The recording is still processing."); },
    });
    const room = await startVoiceVideoRoom.call({ contactId: contact.id, kind: "voice", provider: "daily", title: "Processing call" }, OWNER);
    await stopVoiceVideoRoom.call({ roomId: room.id, capture: false }, OWNER);
    const artifact = await recordVoiceVideoArtifact.call({ contactId: contact.id, kind: "voice", provider: "daily", title: "Processing call", roomId: room.id }, OWNER);
    expect(artifact.status).toBe("failed");
    expect(artifact.importStatus).toBeNull();
    await expect(importVoiceVideoRecording.call({ artifactId: artifact.id }, OWNER)).rejects.toMatchObject({ code: "conflict" });
  });

  it("erases imported owner-storage copies before the privacy receipt completes", async () => {
    const { contact, artifact } = await recordedArtifact();
    const request = await eraseRequest(contact.id);
    const result = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    expect(result.request.status).toBe("in_progress");
    expect(await db().select().from(voiceVideoArtifacts)).toHaveLength(0);
    expect(await storage().head(artifact.storageKey!)).toBeDefined();
    const body = result.artifact.body as { outcomes: Array<{ scope: string; pendingJobs?: string[] }> };
    const storageJob = body.outcomes.find((item) => item.scope === "plugins.voice-video")?.pendingJobs?.[0];
    expect(storageJob).toBeTruthy();
    const queued = await getJob(eraseImportedCopies.name, storageJob!);
    expect(queued?.data).toMatchObject({ requestId: request.id });
    expect(JSON.stringify(queued?.data)).not.toContain(artifact.title);
    const after = await runErasureJobs(request.id);
    expect(after.status).toBe("completed");
    expect(await storage().head(artifact.storageKey!)).toBeUndefined();
    expect(await storage().head(artifact.transcriptStorageKey!)).toBeUndefined();
  });

  it("keeps owner-storage copies while a retention hold protects the recordings", async () => {
    const { contact } = await recordedArtifact();
    const request = await eraseRequest(contact.id);
    await addRetentionException.call({ dataRequestId: request.id, scope: "plugins.voice-video", reason: "legal_claim", legalBasis: "Documented active dispute" }, OWNER);
    const result = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    expect(result.request.status).toBe("partially_completed");
    const rows = await db().select().from(voiceVideoArtifacts);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      if (row.storageKey) expect(await storage().head(row.storageKey)).toBeDefined();
      if (row.transcriptStorageKey) expect(await storage().head(row.transcriptStorageKey)).toBeDefined();
    }
    const body = result.artifact.body as { outcomes: Array<{ scope: string; outcome: string; pendingJobs?: string[] }> };
    expect(body.outcomes.find((item) => item.scope === "plugins.voice-video")?.outcome).toBe("retained");
  });

  it("retries a storage outage instead of completing the receipt early", async () => {
    const { contact, artifact } = await recordedArtifact();
    const request = await eraseRequest(contact.id);
    await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    const failing = vi.spyOn(storage(), "delete").mockRejectedValue(new Error("Storage unreachable"));
    await expect(runErasureJobs(request.id)).rejects.toThrow("Storage unreachable");
    failing.mockRestore();
    expect(await storage().head(artifact.storageKey!)).toBeDefined();
    const [pending] = await db().select().from(dataRequests).where(eq(dataRequests.id, request.id));
    expect(pending!.status).toBe("in_progress");
    const after = await runErasureJobs(request.id);
    expect(after.status).toBe("completed");
    expect(await storage().head(artifact.storageKey!)).toBeUndefined();
  });
});
