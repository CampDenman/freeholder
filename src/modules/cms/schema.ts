// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
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
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
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
    /**
     * Working copy (C2.01). Autosave writes here so a published page's live
     * title/blocks/seo never change until publish copies them across.
     */
    workingTitle: text("working_title"),
    workingBlocks: jsonb("working_blocks"),
    workingSeo: jsonb("working_seo"),
    version: integer("version").notNull().default(1),
    scheduledPublishAt: timestamp("scheduled_publish_at", { withTimezone: true }),
    scheduledUnpublishAt: timestamp("scheduled_unpublish_at", { withTimezone: true }),
    approvalState: text("approval_state", {
      enum: ["none", "pending", "approved", "rejected"],
    })
      .notNull()
      .default("none"),
    approvalNote: text("approval_note"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    editLeaseActor: text("edit_lease_actor"),
    editLeaseUntil: timestamp("edit_lease_until", { withTimezone: true }),
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
    seo: jsonb("seo").notNull().default({}),
    /** Owner-given name for a snapshot they may want again (C2.02). */
    name: text("name"),
    kind: text("kind", { enum: ["autosave", "named", "publish"] })
      .notNull()
      .default("autosave"),
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

/**
 * Shareable, expiring look at a page's working draft (C2.02).
 *
 * The token is stored hashed. Resolving one never requires a staff session —
 * the link *is* the permission, and only until it expires or is revoked.
 */
export const contentPreviewLinks = pgTable(
  "content_preview_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdBy: text("created_by").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("content_preview_links_token_idx").on(t.tokenHash),
    index("content_preview_links_page_idx").on(t.pageId),
  ],
);

/**
 * Who is currently looking at or editing a page (C2.03).
 *
 * A heartbeat upserts one row per actor per page. Listing drops anyone whose
 * last beat is older than the presence window, so a closed tab does not look
 * like a second editor forever.
 */
export const contentPresence = pgTable(
  "content_presence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id").notNull(),
    actor: text("actor").notNull(),
    editing: boolean("editing").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("content_presence_page_actor_idx").on(t.pageId, t.actor),
    index("content_presence_page_seen_idx").on(t.pageId, t.lastSeenAt),
  ],
);

/**
 * Editorial comments and review threads (C2.04).
 *
 * These live beside the page, never inside `pages.blocks` or the live title.
 * A published visitor never sees them; they attach to a block id and/or a
 * revision so a note about a draft does not become public copy.
 */
export const contentComments = pgTable(
  "content_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id").notNull(),
    revisionId: uuid("revision_id"),
    blockId: text("block_id"),
    parentId: uuid("parent_id"),
    body: text("body").notNull(),
    mentions: jsonb("mentions").notNull().default([]),
    kind: text("kind", { enum: ["comment", "review_request"] })
      .notNull()
      .default("comment"),
    reviewer: text("reviewer"),
    reviewState: text("review_state", {
      enum: ["none", "requested", "approved", "changes_requested"],
    })
      .notNull()
      .default("none"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("content_comments_page_idx").on(t.pageId, t.createdAt),
    index("content_comments_parent_idx").on(t.parentId),
    index("content_comments_review_idx").on(t.pageId, t.reviewState),
  ],
);

export const TEMPLATE_KINDS = ["page", "post", "product", "service", "email"] as const;
export const TEMPLATE_PRESETS = [
  "creator",
  "service-business",
  "shop",
  "everything",
  "custom",
] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];
export type TemplatePreset = (typeof TEMPLATE_PRESETS)[number];

/**
 * A full-page (or email) starting tree (C2.13).
 *
 * Templates are defaults, never cages: create-from-template copies the blocks
 * onto a new page, and reset-to-default restores the seeded tree. Per-entity
 * detach/rejoin is C2.14.
 */
export const contentTemplates = pgTable(
  "content_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    kind: text("kind", { enum: TEMPLATE_KINDS }).notNull(),
    preset: text("preset", { enum: TEMPLATE_PRESETS }).notNull(),
    name: text("name").notNull(),
    locale: text("locale").notNull().default("en"),
    blocks: jsonb("blocks").notNull().default([]),
    origin: text("origin", { enum: ["system", "owner"] })
      .notNull()
      .default("system"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("content_templates_key_preset_locale_idx").on(
      t.key,
      t.preset,
      t.locale,
    ),
    index("content_templates_kind_preset_idx").on(t.kind, t.preset),
  ],
);

export const LAYOUT_ENTITY_TYPES = [
  "product",
  "service",
  "post",
  "location",
  "event",
  "gallery",
  "page",
] as const;
export type LayoutEntityType = (typeof LAYOUT_ENTITY_TYPES)[number];

/**
 * Whether a public entity page still follows its template (C2.14).
 *
 * No row, or `detached = false`, means the page is rebuilt from the template
 * when the entity changes. Detach copies the current tree and leaves it
 * alone; rejoin throws the copy away and follows again.
 */
export const contentLayouts = pgTable(
  "content_layouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id").notNull(),
    entityType: text("entity_type", { enum: LAYOUT_ENTITY_TYPES }).notNull(),
    entityId: uuid("entity_id").notNull(),
    templateKey: text("template_key").notNull(),
    detached: boolean("detached").notNull().default(false),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("content_layouts_page_idx").on(t.pageId),
    uniqueIndex("content_layouts_entity_locale_idx").on(t.entityType, t.entityId),
    index("content_layouts_template_idx").on(t.templateKey),
  ],
);
