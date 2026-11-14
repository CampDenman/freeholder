// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: multipart resources and physical calls have distinct lifetimes.
import {sql} from "drizzle-orm";
import {bigint,check,index,jsonb,pgTable,text,timestamp,uniqueIndex,uuid} from "drizzle-orm/pg-core";
import {contacts} from "@/core/contacts/schema";
import {createdAtColumn,updatedAtColumn} from "@/core/db/columns";
import type {MultipartPart} from "@/adapters/storage/types";
import {mediaObjectWrites} from "./write-schema";

export const MULTIPART_STATES=["unverified","creating","open","completing","completed","aborting","aborted","unknown"]as const;
export const MULTIPART_OPERATION_STATES=["started","accepted","unknown","not_applied"]as const;
/** uploadId remains an immutable logical identity even after session pruning. */
export const mediaMultipartResources=pgTable("media_multipart_resources",{
 id:uuid("id").primaryKey().defaultRandom(),originalReservationId:uuid("original_reservation_id"),uploadId:uuid("upload_id").notNull(),
 key:text("object_key").notNull(),keyDigest:text("key_digest").notNull(),
 namespace:text("storage_namespace"),storageKind:text("storage_kind"),storageLocation:jsonb("storage_location").$type<Record<string,string>>().notNull().default({}),
 providerUploadId:text("provider_upload_id"),contentType:text("content_type").notNull(),expectedBytes:bigint("expected_bytes",{mode:"number"}).notNull(),
 actor:text("actor").notNull(),contactId:uuid("contact_id").references(()=>contacts.id,{onDelete:"restrict"}),
 state:text("state",{enum:MULTIPART_STATES}).notNull(),
 objectReceiptId:uuid("object_receipt_id").references(()=>mediaObjectWrites.id,{onDelete:"restrict"}),
 completedAt:timestamp("completed_at",{withTimezone:true}),abortAcknowledgedAt:timestamp("abort_acknowledged_at",{withTimezone:true}),
 // Closed multipart state does not itself mean the completed object is gone.
 retiredAt:timestamp("retired_at",{withTimezone:true}),redactedAt:timestamp("redacted_at",{withTimezone:true}),
 reviewedAt:timestamp("reviewed_at",{withTimezone:true}),reviewedBy:text("reviewed_by"),evidenceDigest:text("evidence_digest"),
 createdAt:createdAtColumn(),updatedAt:updatedAtColumn(),
},t=>[
 uniqueIndex("media_multipart_upload_idx").on(t.uploadId),uniqueIndex("media_multipart_key_idx").on(t.keyDigest),
 index("media_multipart_contact_idx").on(t.contactId,t.state),index("media_multipart_state_idx").on(t.state,t.createdAt),
 check("media_multipart_state",sql`${t.state} in ('unverified','creating','open','completing','completed','aborting','aborted','unknown')`),
 check("media_multipart_namespace",sql`${t.namespace} is null or ${t.namespace} ~ '^[a-f0-9]{64}$'`),
 check("media_multipart_size",sql`${t.expectedBytes} > 0`),
]);
export const mediaMultipartOperations=pgTable("media_multipart_operations",{
 id:uuid("id").primaryKey().defaultRandom(),resourceId:uuid("resource_id").notNull().references(()=>mediaMultipartResources.id,{onDelete:"restrict"}),
 kind:text("operation_kind",{enum:["create","complete","abort"]}).notNull(),state:text("state",{enum:MULTIPART_OPERATION_STATES}).notNull(),
 // Original admission, not a current account or a reconstructed provider ID.
 providerUploadId:text("provider_upload_id"),parts:jsonb("parts").$type<MultipartPart[]>().notNull().default([]),partsDigest:text("parts_digest"),
 actor:text("actor").notNull(),
 writerRuntimeId:uuid("writer_runtime_id"),writerFinishedAt:timestamp("writer_finished_at",{withTimezone:true}),
 providerAcceptedAt:timestamp("provider_accepted_at",{withTimezone:true}),verifiedAt:timestamp("verified_at",{withTimezone:true}),
 observedProviderUploadId:text("observed_provider_upload_id"),
 reviewedAt:timestamp("reviewed_at",{withTimezone:true}),reviewedBy:text("reviewed_by"),evidenceDigest:text("evidence_digest"),
 createdAt:createdAtColumn(),updatedAt:updatedAtColumn(),
},t=>[
 index("media_multipart_operations_resource_idx").on(t.resourceId,t.createdAt),
 index("media_multipart_operations_open_idx").on(t.state,t.createdAt),
 check("media_multipart_operation_kind",sql`${t.kind} in ('create','complete','abort')`),
 check("media_multipart_operation_state",sql`${t.state} in ('started','accepted','unknown','not_applied')`),
 check("media_multipart_parts_digest",sql`${t.partsDigest} is null or ${t.partsDigest} ~ '^[a-f0-9]{64}$'`),
]);
