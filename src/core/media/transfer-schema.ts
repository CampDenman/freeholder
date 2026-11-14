// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type {OriginalProviderRequestProof} from "../../../scripts/media-transfer.mjs";
import type {OriginalMultipartRetirementProof} from "./multipart-retirement-certificate-proof";
import type {StorageCallerRuntimeIdentity} from "./physical-caller-runtime";
// C1.12/C11.08: explicit verified transfer keeps original storage facts intact.
// Runtime use requires the separately assembled verified-transfer capability.
import { sql } from "drizzle-orm";
import { bigint,boolean,check,index,jsonb,pgTable,primaryKey,text,timestamp,uniqueIndex,uuid } from "drizzle-orm/pg-core";
import type { StorageBinding } from "@/adapters/storage/types";
import { contacts } from "@/core/contacts/schema";
import { createdAtColumn,updatedAtColumn } from "@/core/db/columns";
import {dataRequests} from "@/core/privacy/schema";
import { mediaObjectWrites } from "./write-schema";
import {mediaMultipartOperations} from "./multipart-schema";

export const STORAGE_TRANSFER_STATES=["planned","copying","unknown","verified","adopted","cleanup_pending","complete","blocked","cancelled"] as const;
export const mediaStorageTransferPlans=pgTable("media_storage_transfer_plans",{
 id:uuid("id").primaryKey().defaultRandom(),
 requestKey:uuid("request_key").notNull(),
 originalSource:jsonb("original_source").$type<StorageBinding>().notNull(),
 originalTarget:jsonb("original_target").$type<StorageBinding>().notNull(),
 sourceNamespace:text("source_namespace").notNull(),targetNamespace:text("target_namespace").notNull(),
 manifestDigest:text("manifest_digest").notNull(),
 sourceStopEvidenceDigest:text("source_stop_evidence_digest").notNull(),
 sourceDrainId:uuid("source_drain_id"),
 inventoryCount:bigint("inventory_count",{mode:"number"}).notNull(),
 inventoryBytes:bigint("inventory_bytes",{mode:"number"}).notNull(),
 adoptedAt:timestamp("adopted_at",{withTimezone:true}),
 redactedAt:timestamp("redacted_at",{withTimezone:true}),
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
 sourceRevision:jsonb("source_revision").$type<StorageTransferRevision>(),
 targetRevision:jsonb("target_revision").$type<StorageTransferRevision>(),
 redactedAt:timestamp("redacted_at",{withTimezone:true}),
 sourceReadCallerId:uuid("source_read_caller_id"),
 targetVerifyCallerId:uuid("target_verify_caller_id"),
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
 originalSnapshot:jsonb("original_snapshot").$type<Record<string,unknown>>().notNull(),
 originalSnapshotDigest:text("original_snapshot_digest").notNull(),
 createdAt:createdAtColumn(),
},t=>[
 uniqueIndex("media_storage_transfer_receipts_original_idx").on(t.objectId,t.receiptId),
 index("media_storage_transfer_receipts_receipt_idx").on(t.receiptId),
 check("media_storage_transfer_receipts_witness",sql`${t.originalWitnessDigest} ~ '^[a-f0-9]{64}$' and ${t.originalSnapshotDigest} ~ '^[a-f0-9]{64}$'`),
]);

/** Current ownership pointer; original membership stays in immutable receipts. */
export const mediaStorageTransferSubjects=pgTable("media_storage_transfer_subjects",{
 id:uuid("id").primaryKey().defaultRandom(),
 objectId:uuid("object_id").notNull().references(()=>mediaStorageTransferObjects.id,{onDelete:"restrict"}),
 contactId:uuid("contact_id").references(()=>contacts.id,{onDelete:"restrict"}),
 redactedAt:timestamp("redacted_at",{withTimezone:true}),
 createdAt:createdAtColumn(),
},t=>[
 index("media_storage_transfer_subjects_contact_idx").on(t.objectId,t.contactId),
 index("media_storage_transfer_subjects_owner_idx").on(t.contactId),
]);

export interface StorageTransferRevision {kind:"etag"|"generation";key:string;namespace:string;value:string;versionId?:string}
export const STORAGE_TRANSFER_CALL_KINDS=["source_read","target_probe","target_put","target_verify","target_current","source_delete","source_absence","privacy_read","privacy_delete","privacy_absence","privacy_source_read","privacy_source_delete","privacy_source_absence","recovery_read","source_inventory","target_inventory","source_retirement_inventory","target_erasure_inventory","source_erasure_inventory"] as const;
export const STORAGE_MEDIA_CALL_KINDS=[...STORAGE_TRANSFER_CALL_KINDS,"ordinary_put","ordinary_delete","multipart_create","multipart_complete","multipart_abort","multipart_sign","ordinary_recovery_read","multipart_recovery_inspect","ordinary_retirement_inventory","multipart_retirement_inventory"]as const;
/** One committed row per actual provider invocation. A return is not domain apply. */
export const mediaStorageTransferCalls=pgTable("media_storage_transfer_calls",{
 id:uuid("id").primaryKey().defaultRandom(),
 objectId:uuid("object_id").references(()=>mediaStorageTransferObjects.id,{onDelete:"restrict"}),
 objectReceiptId:uuid("object_receipt_id").references(()=>mediaObjectWrites.id,{onDelete:"restrict"}),
 multipartOperationId:uuid("multipart_operation_id").references(()=>mediaMultipartOperations.id,{onDelete:"restrict"}),
 kind:text("kind",{enum:STORAGE_MEDIA_CALL_KINDS}).notNull(),
 namespace:text("namespace").notNull(),physicalKey:text("physical_key").notNull(),
 quotaToken:uuid("quota_token"),
 requestDigest:text("request_digest").notNull(),callerTokenDigest:text("caller_token_digest").notNull(),
 physicalReceiptId:uuid("physical_receipt_id").references(()=>mediaObjectWrites.id,{onDelete:"restrict"}),
 runtimeId:uuid("runtime_id").notNull(),
 runtimeIdentity:jsonb("runtime_identity").$type<StorageCallerRuntimeIdentity>().notNull(),
 expectedRevision:jsonb("expected_revision").$type<StorageTransferRevision>(),
 state:text("state",{enum:["admitted","returned","unknown","stopped"]}).notNull().default("admitted"),
 observedAcceptedAt:timestamp("observed_accepted_at",{withTimezone:true}),
 returnedAt:timestamp("returned_at",{withTimezone:true}),
 stoppedAt:timestamp("stopped_at",{withTimezone:true}),
 resultRequestProof:jsonb("result_request_proof").$type<OriginalProviderRequestProof>(),
 resultDigest:text("result_digest"),resultRevision:jsonb("result_revision").$type<StorageTransferRevision>(),
 resultSha256:text("result_sha256"),resultBytes:bigint("result_bytes",{mode:"number"}),
 resultAbsent:timestamp("result_absent",{withTimezone:true}),
 stopReceiptId:uuid("stop_receipt_id"),redactedAt:timestamp("redacted_at",{withTimezone:true}),
 createdAt:createdAtColumn(),updatedAt:updatedAtColumn(),
},t=>[
 index("media_storage_transfer_calls_object_idx").on(t.objectId,t.createdAt,t.id),
 uniqueIndex("media_storage_calls_original_write_idx").on(t.objectReceiptId).where(sql`${t.kind} in ('ordinary_put','ordinary_delete')`),
 uniqueIndex("media_storage_calls_original_multipart_idx").on(t.multipartOperationId).where(sql`${t.kind} in ('multipart_create','multipart_complete','multipart_abort','multipart_sign')`),
 index("media_storage_calls_receipt_idx").on(t.objectReceiptId,t.createdAt,t.id),
 index("media_storage_calls_multipart_idx").on(t.multipartOperationId,t.createdAt,t.id),
 check("media_storage_calls_original_parent",sql`num_nonnulls(${t.objectId},${t.objectReceiptId},${t.multipartOperationId})=1`),
 uniqueIndex("media_storage_original_quota_token_idx").on(t.namespace,t.quotaToken).where(sql`${t.quotaToken} is not null`),
 index("media_storage_transfer_calls_runtime_idx").on(t.runtimeId,t.state),
 check("media_storage_transfer_calls_kind",sql`${t.kind} in ('source_read','target_probe','target_put','target_verify','target_current','source_delete','source_absence','privacy_read','privacy_delete','privacy_absence','privacy_source_read','privacy_source_delete','privacy_source_absence','recovery_read','source_inventory','target_inventory','source_retirement_inventory','target_erasure_inventory','source_erasure_inventory','ordinary_put','ordinary_delete','multipart_create','multipart_complete','multipart_abort','multipart_sign','ordinary_recovery_read','multipart_recovery_inspect','ordinary_retirement_inventory','multipart_retirement_inventory')`),
 check("media_storage_transfer_calls_state",sql`${t.state} in ('admitted','returned','unknown','stopped')`),
 check("media_storage_transfer_calls_digests",sql`${t.namespace} ~ '^[a-f0-9]{64}$' and ${t.requestDigest} ~ '^[a-f0-9]{64}$' and ${t.callerTokenDigest} ~ '^[a-f0-9]{64}$'`),
 check("media_storage_transfer_calls_return",sql`(${t.state}<>'returned' or (${t.returnedAt} is not null and ${t.resultDigest} ~ '^[a-f0-9]{64}$')) and (${t.state}<>'stopped' or (${t.stoppedAt} is not null and ${t.stopReceiptId} is not null))`),
]);

/** Operator executor records actual process identities before requesting stop. */
export const mediaStorageWriterDrains=pgTable("media_storage_writer_drains",{
 id:uuid("id").primaryKey().defaultRandom(),namespace:text("namespace").notNull(),
 state:text("state",{enum:["capturing","captured","verified","released"]}).notNull(),
 sourceRevision:text("source_revision").notNull(),
 executorIdentity:text("executor_identity").notNull(),
 originalProcesses:jsonb("original_processes").notNull().default({}),
 stopProofDigest:text("stop_proof_digest"),
 verifiedAt:timestamp("verified_at",{withTimezone:true}),releasedAt:timestamp("released_at",{withTimezone:true}),
 createdAt:createdAtColumn(),updatedAt:updatedAtColumn(),
},t=>[
 index("media_storage_writer_drains_namespace_idx").on(t.namespace,t.state),
 check("media_storage_writer_drains_namespace",sql`${t.namespace} ~ '^[a-f0-9]{64}$'`),
 check("media_storage_writer_drains_state",sql`${t.state} in ('capturing','captured','verified','released')`),
 check("media_storage_writer_drains_proof",sql`${t.state}<>'verified' or (${t.verifiedAt} is not null and ${t.stopProofDigest} ~ '^[a-f0-9]{64}$')`),
]);

/** Fresh human review appends; it never rewrites an original return or ACK. */
export const mediaStorageTransferReviews=pgTable("media_storage_transfer_reviews",{
 id:uuid("id").primaryKey().defaultRandom(),
 objectId:uuid("object_id").references(()=>mediaStorageTransferObjects.id,{onDelete:"restrict"}),
 objectReceiptId:uuid("object_receipt_id").references(()=>mediaObjectWrites.id,{onDelete:"restrict"}),
 multipartOperationId:uuid("multipart_operation_id").references(()=>mediaMultipartOperations.id,{onDelete:"restrict"}),
 inventoryId:uuid("inventory_id"),
 callId:uuid("call_id").notNull().references(()=>mediaStorageTransferCalls.id,{onDelete:"restrict"}),
 originalCallWitness:text("original_call_witness").notNull(),
 readCallId:uuid("read_call_id").notNull().references(()=>mediaStorageTransferCalls.id,{onDelete:"restrict"}),
 outcome:text("outcome",{enum:["applied","not_applied","retired"]}).notNull(),
 providerEvidenceDigest:text("provider_evidence_digest").notNull(),
 // New immutable system seals only. Historical NULL remains NULL forever.
 retirementProof:jsonb("retirement_proof").$type<OriginalMultipartRetirementProof>(),
 stopDrainId:uuid("stop_drain_id").references(()=>mediaStorageWriterDrains.id,{onDelete:"restrict"}),
 permitsRetry:boolean("permits_retry").notNull().default(false),
 reviewedBy:text("reviewed_by").notNull(),createdAt:createdAtColumn(),
},t=>[
 check("media_storage_transfer_review_parent",sql`num_nonnulls(${t.objectId},${t.objectReceiptId},${t.multipartOperationId})=1`),
 index("media_storage_transfer_reviews_call_idx").on(t.callId,t.createdAt),
 check("media_storage_transfer_reviews_outcome",sql`${t.outcome} in ('applied','not_applied','retired')`),
 check("media_storage_transfer_reviews_digests",sql`${t.originalCallWitness} ~ '^[a-f0-9]{64}$' and ${t.providerEvidenceDigest} ~ '^[a-f0-9]{64}$'`),
 check("media_storage_transfer_review_retirement_proof",sql`${t.retirementProof} is null or (${t.multipartOperationId} is not null and ${t.objectId} is null and ${t.objectReceiptId} is null and ${t.outcome}='retired' and not ${t.permitsRetry} and ${t.reviewedBy}='system:media-retirement' and jsonb_typeof(${t.retirementProof})='object' and ${t.retirementProof}->>'format'='freeholder.original-multipart-retirement/v1' and ${t.providerEvidenceDigest}=freeholder_media_transfer_fact_digest(${t.retirementProof})) is true`),
 check("media_storage_transfer_reviews_retry",sql`not ${t.permitsRetry} or ${t.outcome}='not_applied'`),
]);

/** Empty and nonempty original request captures are equally immutable. */
export const mediaStorageTransferErasureScopes=pgTable("media_storage_transfer_erasure_scopes",{
 requestId:uuid("request_id").primaryKey().references(()=>dataRequests.id,{onDelete:"restrict"}),
 objectCount:bigint("object_count",{mode:"number"}).notNull(),captureDigest:text("capture_digest").notNull(),
 complete:boolean("complete").notNull().default(false),createdAt:createdAtColumn(),
},t=>[check("media_storage_transfer_erasure_scopes_count",sql`${t.objectCount} >= 0 and ${t.objectCount} <= 10000`),check("media_storage_transfer_erasure_scopes_digest",sql`${t.captureDigest} ~ '^[a-f0-9]{64}$'`)]);
export const mediaStorageTransferErasureMembers=pgTable("media_storage_transfer_erasure_members",{
 requestId:uuid("request_id").notNull().references(()=>mediaStorageTransferErasureScopes.requestId,{onDelete:"restrict"}),
 objectId:uuid("object_id").notNull().references(()=>mediaStorageTransferObjects.id,{onDelete:"restrict"}),
 originalPlanDigest:text("original_plan_digest").notNull(),createdAt:createdAtColumn(),
},t=>[primaryKey({columns:[t.requestId,t.objectId]}),index("media_storage_transfer_erasure_members_object_idx").on(t.objectId),check("media_storage_transfer_erasure_members_digest",sql`${t.originalPlanDigest} ~ '^[a-f0-9]{64}$'`)]);

/** Actual shared-service admission; a generic queued payload is not authority. */
export const mediaStorageTransferJobs=pgTable("media_storage_transfer_jobs",{
 jobId:uuid("job_id").primaryKey(),requestKey:uuid("request_key").notNull(),
 planId:uuid("plan_id").notNull().references(()=>mediaStorageTransferPlans.id,{onDelete:"restrict"}),
 objectId:uuid("object_id").references(()=>mediaStorageTransferObjects.id,{onDelete:"restrict"}),
 action:text("action",{enum:["copy","adopt","retire"]}).notNull(),manifestDigest:text("manifest_digest").notNull(),
 payloadDigest:text("payload_digest").notNull(),createdBy:text("created_by").notNull(),createdAt:createdAtColumn(),
},t=>[uniqueIndex("media_storage_transfer_jobs_request_idx").on(t.requestKey),index("media_storage_transfer_jobs_plan_idx").on(t.planId),check("media_storage_transfer_jobs_action",sql`${t.action} in ('copy','adopt','retire')`),check("media_storage_transfer_jobs_digests",sql`${t.manifestDigest} ~ '^[a-f0-9]{64}$' and ${t.payloadDigest} ~ '^[a-f0-9]{64}$'`)]);
