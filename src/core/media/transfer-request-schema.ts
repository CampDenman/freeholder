// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type {StorageCallerRuntimeIdentity} from "./physical-caller-runtime";
// C1.12/C11.08: immutable admissions and observations per provider request.
import {sql} from "drizzle-orm";
import {bigint,check,index,integer,jsonb,pgTable,text,timestamp,uniqueIndex,uuid} from "drizzle-orm/pg-core";
import type {TransferRequestDescriptor,TransferRequestObservation} from "../../../scripts/media-transfer.mjs";
import {createdAtColumn} from "@/core/db/columns";
import {mediaStorageTransferCalls,mediaStorageTransferReviews} from "./transfer-schema";
export const mediaStorageTransferRequests=pgTable("media_storage_transfer_requests",{
 id:uuid("id").primaryKey().defaultRandom(),callId:uuid("call_id").notNull().references(()=>mediaStorageTransferCalls.id,{onDelete:"restrict"}),
 keyDigest:text("key_digest"),redactedAt:timestamp("redacted_at",{withTimezone:true}),
 descriptor:jsonb("descriptor").$type<TransferRequestDescriptor>().notNull(),descriptorDigest:text("descriptor_digest").notNull(),
 tokenDigest:text("token_digest").notNull(),state:text("state",{enum:["admitted","returned","failed","unknown","stopped"]}).notNull().default("admitted"),
 runtimeIdentity:jsonb("runtime_identity").$type<StorageCallerRuntimeIdentity>().notNull(),
 returnedAt:timestamp("returned_at",{withTimezone:true}),stopReceiptId:uuid("stop_receipt_id").references(()=>mediaStorageTransferReviews.id,{onDelete:"restrict"}),
 observationCount:integer("observation_count").notNull().default(0),
 createdAt:createdAtColumn(),
},t=>[
 uniqueIndex("media_storage_original_mutating_request_idx").on(t.callId).where(sql`${t.descriptor}->>'kind' in ('object.put','object.delete','multipart.create','multipart.complete','multipart.abort')`),
 index("media_storage_transfer_requests_call_idx").on(t.callId,t.createdAt,t.id),
 index("media_storage_transfer_requests_state_idx").on(t.state,t.createdAt),
 check("media_storage_transfer_requests_state",sql`${t.state} in ('admitted','returned','failed','unknown','stopped')`),
 check("media_storage_transfer_requests_digests",sql`${t.descriptorDigest} ~ '^[a-f0-9]{64}$' and ${t.tokenDigest} ~ '^[a-f0-9]{64}$'`),
 check("media_storage_transfer_requests_count",sql`${t.observationCount} >= 0 and ${t.observationCount} <= 16`),
 check("media_storage_transfer_requests_finish",sql`${t.state} in ('admitted','unknown') or (${t.state}='stopped' and ${t.stopReceiptId} is not null) or ${t.returnedAt} is not null`),
]);
export const mediaStorageTransferRequestObservations=pgTable("media_storage_transfer_request_observations",{
 id:uuid("id").primaryKey().defaultRandom(),requestId:uuid("request_id").notNull().references(()=>mediaStorageTransferRequests.id,{onDelete:"restrict"}),
 redactedAt:timestamp("redacted_at",{withTimezone:true}),
 ordinal:integer("ordinal").notNull(),facts:jsonb("facts").$type<TransferRequestObservation>().notNull(),factsDigest:text("facts_digest").notNull(),
 bytes:bigint("bytes",{mode:"number"}),createdAt:createdAtColumn(),
},t=>[
 uniqueIndex("media_storage_transfer_request_observations_request_idx").on(t.requestId,t.ordinal),
 check("media_storage_transfer_request_observations_ordinal",sql`${t.ordinal}>0 and ${t.ordinal}<=16`),
 check("media_storage_transfer_request_observations_digest",sql`${t.factsDigest} ~ '^[a-f0-9]{64}$'`),
]);
