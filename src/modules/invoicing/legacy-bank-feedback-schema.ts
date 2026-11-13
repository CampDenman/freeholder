// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38/C1.08: raw verified financial feedback may remain unassigned.
import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn } from "@/core/db/columns";
import type { LegacyBankFeedbackEvidence } from "./legacy-bank-feedback-proof";
export const legacyBankFeedback = pgTable("legacy_bank_feedback", {
  id: uuid("id").primaryKey().defaultRandom(), captureKey: text("capture_key").notNull(), evidenceDigest: text("evidence_digest").notNull(), authentication: text("authentication").notNull(),
  evidence: jsonb("evidence").$type<LegacyBankFeedbackEvidence>().notNull(), createdAt: createdAtColumn(),
}, table => [uniqueIndex("legacy_bank_feedback_capture_idx").on(table.captureKey),
  index("legacy_bank_feedback_payment_idx").on(sql`(${table.evidence}->>'observedPaymentRef')`, sql`(${table.evidence}->>'observedChargeAccountId')`),
  index("legacy_bank_feedback_refund_idx").on(sql`(${table.evidence}->>'observedRefundRef')`, sql`(${table.evidence}->>'observedChargeAccountId')`),
  check("legacy_bank_feedback_digests", sql`${table.captureKey} ~ '^[a-f0-9]{64}$' and ${table.evidenceDigest} ~ '^[a-f0-9]{64}$' and ${table.authentication} ~ '^[a-f0-9]{64}$'`),
  check("legacy_bank_feedback_evidence", sql`(jsonb_typeof(${table.evidence})='object' and ${table.evidence}->>'protocol'='freeholder.legacy-bank-feedback.v1' and ${table.evidence}->'originalCreatePlatformAccountId'='null'::jsonb and ${table.evidence}->'originalCreateProtocolVersion'='null'::jsonb) is true`),
]);
