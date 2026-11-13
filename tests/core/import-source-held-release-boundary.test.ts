// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C3.47/C11.14: receipt lineage refuses other subjects and corruption.
import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, closeDb } from "@/core/db";
import { users, totpFactors } from "@/core/auth/schema";
import { createSession } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import type { Actor } from "@/core/service";
import { contacts } from "@/core/contacts/schema";
import { resolveContact } from "@/core/contacts/service";
import { dataRequestArtifacts, dataRequests } from "@/core/privacy/schema";
import { addRetentionException, createDataRequest, fulfillDataRequest, removeRetentionException, verifyDataRequest, erasureArtifactIsIntact } from "@/core/privacy/service";
import { importSourceEntries, importSourceGraphs } from "@/core/plugins/schema";
import { importSourceErasureMembers, importSourceErasureObjects, importSourceErasureScopes } from "@/core/import/source-erasure-schema";
import { rollbackImport, startImport } from "@/core/import/service";
import { beginSourceUpload, previewFromUpload, uploadSourceChunk } from "@/core/import/source-upload";
import { resetStorageForTests, storage } from "@/adapters/storage";
import { mediaObjectWrites } from "@/core/media/write-schema";
import { deleteUnownedPendingObjects } from "@/core/media/object-ledger";
import { stopJobs } from "@/core/jobs";
import { ensureDefaults } from "@/modules/cms/service";
import { originalStaticZip } from "../helpers/original-static-zip";
import { hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const ORIGIN = "https://fictional-hold-redrive.example";
const EMAIL = "fictional-released-reader@example.test";

type SourceKind = "wordpress-wxr" | "archive";
let owner: Actor;

function originalBytes(kind: SourceKind, marker: string) {
  if (kind === "archive") return originalStaticZip(Array.from({ length: 501 }, (_, index) => ({
    path: `site/redrive/page-${index}.html`,
    body: `<html><head><title>${index === 0 ? marker : `Fictional page ${index}`}</title></head><body><p>Article ${index}.</p>${index === 500 ? `<!-- Original private reader metadata ${marker}. -->` : ""}</body></html>`,
  })));
  return new TextEncoder().encode(`<rss xmlns:wp="urn:wordpress" xmlns:content="urn:content"><channel><title>Fictional released original</title><link>${ORIGIN}</link>${Array.from({ length: 501 }, (_, index) => `<item><title>${index === 0 ? marker : `Fictional page ${index}`}</title><link>${ORIGIN}/redrive/page-${index}</link><wp:post_id>${index + 1}</wp:post_id><wp:post_type>page</wp:post_type><wp:status>publish</wp:status><content:encoded><![CDATA[<p>Article ${index}.</p>${index === 500 ? `<!-- Original private reader metadata ${marker}. -->` : ""}]]></content:encoded></item>`).join("")}</channel></rss>`);
}

async function stage(kind: SourceKind, marker: string) {
  const run = await startImport.call({ origin: ORIGIN, kind }, owner), bytes = originalBytes(kind, marker);
  const upload = await beginSourceUpload.call({ id: run.id, filename: kind === "archive" ? "fictional-released.zip" : "fictional-released.xml", bytes: bytes.byteLength }, owner);
  expect(upload.chunkCount).toBe(1);
  await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes }, owner);
  const initial = await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, owner);
  expect(await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, owner)).toMatchObject({ status: "discover", counts: { indexed: 500 } });
  const [graph] = await db().select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, run.id));
  if (!graph) throw new Error("The actual original graph is unavailable.");
  return { run, upload, initial, graph, key: `imports/${run.id}/${upload.uploadId}/00000.part` };
}

async function captured(requestId: string) {
  return {
    header: await db().select().from(importSourceErasureScopes).where(eq(importSourceErasureScopes.requestId, requestId)),
    members: await db().select().from(importSourceErasureMembers).where(eq(importSourceErasureMembers.requestId, requestId)),
    objects: await db().select().from(importSourceErasureObjects).where(eq(importSourceErasureObjects.requestId, requestId)),
  };
}

for (const kind of ["wordpress-wxr", "archive"] as const) describe.runIf(hasDatabase)(`released ${kind} receipt boundary (C1.08/C3.47/C11.14)`, { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await truncateSpine(); resetStorageForTests();
    await db().insert(users).values({ id: OWNER.userId, email: "fictional-release-owner@example.test", role: "owner" });
    await db().insert(totpFactors).values({ userId: OWNER.userId, encryptedSecret: "fictional-release-owner-factor" });
    const session = await db().transaction(tx => createSession(tx, OWNER.userId, { twoFactorVerified: true }));
    owner = await actorFromToken(session.token);
    if (owner.kind !== "user" || !owner.sessionId) throw new Error("The actual redrive owner session is unavailable.");
    await ensureDefaults.call({}, owner);
  });
  afterAll(async () => { vi.restoreAllMocks(); await stopJobs(); await closeDb(); });

  it.each(["other subject", "altered retained receipt"] as const)("refuses %s without capturing or minimizing an original", async fault => {
    const contact = (await resolveContact.call({ email: EMAIL }, owner)).contact, original = await stage(kind, EMAIL);
    const first = await createDataRequest.call({ contactId: contact.id, request: { kind: "erasure" } }, owner);
    const hold = await addRetentionException.call({ dataRequestId: first.id, scope: "cms.readerComments", reason: "legal_claim", legalBasis: "Fictional original input retained until claim resolution" }, owner);
    await verifyDataRequest.call({ id: first.id, method: "Actual original reader identity verified for hold" }, owner);
    const retained = await fulfillDataRequest.call({ id: first.id, confirmation: "ERASE" }, owner);
    expect(retained.request.status).toBe("partially_completed");
    expect(JSON.stringify(retained.artifact.body)).toContain("retained");
    const firstCapture = await captured(first.id);
    expect(firstCapture.header).toMatchObject([{ captureVersion: 1, sourceCount: 1, objectCount: 1 }]);
    expect(firstCapture.members).toMatchObject([{ runId: original.run.id, uploadId: original.upload.uploadId, graphId: original.graph.id, graphGeneration: original.graph.generation, sourceRevision: original.graph.sourceRevision, chunkCount: 1 }]);
    expect(firstCapture.objects).toMatchObject([{ chunkIndex: 0, keyDigest: createHash("sha256").update(original.key).digest("hex") }]);
    const originalEntries = await db().select().from(importSourceEntries).where(eq(importSourceEntries.graphId, original.graph.id));
    expect(originalEntries).toHaveLength(500); expect(JSON.stringify(originalEntries)).toContain(EMAIL);
    expect(await rollbackImport.call({ id: original.run.id, graph: original.initial.graph }, owner)).toMatchObject({ status: "rolled_back" });
    expect(await deleteUnownedPendingObjects([original.key])).toEqual({ deleted: 0 });
    expect(new TextDecoder().decode(await storage().get(original.key))).toContain(EMAIL);
    await removeRetentionException.call({ id: hold.id }, owner);
    expect(await deleteUnownedPendingObjects([original.key])).toEqual({ deleted: 1 });
    expect(await storage().get(original.key)).toBeUndefined();
    expect((await db().select().from(contacts).where(eq(contacts.id, contact.id)))[0]?.email).toBeNull();
    expect(await captured(first.id)).toEqual(firstCapture);
    expect(JSON.stringify(await db().select().from(importSourceEntries).where(eq(importSourceEntries.graphId, original.graph.id)))).toContain(EMAIL);
    const [retainedArtifact] = await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, first.id));
    expect(erasureArtifactIsIntact(retainedArtifact)).toBe(true);
    const originalWrites = await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.key, original.key));
    expect(originalWrites.filter(write => write.operation === "put")).toHaveLength(1);
    expect(originalWrites.filter(write => write.operation === "delete")).toHaveLength(1);
    expect(originalWrites.every(write => write.state === "accepted" && write.deletedAt !== null)).toBe(true);
    expect(new Set(originalWrites.map(write => write.namespace)).size).toBe(1);
    expect(originalWrites.every(write => typeof write.namespace === "string" && /^[a-f0-9]{64}$/.test(write.namespace))).toBe(true);
    expect(originalWrites.every(write => write.keyDigest === createHash("sha256").update(`freeholder:media-object-key:v1\0${original.key}`).digest("hex"))).toBe(true);

    const originalBefore = await db().select().from(importSourceEntries).where(eq(importSourceEntries.graphId,original.graph.id));
    const target = fault === "other subject" ? (await resolveContact.call({ email: "fictional-other-reader@example.test" },owner)).contact : contact;
    if (fault === "altered retained receipt") {
      await db().update(dataRequestArtifacts).set({ body: { ...retainedArtifact!.body as Record<string,unknown>, note: "Changed after the original immutable checksum" } }).where(eq(dataRequestArtifacts.id,retainedArtifact!.id));
      expect(erasureArtifactIsIntact((await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.id,retainedArtifact!.id)))[0])).toBe(false);
    }
    const artifactBeforeAttempt = (await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId,first.id)))[0];
    const next = await createDataRequest.call({ contactId: target.id,request: { kind: "erasure" } },owner);
    await verifyDataRequest.call({ id:next.id,method:"Actual separate request identity verification" },owner);
    await expect(fulfillDataRequest.call({ id:next.id,confirmation:"ERASE" },owner)).rejects.toMatchObject({ code:"conflict" });
    expect(await captured(next.id)).toEqual({ header:[],members:[],objects:[] });
    expect(await captured(first.id)).toEqual(firstCapture);
    expect((await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId,first.id)))[0]).toEqual(artifactBeforeAttempt);
    expect(await db().select().from(importSourceEntries).where(eq(importSourceEntries.graphId,original.graph.id))).toEqual(originalBefore);
    expect(await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.key,original.key))).toEqual(originalWrites);
    expect(await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId,next.id))).toEqual([]);
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id,next.id)))[0]?.status).toBe("verified");
  });
});
