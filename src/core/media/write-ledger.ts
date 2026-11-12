// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C3.22/C11.08: original physical intent survives network/process failure.
import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, gt, sql } from "drizzle-orm";
import { boundStorage } from "@/adapters/storage";
import { db } from "@/core/db";
import { contacts } from "@/core/contacts/schema";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { dataRequests, privacyRetentionExceptions } from "@/core/privacy/schema";
import { actorString, ServiceError, type Actor, type Tx } from "@/core/service";
import { assets, mediaObjects, mediaUploads } from "./schema";
import { mediaObjectWrites } from "./write-schema";
import { pendingObjectIsOwned } from "./object-ledger";
import {mediaMultipartResources} from "./multipart-schema";
import {assertOriginalUploadWritable,assertMediaActorLive} from "./upload-ownership";

export const MEDIA_WRITES_SCOPE = "media.storageOperations";
const unsettled = new Set(["unverified", "started", "unknown"]);
export async function allowMediaReceiptWrites(tx: Tx): Promise<void> {
  await tx.execute(sql`select set_config('freeholder.media_writes_v1','1',true)`);
}
async function lockObject(tx: Tx, key: string) {
  await lockObjectDigest(tx, objectKeyDigest(key));
}
export async function lockObjectDigest(tx: Tx, digest: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`media-object-write:${digest}`}))`);
}
export function objectKeyDigest(key: string): string {
  return createHash("sha256").update("freeholder:media-object-key:v1\0").update(key).digest("hex");
}
/** No physical PUT can be admitted after this terminal proxy-session lock. */
export async function discardUnwrittenProxyReservation(uploadId: string, key: string): Promise<boolean> {
  return db().transaction(async tx => {
    await lockContactIdentityForRead(tx);
    await lockObject(tx, key);
    const [upload] = await tx.select().from(mediaUploads).where(eq(mediaUploads.id, uploadId)).limit(1).for("update");
    if (!upload || upload.strategy !== "proxy" || upload.storageKey !== key || !["aborted", "expired", "failed"].includes(upload.state)) return false;
    if ((await records(tx, key)).length) return false;
    await tx.delete(mediaObjects).where(and(eq(mediaObjects.key, key), eq(mediaObjects.state, "pending")));
    return true;
  });
}
/** A missing physical intent proves this guarded reservation never admitted I/O. */
export async function discardUnwrittenObjectReservation(key:string):Promise<boolean>{
 if(await pendingObjectIsOwned(key))return false;
 return db().transaction(async tx=>{
  await lockContactIdentityForRead(tx);await lockObject(tx,key);await allowMediaReceiptWrites(tx);
  const[object]=await tx.select().from(mediaObjects).where(eq(mediaObjects.key,key)).limit(1).for("update");
  if(!object||object.state!=="pending"||(await records(tx,key)).length)return false;
  const active=await tx.select({id:mediaUploads.id}).from(mediaUploads).where(and(eq(mediaUploads.storageKey,key),inArray(mediaUploads.state,["created","uploading","uploaded","processing"]),gt(mediaUploads.expiresAt,new Date()))).limit(1);
  const multipart=await tx.select({id:mediaMultipartResources.id}).from(mediaMultipartResources).where(and(eq(mediaMultipartResources.keyDigest,objectKeyDigest(key)),isNull(mediaMultipartResources.retiredAt))).limit(1);
  if(active.length||multipart.length)return false;
  await tx.delete(mediaObjects).where(eq(mediaObjects.key,key));return true;
 });
}
async function records(tx: Tx, key: string) {
  return tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.keyDigest, objectKeyDigest(key))).orderBy(asc(mediaObjectWrites.createdAt), asc(mediaObjectWrites.id)).for("update");
}

export type TrackedPut = {
  key: string; body: Uint8Array<ArrayBuffer>; contentType: string;
  role: "original" | "variant" | "staged"; uploadId?: string; ownerAssetId?: string;
  requiresReservation?:boolean; originalKey?:string;
};
export type CapturedStorage=Awaited<ReturnType<typeof boundStorage>>;
/** Existing stored bytes are read only through their accepted original fact. */
export async function originalStoredObject(key:string):Promise<CapturedStorage&{receipt:{sha256:string;bytes:number}}>{
 const captured=await boundStorage();
 const receipt=await db().transaction(async tx=>{
  await lockContactIdentityForRead(tx);await lockObject(tx,key);
  const[object]=await tx.select().from(mediaObjects).where(eq(mediaObjects.key,key)).limit(1);
  if(!object)throw new ServiceError("conflict","The original stored-object reservation is unavailable.");
  await assertOriginalUploadWritable(tx,object.ownerContactId,null);
  const history=await records(tx,key),live=history.filter(row=>!row.deletedAt);
  if(!live.length||live.some(row=>row.state!=="accepted"||row.operation!=="put"||row.namespace!==captured.binding.namespace))throw new ServiceError("conflict","Restore and recover the exact original storage resource before reading this object.");
  const original=live.at(-1)!;if(!original.sha256||original.bytes===null)throw new ServiceError("conflict","The original stored-object byte witness needs verified recovery.");
  return{sha256:original.sha256,bytes:original.bytes};
 });
 return{...captured,receipt};
}

/** Caller has already authorized the ordinary upload/backfill/rescan operation.
 * This is shared infrastructure, not authority to retry anyone's old intent.
 */
export async function putWithReceipt(input: TrackedPut, actor: Actor,captured?:CapturedStorage): Promise<void> {
  const body=new Uint8Array(input.body);
  const { store, binding } = captured??await boundStorage();
  const sha256 = createHash("sha256").update(body).digest("hex");
  const admission = await db().transaction(async tx => {
    await lockContactIdentityForRead(tx);
    await assertMediaActorLive(tx,actor);
    await lockObject(tx, input.key);
    await allowMediaReceiptWrites(tx);
    let originalOwner:string|null|undefined,originalActor:string|null=null;
    if (input.uploadId) {
      const [upload] = await tx.select().from(mediaUploads).where(eq(mediaUploads.id, input.uploadId)).limit(1).for("update");
      if (!upload || (input.role==="original"?upload.storageKey!==input.key:!input.key.startsWith(`${upload.storageKey}.r-`)) || upload.state !== "processing" || upload.expiresAt <= new Date()) throw new ServiceError("conflict", "This upload no longer accepts a physical write. Start a new upload.");
      originalOwner=upload.ownerContactId;originalActor=upload.uploadedBy;
      await assertOriginalUploadWritable(tx,originalOwner,originalActor);
    }
    const [reserved]=await tx.select().from(mediaObjects).where(eq(mediaObjects.key,input.originalKey??input.key)).limit(1).for("update");
    if(input.requiresReservation&&!reserved)throw new ServiceError("conflict","The original object reservation was retired before storage admission.");
    if(originalOwner===undefined&&reserved){originalOwner=reserved.ownerContactId;await assertOriginalUploadWritable(tx,originalOwner,null);}
    const multipart=await tx.select({id:mediaMultipartResources.id}).from(mediaMultipartResources).where(and(eq(mediaMultipartResources.keyDigest,objectKeyDigest(input.key)),isNull(mediaMultipartResources.retiredAt))).limit(1);
    if(multipart.length)throw new ServiceError("conflict","The original multipart resource still owns this object key.");
    const history = await records(tx, input.key);
    if (history.some(row => row.redactedAt || unsettled.has(row.state))) throw new ServiceError("conflict", "An original storage operation is unresolved or retired. Start a new upload or review its original receipt.");
    if (history.some(row => row.namespace !== binding.namespace)) throw new ServiceError("conflict", "Restore the exact original storage resource before writing this object key.");
    const original = history.filter(row => row.namespace === binding.namespace);
    if (original.some(row => row.operation === "delete" && row.state === "accepted")) throw new ServiceError("conflict", "This original object key was retired. Start a new upload.");
    const accepted = original.find(row => row.operation === "put" && row.state === "accepted" && !row.deletedAt);
    if (accepted) {
      if (accepted.sha256 !== sha256 || accepted.bytes !== body.byteLength || accepted.contentType !== input.contentType) throw new ServiceError("conflict", "The original upload has different bytes. Start a new upload rather than overwrite it.");
      return { reused: true as const, id: accepted.id };
    }
    const [object] = await tx.select().from(mediaObjects).where(eq(mediaObjects.key, input.key)).limit(1).for("update");
    if (object?.state === "attached") throw new ServiceError("conflict", "This key already belongs to a library file. Start a new upload.");
    let uploader = actor.kind === "user" ? actor.userId : null;
    if (input.ownerAssetId) {
      const [asset] = await tx.select({ uploadedBy: assets.uploadedBy }).from(assets).where(eq(assets.id, input.ownerAssetId)).limit(1);
      uploader = asset?.uploadedBy?.match(/^user:([0-9a-f-]{36})$/i)?.[1] ?? null;
    }
    const [contact] = originalOwner===undefined&&uploader ? await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.userId, uploader)).limit(1) : [];
    const contactId=originalOwner===undefined?contact?.id??null:originalOwner;
    await assertOriginalUploadWritable(tx,contactId,originalActor);
    const id = randomUUID();
    await tx.insert(mediaObjectWrites).values({ id, operation: "put", key: input.key, keyDigest: objectKeyDigest(input.key), namespace: binding.namespace, storageKind: binding.kind,
      storageLocation: binding.location, sha256, bytes: body.byteLength, contentType: input.contentType, actor: actorString(actor), contactId, state: "started" });
    await tx.insert(mediaObjects).values({ key: input.key, contentType: input.contentType, role: input.role, bytes: body.byteLength, uploadId: input.uploadId,ownerContactId:contactId, state: "pending" })
      .onConflictDoUpdate({ target: mediaObjects.key, set: { contentType: input.contentType, role: input.role, bytes: body.byteLength, updatedAt: new Date() } });
    return { reused: false as const, id };
  });
  if (admission.reused) return;
  let providerAccepted = false;
  try {
    await store.put(input.key, body, input.contentType, { onAccepted: async () => {
      providerAccepted = true;
      await observeStorageOperation(admission.id, true, false);
    } });
    providerAccepted = true;
    await observeStorageOperation(admission.id, true);
  } catch (error) {
    // Even if outcome recording itself failed, the original started row still
    // protects this key. No elapsed-time rule converts it into absence.
    await observeStorageOperation(admission.id, providerAccepted, false).catch(() => {});
    throw error;
  }
}

export async function observeStorageOperation(id: string, accepted: boolean, settled = true): Promise<void> {
  await db().transaction(async tx => {
    await allowMediaReceiptWrites(tx);
    const [intent] = await tx.select({ keyDigest: mediaObjectWrites.keyDigest }).from(mediaObjectWrites).where(eq(mediaObjectWrites.id, id)).limit(1);
    if (!intent) throw new ServiceError("conflict", "The original storage receipt is missing. Restore its exact backup.");
    await lockObjectDigest(tx, intent.keyDigest);
    const [row] = await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id, id)).limit(1).for("update");
    if (!row) throw new ServiceError("conflict", "The original storage receipt is missing. Restore its exact backup.");
    if (!accepted && row.state === "accepted") return;
    const contradiction = accepted && row.state === "confirmed_absent";
    await tx.update(mediaObjectWrites).set({ state: contradiction || !settled ? "unknown" : accepted ? "accepted" : "unknown",
      ...(accepted&&!row.observedAcceptedAt ? { observedAcceptedAt: new Date() } : {}), ...(contradiction ? { deletedAt: null } : {}), updatedAt: new Date() }).where(eq(mediaObjectWrites.id, id));
    if (contradiction && !row.redactedAt) {
      // A late positive fact supersedes a human's absence assertion. Restore
      // the pending pointer as well as the receipt so sweepers cannot lose it.
      await tx.insert(mediaObjects).values({ key: row.key, role: "original", state: "pending", contentType: row.contentType, bytes: row.bytes ?? 0 }).onConflictDoNothing();
    }
  });
  await(await import("./erasure-cohorts")).reconcileMediaErasureCohorts({objectReceiptId:id}).catch(()=>{});
}

export async function storageOperationsHeld(tx: Tx, owners: Array<string | null>): Promise<boolean> {
  const holds = await tx.select({ contactId: dataRequests.contactId }).from(privacyRetentionExceptions)
    .innerJoin(dataRequests, eq(dataRequests.id, privacyRetentionExceptions.dataRequestId))
    .where(and(inArray(privacyRetentionExceptions.scope, [MEDIA_WRITES_SCOPE, "media.multipartOperations", "members"]),
      sql`(${privacyRetentionExceptions.expiresAt} is null or ${privacyRetentionExceptions.expiresAt}>clock_timestamp())`));
  return holds.some(hold => owners.includes(null) || owners.includes(hold.contactId));
}

/** Delete only an unowned, settled object in its original resource namespace.
 * The durable delete attempt fences a concurrent/future PUT for this key.
 */
export async function deleteWithReceipt(key: string,captured?:CapturedStorage): Promise<boolean> {
  if (await pendingObjectIsOwned(key)) return false;
  const { store, binding } = captured??await boundStorage();
  const claim = await db().transaction(async tx => {
    await lockContactIdentityForRead(tx);
    await lockObject(tx, key);
    await allowMediaReceiptWrites(tx);
    const [object] = await tx.select().from(mediaObjects).where(eq(mediaObjects.key, key)).limit(1).for("update");
    const history = await records(tx, key);
    const multipart=await tx.select({id:mediaMultipartResources.id}).from(mediaMultipartResources).where(and(eq(mediaMultipartResources.keyDigest,objectKeyDigest(key)),isNull(mediaMultipartResources.retiredAt))).limit(1);
    if(multipart.length)return null;
    if (!history.length || history.some(row => unsettled.has(row.state))) return null;
    const live = history.filter(row => !row.deletedAt);
    if (history.some(row => !row.namespace || row.namespace !== binding.namespace)) return null;
    if (object?.state === "attached" || await storageOperationsHeld(tx, history.map(row => row.contactId))) return null;
    const completed = history.find(row => row.operation === "delete" && row.state === "accepted" && row.namespace === binding.namespace);
    if (completed && !live.length) {
      if (object) await tx.delete(mediaObjects).where(eq(mediaObjects.key, key));
      return { done: true as const };
    }
    const id = randomUUID(), original = history.filter(row => row.operation === "put" && row.state === "accepted" && !row.deletedAt).at(-1) ?? history.at(-1);
    await tx.insert(mediaObjectWrites).values({ id, operation: "delete", key, keyDigest: objectKeyDigest(key), namespace: binding.namespace, storageKind: binding.kind, storageLocation: binding.location,
      sha256: original?.sha256 ?? null, bytes: original?.bytes ?? null, contentType: original?.contentType ?? "application/octet-stream", actor: "system:media-cleanup", contactId: original?.contactId ?? null, state: "started" });
    const{originalMediaErasureRequests,captureMediaErasureCohort}=await import("./erasure-cohorts");
    for(const request of await originalMediaErasureRequests(tx,history.map(row=>row.id)))await captureMediaErasureCohort(tx,request.requestId,request.scope as "media.storageOperations"|"media.multipartOperations",[id]);
    return { done: false as const, id };
  });
  if (!claim) return false;
  if (claim.done) return true;
  try {
    await store.delete(key);
    // Preserve the positive DELETE acknowledgement even if verification or
    // its local commit subsequently fails. It is distinct from absence.
    await observeStorageOperation(claim.id, true, false);
    if (await store.head(key)) throw new Error("The original object is still present after deletion.");
    await db().transaction(async tx => {
      await allowMediaReceiptWrites(tx);
      await lockObject(tx, key);
      await tx.update(mediaObjectWrites).set({ state: "accepted", observedAcceptedAt: new Date(), deletedAt: new Date(), updatedAt: new Date() }).where(eq(mediaObjectWrites.id, claim.id));
      await tx.update(mediaObjectWrites).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(eq(mediaObjectWrites.keyDigest, objectKeyDigest(key)), eq(mediaObjectWrites.namespace, binding.namespace), isNull(mediaObjectWrites.deletedAt)));
      await tx.delete(mediaObjects).where(and(eq(mediaObjects.key, key), eq(mediaObjects.state, "pending")));
    });
    return true;
  } catch (error) {
    await observeStorageOperation(claim.id, false).catch(() => {});
    throw error;
  }
}
