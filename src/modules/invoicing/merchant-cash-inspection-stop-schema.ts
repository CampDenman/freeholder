// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: a human-reviewed physical stop never fabricates a finish.
import { sql } from "drizzle-orm";
import { check, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn } from "@/core/db/columns";
import { merchantCashReturnInspections } from "./merchant-refund-schema";
export const merchantCashReturnInspectionStops = pgTable("merchant_cash_return_inspection_stops", {
 inspectionId: uuid("inspection_id").primaryKey().references(() => merchantCashReturnInspections.id, {onDelete:"restrict"}),
 callerInstanceId:uuid("caller_instance_id").notNull(), admissionDigest:text("admission_digest").notNull(), admissionFingerprint:text("admission_fingerprint").notNull(),
 sourceRevision:text("source_revision").notNull(), mechanicalCheck:text("mechanical_check",{enum:["original_process_absent"]}).notNull(),
 hostingEvidenceDigest:text("hosting_evidence_digest").notNull(), reviewedBy:text("reviewed_by").notNull(), digest:text("digest").notNull(), authentication:text("authentication").notNull(), createdAt:createdAtColumn(),
}, t=>[check("merchant_cash_inspection_stop_digests",sql`${t.admissionDigest} ~ '^[a-f0-9]{64}$' and ${t.admissionFingerprint} ~ '^[a-f0-9]{64}$' and ${t.sourceRevision} ~ '^[a-f0-9]{64}$' and ${t.hostingEvidenceDigest} ~ '^[a-f0-9]{64}$' and ${t.digest} ~ '^[a-f0-9]{64}$' and ${t.authentication} ~ '^[a-f0-9]{64}$'`),
 check("merchant_cash_inspection_stop_kind",sql`${t.mechanicalCheck} in ('original_process_absent')`),
 check("merchant_cash_inspection_stop_reviewer",sql`${t.reviewedBy} ~ '^user:[0-9a-f-]{36}$'`)]);
