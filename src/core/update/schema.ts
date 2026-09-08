// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Update runs, snapshots and instance release notes (MASTER.md §39.5, §39.10, C10.06).
import { sql } from "drizzle-orm";
import {
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn } from "@/core/db/columns";

export const UPDATE_TRIGGERS = ["schedule", "admin", "cli", "agent"] as const;
export const UPDATE_RUN_STATUSES = [
  "started",
  "completed",
  "rolled_back",
  "failed",
] as const;
export const SNAPSHOT_KINDS = ["db", "config"] as const;
export const RELEASE_NOTE_KINDS = [
  "platform_upgrade",
  "module_toggled",
  "plugin_installed",
  "plugin_updated",
  "plugin_removed",
  "setting_changed",
  "custom",
] as const;

export const updateSnapshots = pgTable(
  "update_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: SNAPSHOT_KINDS }).notNull(),
    fingerprint: text("fingerprint").notNull(),
    version: text("version").notNull(),
    bytes: integer("bytes").notNull().default(0),
    createdAt: createdAtColumn(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [
    check("update_snapshots_fingerprint_not_blank", sql`length(trim(${t.fingerprint})) > 0`),
    check("update_snapshots_version_not_blank", sql`length(trim(${t.version})) > 0`),
  ],
);

export const updateRuns = pgTable(
  "update_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromVersion: text("from_version").notNull(),
    toVersion: text("to_version").notNull(),
    trigger: text("trigger", { enum: UPDATE_TRIGGERS }).notNull(),
    status: text("status", { enum: UPDATE_RUN_STATUSES }).notNull().default("started"),
    preflight: jsonb("preflight").notNull().default({}),
    snapshotId: uuid("snapshot_id").references(() => updateSnapshots.id),
    rolledBackFromRunId: uuid("rolled_back_from_run_id"),
    log: text("log").notNull().default(""),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    check("update_runs_from_not_blank", sql`length(trim(${t.fromVersion})) > 0`),
    check("update_runs_to_not_blank", sql`length(trim(${t.toVersion})) > 0`),
  ],
);

export const releaseNotes = pgTable(
  "release_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: RELEASE_NOTE_KINDS }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    actor: text("actor").notNull(),
    sourceRef: text("source_ref"),
    visibility: text("visibility").notNull().default("internal"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("release_notes_title_not_blank", sql`length(trim(${t.title})) > 0`),
    check("release_notes_visibility", sql`${t.visibility} in ('internal', 'public')`),
  ],
);
