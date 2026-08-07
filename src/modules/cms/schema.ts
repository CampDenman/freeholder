// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The CMS tables (MASTER.md §4.6, §32).
//
// The governing rule of this module is §32's: **structure is data; code is
// vocabulary.** Rearranging a site — any page, the chrome around it, the order
// of anything on it — is a row in these tables, live on the next request and
// never a build. Only *extending the vocabulary* (a new kind of block) is code.
//
// That is why `blocks` is jsonb and why that does not contradict §2 principle
// 12's ban on shadow stores. Principle 12 permits jsonb for "genuinely
// owner-defined schemaless data (custom fields, block content)" — and block
// content is the example it names. What keeps it honest is that every node is
// Zod-validated against a registered block type before it is written (see
// blocks/registry.ts), so this is a typed tree that happens to be stored as
// JSON, not a bag anyone can put anything in.
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

/**
 * A page with a public face.
 *
 * `slug` is the path with no leading or trailing slash, and the home page is
 * the empty string — so the catch-all route can look up exactly what it was
 * asked for without special-casing the root anywhere but one line.
 */
export const pages = pgTable(
  "pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** "" for home, "about", "services/weddings". No leading slash. */
    slug: text("slug").notNull(),
    /** BCP-47. The default locale is unprefixed in URLs (§4.9). */
    locale: text("locale").notNull().default("en"),
    title: text("title").notNull(),
    /** The block tree. Validated against the registry on every write. */
    blocks: jsonb("blocks").notNull().default([]),
    status: text("status", { enum: ["draft", "published"] })
      .notNull()
      .default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /** Per-page SEO overrides; the builder fills the gaps (§5). */
    seo: jsonb("seo").notNull().default({}),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    // One page per path per locale. A second row for the same slug is not
    // "unlikely", it is the thing that makes a URL ambiguous.
    uniqueIndex("pages_slug_locale_idx").on(t.slug, t.locale),
    index("pages_status_idx").on(t.status),
  ],
);

/**
 * A reusable block tree.
 *
 * Two things at once, deliberately: the site chrome (§32 — "the header,
 * footer, nav and announcement bar are synced Sections … Menus are rows, not
 * JSX"), and any arrangement an owner saves to reuse across pages. They are
 * the same object because they behave the same way; only `kind` differs, and
 * only so the admin can list them separately.
 */
export const sections = pgTable(
  "sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Stable identifier. Chrome sections use reserved keys the layout looks up
     * by name ("header", "footer"); owner-made sections get a generated one.
     */
    key: text("key").notNull(),
    locale: text("locale").notNull().default("en"),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["chrome", "reusable"] })
      .notNull()
      .default("reusable"),
    blocks: jsonb("blocks").notNull().default([]),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [uniqueIndex("sections_key_locale_idx").on(t.key, t.locale)],
);

/**
 * Autosave history (§32: "autosave with visible version history and one-click
 * restore — `ContentRevision` rows, normalized, in the database, per the
 * mandate").
 *
 * Append-only. `subjectId` is polymorphic across pages and sections and is
 * therefore uuid-typed but not a foreign key — the same shape, and the same
 * reasoning, as audit_log.subject_id.
 */
export const contentRevisions = pgTable(
  "content_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subjectType: text("subject_type", { enum: ["page", "section"] }).notNull(),
    subjectId: uuid("subject_id").notNull(),
    title: text("title"),
    blocks: jsonb("blocks").notNull().default([]),
    /** "user:<id>", "agent:<key-name>", "system" — as everywhere else. */
    actor: text("actor").notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("content_revisions_subject_idx").on(
      t.subjectType,
      t.subjectId,
      t.createdAt,
    ),
  ],
);
