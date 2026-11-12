// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Shared receipt transitions are independent of source-specific provider I/O.
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { createContact } from "@/core/contacts/service";
import { auditLog } from "@/core/events/schema";
import { defineJob, getJob, registerJob } from "@/core/jobs";
import { dataRequestArtifacts, dataRequests } from "@/core/privacy/schema";
import { addRetentionException, createDataRequest, fulfillDataRequest, reopenErasureJob, verifyDataRequest } from "@/core/privacy/service";
import { ready } from "@/core/runtime";
import { OWNER, closeDb, hasDatabase, truncateSpine } from "../helpers/spine";
const HUMAN = { ...OWNER, security: { twoFactorRequired: false, twoFactorEnrolled: true, twoFactorVerified: true, stepUpValid: true } };
const JOB = "core.reopenErasureFixture";
async function completed(hold = false) {
  const contact = await createContact.call({ name: "Fictional original privacy subject", email: "original-privacy@example.test" }, HUMAN);
  const request = await createDataRequest.call({ contactId: contact.id, request: { kind: "erasure" } }, HUMAN);
  await verifyDataRequest.call({ id: request.id, method: "Fictional independent original identity verification." }, HUMAN);
  if (hold) await addRetentionException.call({ dataRequestId: request.id, scope: "contact.tasks", reason: "legal_obligation", legalBasis: "Fictional independent named task evidence remains subject to retention." }, HUMAN);
  const result = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, HUMAN);
  return result;
}
const input = (requestId: string) => ({ requestId, scope: "contact.notes", jobName: JOB, jobData: { proof: "fictional-original-source-evidence" }, idempotencyKey: "fictional-exact-new-source-version" });
describe.runIf(hasDatabase)("reopen original erasure receipts", () => {
  beforeAll(async () => { await ready(); registerJob(defineJob({ name: JOB, summary: "Fixture source receipt transition", handler: async () => ({ ok: true }) })); }, 60_000);
  beforeEach(async () => { await truncateSpine(); await db().insert(users).values({ id: OWNER.userId, role: "owner", email: "owner@example.test" }); });
  afterAll(closeDb);
  it("admits one exact source job and preserves other retained outcomes", async () => {
    const original = await completed(true), before = original.artifact.body as { outcomes: Array<{ scope: string; outcome: string }> };
    const first = await reopenErasureJob.call(input(original.request.id), { kind: "system" });
    expect(first).toMatchObject({ changed: true, recoveryRequired: false }); expect(first.jobId).toBeTruthy();
    const job = await getJob(JOB, first.jobId!); expect(job!.data).toEqual({ proof: "fictional-original-source-evidence", requestId: original.request.id, originalJobId: first.jobId });
    expect(await reopenErasureJob.call(input(original.request.id), { kind: "system" })).toEqual({ jobId: first.jobId, recoveryRequired: false, changed: false });
    const [request] = await db().select().from(dataRequests).where(eq(dataRequests.id, original.request.id)); expect(request).toMatchObject({ status: "in_progress", fulfilledAt: null });
    const [artifact] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, request!.id));
    const after = artifact!.body as { outcomes: Array<{ scope: string; outcome: string; pendingJobs?: string[] }> };
    expect(after.outcomes.find(outcome => outcome.scope === "contact.notes")).toMatchObject({ outcome: "pending", pendingJobs: [first.jobId] });
    expect(after.outcomes.filter(outcome => outcome.outcome === "retained")).toEqual(before.outcomes.filter(outcome => outcome.outcome === "retained"));
    const audits = await db().select().from(auditLog).where(eq(auditLog.action, "privacy.reopenErasureJob")); expect(audits).toHaveLength(1); expect(audits[0]!.diff).toEqual({ requestId: request!.id, scope: "contact.notes" });
    const second = await reopenErasureJob.call({ ...input(original.request.id), jobData: { proof: "fictional-second-original-source-evidence" }, idempotencyKey: "fictional-second-source-version" }, { kind: "system" });
    expect(second.jobId).not.toBe(first.jobId);
    const both = (await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, request!.id)))[0]!.body as { outcomes: Array<{ scope: string; pendingJobs?: string[] }> };
    expect(both.outcomes.find(outcome => outcome.scope === "contact.notes")!.pendingJobs).toEqual([first.jobId, second.jobId]);
    expect(await reopenErasureJob.call(input(original.request.id), { kind: "system" })).toMatchObject({ jobId: first.jobId, changed: false });
  });
  it("requires restoration of a missing original artifact without fabricating one", async () => {
    const original = await completed();
    await db().delete(dataRequestArtifacts).where(eq(dataRequestArtifacts.id, original.artifact.id));
    expect(await reopenErasureJob.call(input(original.request.id), { kind: "system" })).toEqual({ jobId: null, recoveryRequired: true, changed: true });
    expect(await db().select().from(dataRequestArtifacts)).toHaveLength(0);
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id, original.request.id)))[0]!.status).toBe("in_progress");
    expect(await reopenErasureJob.call(input(original.request.id), { kind: "system" })).toMatchObject({ changed: false, recoveryRequired: true });
  });
  it("requires original receipt recovery when its contents no longer match its checksum", async () => {
    const original = await completed();
    await db().update(dataRequestArtifacts).set({ body: { format: "freeholder.erasure-receipt", outcomes: [] } }).where(eq(dataRequestArtifacts.id, original.artifact.id));
    expect(await reopenErasureJob.call(input(original.request.id), { kind: "system" })).toMatchObject({ recoveryRequired: true, jobId: null });
    expect((await db().select().from(dataRequestArtifacts))[0]!.body).toEqual({ format: "freeholder.erasure-receipt", outcomes: [] });
  });
  it("refuses person, key, agent and plugin callers", async () => {
    const original = await completed();
    for (const actor of [HUMAN, { kind: "agent" as const, keyName: "fixture", scopes: ["*"] }, { ...HUMAN, keyScopes: ["privacy.reopenErasureJob"] }, { kind: "plugin" as const, name: "fixture", grants: HUMAN.grants }]) await expect(reopenErasureJob.call(input(original.request.id), actor)).rejects.toMatchObject({ code: "permission" });
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id, original.request.id)))[0]!.status).toBe("completed");
  });
});
