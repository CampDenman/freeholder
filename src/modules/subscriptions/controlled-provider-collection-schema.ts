// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Exact target collection extensions; Invoice/Payment/Credit remain canonical.
import { sql } from "drizzle-orm";
import { bigint,check,foreignKey,index,integer,jsonb,pgTable,text,timestamp,uniqueIndex,uuid } from "drizzle-orm/pg-core";
import { createdAtColumn } from "@/core/db/columns";
import { invoices,creditNotes } from "@/modules/invoicing/schema";
import { merchantTaxProfileVersions } from "@/modules/invoicing/merchant-tax-schema";
import { subscriptionCommercialTerms } from "./schema";
import { subscriptionProrations } from "./proration-schema";
import { subscriptionControlledResources,subscriptionControlledOperations,subscriptionControlledCalls,subscriptionControlledFacts } from "./controlled-provider-schema";
import type { ControlledTargetInput,ControlledTargetReview,ControlledComponentProvenance } from "./controlled-provider-collection-contract";
export const subscriptionControlledQuotes=pgTable("subscription_controlled_quotes",{
 id:uuid("id").primaryKey(),kind:text("kind",{enum:["period","proration"]}).notNull(),canonicalSourceId:text("canonical_source_id").notNull(),resourceId:uuid("resource_id").notNull().references(()=>subscriptionControlledResources.id,{onDelete:"restrict"}),
 previousTermsId:uuid("previous_terms_id").notNull().references(()=>subscriptionCommercialTerms.id,{onDelete:"restrict"}),
 plannedProrationId:uuid("planned_proration_id"),plannedCollectionId:uuid("planned_collection_id").notNull(),
 profileId:uuid("profile_id").notNull(),profileVersion:integer("profile_version").notNull(),
 calendarReadOperationId:uuid("calendar_read_operation_id").notNull().references(()=>subscriptionControlledOperations.id,{onDelete:"restrict"}),
 customerFinancialOperationId:uuid("customer_financial_operation_id").notNull().references(()=>subscriptionControlledOperations.id,{onDelete:"restrict"}),
 nativePreviewOperationId:uuid("native_preview_operation_id").notNull().references(()=>subscriptionControlledOperations.id,{onDelete:"restrict"}),
 updatePreviewOperationId:uuid("update_preview_operation_id").notNull().references(()=>subscriptionControlledOperations.id,{onDelete:"restrict"}),
 input:jsonb("input").$type<ControlledTargetInput>(),review:jsonb("review").$type<ControlledTargetReview>(),
 inputDigest:text("input_digest").notNull(),reviewDigest:text("review_digest").notNull(),redactedAt:timestamp("redacted_at",{withTimezone:true}),
 quotedParentRevision:text("quoted_parent_revision").notNull(),sourceRevision:text("source_revision").notNull(),quoteDigest:text("quote_digest").notNull(),effectiveAt:timestamp("effective_at",{withTimezone:true}).notNull(),createdAt:createdAtColumn(),
},t=>[foreignKey({name:"subscription_controlled_quotes_profile_version",columns:[t.profileId,t.profileVersion],foreignColumns:[merchantTaxProfileVersions.profileId,merchantTaxProfileVersions.version]}).onDelete("restrict"),index("subscription_controlled_quotes_resource").on(t.resourceId),uniqueIndex("subscription_controlled_quotes_proration").on(t.plannedProrationId),uniqueIndex("subscription_controlled_quotes_collection").on(t.plannedCollectionId),
 check("subscription_controlled_quotes_original",sql`${t.quotedParentRevision} ~ '^[a-f0-9]{64}$' and ${t.profileVersion}>0 and ${t.sourceRevision} ~ '^[a-f0-9]{64}$' and ${t.quoteDigest} ~ '^[a-f0-9]{64}$' and ${t.inputDigest} ~ '^[a-f0-9]{64}$' and ${t.reviewDigest} ~ '^[a-f0-9]{64}$' and ((${t.redactedAt} is null and jsonb_typeof(${t.input})='object' and jsonb_typeof(${t.review})='object') or (${t.redactedAt} is not null and ${t.input} is null and ${t.review} is null)) and ((${t.kind}='period' and ${t.plannedProrationId} is null) or (${t.kind}='proration' and ${t.plannedProrationId} is not null))`)]);
export const subscriptionControlledCollections=pgTable("subscription_controlled_collections",{
 id:uuid("id").primaryKey(),kind:text("kind",{enum:["period","proration"]}).notNull(),quoteId:uuid("quote_id").notNull().references(()=>subscriptionControlledQuotes.id,{onDelete:"restrict"}),
 prorationId:uuid("proration_id").references(()=>subscriptionProrations.id,{onDelete:"restrict"}),
 invoiceId:uuid("invoice_id").references(()=>invoices.id,{onDelete:"restrict"}),termsId:uuid("terms_id").notNull().references(()=>subscriptionCommercialTerms.id,{onDelete:"restrict"}),
 creditNoteId:uuid("credit_note_id").references(()=>creditNotes.id,{onDelete:"restrict"}),canonicalTargetDigest:text("canonical_target_digest").notNull(),
 acceptedCurrentParentRevision:text("accepted_current_parent_revision").notNull(),acceptanceKind:text("acceptance_kind",{enum:["explicit_change","original_period_mandate"]}).notNull(),originalConsentDigest:text("original_consent_digest").notNull(),acceptedBy:text("accepted_by").notNull(),acceptedQuoteDigest:text("accepted_quote_digest").notNull(),collectionPolicy:text("collection_policy").notNull(),createdAt:createdAtColumn(),
},t=>[uniqueIndex("subscription_controlled_collections_quote").on(t.quoteId),uniqueIndex("subscription_controlled_collections_proration").on(t.prorationId),uniqueIndex("subscription_controlled_collections_invoice").on(t.invoiceId),
 check("subscription_controlled_collections_original",sql`${t.canonicalTargetDigest} ~ '^[a-f0-9]{64}$' and ${t.acceptedCurrentParentRevision} ~ '^[a-f0-9]{64}$' and ${t.acceptedQuoteDigest} ~ '^[a-f0-9]{64}$' and ${t.originalConsentDigest} ~ '^[a-f0-9]{64}$' and ${t.collectionPolicy}='canonical_gross_target_locked_credit_no_wallet' and ((${t.kind}='period' and ${t.prorationId} is null and ${t.invoiceId} is not null) or (${t.kind}='proration' and ${t.prorationId} is not null))`)]);
export const subscriptionControlledComponents=pgTable("subscription_controlled_components",{
 id:uuid("id").primaryKey(),collectionId:uuid("collection_id").notNull().references(()=>subscriptionControlledCollections.id,{onDelete:"restrict"}),position:integer("position").notNull(),
 kind:text("kind",{enum:["net","merchant_declared_tax_collection","locked_canonical_credit"]}).notNull(),amountMinor:bigint("amount_minor",{mode:"number"}).notNull(),currency:text("currency").notNull(),
 periodStart:timestamp("period_start",{withTimezone:true}).notNull(),periodEnd:timestamp("period_end",{withTimezone:true}).notNull(),
 provenance:jsonb("provenance").$type<ControlledComponentProvenance>().notNull(),provenanceDigest:text("provenance_digest").notNull(),createdAt:createdAtColumn(),
},t=>[uniqueIndex("subscription_controlled_components_position").on(t.collectionId,t.position),
 check("subscription_controlled_components_original",sql`${t.position}>=0 and ${t.currency} ~ '^[A-Z]{3}$' and ${t.periodEnd}>${t.periodStart} and ${t.provenanceDigest} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${t.provenance})='object' and ${t.amountMinor} between -9007199254740991 and 9007199254740991 and ((${t.kind} in('net','merchant_declared_tax_collection') and ${t.amountMinor}>=0) or (${t.kind}='locked_canonical_credit' and ${t.amountMinor}<0))`)]);
export const subscriptionControlledInvoiceBindings=pgTable("subscription_controlled_invoice_bindings",{
 collectionId:uuid("collection_id").primaryKey().references(()=>subscriptionControlledCollections.id,{onDelete:"restrict"}),resourceId:uuid("resource_id").notNull().references(()=>subscriptionControlledResources.id,{onDelete:"restrict"}),originKind:text("origin_kind",{enum:["created_draft","update_generated","calendar_generated"]}).notNull(),
 creatorOperationId:uuid("creator_operation_id").notNull().references(()=>subscriptionControlledOperations.id,{onDelete:"restrict"}),providerInvoiceRef:text("provider_invoice_ref").notNull(),
 operationId:uuid("operation_id").notNull().references(()=>subscriptionControlledOperations.id,{onDelete:"restrict"}),callId:uuid("call_id").notNull().references(()=>subscriptionControlledCalls.id,{onDelete:"restrict"}),
 factId:uuid("fact_id").notNull().references(()=>subscriptionControlledFacts.id,{onDelete:"restrict"}),originalEvidenceDigest:text("original_evidence_digest").notNull(),createdAt:createdAtColumn(),
},t=>[uniqueIndex("subscription_controlled_invoice_bindings_invoice").on(t.resourceId,t.providerInvoiceRef),check("subscription_controlled_invoice_bindings_original",sql`${t.providerInvoiceRef} ~ '^in_[A-Za-z0-9_]{1,196}$' and ${t.originalEvidenceDigest} ~ '^[a-f0-9]{64}$'`)]);
export const subscriptionControlledItemReceipts=pgTable("subscription_controlled_item_receipts",{
 componentId:uuid("component_id").primaryKey().references(()=>subscriptionControlledComponents.id,{onDelete:"restrict"}),resourceId:uuid("resource_id").notNull().references(()=>subscriptionControlledResources.id,{onDelete:"restrict"}),originKind:text("origin_kind",{enum:["invoice_item","subscription_line"]}).notNull(),
 creatorOperationId:uuid("creator_operation_id").notNull().references(()=>subscriptionControlledOperations.id,{onDelete:"restrict"}),providerInvoiceItemRef:text("provider_invoice_item_ref"),providerInvoiceLineRef:text("provider_invoice_line_ref"),providerPriceRef:text("provider_price_ref"),
 operationId:uuid("operation_id").notNull().references(()=>subscriptionControlledOperations.id,{onDelete:"restrict"}),callId:uuid("call_id").notNull().references(()=>subscriptionControlledCalls.id,{onDelete:"restrict"}),
 factId:uuid("fact_id").notNull().references(()=>subscriptionControlledFacts.id,{onDelete:"restrict"}),originalEvidenceDigest:text("original_evidence_digest").notNull(),createdAt:createdAtColumn(),
},t=>[uniqueIndex("subscription_controlled_item_receipts_item").on(t.resourceId,t.providerInvoiceItemRef),uniqueIndex("subscription_controlled_item_receipts_line").on(t.resourceId,t.providerInvoiceLineRef),check("subscription_controlled_item_receipts_original",sql`(${t.providerInvoiceItemRef} is null or ${t.providerInvoiceItemRef} ~ '^ii_[A-Za-z0-9_]{1,196}$') and (${t.providerInvoiceLineRef} is null or ${t.providerInvoiceLineRef} ~ '^il_[A-Za-z0-9_]{1,196}$') and (${t.providerInvoiceItemRef} is not null or ${t.providerInvoiceLineRef} is not null) and (${t.providerPriceRef} is null or ${t.providerPriceRef} ~ '^price_[A-Za-z0-9_]{1,195}$') and ${t.originalEvidenceDigest} ~ '^[a-f0-9]{64}$'`)]);
export const subscriptionControlledInvoiceProofs=pgTable("subscription_controlled_invoice_proofs",{
 id:uuid("id").primaryKey(),collectionId:uuid("collection_id").notNull().references(()=>subscriptionControlledInvoiceBindings.collectionId,{onDelete:"restrict"}),
 operationId:uuid("operation_id").notNull().references(()=>subscriptionControlledOperations.id,{onDelete:"restrict"}),callId:uuid("call_id").notNull().references(()=>subscriptionControlledCalls.id,{onDelete:"restrict"}),
 resultDigest:text("result_digest").notNull(),canonicalTargetDigest:text("canonical_target_digest").notNull(),customerFinancialDigest:text("customer_financial_digest").notNull(),createdAt:createdAtColumn(),
},t=>[uniqueIndex("subscription_controlled_invoice_proofs_operation").on(t.operationId),index("subscription_controlled_invoice_proofs_collection").on(t.collectionId),check("subscription_controlled_invoice_proofs_original",sql`${t.resultDigest} ~ '^[a-f0-9]{64}$' and ${t.canonicalTargetDigest} ~ '^[a-f0-9]{64}$' and ${t.customerFinancialDigest} ~ '^[a-f0-9]{64}$'`)]);
