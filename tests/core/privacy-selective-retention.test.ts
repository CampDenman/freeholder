// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C3.47: legal retention and pending unheld cleanup are independent facts.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { createContact } from "@/core/contacts/service";
import { db } from "@/core/db";
import { defineJob, getJob, listJobs, registerJob, stopJobs } from "@/core/jobs";
import { dataRequestArtifacts, dataRequests } from "@/core/privacy/schema";
import { addRetentionException, completeErasureJob, createDataRequest, fulfillDataRequest, registerContactPrivacySource, reopenErasureJob, verifyDataRequest } from "@/core/privacy/service";
import { ready } from "@/core/runtime";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const SCOPE = "tests.selectiveOriginals", JOB = "core.selectiveOriginalErasureFixture";
const receipt = z.object({ outcomes: z.array(z.object({ scope: z.string(), outcome: z.string(),
  pendingJobs: z.array(z.uuid()).optional(), completedJobs: z.array(z.uuid()).optional() }).passthrough()) });
const workData = z.object({ requestId: z.uuid(), originalJobId: z.uuid() });
const scopeResult = (body: unknown) => receipt.parse(body).outcomes.find(row => row.scope === SCOPE)!;

describe.runIf(hasDatabase)("selective erasure inside retained scopes", () => {
  let failCleanup = false;
  let retainRequests: string[] = [], cleanupRequests: string[] = [], completed: string[] = [];
  let lastJobId: string | undefined;
  beforeAll(async () => {
    await ready();
    registerJob(defineJob({ name: JOB, summary: "Execute the fixture's unheld source work before acknowledging its actual job.", handler: async data => {
      const input = workData.parse(data);
      completed.push(input.originalJobId);
      await completeErasureJob.call({ requestId: input.requestId, scope: SCOPE, jobId: input.originalJobId }, { kind: "system" });
      return { ok: true };
    } }));
    registerContactPrivacySource({ scope: SCOPE, tables: [], retentionScopes: ["contact.tasks"], exportData: async () => [], erase: async () => ({ affected: 0 }),
      retain: async (_tx, _contactId, context) => { retainRequests.push(context.requestId); },
      eraseUnheld: async (tx, _contactId, context) => {
        expect(context.service.tx).toBe(tx);
        expect(context.service.actor.kind).toBe("user");
        cleanupRequests.push(context.requestId);
        lastJobId = randomUUID();
        const job = await context.service.queueJob(JOB, { requestId: context.requestId, originalJobId: lastJobId },
          { id: lastJobId, idempotencyKey: `selective-originals:${context.requestId}` });
        if (failCleanup) throw new Error("Synthetic selective source transaction failure");
        return { affected: 0, pendingJobs: [job.id, job.id] };
      },
    });
  }, 60_000);
  beforeEach(async () => {
    failCleanup = false; retainRequests = []; cleanupRequests = []; completed = []; lastJobId = undefined;
    await truncateSpine();
    await db().insert(users).values({ id: OWNER.userId, email: "selective-owner@example.test", role: "owner" });
  });
  afterAll(async () => { await stopJobs(); await closeDb(); });

  async function pending() {
    const contact = await createContact.call({ name: "Original held scope", email: "selective-subject@example.test" }, OWNER);
    const original = await createDataRequest.call({ contactId: contact.id, request: { kind: "erasure" } }, OWNER);
    for (const scope of [SCOPE, "contact.tasks"]) await addRetentionException.call({ dataRequestId: original.id, scope,
      reason: "legal_obligation", legalBasis: "Synthetic exact original evidence remains subject to its named hold." }, OWNER);
    const current = await createDataRequest.call({ contactId: contact.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: current.id, method: "Synthetic actual current erasure identity verification." }, OWNER);
    return { contact, original, current };
  }
  async function artifact(requestId: string) {
    const [row] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, requestId));
    return row!;
  }
  async function runActualJob(id: string) {
    const job = await getJob(JOB, id);
    expect(job).toBeTruthy();
    await listJobs().get(JOB)!.handler(job!.data);
  }

  it("queues unheld work once for the actual current request and preserves retention after its real acknowledgement", async () => {
    const { original, current } = await pending();
    const result = await fulfillDataRequest.call({ id: current.id, confirmation: "ERASE" }, OWNER);
    expect(retainRequests).toEqual([original.id, original.id]);
    expect(cleanupRequests).toEqual([current.id]);
    expect(result.request).toMatchObject({ status: "in_progress", fulfilledAt: null });
    const outcome = scopeResult(result.artifact.body);
    expect(outcome).toMatchObject({ outcome: "retained", pendingJobs: [lastJobId] });
    const replay = await fulfillDataRequest.call({ id: current.id, confirmation: "ERASE" }, OWNER);
    expect(replay.artifact).toEqual(result.artifact);
    expect(cleanupRequests).toEqual([current.id]);
    await runActualJob(lastJobId!);
    expect(completed).toEqual([lastJobId]);
    const done = scopeResult((await artifact(current.id)).body);
    expect(done).toMatchObject({ outcome: "retained", completedJobs: [lastJobId] });
    expect(done).not.toHaveProperty("pendingJobs");
    expect(done.retentionExceptions).toEqual(outcome.retentionExceptions);
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id, current.id)))[0]).toMatchObject({ status: "partially_completed" });
  });

  it("rolls back the actual source job and parent erasure together when selective cleanup fails", async () => {
    const { contact, current } = await pending();
    failCleanup = true;
    await expect(fulfillDataRequest.call({ id: current.id, confirmation: "ERASE" }, OWNER)).rejects.toThrow("Synthetic selective source transaction failure");
    expect(await getJob(JOB, lastJobId!)).toBeNull();
    expect(await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, current.id))).toHaveLength(0);
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id, current.id)))[0]?.status).toBe("verified");
    expect((await db().select().from(contacts).where(eq(contacts.id, contact.id)))[0]?.name).toBe(contact.name);
  });

  it("reopens only opted-in retained scopes and deduplicates pending and actually completed source evidence", async () => {
    const { current } = await pending();
    await fulfillDataRequest.call({ id: current.id, confirmation: "ERASE" }, OWNER);
    await runActualJob(lastJobId!);
    const input = { requestId: current.id, scope: SCOPE, jobName: JOB, jobData: {}, idempotencyKey: "actual-new-unheld-source-evidence" };
    const opened = await reopenErasureJob.call(input, { kind: "system" });
    expect(opened).toMatchObject({ recoveryRequired: false, changed: true });
    expect(scopeResult((await artifact(current.id)).body)).toMatchObject({ outcome: "retained", pendingJobs: [opened.jobId] });
    expect(await reopenErasureJob.call(input, { kind: "system" })).toEqual({ ...opened, changed: false });
    expect(await reopenErasureJob.call({ ...input, scope: "contact.tasks" }, { kind: "system" })).toEqual({ jobId: null, recoveryRequired: false, changed: false });
    await runActualJob(opened.jobId!);
    expect(await reopenErasureJob.call(input, { kind: "system" })).toEqual({ ...opened, changed: false });
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id, current.id)))[0]?.status).toBe("partially_completed");
    expect(scopeResult((await artifact(current.id)).body)).not.toHaveProperty("pendingJobs");
  });
});
