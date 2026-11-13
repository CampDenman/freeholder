// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C9.38: an accepted future amendment never rewrites earlier promises.
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn } from "@/core/db/columns";
import { subscriptionCommercialTerms, subscriptions, plans } from "./schema";
export const subscriptionCommercialAmendments = pgTable("subscription_commercial_amendments", {
  termsId: uuid("terms_id").primaryKey().references(() => subscriptionCommercialTerms.id, { onDelete: "restrict" }),
  subscriptionId: uuid("subscription_id").notNull().references(() => subscriptions.id, { onDelete: "restrict" }),
  planId: uuid("plan_id").notNull().references(() => plans.id, { onDelete: "restrict" }),
  previousTermsId: uuid("previous_terms_id").notNull().references(() => subscriptionCommercialTerms.id, { onDelete: "restrict" }),
  acceptedBy: text("accepted_by").notNull(),
  acceptedQuoteDigest: text("accepted_quote_digest").notNull(),
  state: text("state", { enum: ["pending_stop", "activated"] }).notNull(),
  originalJobId: uuid("original_job_id"), jobClaimDigest: text("job_claim_digest"),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  createdAt: createdAtColumn(),
}, t => [
  index("subscription_commercial_amendments_parent").on(t.subscriptionId),
  index("subscription_commercial_amendments_plan").on(t.planId),
  index("subscription_commercial_amendments_previous").on(t.previousTermsId),
  uniqueIndex("subscription_commercial_amendments_job").on(t.originalJobId),
  check("subscription_commercial_amendments_acceptance", sql`${t.acceptedQuoteDigest} ~ '^[a-f0-9]{64}$' and ${t.acceptedBy} ~ '^(user:|agent:|plugin:)'`),
  check("subscription_commercial_amendments_state", sql`(${t.state}='pending_stop' and ${t.activatedAt} is null and ${t.originalJobId} is not null and ${t.jobClaimDigest} ~ '^[a-f0-9]{64}$') or (${t.state}='activated' and ${t.activatedAt} is not null)`),
]);
