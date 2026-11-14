// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: actual original fee callers; stop never supplies bank evidence.
import {sql} from "drizzle-orm";
import {check,foreignKey,index,integer,jsonb,pgTable,text,uniqueIndex,uuid} from "drizzle-orm/pg-core";
import {createdAtColumn} from "@/core/db/columns";
import {merchantFeeRefunds} from "./merchant-collection-schema";
import {payments} from "./schema";
import {subscriptionProviderChargeReceipts} from "@/modules/subscriptions/schema";
import type {MerchantPhysicalCaller} from "./merchant-physical-caller";
export type MerchantFeeInvocationProof={body:Record<string,unknown>;digest:string;authentication:string};
/** Header never changes. Each nullable proof is appended once, independently
 * authenticated against this exact real admission and actual server holder.
 * A late raw provider ACK still commits to merchant_fee_observations even
 * when a finished/stopped invocation can no longer append evidence. */
export const merchantFeeRefundInvocations=pgTable("merchant_fee_refund_invocations",{
 id:uuid("id").primaryKey(),paymentId:uuid("payment_id").notNull(),originalChargeReceiptId:uuid("original_charge_receipt_id").notNull(),namespaceKey:text("namespace_key").notNull(),
 feeOperationId:uuid("fee_operation_id"),
 ordinal:integer("ordinal").notNull(),kind:text("kind",{enum:["source_inspect","post","recover_get"]}).notNull(),
 feeOperationFingerprint:text("fee_operation_fingerprint"),request:jsonb("request").$type<Record<string,unknown>>().notNull(),
 caller:jsonb("caller").$type<MerchantPhysicalCaller>().notNull(),nonceHash:text("nonce_hash").notNull(),
 digest:text("digest").notNull(),authentication:text("authentication").notNull(),
 firstResult:jsonb("first_result").$type<MerchantFeeInvocationProof>(),finish:jsonb("finish").$type<MerchantFeeInvocationProof>(),stop:jsonb("stop").$type<MerchantFeeInvocationProof>(),createdAt:createdAtColumn(),
},t=>[
 foreignKey({name:"merchant_fee_invocations_operation_fk",columns:[t.feeOperationId],foreignColumns:[merchantFeeRefunds.id]}).onDelete("restrict"),
 foreignKey({name:"merchant_fee_invocations_payment_fk",columns:[t.paymentId],foreignColumns:[payments.id]}).onDelete("restrict"),
 foreignKey({name:"merchant_fee_invocations_receipt_fk",columns:[t.originalChargeReceiptId],foreignColumns:[subscriptionProviderChargeReceipts.id]}).onDelete("restrict"),
 uniqueIndex("merchant_fee_invocations_ordinal").on(t.paymentId,t.namespaceKey,t.ordinal),
 uniqueIndex("merchant_fee_invocations_post").on(t.feeOperationId).where(sql`${t.kind}='post'`),
 index("merchant_fee_invocations_operation").on(t.feeOperationId,t.createdAt),
 index("merchant_fee_invocations_receipt").on(t.originalChargeReceiptId,t.ordinal),
 uniqueIndex("merchant_fee_invocations_preflight").on(sql`(${t.request}->>'parentFeeInvocationId')`).where(sql`${t.kind}='source_inspect' and ${t.request}->>'readKind'='fee_preflight'`),
 check("merchant_fee_invocations_kind",sql`${t.kind} in ('source_inspect','post','recover_get') and ${t.ordinal}>0`),
 check("merchant_fee_invocations_owner",sql`((${t.kind}='source_inspect' and ${t.feeOperationId} is null and ${t.feeOperationFingerprint} is null) or (${t.kind} in ('post','recover_get') and ${t.feeOperationId} is not null and ${t.feeOperationFingerprint} ~ '^[a-f0-9]{64}$')) is true`),
 check("merchant_fee_invocations_source",sql`((${t.kind}='source_inspect' and ((${t.request}->>'readKind'='payment_source' and ${t.request}->>'parentFeeInvocationId' is null) or (${t.request}->>'readKind'='fee_preflight' and ${t.request}->>'parentFeeInvocationId' ~ '^[0-9a-f-]{36}$'))) or (${t.kind}<>'source_inspect' and ${t.request}->>'readKind' is null and ${t.request}->>'parentFeeInvocationId' is null)) is true`),
 check("merchant_fee_invocations_header",sql`length(${t.namespaceKey}) between 3 and 1502 and ${t.nonceHash} ~ '^[a-f0-9]{64}$' and ${t.digest} ~ '^[a-f0-9]{64}$' and ${t.authentication} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${t.request})='object' and jsonb_typeof(${t.caller})='object'`),
 check("merchant_fee_invocations_proofs",sql`(${t.firstResult} is null or jsonb_typeof(${t.firstResult})='object') and (${t.finish} is null or jsonb_typeof(${t.finish})='object') and (${t.stop} is null or jsonb_typeof(${t.stop})='object') and (${t.finish} is null or ${t.stop} is null)`),
]);
