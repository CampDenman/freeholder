// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: independent original admissions, actual finishes and human stops.
import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn } from "@/core/db/columns";
import { subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "./provider-schedule-schema";
import type { ProviderReadSignedProof } from "./provider-read-signatures";
export const subscriptionProviderReadTickets = pgTable("subscription_provider_read_tickets", {
  readId: uuid("read_id").primaryKey(), operationId: uuid("operation_id").notNull().references(() => subscriptionProviderScheduleOperations.id, { onDelete: "restrict" }),
  subscriptionId: uuid("subscription_id").notNull().references(() => subscriptionProviderScheduleResources.subscriptionId, { onDelete: "restrict" }),
  admission: jsonb("admission").$type<Record<string, unknown>>().notNull(), admissionDigest: text("admission_digest").notNull(), createdAt: createdAtColumn(),
}, t => [index("subscription_provider_read_tickets_parent").on(t.subscriptionId), index("subscription_provider_read_tickets_operation").on(t.operationId),
  check("subscription_provider_read_tickets_digest", sql`${t.admissionDigest} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${t.admission})='object'`)]);
export const subscriptionProviderReadFinishes = pgTable("subscription_provider_read_finishes", {
  readId: uuid("read_id").primaryKey().references(() => subscriptionProviderReadTickets.readId, { onDelete: "restrict" }),
  proof: jsonb("proof").$type<ProviderReadSignedProof>().notNull(), proofDigest: text("proof_digest").notNull(), createdAt: createdAtColumn(),
}, t => [check("subscription_provider_read_finishes_digest", sql`${t.proofDigest} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${t.proof})='object'`)]);
/** Historical admissions may have no normalized ticket: their original sparse
 * birth evidence is retained, never replaced with today's runtime identity. */
export const subscriptionProviderReadStops = pgTable("subscription_provider_read_stops", {
  readId: uuid("read_id").primaryKey(), operationId: uuid("operation_id").notNull().references(() => subscriptionProviderScheduleOperations.id, { onDelete: "restrict" }),
  subscriptionId: uuid("subscription_id").notNull().references(() => subscriptionProviderScheduleResources.subscriptionId, { onDelete: "restrict" }),
  proof: jsonb("proof").$type<ProviderReadSignedProof>().notNull(), proofDigest: text("proof_digest").notNull(), createdAt: createdAtColumn(),
}, t => [index("subscription_provider_read_stops_parent").on(t.subscriptionId), index("subscription_provider_read_stops_operation").on(t.operationId),
  check("subscription_provider_read_stops_digest", sql`${t.proofDigest} ~ '^[a-f0-9]{64}$' and jsonb_typeof(${t.proof})='object'`)]);
