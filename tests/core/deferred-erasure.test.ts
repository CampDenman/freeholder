// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C3.13: provider acknowledgements govern privacy completion.
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { createContact } from "@/core/contacts/service";
import { dataRequestArtifacts, dataRequests } from "@/core/privacy/schema";
import { registerContactPrivacySource, createDataRequest, verifyDataRequest, fulfillDataRequest,
  completeErasureJob, denyDataRequest, pruneExpiredPrivacyArtifacts, addRetentionException, removeRetentionException } from "@/core/privacy/service";
import { getJob, stopJobs } from "@/core/jobs";
import { voiceVideoRooms, voiceVideoArtifacts } from "../../plugins/voice-video/schema";
import { eraseProviderRecordings } from "../../plugins/voice-video/erasure";
import { fixtureVoiceVideoProvider } from "../../plugins/voice-video/adapter";
import { OWNER, ANONYMOUS, closeDb, hasDatabase, truncateSpine } from "../helpers/spine";

const scope = "test.deferred-provider";
const tasks = new Map<string, string[]>();
registerContactPrivacySource({ scope, tables: [], exportData: async () => [],
  erase: async (_tx, contactId) => ({ affected: 1, pendingJobs: tasks.get(contactId) ?? [] }) });

async function pendingRequest() {
  const contact = await createContact.call({ name: "Provider customer", email: "deferred@example.test" }, OWNER);
  const jobs = [randomUUID(), randomUUID()];
  tasks.set(contact.id, jobs);
  const request = await createDataRequest.call({ contactId: contact.id, request: { kind: "erasure" } }, OWNER);
  await verifyDataRequest.call({ id: request.id, method: "Verified customer request" }, OWNER);
  return { contact, request, jobs };
}

describe.runIf(hasDatabase)("deferred provider erasure", () => {
  beforeEach(async () => { tasks.clear(); await truncateSpine(); });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  it("keeps the request pending until every job acknowledges and accepts duplicate acknowledgements", async () => {
    const { request, jobs } = await pendingRequest();
    const result = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    expect(result.request.status).toBe("in_progress");
    expect(result.request.fulfilledAt).toBeNull();
    const repeated = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    expect(repeated.artifact.id).toBe(result.artifact.id);
    await expect(denyDataRequest.call({ id: request.id, resolution: "Cancel pending deletion" }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    const input = { requestId: request.id, scope, jobId: jobs[0]! };
    await expect(completeErasureJob.call(input, ANONYMOUS)).rejects.toMatchObject({ code: "permission" });
    await expect(completeErasureJob.call(input, OWNER)).rejects.toMatchObject({ code: "permission" });
    await completeErasureJob.call({ ...input, jobId: randomUUID() }, { kind: "system" });
    await completeErasureJob.call(input, { kind: "system" });
    await completeErasureJob.call(input, { kind: "system" });
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id, request.id)))[0]?.status).toBe("in_progress");
    await completeErasureJob.call({ ...input, jobId: jobs[1]! }, { kind: "system" });
    const [done] = await db().select().from(dataRequests).where(eq(dataRequests.id, request.id));
    expect(done?.status).toBe("completed");
    expect(done?.fulfilledAt).toBeInstanceOf(Date);
    await completeErasureJob.call(input, { kind: "system" });
  });
  it("retains an expired pending receipt for retry and prunes it after completion", async () => {
    const { request, jobs } = await pendingRequest();
    await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    const expire = () => db().update(dataRequestArtifacts).set({ createdAt: new Date(0), expiresAt: new Date(1000) }).where(eq(dataRequestArtifacts.dataRequestId, request.id));
    await expire();
    expect(await pruneExpiredPrivacyArtifacts()).toBe(0);
    for (const jobId of jobs) await completeErasureJob.call({ requestId: request.id, scope, jobId }, { kind: "system" });
    await expire();
    expect(await pruneExpiredPrivacyArtifacts()).toBe(1);
  });
  it("commits a provider cleanup job before deleting its room and keeps failed work pending", async () => {
    const { contact, request } = await pendingRequest();
    tasks.delete(contact.id);
    const activeLeaseEnds = new Date(Date.now() + 600_000);
    const [room] = await db().insert(voiceVideoRooms).values({ contactId: contact.id, kind: "video", provider: "daily", title: "Private call",
      status: "ended", externalRef: "example.daily.co/fh-11111111-1111-4111-8111-111111111111", providerRoomId: randomUUID(), providerDomain: "example.daily.co",
      providerLeaseToken: randomUUID(), providerLeaseExpiresAt: activeLeaseEnds }).returning();
    await db().insert(voiceVideoArtifacts).values({ contactId: contact.id, roomId: room!.id, kind: "video", provider: "daily", title: "Private recording" });
    const result = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    expect(result.request.status).toBe("in_progress");
    expect(await db().select().from(voiceVideoRooms)).toHaveLength(0);
    expect(await db().select().from(voiceVideoArtifacts)).toHaveLength(0);
    const body = result.artifact.body as { outcomes: Array<{ scope: string; pendingJobs?: string[] }> };
    const jobId = body.outcomes.find(item => item.scope === "plugins.voice-video.rooms")?.pendingJobs?.[0];
    expect(jobId).toBeTruthy();
    const queued = await getJob(eraseProviderRecordings.name, jobId!);
    expect(queued?.data).toMatchObject({ requestId: request.id, originalJobId: jobId, providerRoomId: room!.providerRoomId, accountDomain: "example.daily.co" });
    expect(queued!.startAfter.getTime()).toBeGreaterThan(activeLeaseEnds.getTime());
    expect(JSON.stringify(queued?.data)).not.toContain(contact.id);
    expect(JSON.stringify(queued?.data)).not.toContain("Private call");
    const context = { id: jobId!, name: eraseProviderRecordings.name, attempt: 1, signal: new AbortController().signal,
      leaseSeconds: 300, heartbeat: async () => true, isCancelled: async () => false, throwIfCancelled: async () => {} };
    const provider = vi.spyOn(fixtureVoiceVideoProvider, "eraseRoomRecordings").mockRejectedValueOnce(new Error("Temporary provider outage"));
    try {
      await expect(eraseProviderRecordings.handler(queued!.data, context)).rejects.toThrow("Temporary provider outage");
      expect((await db().select().from(dataRequests).where(eq(dataRequests.id, request.id)))[0]?.status).toBe("in_progress");
      // Dead-letter redrive creates a new execution ID but preserves payload.
      await eraseProviderRecordings.handler(queued!.data, { ...context, id: randomUUID() });
      expect((await db().select().from(dataRequests).where(eq(dataRequests.id, request.id)))[0]?.status).toBe("completed");
    } finally { provider.mockRestore(); }
  });
  it("inherits child retention holds before cascading room deletion", async () => {
    const { contact, request } = await pendingRequest();
    tasks.delete(contact.id);
    const [room] = await db().insert(voiceVideoRooms).values({ contactId: contact.id, kind: "video", provider: "daily", title: "Retained call" }).returning();
    await db().insert(voiceVideoArtifacts).values({ contactId: contact.id, roomId: room!.id, kind: "video", provider: "daily", title: "Retained recording" });
    await addRetentionException.call({ dataRequestId: request.id, scope: "plugins.voice-video", reason: "legal_claim", legalBasis: "Documented active dispute" }, OWNER);
    const result = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    expect(result.request.status).toBe("partially_completed");
    expect(await db().select().from(voiceVideoRooms)).toHaveLength(1);
    expect(await db().select().from(voiceVideoArtifacts)).toHaveLength(1);
  });

  it("preserves documented holds when provider work finishes and refuses late retention edits", async () => {
    const { request, jobs } = await pendingRequest();
    const hold = await addRetentionException.call({ dataRequestId: request.id, scope: "plugins.voice-video", reason: "legal_claim", legalBasis: "Documented active dispute" }, OWNER);
    const result = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, OWNER);
    expect(result.request.status).toBe("in_progress");
    await expect(removeRetentionException.call({ id: hold.id }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    await expect(addRetentionException.call({ dataRequestId: request.id, scope, reason: "legal_claim", legalBasis: "Too late to undo deletion" }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    for (const jobId of jobs) await completeErasureJob.call({ requestId: request.id, scope, jobId }, { kind: "system" });
    const [done] = await db().select().from(dataRequests).where(eq(dataRequests.id, request.id));
    expect(done?.status).toBe("partially_completed");
    expect(done?.fulfilledAt).toBeInstanceOf(Date);
    const [receipt] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, request.id));
    expect(receipt?.body).toMatchObject({ status: "partially_completed" });
  });

});
