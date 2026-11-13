// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C9.38: immutable fresh consent to a valid calendar after a missed boundary.
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn } from "@/core/db/columns";
import { subscriptionCommercialTerms, subscriptions } from "./schema";
import { subscriptionProviderGenerations } from "./provider-generation-schema";
export const subscriptionCommercialResumptions = pgTable("subscription_commercial_resumptions", {
  termsId: uuid("terms_id").primaryKey().references(() => subscriptionCommercialTerms.id, { onDelete: "restrict" }),
  subscriptionId: uuid("subscription_id").notNull().references(() => subscriptions.id, { onDelete: "restrict" }),
  previousTermsId: uuid("previous_terms_id").notNull().references(() => subscriptionCommercialTerms.id, { onDelete: "restrict" }),
  originalPeriodEnd: timestamp("original_period_end", { withTimezone: true }).notNull(),
  previousEffectiveStart: timestamp("previous_effective_start", { withTimezone: true }).notNull(),
  acceptedPeriodStart: timestamp("accepted_period_start", { withTimezone: true }).notNull(),
  generationId: uuid("generation_id").references(() => subscriptionProviderGenerations.id, { onDelete: "restrict" }),
  generationDigest: text("generation_digest").notNull(), operationRevision: integer("operation_revision").notNull(), evidenceRevision: integer("evidence_revision").notNull(),
  journalDigest: text("journal_digest").notNull(), stoppedProofDigest: text("stopped_proof_digest").notNull(), createdAt: createdAtColumn(),
}, t => [index("subscription_commercial_resumptions_parent").on(t.subscriptionId), index("subscription_commercial_resumptions_previous").on(t.previousTermsId),
  index("subscription_commercial_resumptions_generation").on(t.generationId),
  check("subscription_commercial_resumptions_calendar", sql`${t.acceptedPeriodStart}>${t.originalPeriodEnd} and ${t.acceptedPeriodStart}>${t.previousEffectiveStart}`),
  check("subscription_commercial_resumptions_stamps", sql`${t.operationRevision}>=0 and ${t.evidenceRevision}>=0 and ${t.generationDigest} ~ '^[a-f0-9]{64}$' and ${t.journalDigest} ~ '^[a-f0-9]{64}$' and ${t.stoppedProofDigest} ~ '^[a-f0-9]{64}$'`),
]);
