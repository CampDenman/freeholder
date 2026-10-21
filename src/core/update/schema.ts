// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Update runs, snapshots and instance release notes (MASTER.md §39.5, §39.10,
// C10.06), and the cached signed feed (C10.11).
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
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
export const POLICY_CHANNELS = ["security", "stable", "edge", "off"] as const;
export const APPLY_LEVELS = ["security", "patch", "minor", "none"] as const;
export const WINDOW_DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export const NOTIFY_CHANNELS = ["email", "sms"] as const;

export const RELEASE_NOTE_KINDS = [
  "platform_upgrade",
  "module_toggled",
  "plugin_installed",
  "plugin_updated",
  "plugin_removed",
  "setting_changed",
  "custom",
] as const;

export const updateSettings = pgTable(
  "update_settings",
  {
    id: integer("id").primaryKey().default(1),
    channel: text("channel", { enum: POLICY_CHANNELS }).notNull().default("security"),
    applyLevel: text("apply_level", { enum: APPLY_LEVELS }).notNull().default("security"),
    window: jsonb("window")
      .$type<{ days: string[]; start: string }>()
      .notNull()
      .default({ days: ["tue", "wed", "thu"], start: "03:00" }),
    drain: boolean("drain").notNull().default(true),
    notifyChannels: text("notify_channels").array().notNull().default(sql`'{"email","sms"}'`),
    keepSnapshots: integer("keep_snapshots").notNull().default(5),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    pausedUntil: timestamp("paused_until", { withTimezone: true }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    check("update_settings_singleton", sql`${t.id} = 1`),
    check("update_settings_keep_snapshots", sql`${t.keepSnapshots} between 1 and 50`),
  ],
);

/**
 * What the signed feed offered, cached (§39.10, C10.11).
 *
 * Cached rather than fetched per read for one reason: an owner asking "am I
 * exposed?" must get an answer when the feed is unreachable, and "I could not
 * reach the feed" is a different sentence from "you are up to date". The
 * `verified` column records whether the signature checked out at the moment
 * the row was written, so a row can never be mistaken for a trusted one later.
 */
export const availableReleases = pgTable(
  "available_releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    version: text("version").notNull(),
    channel: text("channel", { enum: ["stable", "security", "edge"] }).notNull(),
    digest: text("digest").notNull(),
    severity: text("severity", {
      enum: ["none", "low", "medium", "high", "critical"],
    })
      .notNull()
      .default("none"),
    // numeric, not real: a CVSS score is compared and displayed, never summed,
    // and 8.1 must read back as 8.1 rather than 8.100000381469727.
    cvss: numeric("cvss", { precision: 3, scale: 1 }),
    schemaBreaking: boolean("schema_breaking").notNull().default(false),
    minFromVersion: text("min_from_version").notNull(),
    pluginApi: text("plugin_api").notNull(),
    notesUrl: text("notes_url").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    verified: boolean("verified").notNull().default(false),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("available_releases_version_key").on(t.version),
    index("available_releases_published_idx").on(t.publishedAt),
    check("available_releases_version_not_blank", sql`length(trim(${t.version})) > 0`),
    check(
      "available_releases_digest_shape",
      sql`${t.digest} ~ '^sha256:[a-f0-9]{64}$'`,
    ),
    check("available_releases_cvss_range", sql`${t.cvss} is null or (${t.cvss} >= 0 and ${t.cvss} <= 10)`),
    // A scored release must say how bad, and an unscored one must not claim a
    // band. C10.02 refuses this at the feed; the database refuses it too,
    // because a cache that can hold what the parser rejects is not a cache.
    check(
      "available_releases_severity_matches_score",
      sql`(${t.cvss} is null and ${t.severity} = 'none') or (${t.cvss} is not null and ${t.severity} <> 'none')`,
    ),
  ],
);

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
