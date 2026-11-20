// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: actual admission order, never money or returned-bank authority.
import { sql } from "drizzle-orm";
import { bigint,check,foreignKey,index,jsonb,pgTable,text,uniqueIndex,uuid } from "drizzle-orm/pg-core";
import { createdAtColumn } from "@/core/db/columns";
import { merchantCashReturnInspections } from "@/modules/invoicing/merchant-refund-schema";
import { subscriptionProviderChargeReceipts } from "./schema";
import { subscriptionControlledResources } from "./controlled-provider-schema";
export const subscriptionControlledCashInspectionLineages=pgTable("subscription_controlled_cash_inspection_lineages",{
 inspectionId:uuid("inspection_id").primaryKey().references(()=>merchantCashReturnInspections.id,{onDelete:"restrict"}),
 resourceId:uuid("resource_id").notNull().references(()=>subscriptionControlledResources.id,{onDelete:"restrict"}),
 receiptId:uuid("receipt_id").notNull().references(()=>subscriptionProviderChargeReceipts.id,{onDelete:"restrict"}),
 namespaceKey:text("namespace_key").notNull(),admissionSequence:bigint("admission_sequence",{mode:"number"}).notNull().default(sql`nextval('controlled_cash_read_admission_seq'::regclass)`),
 predecessorInspectionId:uuid("predecessor_inspection_id"),predecessorDigest:text("predecessor_digest"),
 closedInspectionIds:jsonb("closed_inspection_ids").$type<string[]>().notNull(),closedHistoryDigest:text("closed_history_digest").notNull(),
 callerInstanceId:uuid("caller_instance_id").notNull(),admissionDigest:text("admission_digest").notNull(),admissionFingerprint:text("admission_fingerprint").notNull(),
 digest:text("digest").notNull(),authentication:text("authentication").notNull(),createdAt:createdAtColumn(),
},t=>[
 foreignKey({name:"controlled_cash_lineage_predecessor",columns:[t.predecessorInspectionId],foreignColumns:[t.inspectionId]}).onDelete("restrict"),
 uniqueIndex("controlled_cash_lineage_sequence").on(t.admissionSequence),
 uniqueIndex("controlled_cash_lineage_successor").on(t.namespaceKey,t.predecessorInspectionId),
 uniqueIndex("controlled_cash_lineage_root").on(t.namespaceKey).where(sql`${t.predecessorInspectionId} is null`),
 index("controlled_cash_lineage_receipt").on(t.receiptId),index("controlled_cash_lineage_resource").on(t.resourceId),
 check("controlled_cash_lineage_sequence_bound",sql`${t.admissionSequence}>0 and ${t.admissionSequence}<=9007199254740991`),
 check("controlled_cash_lineage_previous",sql`((${t.predecessorInspectionId} is null and ${t.predecessorDigest} is null) or (${t.predecessorInspectionId} is not null and ${t.predecessorInspectionId}<>${t.inspectionId} and ${t.predecessorDigest} ~ '^[a-f0-9]{64}$')) is true`),
 check("controlled_cash_lineage_closed",sql`jsonb_typeof(${t.closedInspectionIds})='array' and jsonb_array_length(${t.closedInspectionIds})<=5000`),
 check("controlled_cash_lineage_digests",sql`${t.admissionDigest} ~ '^[a-f0-9]{64}$' and ${t.admissionFingerprint} ~ '^[a-f0-9]{64}$' and ${t.closedHistoryDigest} ~ '^[a-f0-9]{64}$' and ${t.digest} ~ '^[a-f0-9]{64}$' and ${t.authentication} ~ '^[a-f0-9]{64}$'`),
]);
