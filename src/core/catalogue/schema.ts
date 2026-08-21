// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A federated catalogue of shareable agent and playbook definitions
// (MASTER.md §40, C4.23).
//
// Federated means there is no central registry anybody has to be admitted to.
// A catalogue is a URL an owner chose to trust, and an instance may follow
// several — or none, which is the default and costs nothing.
//
// **A definition is data.** It is a brief, some parameters and a declared set
// of scopes; it is never a credential, never a bound connection, and never a
// live agent. Installing one creates something switched off that the owner
// then points at a worker of their own. That is the whole safety argument, and
// it is enforced at the point of install rather than promised here.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/core/auth/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const CATALOGUE_KINDS = ["playbook", "agent"] as const;

/** A catalogue this instance follows. */
export const catalogueSources = pgTable(
  "catalogue_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Where the index lives. HTTPS only, checked at the service. */
    url: text("url").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /**
     * Trust is per source and explicit. Following a catalogue is a decision an
     * owner makes once and can undo; nothing is followed by default, because
     * a platform that ships with a trusted registry has chosen for them.
     */
    addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("catalogue_sources_url_idx").on(t.url),
    index("catalogue_sources_enabled_idx").on(t.enabled),
  ],
);

/**
 * One definition as a catalogue offered it.
 *
 * Cached rather than fetched on view, so browsing does not depend on somebody
 * else's uptime and so what an owner approved is exactly what gets installed —
 * a catalogue that changed between preview and install would make approval
 * meaningless.
 */
export const catalogueEntries = pgTable(
  "catalogue_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => catalogueSources.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    kind: text("kind", { enum: CATALOGUE_KINDS }).notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    version: text("version").notNull(),
    /** Which Freeholder versions the author says this works with. */
    freeholderRange: text("freeholder_range"),
    /** What it would be allowed to do, shown before anybody approves it. */
    declaredScopes: text("declared_scopes").array().notNull().default(sql`'{}'`),
    author: text("author"),
    license: text("license"),
    /** The document itself, exactly as fetched. */
    document: jsonb("document").notNull(),
    /**
     * SHA-256 of the document as fetched.
     *
     * Provenance in one column: what an owner previewed and what gets
     * installed are the same bytes, and a catalogue that quietly rewrote an
     * entry after approval is caught rather than trusted.
     */
    checksum: text("checksum").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("catalogue_entries_unique_idx").on(t.sourceId, t.slug),
    index("catalogue_entries_kind_idx").on(t.kind, t.name),
    check(
      "catalogue_entries_kind_valid",
      sql`${t.kind} in ('playbook', 'agent')`,
    ),
  ],
);

/**
 * What this instance installed, from where, and as what.
 *
 * Kept after the fact because "where did this playbook come from?" is a
 * question an owner asks months later, usually about one that did something
 * surprising, and the answer must not depend on the catalogue still existing.
 */
export const catalogueInstalls = pgTable(
  "catalogue_installs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryId: uuid("entry_id").references(() => catalogueEntries.id, {
      onDelete: "set null",
    }),
    /** Copied rather than joined: the source may be removed later. */
    sourceUrl: text("source_url").notNull(),
    slug: text("slug").notNull(),
    kind: text("kind", { enum: CATALOGUE_KINDS }).notNull(),
    version: text("version").notNull(),
    checksum: text("checksum").notNull(),
    /** The playbook or agent this became, if it still exists. */
    installedId: uuid("installed_id"),
    installedBy: uuid("installed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [index("catalogue_installs_slug_idx").on(t.slug, t.createdAt)],
);
