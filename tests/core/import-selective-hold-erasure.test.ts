// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47/C11.10: selective cleanup respects every live original hold.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users, totpFactors } from "@/core/auth/schema";
import { createSession } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { resolveContact } from "@/core/contacts/service";
import { addRetentionException, createDataRequest, fulfillDataRequest, verifyDataRequest } from "@/core/privacy/service";
import { dataRequests } from "@/core/privacy/schema";
import { privacyRetentionSourceMembers, privacyRetentionSourceSnapshots } from "@/core/privacy/retention-schema";
import { startImport, rollbackImport } from "@/core/import/service";
import { beginSourceUpload, uploadSourceChunk } from "@/core/import/source-upload";
import { eraseImportSourceObjects, IMPORT_SOURCE_ERASURE_JOB } from "@/core/import/source-erasure";
import { getJob, stopJobs } from "@/core/jobs";
import { mediaObjectWrites } from "@/core/media/write-schema";
import { resetStorageForTests, storage } from "@/adapters/storage";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("actual selective original retention", () => {
  beforeEach(async () => { await truncateSpine(); resetStorageForTests(); });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  it("queues only the later unheld generation while another real reader hold preserves its original", async () => {
    await db().insert(users).values({ id: OWNER.userId, email: "fictional-selective-owner@example.test", role: "owner" });
    await db().insert(totpFactors).values({ userId: OWNER.userId, encryptedSecret: "fictional-selective-factor" });
    const session = await db().transaction(tx => createSession(tx, OWNER.userId, { twoFactorVerified: true }));
    const owner = await actorFromToken(session.token);
    if (owner.kind !== "user" || !owner.sessionId) throw new Error("The actual fresh owner session did not resolve.");
    const reader = (await resolveContact.call({ email: "fictional-selective-reader@example.test" }, owner)).contact;
    const request = await createDataRequest.call({ contactId: reader.id, request: { kind: "erasure" } }, owner);
    const empty = await addRetentionException.call({ dataRequestId: request.id, scope: "cms.readerComments", reason: "legal_claim", legalBasis: "Synthetic original empty membership stays empty" }, owner);
    const bytes = new TextEncoder().encode("<rss xmlns:wp=\"http://wordpress.org/export/1.2/\"><channel><title>Actual opaque original evidence</title></channel></rss>");
    const upload = async (origin: string) => {
      const run = await startImport.call({ kind: "wordpress-wxr", origin }, owner);
      const source = await beginSourceUpload.call({ id: run.id, filename: "actual-original.xml", bytes: bytes.byteLength }, owner);
      await uploadSourceChunk.call({ id: run.id, uploadId: source.uploadId, index: 0, bytes }, owner);
      return { run, source, key: `imports/${run.id}/${source.uploadId}/00000.part` };
    };
    const original = await upload("https://fictional-selective-held.example");
    const other = (await resolveContact.call({ email: "fictional-selective-other-reader@example.test" }, owner)).contact;
    const otherRequest = await createDataRequest.call({ contactId: other.id, request: { kind: "erasure" } }, owner);
    const otherHold = await addRetentionException.call({ dataRequestId: otherRequest.id, scope: "cms.readerComments", reason: "legal_claim", legalBasis: "Synthetic distinct reader request preserves the actual original" }, owner);
    const later = await upload("https://fictional-selective-unheld.example");
    await verifyDataRequest.call({ id: request.id, method: "Synthetic actual selective-erasure subject verification" }, owner);
    const result = await fulfillDataRequest.call({ id: request.id, confirmation: "ERASE" }, owner);
    const receipt = result.artifact.body as { outcomes: Array<{ scope: string; pendingJobs?: string[] }> };
    const pending = receipt.outcomes.find(item => item.scope === "imports.readerSources")?.pendingJobs ?? [];
    expect(result.request.status).toBe("in_progress");
    expect(pending).toHaveLength(1);
    const job = await getJob(IMPORT_SOURCE_ERASURE_JOB, pending[0]!);
    if (!job?.data) throw new Error("The actual unheld-original cleanup job is missing.");
    expect(job.data["requestId"]).toBe(request.id);
    expect(job.data["keys"]).toEqual([later.key]);
    expect(await storage().get(original.key)).toEqual(bytes);
    await rollbackImport.call({ id: later.run.id }, owner);
    await eraseImportSourceObjects(job.data);
    expect(await storage().get(later.key)).toBeUndefined();
    expect(await storage().get(original.key)).toEqual(bytes);
    expect(await db().select().from(mediaObjectWrites).where(and(eq(mediaObjectWrites.key, original.key), eq(mediaObjectWrites.operation, "delete")))).toEqual([]);
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id, request.id)))[0]?.status).toBe("partially_completed");
    expect(await db().select().from(privacyRetentionSourceSnapshots).where(and(eq(privacyRetentionSourceSnapshots.exceptionId, empty.id), eq(privacyRetentionSourceSnapshots.sourceScope, "imports.readerSources")))).toMatchObject([{ memberCount: 0 }]);
    expect(await db().select().from(privacyRetentionSourceMembers).where(eq(privacyRetentionSourceMembers.exceptionId, empty.id))).toEqual([]);
    expect(await db().select().from(privacyRetentionSourceMembers).where(eq(privacyRetentionSourceMembers.exceptionId, otherHold.id))).toMatchObject([{ sourceId: original.run.id, generation: original.source.uploadId }]);
  });
});
