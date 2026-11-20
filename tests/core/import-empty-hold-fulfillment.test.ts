// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47/C11.10: an original empty hold cannot retain later source generations.
import { writeFile } from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users, totpFactors } from "@/core/auth/schema";
import { createSession } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { resolveContact } from "@/core/contacts/service";
import { addRetentionException, createDataRequest, fulfillDataRequest, verifyDataRequest } from "@/core/privacy/service";
import { dataRequests, privacyRetentionExceptions } from "@/core/privacy/schema";
import { privacyRetentionSourceMembers, privacyRetentionSourceSnapshots } from "@/core/privacy/retention-schema";
import { startImport, rollbackImport } from "@/core/import/service";
import { beginSourceUpload, uploadSourceChunk } from "@/core/import/source-upload";
import { eraseImportSourceObjects, IMPORT_SOURCE_ERASURE_JOB } from "@/core/import/source-erasure";
import { getJob, listJobs, stopJobs } from "@/core/jobs";
import { mediaObjectWrites } from "@/core/media/write-schema";
import { resetStorageForTests, storage } from "@/adapters/storage";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("known-empty original hold during actual erasure fulfillment", () => {
  beforeEach(async () => { await truncateSpine(); resetStorageForTests(); });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  it("erases a later unheld original through its actual privacy job while the earlier empty hold persists", async () => {
    await db().insert(users).values({ id: OWNER.userId, email: "fictional-empty-hold-owner@example.test", role: "owner" });
    await db().insert(totpFactors).values({ userId: OWNER.userId, encryptedSecret: "fictional-empty-hold-factor" });
    const session = await db().transaction(tx => createSession(tx, OWNER.userId, { twoFactorVerified: true }));
    const owner = await actorFromToken(session.token);
    if (owner.kind !== "user" || !owner.sessionId) throw new Error("The actual fresh owner session did not resolve.");
    const email = "fictional-later-unheld-reader@example.test";
    const reader = (await resolveContact.call({ email }, owner)).contact;
    const request = await createDataRequest.call({ contactId: reader.id, request: { kind: "erasure" } }, owner);
    const hold = await addRetentionException.call({ dataRequestId: request.id, scope: "cms.readerComments", reason: "legal_claim", legalBasis: "Synthetic exact empty original-source generation membership" }, owner);
    const headers = await db().select().from(privacyRetentionSourceSnapshots).where(and(eq(privacyRetentionSourceSnapshots.exceptionId, hold.id), eq(privacyRetentionSourceSnapshots.sourceScope, "imports.readerSources")));
    expect(headers).toMatchObject([{ captureVersion: 1, memberCount: 0 }]);
    expect(await db().select().from(privacyRetentionSourceMembers).where(eq(privacyRetentionSourceMembers.exceptionId, hold.id))).toEqual([]);
    const run = await startImport.call({ kind: "wordpress-wxr", origin: "https://fictional-later-unheld.example" }, owner);
    const bytes = new TextEncoder().encode(`<rss xmlns:wp="http://wordpress.org/export/1.2/"><channel><title>Later independent original</title><item><title>Original article</title><wp:post_id>10</wp:post_id><wp:post_type>post</wp:post_type><wp:comment><wp:comment_id>20</wp:comment_id><wp:comment_author_email>${email}</wp:comment_author_email><wp:comment_content>PRIVATE_LATER_UNHELD_ORIGINAL_BODY</wp:comment_content></wp:comment></item></channel></rss>`);
    const upload = await beginSourceUpload.call({ id: run.id, filename: "later-unheld.xml", bytes: bytes.byteLength }, owner);
    await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes }, owner);
    const key = `imports/${run.id}/${upload.uploadId}/00000.part`;
    expect(await storage().get(key)).toEqual(bytes);
    await verifyDataRequest.call({ id: request.id, method: "Synthetic actual later-source subject verification" }, owner);
    const result = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, owner);
    const receipt = result.artifact.body as { outcomes: Array<{ scope: string; outcome: string; pendingJobs?: string[] }> };
    const outcome = receipt.outcomes.find(item => item.scope === "imports.readerSources");
    const pending = outcome?.pendingJobs ?? [];
    const members = await db().select().from(privacyRetentionSourceMembers).where(eq(privacyRetentionSourceMembers.exceptionId, hold.id));
    const observation = { requestStatus: result.request.status, rawSourceOutcome: outcome, actualCanonicalMembers: members.length,
      cleanupRegistered: listJobs().has(IMPORT_SOURCE_ERASURE_JOB), originalBytesStillPresent: Boolean(await storage().get(key)),
      physicalOperations: (await db().select({ operation: mediaObjectWrites.operation, state: mediaObjectWrites.state }).from(mediaObjectWrites).where(eq(mediaObjectWrites.key, key))) };
    if (process.env.FREEHOLDER_EMPTY_HOLD_OBSERVATION) await writeFile(process.env.FREEHOLDER_EMPTY_HOLD_OBSERVATION, JSON.stringify(observation, null, 2), { mode: 0o600, flag: "wx" });
    expect(observation.actualCanonicalMembers).toBe(0);
    expect(observation.cleanupRegistered).toBe(true);
    expect(pending.length, JSON.stringify(observation)).toBeGreaterThan(0);
    expect(result.request.status).toBe("in_progress");
    const job = await getJob(IMPORT_SOURCE_ERASURE_JOB, pending[0]!);
    if (!job?.data) throw new Error("The original durable privacy cleanup job is missing.");
    // End the valid upload window through the real business mutation. Jobs
    // remain disabled; only the actual recorded privacy body below can delete.
    await rollbackImport.call({ id: run.id }, owner);
    await eraseImportSourceObjects(job.data);
    expect(await storage().get(key)).toBeUndefined();
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id, request.id)))[0]?.status).toBe("partially_completed");
    expect(await db().select().from(privacyRetentionExceptions).where(eq(privacyRetentionExceptions.id, hold.id))).toMatchObject([{ id: hold.id }]);
    expect(await db().select().from(privacyRetentionSourceSnapshots).where(and(eq(privacyRetentionSourceSnapshots.exceptionId, hold.id), eq(privacyRetentionSourceSnapshots.sourceScope, "imports.readerSources")))).toEqual(headers);
    expect(await db().select().from(privacyRetentionSourceMembers).where(eq(privacyRetentionSourceMembers.exceptionId, hold.id))).toEqual([]);
  });
});
