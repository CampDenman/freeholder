// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: genuine same-transaction application proof, never bank authority.
import { sql } from "drizzle-orm";
import { bigint,check,index,integer,jsonb,pgTable,text,timestamp,unique,uuid } from "drizzle-orm/pg-core";
import { createdAtColumn } from "@/core/db/columns";
import { subscriptions,subscriptionCommercialTerms,subscriptionProviderChargeReceipts,subscriptionProviderChargeObservations } from "@/modules/subscriptions/schema";
import { subscriptionControlledResources,subscriptionControlledOperations,subscriptionControlledCalls,subscriptionControlledFacts } from "@/modules/subscriptions/controlled-provider-schema";
import { subscriptionControlledCollections,subscriptionControlledQuotes } from "@/modules/subscriptions/controlled-provider-collection-schema";
import { invoices,payments } from "./schema";
import { merchantCashReturnInspections,merchantCashReturnObservations } from "./merchant-refund-schema";

export type ControlledApplicationPhysicalEntry={table:string;id:string;fingerprint:string;hashDomain:"postgres_row"};
export type ControlledApplicationRawBinding={factId:string;operationId:string;callId:string;actualDigest:string;receiptIds:string[]};
export type ControlledApplicationMutableBeforeRow={table:"payment_plans"|"payment_plan_installments";id:string;fingerprint:string;fields:{paid_minor:number;status:string;updated_at:string}};
const minor=(name:string)=>bigint(name,{mode:"number"}).notNull();
/** Only full-row hashes and the invoice columns changed by the real shared
 * settlement spine are retained. Billing address/tax-ID/memo before-images are
 * NOT copied: reconstruction hashes every unchanged live column plus these
 * exact original DB values. SQL admission copies timestamps without a JS Date
 * round trip, preserving actual PostgreSQL sub-millisecond precision. */
export const controlledCashApplicationBatches=pgTable("controlled_cash_application_batches",{
 id:uuid("id").primaryKey().defaultRandom(),
 collectionId:uuid("collection_id").notNull().references(()=>subscriptionControlledCollections.id,{onDelete:"restrict"}),
 quoteId:uuid("quote_id").notNull().references(()=>subscriptionControlledQuotes.id,{onDelete:"restrict"}),
 resourceId:uuid("resource_id").notNull().references(()=>subscriptionControlledResources.id,{onDelete:"restrict"}),
 subscriptionId:uuid("subscription_id").notNull().references(()=>subscriptions.id,{onDelete:"restrict"}),
 invoiceId:uuid("invoice_id").notNull().references(()=>invoices.id,{onDelete:"restrict"}),
 termsId:uuid("terms_id").notNull().references(()=>subscriptionCommercialTerms.id,{onDelete:"restrict"}),
 protocol:text("protocol").notNull(),admissionTransactionId:text("admission_transaction_id").notNull().default(sql`txid_current()::text`),
 bankRevision:text("bank_revision").notNull(),parentRevision:text("parent_revision").notNull(),parentPgRevision:text("parent_pg_revision").notNull(),preApplicationRevision:text("pre_application_revision").notNull(),
 acceptedQuoteDigest:text("accepted_quote_digest").notNull(),canonicalTargetDigest:text("canonical_target_digest").notNull(),
 beforeEntries:jsonb("before_entries").$type<ControlledApplicationPhysicalEntry[]>().notNull(),
 mutableBeforeRows:jsonb("mutable_before_rows").$type<ControlledApplicationMutableBeforeRow[]>().notNull(),
 requestedReceiptIds:jsonb("requested_receipt_ids").$type<string[]>().notNull(),rawBindings:jsonb("raw_bindings").$type<ControlledApplicationRawBinding[]>().notNull(),
 invoiceBeforeFingerprint:text("invoice_before_fingerprint").notNull(),invoiceBeforeStatus:text("invoice_before_status").notNull(),
 invoiceBeforePaidMinor:minor("invoice_before_paid_minor"),invoiceBeforeCreditedMinor:minor("invoice_before_credited_minor"),invoiceBeforeRefundedMinor:minor("invoice_before_refunded_minor"),
 invoiceBeforePaidAt:text("invoice_before_paid_at"),invoiceBeforeUpdatedAt:text("invoice_before_updated_at").notNull(),
 expectedCashMinor:minor("expected_cash_minor"),expectedFeeMinor:minor("expected_fee_minor"),currency:text("currency").notNull(),
 digest:text("digest").notNull(),authentication:text("authentication").notNull(),createdAt:createdAtColumn(),
},t=>[
 index("controlled_cash_batches_collection_idx").on(t.collectionId,t.createdAt),index("controlled_cash_batches_invoice_idx").on(t.invoiceId,t.createdAt),index("controlled_cash_batches_subscription_idx").on(t.subscriptionId,t.createdAt),
 check("controlled_cash_batches_protocol",sql`${t.protocol} in ('controlled_net_gross.v1','controlled_cash_atomic.v1') and ${t.admissionTransactionId} ~ '^[0-9]+$'`),
 check("controlled_cash_batches_digests",sql`${t.bankRevision} ~ '^[a-f0-9]{64}$' and ${t.parentRevision} ~ '^[a-f0-9]{64}$' and ${t.parentPgRevision} ~ '^[a-f0-9]{64}$' and ${t.preApplicationRevision} ~ '^[a-f0-9]{64}$' and ${t.acceptedQuoteDigest} ~ '^[a-f0-9]{64}$' and ${t.canonicalTargetDigest} ~ '^[a-f0-9]{64}$' and ${t.invoiceBeforeFingerprint} ~ '^[a-f0-9]{64}$' and ${t.digest} ~ '^[a-f0-9]{64}$' and ${t.authentication} ~ '^[a-f0-9]{64}$'`),
 check("controlled_cash_batches_arrays",sql`jsonb_typeof(${t.beforeEntries})='array' and jsonb_array_length(${t.beforeEntries}) between 1 and 5000 and jsonb_typeof(${t.mutableBeforeRows})='array' and jsonb_array_length(${t.mutableBeforeRows})<=5000 and jsonb_typeof(${t.requestedReceiptIds})='array' and jsonb_array_length(${t.requestedReceiptIds}) between 1 and 5000 and jsonb_typeof(${t.rawBindings})='array' and jsonb_array_length(${t.rawBindings})<=5000`),
 check("controlled_cash_batches_amounts",sql`${t.invoiceBeforePaidMinor} between 0 and 9007199254740991 and ${t.invoiceBeforeCreditedMinor} between 0 and 9007199254740991 and ${t.invoiceBeforeRefundedMinor}=0 and ${t.expectedCashMinor} between 1 and 9007199254740991 and ${t.expectedFeeMinor} between 0 and ${t.expectedCashMinor} and ${t.currency} ~ '^[A-Z]{3}$'`),
 check("controlled_cash_batches_invoice_status",sql`${t.invoiceBeforeStatus} in('sent','viewed','partially_paid','overdue')`),
]);

/** These rows are admitted BEFORE the first canonical mutation. Every source
 * is an actual FK; no planned local payment UUID exists in this receipt proof. */
export const controlledCashApplicationReceipts=pgTable("controlled_cash_application_receipts",{
 id:uuid("id").primaryKey().defaultRandom(),batchId:uuid("batch_id").notNull().references(()=>controlledCashApplicationBatches.id,{onDelete:"restrict"}),
 receiptId:uuid("receipt_id").notNull().references(()=>subscriptionProviderChargeReceipts.id,{onDelete:"restrict"}),ordinal:integer("ordinal").notNull(),
 originalObservationId:uuid("original_observation_id").notNull().references(()=>subscriptionProviderChargeObservations.id,{onDelete:"restrict"}),
 originOperationId:uuid("origin_operation_id").notNull().references(()=>subscriptionControlledOperations.id,{onDelete:"restrict"}),
 originCallId:uuid("origin_call_id").notNull().references(()=>subscriptionControlledCalls.id,{onDelete:"restrict"}),originFactId:uuid("origin_fact_id").notNull().references(()=>subscriptionControlledFacts.id,{onDelete:"restrict"}),
 bankInspectionId:uuid("bank_inspection_id").notNull().references(()=>merchantCashReturnInspections.id,{onDelete:"restrict"}),bankObservationId:uuid("bank_observation_id").notNull().references(()=>merchantCashReturnObservations.id,{onDelete:"restrict"}),bankFinishCallerId:uuid("bank_finish_caller_id").notNull(),
 immutableBankRevision:text("immutable_bank_revision").notNull(),namespaceRevision:text("namespace_revision").notNull(),receiptFingerprint:text("receipt_fingerprint").notNull(),
 originalObservationIds:jsonb("original_observation_ids").$type<string[]>().notNull(),
 amountMinor:minor("amount_minor"),currency:text("currency").notNull(),priorCashMinor:minor("prior_cash_minor"),priorAllocatedFeeMinor:minor("prior_allocated_fee_minor"),feeMinor:minor("fee_minor"),
 feeAllocationRevision:text("fee_allocation_revision").notNull(),paymentEvidenceDigest:text("payment_evidence_digest").notNull(),
 paymentIdempotencyKey:text("payment_idempotency_key").notNull(),paymentRequestHash:text("payment_request_hash").notNull(),
 processedAt:timestamp("processed_at",{withTimezone:true}).notNull(),digest:text("digest").notNull(),authentication:text("authentication").notNull(),createdAt:createdAtColumn(),
},t=>[
 unique("controlled_cash_receipts_batch_receipt_key").on(t.batchId,t.receiptId),unique("controlled_cash_receipts_batch_ordinal_key").on(t.batchId,t.ordinal),unique("controlled_cash_receipts_payment_key_key").on(t.paymentIdempotencyKey),
 index("controlled_cash_receipts_receipt_idx").on(t.receiptId),index("controlled_cash_receipts_inspection_idx").on(t.bankInspectionId),
 check("controlled_cash_receipts_order",sql`${t.ordinal} between 1 and 5000`),
 check("controlled_cash_receipts_amounts",sql`${t.amountMinor} between 1 and 9007199254740991 and ${t.priorCashMinor} between 0 and 9007199254740991 and ${t.priorAllocatedFeeMinor} between 0 and 9007199254740991 and ${t.feeMinor} between 0 and ${t.amountMinor} and ${t.currency} ~ '^[A-Z]{3}$'`),
 check("controlled_cash_receipts_digests",sql`${t.immutableBankRevision} ~ '^[a-f0-9]{64}$' and ${t.namespaceRevision} ~ '^[a-f0-9]{64}$' and ${t.receiptFingerprint} ~ '^[a-f0-9]{64}$' and ${t.feeAllocationRevision} ~ '^[a-f0-9]{64}$' and ${t.paymentEvidenceDigest} ~ '^[a-f0-9]{64}$' and ${t.paymentRequestHash} ~ '^[a-f0-9]{64}$' and ${t.digest} ~ '^[a-f0-9]{64}$' and ${t.authentication} ~ '^[a-f0-9]{64}$'`),
 check("controlled_cash_receipts_inventory",sql`jsonb_typeof(${t.originalObservationIds})='array' and jsonb_array_length(${t.originalObservationIds}) between 1 and 5000 and length(${t.paymentIdempotencyKey}) between 1 and 500`),
]);

/** Inserted from the GENUINE newly created payment by the SQL boundary. A
 * receipt is applied once over its lifetime, and no actual payment can fund a
 * second receipt. Failed later stages roll the entire real transaction back. */
export const controlledCashApplicationLinks=pgTable("controlled_cash_application_links",{
 receiptId:uuid("receipt_id").primaryKey().references(()=>subscriptionProviderChargeReceipts.id,{onDelete:"restrict"}),
 receiptProofId:uuid("receipt_proof_id").notNull().references(()=>controlledCashApplicationReceipts.id,{onDelete:"restrict"}),
 batchId:uuid("batch_id").notNull().references(()=>controlledCashApplicationBatches.id,{onDelete:"restrict"}),
 paymentId:uuid("payment_id").notNull().references(()=>payments.id,{onDelete:"restrict"}),
 createdPaymentFingerprint:text("created_payment_fingerprint").notNull(),createdAt:createdAtColumn(),
},t=>[unique("controlled_cash_links_payment_key").on(t.paymentId),unique("controlled_cash_links_proof_key").on(t.receiptProofId),index("controlled_cash_links_batch_idx").on(t.batchId),
 check("controlled_cash_links_fingerprint",sql`${t.createdPaymentFingerprint} ~ '^[a-f0-9]{64}$'`)]);
