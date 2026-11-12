// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: explicit verified transfer keeps original storage facts intact.
// Unregistered source draft; no migration, runtime or adoption acceptance yet.
import { sql } from "drizzle-orm";
import { bigint,check,index,jsonb,pgTable,text,uniqueIndex,uuid } from "drizzle-orm/pg-core";
import type { StorageBinding } from "@/adapters/storage/types";
import { contacts } from "@/core/contacts/schema";
import { createdAtColumn,updatedAtColumn } from "@/core/db/columns";
import { mediaObjectWrites } from "./write-schema";

export const STORAGE_TRANSFER_STATES=["planned","copying","unknown","verified","adopted","cleanup_pending","complete","blocked","cancelled"] as const;
export const mediaStorageTransferPlans=pgTable("media_storage_transfer_plans",{
 id:uuid("id").primaryKey().defaultRandom(),
 requestKey:uuid("request_key").notNull(),
 originalSource:jsonb("original_source").$type<StorageBinding>().notNull(),
 originalTarget:jsonb("original_target").$type<StorageBinding>().notNull(),
 sourceNamespace:text("source_namespace").notNull(),targetNamespace:text("target_namespace").notNull(),
 manifestDigest:text("manifest_digest").notNull(),
 sourceStopEvidenceDigest:text("source_stop_evidence_digest").notNull(),
 state:text("state",{enum:STORAGE_TRANSFER_STATES}).notNull().default("planned"),
 createdBy:text("created_by").notNull(),
 createdAt:createdAtColumn(),updatedAt:updatedAtColumn(),
},t=>[
 uniqueIndex("media_storage_transfer_plans_request_idx").on(t.requestKey),
 index("media_storage_transfer_plans_source_idx").on(t.sourceNamespace,t.state),
 check("media_storage_transfer_plans_namespaces",sql`${t.sourceNamespace} ~ '^[a-f0-9]{64}$' and ${t.targetNamespace} ~ '^[a-f0-9]{64}$' and ${t.sourceNamespace} <> ${t.targetNamespace}`),
 check("media_storage_transfer_plans_digests",sql`${t.manifestDigest} ~ '^[a-f0-9]{64}$' and ${t.sourceStopEvidenceDigest} ~ '^[a-f0-9]{64}$'`),
 check("media_storage_transfer_plans_state",sql`${t.state} in ('planned','copying','unknown','verified','adopted','cleanup_pending','complete','blocked','cancelled')`),
 check("media_storage_transfer_plans_bindings",sql`(jsonb_typeof(${t.originalSource})='object' and ${t.originalSource}->>'namespace'=${t.sourceNamespace} and ${t.originalSource}->>'kind' in ('s3','replit') and jsonb_typeof(${t.originalTarget})='object' and ${t.originalTarget}->>'namespace'=${t.targetNamespace} and ${t.originalTarget}->>'kind' in ('s3','replit')) is true`),
]);

export const mediaStorageTransferObjects=pgTable("media_storage_transfer_objects",{
 id:uuid("id").primaryKey().defaultRandom(),
 planId:uuid("plan_id").notNull().references(()=>mediaStorageTransferPlans.id,{onDelete:"restrict"}),
 key:text("object_key").notNull(),keyDigest:text("key_digest").notNull(),
 targetKey:text("target_object_key").notNull(),targetKeyDigest:text("target_key_digest").notNull(),
 sha256:text("sha256").notNull(),bytes:bigint("bytes",{mode:"number"}).notNull(),contentType:text("content_type").notNull(),
 originalReceiptSetDigest:text("original_receipt_set_digest").notNull(),
 state:text("state",{enum:STORAGE_TRANSFER_STATES}).notNull().default("planned"),
 targetReceiptId:uuid("target_receipt_id").references(()=>mediaObjectWrites.id,{onDelete:"restrict"}),
 sourceDeleteReceiptId:uuid("source_delete_receipt_id").references(()=>mediaObjectWrites.id,{onDelete:"restrict"}),
 createdAt:createdAtColumn(),updatedAt:updatedAtColumn(),
},t=>[
 uniqueIndex("media_storage_transfer_objects_key_idx").on(t.planId,t.keyDigest),
 uniqueIndex("media_storage_transfer_objects_target_idx").on(t.planId,t.targetKeyDigest),
 index("media_storage_transfer_objects_state_idx").on(t.planId,t.state),
 index("media_storage_transfer_objects_target_receipt_idx").on(t.targetReceiptId),
 index("media_storage_transfer_objects_source_delete_idx").on(t.sourceDeleteReceiptId),
 check("media_storage_transfer_objects_digests",sql`${t.keyDigest} ~ '^[a-f0-9]{64}$' and ${t.targetKeyDigest} ~ '^[a-f0-9]{64}$' and ${t.targetKeyDigest} <> ${t.keyDigest} and ${t.sha256} ~ '^[a-f0-9]{64}$' and ${t.originalReceiptSetDigest} ~ '^[a-f0-9]{64}$'`),
 check("media_storage_transfer_objects_size",sql`${t.bytes} >= 0 and ${t.bytes} <= 9007199254740991`),
 check("media_storage_transfer_objects_key",sql`length(${t.key}) between 1 and 2048 and length(${t.targetKey}) between 1 and 2048 and ${t.targetKey} <> ${t.key} and length(${t.contentType}) between 1 and 255`),
 check("media_storage_transfer_objects_state",sql`${t.state} in ('planned','copying','unknown','verified','adopted','cleanup_pending','complete','blocked','cancelled')`),
 check("media_storage_transfer_objects_adoption_receipt",sql`${t.state} not in ('adopted','cleanup_pending','complete') or ${t.targetReceiptId} is not null`),
 check("media_storage_transfer_objects_cleanup_receipt",sql`${t.state} <> 'complete' or ${t.sourceDeleteReceiptId} is not null`),
]);

/** Original receipt membership is retained instead of overwriting namespaces. */
export const mediaStorageTransferReceipts=pgTable("media_storage_transfer_receipts",{
 id:uuid("id").primaryKey().defaultRandom(),
 objectId:uuid("object_id").notNull().references(()=>mediaStorageTransferObjects.id,{onDelete:"restrict"}),
 receiptId:uuid("receipt_id").notNull().references(()=>mediaObjectWrites.id,{onDelete:"restrict"}),
 originalWitnessDigest:text("original_witness_digest").notNull(),
 createdAt:createdAtColumn(),
},t=>[
 uniqueIndex("media_storage_transfer_receipts_original_idx").on(t.objectId,t.receiptId),
 index("media_storage_transfer_receipts_receipt_idx").on(t.receiptId),
 check("media_storage_transfer_receipts_witness",sql`${t.originalWitnessDigest} ~ '^[a-f0-9]{64}$'`),
]);

/** Repoint through the shared contact merge before this source is registered. */
export const mediaStorageTransferSubjects=pgTable("media_storage_transfer_subjects",{
 id:uuid("id").primaryKey().defaultRandom(),
 objectId:uuid("object_id").notNull().references(()=>mediaStorageTransferObjects.id,{onDelete:"restrict"}),
 contactId:uuid("contact_id").notNull().references(()=>contacts.id,{onDelete:"restrict"}),
 createdAt:createdAtColumn(),
},t=>[
 index("media_storage_transfer_subjects_contact_idx").on(t.objectId,t.contactId),
 index("media_storage_transfer_subjects_owner_idx").on(t.contactId),
]);
