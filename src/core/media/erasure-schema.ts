// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C1.08: minimal original erasure authority survives source minimization.
import {sql} from "drizzle-orm";
import {boolean,check,index,jsonb,pgTable,primaryKey,text,timestamp,uniqueIndex,uuid} from "drizzle-orm/pg-core";
import {dataRequests} from "@/core/privacy/schema";
import {mediaObjectWrites} from "./write-schema";
import {mediaMultipartResources} from "./multipart-schema";
export const mediaErasureCohorts=pgTable("media_erasure_cohorts",{
 id:uuid("id").primaryKey().defaultRandom(),requestId:uuid("request_id").notNull().references(()=>dataRequests.id,{onDelete:"restrict"}),
 scope:text("scope").notNull(),objectReceiptId:uuid("object_receipt_id").references(()=>mediaObjectWrites.id,{onDelete:"restrict"}),
 multipartResourceId:uuid("multipart_resource_id").references(()=>mediaMultipartResources.id,{onDelete:"restrict"}),
 createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[
 index("media_erasure_request_idx").on(t.requestId),
 uniqueIndex("media_erasure_object_idx").on(t.requestId,t.scope,t.objectReceiptId).where(sql`${t.objectReceiptId} is not null`),
 uniqueIndex("media_erasure_multipart_idx").on(t.requestId,t.scope,t.multipartResourceId).where(sql`${t.multipartResourceId} is not null`),
 check("media_erasure_one_source",sql`num_nonnulls(${t.objectReceiptId},${t.multipartResourceId}) = 1`),
 check("media_erasure_scope",sql`${t.scope} in ('media.storageOperations','media.multipartOperations')`),
]);

/** First observed membership is immutable, including a truly empty capture.
 * Missing legacy birth stays a separately recorded debt, never a new UUID. */
export interface OriginalMediaErasureMembership{
 format:"freeholder.original-media-erasure/v1";
 legacyScopes:Array<{requestId:string;scope:string;artifactDigest:string|null}>;
 receipts:Array<{id:string;reservationId:string|null;witness:string}>;
 resources:Array<{id:string;reservationId:string|null;witness:string}>;
 uploads:Array<{id:string;witness:string}>;
 reservations:Array<{id:string;keyDigest:string;witness:string}>;
 legacyReservations:Array<{keyDigest:string;witness:string}>;
}
export const mediaOriginalErasureScopes=pgTable("media_original_erasure_scopes",{
 requestId:uuid("request_id").notNull().references(()=>dataRequests.id,{onDelete:"restrict"}),scope:text("scope").notNull(),
 membership:jsonb("membership").$type<OriginalMediaErasureMembership>().notNull(),captureDigest:text("capture_digest").notNull(),
 complete:boolean("complete").notNull().default(false),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[
 primaryKey({columns:[t.requestId,t.scope]}),
 check("media_original_erasure_scope",sql`${t.scope} in ('media.storageOperations','media.multipartOperations')`),
 check("media_original_erasure_digest",sql`${t.captureDigest} ~ '^[a-f0-9]{64}$'`),
]);
