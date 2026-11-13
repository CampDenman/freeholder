// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: original controlled transport has its own real admission lineage.
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn } from "@/core/db/columns";
import { subscriptionCommercialTerms, subscriptionMerchantScopes, subscriptionProviderChargeReceipts } from "./schema";
import type { MerchantControlledSubscriptionScope, MerchantControlledObservation } from "@/adapters/payments";
import type { ProviderReadSignedProof } from "./provider-read-signatures";
export const subscriptionControlledResources=pgTable("subscription_controlled_resources",{
 id:uuid("id").primaryKey(),subscriptionId:uuid("subscription_id").notNull().references(()=>subscriptionMerchantScopes.subscriptionId,{onDelete:"restrict"}),
 termsId:uuid("terms_id").notNull().references(()=>subscriptionCommercialTerms.id,{onDelete:"restrict"}),generation:integer("generation").notNull(),
 originalScope:jsonb("original_scope").$type<MerchantControlledSubscriptionScope>().notNull(),originalSourceRevision:text("original_source_revision").notNull(),createdAt:createdAtColumn(),
},t=>[uniqueIndex("subscription_controlled_resources_generation").on(t.subscriptionId,t.generation),index("subscription_controlled_resources_terms").on(t.termsId),
 check("subscription_controlled_resources_original",sql`${t.generation}>0 and ${t.originalSourceRevision} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${t.originalScope})='object'`)]);
export const CONTROLLED_PROVIDER_KINDS=["create_product","read_product","discover_bootstrap","bootstrap","pause_drafts","read_bootstrap","create_schedule","read_calendar","preview_proration","update_calendar","read_invoice","list_invoices","set_invoice_fee","finalize_invoice","pay_invoice","cancel_calendar","void_invoice","delete_draft"] as const;
export const subscriptionControlledOperations=pgTable("subscription_controlled_operations",{
 id:uuid("id").primaryKey(),resourceId:uuid("resource_id").notNull().references(()=>subscriptionControlledResources.id,{onDelete:"restrict"}),
 kind:text("kind",{enum:CONTROLLED_PROVIDER_KINDS}).notNull(),ordinal:integer("ordinal").notNull(),originalRequest:jsonb("original_request").$type<Record<string,unknown>>().notNull(),
 requestDigest:text("request_digest").notNull(),idempotencyKey:text("idempotency_key").notNull(),previousEvidenceRevision:text("previous_evidence_revision").notNull(),
 acceptedQuoteDigest:text("accepted_quote_digest").notNull(),createdAt:createdAtColumn(),
},t=>[uniqueIndex("subscription_controlled_operations_ordinal").on(t.resourceId,t.ordinal),uniqueIndex("subscription_controlled_operations_key").on(t.idempotencyKey),
 check("subscription_controlled_operations_original",sql`${t.ordinal}>0 and ${t.requestDigest} ~ '^[a-f0-9]{64}$' and ${t.previousEvidenceRevision} ~ '^[a-f0-9]{64}$' and ${t.acceptedQuoteDigest} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${t.originalRequest})='object'`),
 check("subscription_controlled_operations_kind",sql`${t.kind} in('create_product','read_product','discover_bootstrap','bootstrap','pause_drafts','read_bootstrap','create_schedule','read_calendar','preview_proration','update_calendar','read_invoice','list_invoices','set_invoice_fee','finalize_invoice','pay_invoice','cancel_calendar','void_invoice','delete_draft')`)]);
export const subscriptionControlledCalls=pgTable("subscription_controlled_calls",{
 id:uuid("id").primaryKey(),operationId:uuid("operation_id").notNull().references(()=>subscriptionControlledOperations.id,{onDelete:"restrict"}),
 admission:jsonb("admission").$type<ProviderReadSignedProof>().notNull(),admissionDigest:text("admission_digest").notNull(),createdAt:createdAtColumn(),
},t=>[uniqueIndex("subscription_controlled_calls_operation").on(t.operationId),check("subscription_controlled_calls_original",sql`${t.admissionDigest} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${t.admission})='object'`)]);
export const subscriptionControlledFacts=pgTable("subscription_controlled_facts",{
 id:uuid("id").primaryKey(),callId:uuid("call_id").notNull().references(()=>subscriptionControlledCalls.id,{onDelete:"restrict"}),
 ordinal:integer("ordinal").notNull(),actual:jsonb("actual").$type<MerchantControlledObservation>().notNull(),actualDigest:text("actual_digest").notNull(),createdAt:createdAtColumn(),
},t=>[uniqueIndex("subscription_controlled_facts_ordinal").on(t.callId,t.ordinal),check("subscription_controlled_facts_original",sql`${t.ordinal}>0 and ${t.actualDigest} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${t.actual})='object'`)]);
export const subscriptionControlledFinishes=pgTable("subscription_controlled_finishes",{
 callId:uuid("call_id").primaryKey().references(()=>subscriptionControlledCalls.id,{onDelete:"restrict"}),proof:jsonb("proof").$type<ProviderReadSignedProof>().notNull(),
 proofDigest:text("proof_digest").notNull(),actualResult:jsonb("actual_result").$type<Record<string,unknown>>().notNull(),createdAt:createdAtColumn(),
},t=>[check("subscription_controlled_finishes_original",sql`${t.proofDigest} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${t.proof})='object' and jsonb_typeof(${t.actualResult})='object'`)]);
export const subscriptionControlledStops=pgTable("subscription_controlled_stops",{
 callId:uuid("call_id").primaryKey().references(()=>subscriptionControlledCalls.id,{onDelete:"restrict"}),proof:jsonb("proof").$type<ProviderReadSignedProof>().notNull(),
 proofDigest:text("proof_digest").notNull(),createdAt:createdAtColumn(),
},t=>[check("subscription_controlled_stops_original",sql`${t.proofDigest} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${t.proof})='object'`)]);
/** A result projection cannot erase an old actual caller or replace bank facts. */
export const subscriptionControlledVerifications=pgTable("subscription_controlled_verifications",{
 operationId:uuid("operation_id").primaryKey().references(()=>subscriptionControlledOperations.id,{onDelete:"restrict"}),
 callId:uuid("call_id").notNull().references(()=>subscriptionControlledCalls.id,{onDelete:"restrict"}),
 actualResult:jsonb("actual_result").$type<Record<string,unknown>>().notNull(),actualResultDigest:text("actual_result_digest").notNull(),evidenceRevision:text("evidence_revision").notNull(),createdAt:createdAtColumn(),
},t=>[uniqueIndex("subscription_controlled_verifications_call").on(t.callId),check("subscription_controlled_verifications_original",sql`${t.actualResultDigest} ~ '^[a-f0-9]{64}$' and ${t.evidenceRevision} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${t.actualResult})='object'`)]);

/** Additive ancestry to the one canonical immutable cash receipt. This does
 * not invent a legacy operation FK or create another transferable cash source. */
export const subscriptionControlledChargeOrigins=pgTable("subscription_controlled_charge_origins",{
 receiptId:uuid("receipt_id").primaryKey().references(()=>subscriptionProviderChargeReceipts.id,{onDelete:"restrict"}),
 resourceId:uuid("resource_id").notNull().references(()=>subscriptionControlledResources.id,{onDelete:"restrict"}),
 operationId:uuid("operation_id").notNull().references(()=>subscriptionControlledOperations.id,{onDelete:"restrict"}),
 callId:uuid("call_id").notNull().references(()=>subscriptionControlledCalls.id,{onDelete:"restrict"}),
 factId:uuid("fact_id").notNull().references(()=>subscriptionControlledFacts.id,{onDelete:"restrict"}),
 originalEvidenceDigest:text("original_evidence_digest").notNull(),createdAt:createdAtColumn(),
},t=>[index("subscription_controlled_charge_origins_resource").on(t.resourceId),index("subscription_controlled_charge_origins_operation").on(t.operationId),index("subscription_controlled_charge_origins_fact").on(t.factId),
 check("subscription_controlled_charge_origins_original",sql`${t.originalEvidenceDigest} ~ '^[a-f0-9]{64}$'`)]);

/** Actual zero-only transport closure is distinct from caller stop and paid
 * economics. Its original complete canceled-calendar/invoice proof cannot be
 * repurposed for a positive collection or another provider resource. */
export const subscriptionControlledClosures=pgTable("subscription_controlled_closures",{
 resourceId:uuid("resource_id").primaryKey().references(()=>subscriptionControlledResources.id,{onDelete:"restrict"}),
 kind:text("kind",{enum:["zero_transport"]}).notNull(),originalEvidenceRevision:text("original_evidence_revision").notNull(),
 proof:jsonb("proof").$type<Record<string,unknown>>().notNull(),proofDigest:text("proof_digest").notNull(),createdAt:createdAtColumn(),
},t=>[check("subscription_controlled_closures_original",sql`${t.kind}='zero_transport' and ${t.originalEvidenceRevision} ~ '^[a-f0-9]{64}$' and ${t.proofDigest} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${t.proof})='object'`)]);
