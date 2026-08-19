// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Installed plugins and import runs (C3.09, C3.11, C3.23).
import {
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
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
    installedBy: text("installed_by").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("installed_plugins_name_idx").on(t.name),
    index("installed_plugins_status_idx").on(t.status),
  ],
);

export const pluginRegistries = pgTable(
  "plugin_registries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    tier: text("tier", { enum: PLUGIN_TIERS }).notNull().default("community"),
    signature: text("signature"),
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
