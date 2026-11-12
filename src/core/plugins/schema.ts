// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Installed plugins and import runs (C3.09, C3.11, C3.23).
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const PLUGIN_STATUSES = ["installed", "enabled", "disabled"] as const;
export const PLUGIN_TIERS = ["verified", "community", "private", "local"] as const;
export const RETENTION_CHOICES = ["keep", "purge"] as const;
export const IMPORT_STATUSES = [
  "discover",
  "mapped",
  "previewed",
  "committed",
  "reconciled",
  "published",
  "rolled_back",
  "failed",
] as const;

export const installedPlugins = pgTable(
  "installed_plugins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    version: text("version").notNull(),
    status: text("status", { enum: PLUGIN_STATUSES }).notNull().default("installed"),
    source: text("source").notNull(),
    tier: text("tier", { enum: PLUGIN_TIERS }).notNull().default("local"),
    integrity: text("integrity").notNull(),
    signature: text("signature"),
    license: text("license").notNull(),
    freeholder: text("freeholder").notNull(),
    permissions: jsonb("permissions").notNull().default([]),
    config: jsonb("config").notNull().default({}),
    disabledReason: text("disabled_reason"),
    previousVersion: text("previous_version"),
    previousArtifact: jsonb("previous_artifact"),
    installedBy: text("installed_by").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("installed_plugins_name_idx").on(t.name),
    index("installed_plugins_status_idx").on(t.status),
  ],
);

/** Public verification keys only. Revocations remain as security history. */
export const pluginPublisherKeys = pgTable("plugin_publisher_keys", {
  keyId: text("key_id").primaryKey(),
  publisher: text("publisher").notNull(),
  publicKey: text("public_key").notNull(),
  trustedBy: text("trusted_by").notNull(),
  createdAt: createdAtColumn(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

/** Owner consent covers an exact set of scopes, never an API-key approval. */
export const pluginPermissionConsents = pgTable("plugin_permission_consents", {
  name: text("name").primaryKey(),
  scopeHash: text("scope_hash").notNull(),
  permissions: jsonb("permissions").notNull(),
  reviewedVersion: text("reviewed_version").notNull(),
  approvedBy: text("approved_by").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  runtimeDisabledAt: timestamp("runtime_disabled_at", { withTimezone: true }),
  disabledReason: text("disabled_reason"),
}, (t) => [
  check("plugin_permission_consents_scope_hash_check", sql`${t.scopeHash} ~ '^[a-f0-9]{64}$'`),
  check("plugin_permission_consents_permissions_check", sql`jsonb_typeof(${t.permissions}) = 'array'`),
]);

export const pluginRegistries = pgTable(
  "plugin_registries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    tier: text("tier", { enum: PLUGIN_TIERS }).notNull().default("community"),
    signature: text("signature"),
    publisherKeyId: text("publisher_key_id").references(() => pluginPublisherKeys.keyId),
    cachedIndex: jsonb("cached_index").notNull().default({}),
    fetchedAt: text("fetched_at"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [uniqueIndex("plugin_registries_url_idx").on(t.url)],
);

export const pluginRetentions = pgTable("plugin_retentions", {
  name: text("name").primaryKey(),
  retention: text("retention", { enum: RETENTION_CHOICES }).notNull(),
  createdAt: createdAtColumn(),
});

export const importRuns = pgTable(
  "import_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    origin: text("origin"),
    kind: text("kind"),
    status: text("status", { enum: IMPORT_STATUSES }).notNull().default("discover"),
    checkpoint: jsonb("checkpoint").notNull().default({}),
    preview: jsonb("preview").notNull().default({}),
    mapping: jsonb("mapping").notNull().default({}),
    conflicts: jsonb("conflicts").notNull().default([]),
    counts: jsonb("counts").notNull().default({}),
    error: text("error"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [index("import_runs_status_idx").on(t.status)],
);

/** Private, normalized progress; source bodies remain in immutable objects. */
export const importSourceGraphs = pgTable("import_source_graphs", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => importRuns.id, { onDelete: "cascade" }),
  generation: uuid("generation").notNull(),
  sourceRevision: text("source_revision").notNull(),
  sourceStartedAt: timestamp("source_started_at", { withTimezone: true }).notNull(),
  planDigest: text("plan_digest"),
  planRevision: integer("plan_revision").notNull().default(1),
  parserVersion: integer("parser_version").notNull().default(1),
  state: text("state", { enum: ["indexing", "indexed", "invalidated"] }).notNull().default("indexing"),
  cursor: jsonb("cursor").notNull(),
  headerMetadata: jsonb("header_metadata").notNull().default({}),
  planMetadata: jsonb("plan_metadata"),
  commitOrdinal: integer("commit_ordinal").notNull().default(0),
  batchCounter: integer("batch_counter").notNull().default(0),
  leaseToken: uuid("lease_token"),
  leaseActor: text("lease_actor"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
}, (t) => [uniqueIndex("import_source_graphs_run_unique").on(t.runId)]);

export const importSourceEntries = pgTable("import_source_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  graphId: uuid("graph_id").notNull().references(() => importSourceGraphs.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  sourceIdentity: text("source_identity").notNull(),
  kind: text("kind", { enum: ["page", "post", "attachment", "menu", "skipped"] }).notNull(),
  startByte: integer("start_byte").notNull(),
  endByte: integer("end_byte").notNull(),
  digest: text("digest").notNull(),
  metadata: jsonb("metadata").notNull(),
  bodyBytes: integer("body_bytes").notNull(),
  targetSlug: text("target_slug"),
  targetPageId: uuid("target_page_id"),
  resolution: text("resolution", { enum: ["keep-existing", "replace", "rename"] }),
}, (t) => [
  uniqueIndex("import_source_entries_ordinal_unique").on(t.graphId, t.ordinal),
  uniqueIndex("import_source_entries_identity_unique").on(t.graphId, t.kind, t.sourceIdentity),
  uniqueIndex("import_source_entries_target_unique").on(t.graphId, t.targetSlug),
]);

export const importSourceBatches = pgTable("import_source_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  graphId: uuid("graph_id").notNull().references(() => importSourceGraphs.id, { onDelete: "cascade" }),
  batchIndex: integer("batch_index").notNull(),
  childRunId: uuid("child_run_id").notNull().references(() => importRuns.id),
  startOrdinal: integer("start_ordinal").notNull(),
  endOrdinal: integer("end_ordinal").notNull(),
  kind: text("kind", { enum: ["content", "media", "navigation"] }).notNull().default("content"),
  mediaKey: text("media_key"),
  createdAt: createdAtColumn(),
}, (t) => [uniqueIndex("import_source_batches_index_unique").on(t.graphId, t.batchIndex), uniqueIndex("import_source_batches_child_unique").on(t.childRunId)]);

export const importSourceMedia = pgTable("import_source_media", {
  id: uuid("id").primaryKey().defaultRandom(),
  graphId: uuid("graph_id").notNull().references(() => importSourceGraphs.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  planned: jsonb("planned").notNull(),
  digest: text("digest"),
  bytes: integer("bytes"),
  assetId: uuid("asset_id"),
  error: text("error"),
}, (t) => [uniqueIndex("import_source_media_identity_unique").on(t.graphId, t.key)]);
