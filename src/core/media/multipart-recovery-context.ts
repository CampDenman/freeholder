// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Shared original recovery identity; no provider I/O or historical rebinding.
import {createHash} from "node:crypto";
import {and,eq} from "drizzle-orm";
import {z} from "zod";
import {lockContactIdentityForRead} from "@/core/contacts/identity-lock";
import {hasModuleAccess,ServiceError,type Actor,type Tx} from "@/core/service";
import {mediaMultipartOperations,mediaMultipartResources} from "./multipart-schema";
import {lockObjectDigest,objectKeyDigest} from "./write-ledger";
type Resource=typeof mediaMultipartResources.$inferSelect;
type Operation=typeof mediaMultipartOperations.$inferSelect;
const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const confirmation=z.object({resourceId:z.uuid(),operationId:z.uuid().optional(),expectedWitness:digest,originalNamespace:digest,providerUploadId:z.string().min(1).max(4096).optional(),stopDrainId:z.uuid().optional(),
 originalKey:z.string().min(1).max(2048).optional(),
 action:z.enum(["verify_original","applied","not_applied","cleanup"]),sha256:digest.optional(),bytes:z.number().int().nonnegative().max(5*1024**3).optional(),
 providerFinalReference:z.string().trim().min(8).max(300),providerEvidence:z.string().trim().min(20).max(2000),stoppedWriterEvidence:z.string().trim().min(20).max(2000),confirmation:z.literal("ORIGINAL MULTIPART RESOURCE CONFIRMED")});
export type MultipartRecoveryConfirmation=z.infer<typeof confirmation>;
export function human(actor:Actor){if(actor.kind!=="user"||actor.keyScopes||!hasModuleAccess(actor,"media","manage"))throw new ServiceError("permission","Sign in as a person with permission to manage original upload recovery.");}
export function fingerprint(resource:Resource,operation:Operation|null){return createHash("sha256").update(JSON.stringify({resource,operation})).digest("hex");}
export async function capture(tx:Tx,input:z.infer<typeof confirmation>){
 await lockContactIdentityForRead(tx);
 const[identity]=await tx.select({digest:mediaMultipartResources.keyDigest}).from(mediaMultipartResources).where(eq(mediaMultipartResources.id,input.resourceId)).limit(1);
 if(!identity)throw new ServiceError("not_found","The original multipart resource is unavailable.");
 await lockObjectDigest(tx,identity.digest);
 const[resource]=await tx.select().from(mediaMultipartResources).where(eq(mediaMultipartResources.id,input.resourceId)).limit(1).for("update");
 const operation=input.operationId?(await tx.select().from(mediaMultipartOperations).where(and(eq(mediaMultipartOperations.id,input.operationId),eq(mediaMultipartOperations.resourceId,input.resourceId))).limit(1).for("update"))[0]??null:null;
 if(!resource||(input.operationId&&!operation)||fingerprint(resource,operation)!==input.expectedWitness)throw new ServiceError("conflict","The original upload evidence changed. Reload it before reviewing the outcome.");
 const key=resource.redactedAt?input.originalKey:resource.key;
 if(!key||(input.originalKey&&input.originalKey!==key)||objectKeyDigest(key)!==resource.keyDigest||/[\u0000-\u001f]/.test(key))throw new ServiceError("validation","Restore the exact original object key and verify its immutable digest before recovery.");
 if(resource.namespace&&resource.namespace!==input.originalNamespace)throw new ServiceError("conflict","Restore this upload's original storage resource; its namespace cannot be replaced.");
 if(input.providerUploadId&&resource.providerUploadId&&resource.providerUploadId!==input.providerUploadId)throw new ServiceError("conflict","The evidence names a different original provider upload.");
 if(input.action==="not_applied"&&operation?.providerAcceptedAt)throw new ServiceError("conflict","A recorded positive provider acknowledgement cannot be marked unapplied.");
 return{resource,operation,key};
}
