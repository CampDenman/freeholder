// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import originalDeleteRecoveryServices,{recoverExactOriginalDelete} from "./original-delete-recovery";
import {db} from "@/core/db";
import originalRecoveryServices,{recoverExactOriginalPut} from "./original-write-recovery";
import {storageRecoveryConfirmation} from "./storage-recovery-contract";
import {requireDurableMediaRetirementProof} from "./retirement-authority";
// C1.12/C11.08: explicit human evidence settles each original physical call.
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { timestamp } from "@/core/contract";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { actorString, defineOrchestratedService, hasModuleAccess, ServiceError, type Actor } from "@/core/service";
import {defineMediaService as defineService} from "./guarded-service";
import { mediaObjects } from "./schema";
import { allowMediaReceiptWrites, lockObjectDigest,objectKeyDigest } from "./write-ledger";
import { mediaObjectWrites } from "./write-schema";
import {captureMediaErasureCohort,originalMediaErasureRequests} from "./erasure-cohorts";

function human(actor: Actor) {
  if (actor.kind !== "user" || actor.keyScopes || !hasModuleAccess(actor, "media", "manage")) throw new ServiceError("permission", "Sign in as a person with permission to manage media recovery.");
}
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const confirmation = storageRecoveryConfirmation;
function physicalKey(row:typeof mediaObjectWrites.$inferSelect,input:z.infer<typeof confirmation>):string{
 const key=row.redactedAt?input.originalKey:row.key;
 if(!key||(input.originalKey&&input.originalKey!==key)||objectKeyDigest(key)!==row.keyDigest||/[\u0000-\u001f]/.test(key))throw new ServiceError("validation","Restore the exact original object key; it must match the immutable original key digest.");
 return key;
}
const publicRow = z.object({ id: z.uuid(), operation: z.enum(["put", "delete"]), key: z.string(), namespace: digest.nullable(),
  bytes: z.number().nullable(), sha256: digest.nullable(), contentType: z.string(), state: z.string(),
  observedAcceptedAt: timestamp.nullable(), createdAt: timestamp, updatedAt: timestamp });
export const listStorageOperations = defineService({
  name: "media.listStorageOperations", summary: "Inspect unresolved original storage operations before human recovery.", kind: "query", permission: "scoped", agentCallable: false,
  input: z.object({ limit: z.number().int().min(1).max(100).default(25) }), output: z.object({ rows: z.array(publicRow) }),
  handler: async (input, ctx) => {
    human(ctx.actor);
    return { rows: await ctx.tx.select().from(mediaObjectWrites).where(inArray(mediaObjectWrites.state, ["unverified", "started", "unknown"]))
      .orderBy(asc(mediaObjectWrites.createdAt), asc(mediaObjectWrites.id)).limit(input.limit) };
  },
});
const claimStorageRecovery = defineService({
  name: "media.claimStorageRecovery", summary: "Capture unchanged original storage intent for a person's review.", kind: "mutation", permission: "scoped", agentCallable: false, stepUp: true,
  external: false, orchestratedBy: "media.reconcileStorageOperation", auditInputFields: ["id", "outcome"],
  input: confirmation, output: publicRow,
  handler: async (input, ctx) => {
    human(ctx.actor);
    await lockContactIdentityForRead(ctx.tx);
    const [row] = await ctx.tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id, input.id)).limit(1).for("update");
    if (!row) throw new ServiceError("not_found", "The original storage receipt is unavailable.");
    if (! ["unverified", "started", "unknown"].includes(row.state) || row.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new ServiceError("conflict", "The original operation changed. Reload it before reviewing the outcome.");
    physicalKey(row,input);
    if (row.namespace && row.namespace !== input.originalNamespace) throw new ServiceError("conflict", "The evidence does not identify the original storage resource.");
    if (row.observedAcceptedAt && input.outcome === "not_applied") throw new ServiceError("conflict", "The provider already acknowledged this operation. A later failure cannot erase that fact.");
    if(row.operation==="put"?input.outcome==="not_applied":input.outcome==="applied")requireDurableMediaRetirementProof();
    ctx.setSubject("media_storage_operation", row.id);
    return row;
  },
});
const applyStorageRecovery = defineService({
  name: "media.applyStorageRecovery", summary: "Record a person's verified original provider and stopped-writer evidence.", kind: "mutation", permission: "scoped", agentCallable: false, stepUp: true,
  external: false, orchestratedBy: "media.reconcileStorageOperation", auditInputFields: ["id", "outcome"],
  input: confirmation.extend({ storageKind: z.enum(["local", "s3", "replit"]), storageLocation: z.record(z.string(), z.string()) }), output: z.object({ ok: z.literal(true) }),
  handler: async (input, ctx) => {
    human(ctx.actor);
    await lockContactIdentityForRead(ctx.tx);
    await allowMediaReceiptWrites(ctx.tx);
    const [intent] = await ctx.tx.select({ keyDigest: mediaObjectWrites.keyDigest }).from(mediaObjectWrites).where(eq(mediaObjectWrites.id, input.id)).limit(1);
    if (!intent) throw new ServiceError("not_found", "The original storage receipt is unavailable.");
    await lockObjectDigest(ctx.tx, intent.keyDigest);
    const [row] = await ctx.tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.id, input.id)).limit(1).for("update");
    if (!row || !["unverified", "started", "unknown"].includes(row.state) || row.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new ServiceError("conflict", "The storage operation changed during verification. Reload it before reviewing again.");
    const key=physicalKey(row,input);
    if (row.namespace && row.namespace !== input.originalNamespace) throw new ServiceError("conflict", "This is not the original storage namespace.");
    if (row.observedAcceptedAt && input.outcome === "not_applied") throw new ServiceError("conflict", "A recorded provider acknowledgement cannot be marked unapplied.");
    const evidenceDigest = createHash("sha256").update(JSON.stringify({ ...input, actor: actorString(ctx.actor) })).digest("hex");
    const absent = row.operation === "put" ? input.outcome === "not_applied" : input.outcome === "applied";
    if(absent)requireDurableMediaRetirementProof();
    if(row.redactedAt&&!absent){
      // A fresh physical cleanup witness may restore a verified provider key;
      // the minimized historical identity and its digest remain unchanged.
      const [adopted]=await ctx.tx.insert(mediaObjectWrites).values({operation:"put",key,keyDigest:row.keyDigest,namespace:row.namespace,storageKind:row.storageKind,storageLocation:input.storageLocation,
        sha256:row.sha256??input.sha256,bytes:row.bytes??input.bytes,contentType:row.contentType,actor:actorString(ctx.actor),contactId:null,state:"accepted",reviewedAt:new Date(),reviewedBy:actorString(ctx.actor),evidenceDigest}).returning();
      const requests=await originalMediaErasureRequests(ctx.tx,[row.id]);
      if(!requests.length)throw new ServiceError("conflict","Restore the original erasure authority before adopting its physical cleanup witness.");
      for(const request of requests)await captureMediaErasureCohort(ctx.tx,request.requestId,request.scope as "media.storageOperations"|"media.multipartOperations",[adopted!.id]);
      await ctx.tx.insert(mediaObjects).values({key,role:"original",state:"pending",bytes:row.bytes??input.bytes,contentType:row.contentType}).onConflictDoNothing();
    }
    await ctx.tx.update(mediaObjectWrites).set({ state: input.outcome === "applied" ? "accepted" : "confirmed_absent",
      ...(!row.namespace ? { namespace: input.originalNamespace, storageKind: input.storageKind, storageLocation: input.storageLocation, sha256: input.sha256 ?? null, bytes: row.bytes ?? input.bytes ?? null } : {}),
      reviewedAt: new Date(), reviewedBy: row.redactedAt?null:actorString(ctx.actor), evidenceDigest,
      ...(absent ? { deletedAt: new Date() } : {}), updatedAt: new Date() }).where(eq(mediaObjectWrites.id, row.id));
    if (row.operation === "delete" && absent) {
      // Only this exact provider resource was verified. Another unknown PUT
      // still protects its ownership and pending erasure receipt.
      await ctx.tx.update(mediaObjectWrites).set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(mediaObjectWrites.keyDigest, row.keyDigest), eq(mediaObjectWrites.namespace, input.originalNamespace), eq(mediaObjectWrites.state, "accepted"), isNull(mediaObjectWrites.deletedAt)));
    }
    const unresolved = await ctx.tx.select({ id: mediaObjectWrites.id }).from(mediaObjectWrites)
      .where(and(eq(mediaObjectWrites.keyDigest, row.keyDigest), inArray(mediaObjectWrites.state, ["unverified", "started", "unknown"]))).limit(1);
    if (absent && !unresolved.length) await ctx.tx.delete(mediaObjects).where(and(eq(mediaObjects.key, key), eq(mediaObjects.state, "pending")));
    ctx.setSubject("media_storage_operation", row.id);
    return { ok: true as const };
  },
});
export const reconcileStorageOperation = defineOrchestratedService({
  name: "media.reconcileStorageOperation", summary: "Verify the original storage resource and record a fresh person's final provider evidence.", kind: "mutation", permission: "scoped", agentCallable: false, stepUp: true,
  auditInputFields: ["id", "outcome"], input: confirmation, output: z.object({ ok: z.literal(true) }),
  handler: async (input, actor) => {
    human(actor);
    const[row]=await db().select({operation:mediaObjectWrites.operation}).from(mediaObjectWrites).where(eq(mediaObjectWrites.id,input.id)).limit(1);
    return row?.operation==="delete"?recoverExactOriginalDelete(input,actor):recoverExactOriginalPut(input,actor);
  },
});
export default [listStorageOperations, claimStorageRecovery, applyStorageRecovery, ...originalRecoveryServices,...originalDeleteRecoveryServices,reconcileStorageOperation];
