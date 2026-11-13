// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: restarting creates another original generation; old resources stay immutable.
import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn } from "@/core/db/columns";
import { subscriptionCommercialTerms } from "./schema";
import { subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "./provider-schedule-schema";
export const subscriptionProviderGenerations = pgTable("subscription_provider_generations", {
  id: uuid("id").primaryKey(), subscriptionId: uuid("subscription_id").notNull().references(() => subscriptionProviderScheduleResources.subscriptionId, { onDelete: "restrict" }),
  sequence: integer("sequence").notNull(), previousGenerationId: uuid("previous_generation_id"),
  termsId: uuid("terms_id").notNull().references(() => subscriptionCommercialTerms.id, { onDelete: "restrict" }),
  firstOperationId: uuid("first_operation_id").notNull().references(() => subscriptionProviderScheduleOperations.id, { onDelete: "restrict" }),
  predecessorProofDigest: text("predecessor_proof_digest"), providerCustomerRef: text("provider_customer_ref").notNull(),
  providerScheduleRef: text("provider_schedule_ref"), providerSubscriptionRef: text("provider_subscription_ref"), createdAt: createdAtColumn(),
}, t => [
  uniqueIndex("subscription_provider_generations_sequence").on(t.subscriptionId, t.sequence),
  uniqueIndex("subscription_provider_generations_first_operation").on(t.firstOperationId),
  index("subscription_provider_generations_terms").on(t.termsId), index("subscription_provider_generations_previous").on(t.previousGenerationId),
  foreignKey({ name: "subscription_provider_generations_previous_fk", columns: [t.previousGenerationId], foreignColumns: [t.id] }).onDelete("restrict"),
  check("subscription_provider_generations_sequence_check", sql`${t.sequence}>0 and ((${t.sequence}=1 and ${t.previousGenerationId} is null and ${t.predecessorProofDigest} is null) or (${t.sequence}>1 and ${t.previousGenerationId} is not null and ${t.predecessorProofDigest} ~ '^[a-f0-9]{64}$'))`),
  check("subscription_provider_generations_refs", sql`${t.providerCustomerRef} ~ '^cus_[A-Za-z0-9]+$' and (${t.providerScheduleRef} is null or ${t.providerScheduleRef} ~ '^sub_sched_[A-Za-z0-9]+$') and (${t.providerSubscriptionRef} is null or ${t.providerSubscriptionRef} ~ '^sub_[A-Za-z0-9]+$')`),
]);
