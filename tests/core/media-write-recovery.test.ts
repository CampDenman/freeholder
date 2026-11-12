// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: recovery proves each original outcome without blind retries.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts, contactMergeOperations } from "@/core/contacts/schema";
import { createContact, mergeContacts, undoContactMerge } from "@/core/contacts/service";
import { createDataRequest, verifyDataRequest, fulfillDataRequest } from "@/core/privacy/service";
import { dataRequests } from "@/core/privacy/schema";
import { getJob, stopJobs } from "@/core/jobs";
import { beginUpload, abortUpload, cleanupOrphanedMedia, uploadAsset } from "@/core/media/service";
import { mediaObjects, mediaUploads } from "@/core/media/schema";
import { mediaObjectWrites } from "@/core/media/write-schema";
import { observeStorageOperation, putWithReceipt, MEDIA_WRITES_SCOPE,allowMediaReceiptWrites } from "@/core/media/write-ledger";
import { listStorageOperations, reconcileStorageOperation } from "@/core/media/write-recovery";
import { eraseMediaStorageOperations, MEDIA_WRITE_ERASURE_JOB } from "@/core/media/write-privacy";
import {eraseMultipartOperations,MULTIPART_ERASURE_JOB,MULTIPART_PRIVACY_SCOPE} from "@/core/media/multipart-privacy";
import { resetStorageForTests, storage } from "@/adapters/storage";
import { resetEnvForTests } from "@/core/env";
import { ready } from "@/core/runtime";
import { type Actor } from "@/core/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("original media recovery (C1.12/C11.08)", () => {
  const UPLOADER = { ...OWNER, userId: "00000000-0000-4000-8000-000000000002", role: "customer", grants: [] };
  let root: string;
  beforeAll(ready, 60_000);
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values({ id: OWNER.userId, email: "owner@example.test", role: "owner" });
    await db().insert(users).values({ id: UPLOADER.userId, email: "uploader@example.test", role: "customer" });
    root = mkdtempSync(join(tmpdir(), "freeholder-media-recovery-fixture-"));
    vi.stubEnv("FREEHOLDER_STORAGE", "local"); vi.stubEnv("LOCAL_STORAGE_ROOT", root);
    resetEnvForTests(); resetStorageForTests();
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); resetEnvForTests(); resetStorageForTests(); rmSync(root, { recursive: true, force: true }); });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  const body = () => new Uint8Array(Buffer.from("%PDF-1.7\nOriginal synthetic recovery fixture.\n%%EOF\n"));
  const request = (bytes = body()) => ({ filename: "private.pdf", contentType: "application/pdf", bytes });
  async function unknownPut(actor: Actor = OWNER) {
    const store = storage(), put = store.put.bind(store);
    const spy = vi.spyOn(store, "put").mockImplementation(async (...args) => { await put(...args); throw new Error("Synthetic lost PUT acknowledgement"); });
    await failure(uploadAsset.call(request(), actor));
    const [row] = await db().select().from(mediaObjectWrites);
    expect(row?.state).toBe("unknown");
    return { row: row!, store, spy };
  }
  function review(row: typeof mediaObjectWrites.$inferSelect, outcome: "applied" | "not_applied" = "applied") {
    return { id: row.id, expectedUpdatedAt: row.updatedAt.toISOString(), originalNamespace: row.namespace!, outcome,
      providerFinalReference: "fixture-provider-final-1234", providerEvidence: "Synthetic provider confirmed the exact original operation outcome.",
      stoppedWriterEvidence: "Synthetic original provider writers were verified stopped before review.", confirmation: "ORIGINAL STORAGE OUTCOME CONFIRMED" };
  }
  async function positivePending() {
    const store = storage(), put = store.put.bind(store), bytes = body();
    const reservation = await beginUpload.call({ filename: "private.pdf", contentType: "application/pdf", bytes: bytes.byteLength }, OWNER);
    vi.spyOn(store, "put").mockImplementation(async (...args) => { const result = await put(...args); await db().transaction(async tx=>{await allowMediaReceiptWrites(tx);await tx.update(mediaUploads).set({ state: "aborted" }).where(eq(mediaUploads.id, reservation.id));}); return result; });
    await failure(uploadAsset.call({ ...request(bytes), uploadId: reservation.id }, OWNER));
    const [row] = await db().select().from(mediaObjectWrites);
    expect(row?.state).toBe("accepted");
    return { store, row: row! };
  }

  it("never repeats an unknown physical PUT and keeps its witness when the owner aborts", async () => {
    const bytes = body(), reservation = await beginUpload.call({ filename: "private.pdf", contentType: "application/pdf", bytes: bytes.byteLength }, OWNER);
    const store = storage(), put = store.put.bind(store);
    const spy = vi.spyOn(store, "put").mockImplementation(async (...args) => { await put(...args); throw new Error("Synthetic lost ACK"); });
    await failure(uploadAsset.call({ ...request(bytes), uploadId: reservation.id }, OWNER));
    expect((await failure(uploadAsset.call({ ...request(bytes), uploadId: reservation.id }, OWNER))).code).toBe("conflict");
    expect((await failure(abortUpload.call({ id: reservation.id }, OWNER))).code).toBe("conflict");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await db().select().from(mediaObjects)).toHaveLength(1);
    expect((await db().select().from(mediaObjectWrites))[0]?.state).toBe("unknown");
  });

  it("keeps an observed positive PUT unknown when subsequent byte verification fails", async () => {
    const store = storage();
    const put = vi.spyOn(store, "put").mockImplementation(async (_key, _body, _contentType, observation) => {
      await observation?.onAccepted?.();
      throw new Error("Synthetic readback failed after actual positive upload acknowledgment");
    });
    const remove = vi.spyOn(store, "delete");
    await failure(uploadAsset.call(request(), OWNER));
    const [receipt] = await db().select().from(mediaObjectWrites);
    expect(receipt?.state).toBe("unknown");
    expect(receipt?.observedAcceptedAt).toBeInstanceOf(Date);
    expect(put).toHaveBeenCalledTimes(1); expect(remove).not.toHaveBeenCalled();
    expect((await failure(putWithReceipt({ key: receipt!.key, body: body(), contentType: "application/pdf", role: "original" }, OWNER))).code).toBe("conflict");
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("cleans a settled pending file only in its original resource and retires its key", async () => {
    const { store, row } = await positivePending();
    const result = await cleanupOrphanedMedia(new Date(Date.now() + 2 * 86_400_000));
    expect(result.orphanedObjects).toBe(1);
    expect(await store.get(row.key)).toBeUndefined();
    expect(await db().select().from(mediaObjects)).toHaveLength(0);
    const history = await db().select().from(mediaObjectWrites);
    expect(history).toHaveLength(2);
    expect(history.every(receipt => receipt.state === "accepted" && receipt.deletedAt)).toBe(true);
    expect((await failure(putWithReceipt({ key: row.key, body: body(), contentType: "application/pdf", role: "original" }, OWNER))).code).toBe("conflict");
  });

  it("preserves a lost DELETE outcome without another physical call and accepts exact human recovery", async () => {
    const { store, row } = await positivePending(), remove = store.delete.bind(store);
    const spy = vi.spyOn(store, "delete").mockImplementation(async key => { await remove(key); throw new Error("Synthetic lost DELETE acknowledgement"); });
    await failure(cleanupOrphanedMedia(new Date(Date.now() + 2 * 86_400_000)));
    await cleanupOrphanedMedia(new Date(Date.now() + 3 * 86_400_000));
    expect(spy).toHaveBeenCalledTimes(1);
    const [operation] = (await db().select().from(mediaObjectWrites)).filter(receipt => receipt.operation === "delete");
    expect(operation?.state).toBe("unknown");
    await reconcileStorageOperation.call(review(operation!), OWNER);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await db().select().from(mediaObjects)).toHaveLength(0);
    const [resolved] = await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id, operation!.id));
    expect(resolved?.state).toBe("accepted");
    expect(resolved?.reviewedBy).toBe(`user:${OWNER.userId}`);
    expect(JSON.stringify(resolved)).not.toContain("fixture-provider-final-1234");
    expect((await failure(reconcileStorageOperation.call(review(operation!), OWNER))).code).toBe("conflict");
    expect(await store.get(row.key)).toBeUndefined();
  });

  it("refuses system, agent, plugin, personal keys and stale sessions before provider evidence reads", async () => {
    const { row, store } = await unknownPut(), head = vi.spyOn(store, "head");
    const actors: Actor[] = [{ kind: "system" }, { kind: "agent", keyName: "fixture", scopes: ["media.*"] }, { kind: "plugin", name: "fixture", grants: OWNER.grants },
      { ...OWNER, keyScopes: ["media.*"] }, { ...OWNER, security: { twoFactorRequired: true, twoFactorEnrolled: true, twoFactorVerified: true, stepUpValid: false } }];
    for (const actor of actors) await failure(reconcileStorageOperation.call(review(row), actor));
    expect(head).not.toHaveBeenCalled();
    expect((await db().select().from(mediaObjectWrites))[0]?.state).toBe("unknown");
  });

  it("refuses another namespace and preserves observed positive provider facts", async () => {
    const { row, store } = await unknownPut(), head = vi.spyOn(store, "head");
    await failure(reconcileStorageOperation.call({ ...review(row), originalNamespace: "a".repeat(64) }, OWNER));
    expect(head).not.toHaveBeenCalled();
    await observeStorageOperation(row.id, true, false);
    const [positive] = await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id, row.id));
    expect(positive?.observedAcceptedAt).not.toBeNull();
    expect((await failure(reconcileStorageOperation.call(review(positive!, "not_applied"), OWNER))).code).toBe("conflict");
  });

  it("restores pending ownership if a late positive fact contradicts human absence", async () => {
    const { row, store } = await unknownPut();
    await store.delete(row.key);
    await reconcileStorageOperation.call(review(row, "not_applied"), OWNER);
    expect(await db().select().from(mediaObjects)).toHaveLength(0);
    await observeStorageOperation(row.id, true);
    expect((await db().select().from(mediaObjectWrites))[0]?.state).toBe("unknown");
    expect((await db().select().from(mediaObjects))[0]?.key).toBe(row.key);
    expect((await cleanupOrphanedMedia(new Date(Date.now() + 2 * 86_400_000))).orphanedObjects).toBe(0);
  });

  it("moves only contact pointers on merge and refuses undo after physical evidence changes", async () => {
    const original = await createContact.call({ name: "Original uploader", email: "original@example.test" }, OWNER);
    await db().update(contacts).set({ userId: OWNER.userId }).where(eq(contacts.id, original.id));
    const survivor = await createContact.call({ name: "Surviving record", email: "survivor@example.test" }, OWNER);
    const { row } = await unknownPut();
    const merged = await mergeContacts.call({ survivingId: survivor.id, duplicateId: original.id }, OWNER);
    expect((await db().select().from(mediaObjectWrites))[0]?.contactId).toBe(survivor.id);
    const [operation] = await db().select().from(contactMergeOperations).where(eq(contactMergeOperations.id, merged.mergeOperationId));
    const witness = JSON.stringify((operation?.referenceState as Array<{ table: string }>).find(item => item.table === "media_object_writes"));
    expect(witness).not.toContain(row.key);
    await undoContactMerge.call({ operationId: merged.mergeOperationId }, OWNER);
    expect((await db().select().from(mediaObjectWrites))[0]?.contactId).toBe(original.id);
    const again = await mergeContacts.call({ survivingId: survivor.id, duplicateId: original.id }, OWNER);
    await observeStorageOperation(row.id, true);
    expect((await failure(undoContactMerge.call({ operationId: again.mergeOperationId }, OWNER))).code).toBe("conflict");
    expect((await db().select().from(mediaObjectWrites))[0]?.state).toBe("accepted");
  });

  it("keeps erasure pending through an unknown PUT and minimizes all resulting cleanup receipts", async () => {
    const contact = await createContact.call({ name: "Original uploader", email: "original@example.test" }, OWNER);
    await db().update(contacts).set({ userId: UPLOADER.userId }).where(eq(contacts.id, contact.id));
    const { row } = await unknownPut(UPLOADER);
    const erasure = await createDataRequest.call({ contactId: contact.id, request: { kind: "erasure" } }, OWNER);
    await verifyDataRequest.call({ id: erasure.id, method: "Synthetic verified media erasure" }, OWNER);
    const result = await fulfillDataRequest.call({ id: erasure.id, confirmation: "ERASE" }, OWNER);
    const scope = (result.artifact.body as { outcomes: Array<{ scope: string; outcome: string; pendingJobs?: string[] }> }).outcomes.find(item => item.scope === MEDIA_WRITES_SCOPE);
    expect(scope?.outcome).toBe("pending");
    const job = await getJob(MEDIA_WRITE_ERASURE_JOB, scope!.pendingJobs![0]!);
    await failure(eraseMediaStorageOperations(job!.data));
    await reconcileStorageOperation.call(review((await db().select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id, row.id)))[0]!), OWNER);
    await eraseMediaStorageOperations(job!.data);
    const reservationScope=(result.artifact.body as {outcomes:Array<{scope:string;pendingJobs?:string[]}>}).outcomes.find(item=>item.scope===MULTIPART_PRIVACY_SCOPE);
    for(const jobId of reservationScope?.pendingJobs??[]){const reservationJob=await getJob(MULTIPART_ERASURE_JOB,jobId);await eraseMultipartOperations(reservationJob!.data);}
    const history = await db().select().from(mediaObjectWrites);
    expect(history).toHaveLength(2);
    expect(history.every(receipt => receipt.redactedAt && receipt.contactId === null && receipt.actor === "erased" && receipt.key.startsWith("retained:"))).toBe(true);
    expect((await db().select().from(dataRequests).where(eq(dataRequests.id, erasure.id)))[0]?.status).toBe("completed");
    expect((await listStorageOperations.call({}, OWNER)).rows).toHaveLength(0);
  });
});
