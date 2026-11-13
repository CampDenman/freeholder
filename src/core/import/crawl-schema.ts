// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: actual HTTP frontier and private original response ownership.
// Source-only schema81 model; not registered for runtime before its migration.
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";
import { dataRequests } from "@/core/privacy/schema";
import { importRuns } from "@/core/plugins/schema";
import type { CrawlOriginalFacts } from "./crawl-original";

export const importCrawlSources = pgTable("import_crawl_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => importRuns.id, { onDelete: "cascade" }),
  generation: uuid("generation").notNull(),
  kind: text("kind", { enum: ["wordpress-rest", "sitemap", "rss", "atom", "html"] }).notNull(),
  siteUrl: text("site_url"),
  sourceUrl: text("source_url"),
  createdBy: text("created_by").notNull(),
  executorIdentity: jsonb("executor_identity").$type<{ kind: "key" | "user"; id: string }>().notNull(),
  state: text("state", { enum: ["discovering", "sealed", "invalidated", "rolled_back"] }).notNull().default("discovering"),
  sourceRevision: text("source_revision"),
  requestCounter: integer("request_counter").notNull().default(0),
  networkRequests: integer("network_requests").notNull().default(0),
  capturedBytes: integer("captured_bytes").notNull().default(0),
  reservedBytes: integer("reserved_bytes").notNull().default(0),
  metadataBytes: integer("metadata_bytes").notNull().default(0),
  pageCount: integer("page_count").notNull().default(0),
  robotsResponseId: uuid("robots_response_id"),
  redactedAt: timestamp("redacted_at", { withTimezone: true }),
  sourceStartedAt: timestamp("source_started_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  nextRequestAt: timestamp("next_request_at", { withTimezone: true }).notNull(),
  leaseToken: uuid("lease_token"),
  leaseActor: text("lease_actor"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
}, table => [uniqueIndex("import_crawl_sources_run_unique").on(table.runId), uniqueIndex("import_crawl_sources_generation_unique").on(table.id, table.generation), index("import_crawl_sources_expiry_idx").on(table.expiresAt)]);

export const importCrawlRequests = pgTable("import_crawl_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceId: uuid("source_id").notNull().references(() => importCrawlSources.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  url: text("url"),
  urlDigest: text("url_digest"),
  role: text("role", { enum: ["robots", "html", "sitemap", "rss", "atom", "rest-pages", "rest-posts"] }).notNull(),
  depth: integer("depth").notNull(),
  restPage: integer("rest_page"),
  state: text("state", { enum: ["pending", "claimed", "accepted", "blocked", "failed"] }).notNull().default("pending"),
  discoveredByResponseId: uuid("discovered_by_response_id"),
  acceptedResponseId: uuid("accepted_response_id"),
  // Feed metadata is bound to its actual discovering response. It never
  // substitutes an excerpt for the later original rendered page body.
  entryMetadata: jsonb("entry_metadata"),
  attempts: integer("attempts").notNull().default(0),
  redactedAt: timestamp("redacted_at", { withTimezone: true }),
  createdAt: createdAtColumn(),
}, table => [
  uniqueIndex("import_crawl_requests_ordinal_unique").on(table.sourceId, table.ordinal),
  uniqueIndex("import_crawl_requests_identity_unique").on(table.sourceId, table.role, table.urlDigest),
  index("import_crawl_requests_state_idx").on(table.sourceId, table.state, table.ordinal),
]);

export const importCrawlResponses = pgTable("import_crawl_responses", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().references(() => importCrawlRequests.id, { onDelete: "cascade" }),
  attempt: integer("attempt").notNull(),
  claimedBy: text("claimed_by").notNull(),
  executorIdentity: jsonb("executor_identity").$type<{ kind: "key" | "user"; id: string }>().notNull(),
  storageKey: text("storage_key"),
  // These immutable admission facts survive payload/URL minimization. A
  // replacement store or reused key cannot acquire an earlier response.
  keyDigest: text("key_digest").notNull(),
  storageNamespace: text("storage_namespace").notNull(),
  state: text("state", { enum: ["reserved", "admitted", "fetched", "put_unknown", "stored", "transport_failed", "retired"] }).notNull().default("reserved"),
  reservedBytes: integer("reserved_bytes").notNull(),
  facts: jsonb("facts").$type<CrawlOriginalFacts>(),
  discoveryOrdinal: integer("discovery_ordinal").notNull().default(0),
  discoveryComplete: boolean("discovery_complete").notNull().default(false),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  providerAcceptedAt: timestamp("provider_accepted_at", { withTimezone: true }),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  redactedAt: timestamp("redacted_at", { withTimezone: true }),
  createdAt: createdAtColumn(),
}, table => [
  uniqueIndex("import_crawl_responses_attempt_unique").on(table.requestId, table.attempt),
  uniqueIndex("import_crawl_responses_key_unique").on(table.keyDigest),
  uniqueIndex("import_crawl_responses_request_pair_unique").on(table.id, table.requestId),
  index("import_crawl_responses_state_idx").on(table.state),
]);

/** Exact erasure membership is retained for late facts and later legal holds;
 * it identifies an actual request, never a guessed owner of opaque content. */
export const importCrawlResponseErasures = pgTable("import_crawl_response_erasures", {
  id: uuid("id").primaryKey().defaultRandom(),
  responseId: uuid("response_id").notNull().references(() => importCrawlResponses.id, { onDelete: "restrict" }),
  requestId: uuid("request_id").notNull().references(() => dataRequests.id, { onDelete: "restrict" }),
  createdAt: createdAtColumn(),
}, table => [uniqueIndex("import_crawl_response_erasures_pair_unique").on(table.responseId, table.requestId), index("import_crawl_response_erasures_request_idx").on(table.requestId)]);
