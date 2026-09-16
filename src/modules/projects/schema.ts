// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One piece of work, from enquiry to done (MASTER.md §4.7, C6.15).
//
// **This is the same entity C8.01 will publish**, not a second one. §4.7's
// `Project` already carries `client_contact_id`, `services[]` and
// `occurred_on` — operational facts — because a case study *is* a job that got
// finished, and modelling those as two tables would fork exactly the way the
// contact spine exists to prevent: the wedding in the portfolio and the
// wedding in the diary would stop being the same wedding the first time
// somebody edited one.
//
// So C6.15 builds the working half — who it is for, what state it is in, what
// it is made of — and C8.01 adds the publishing half (blocks, cover, SEO,
// featured) to the same row. The seam is additive, which is what lets a
// business decide *after* the job whether it becomes a case study.
//
// The other decision worth reading: **what a project is made of is a link
// table, not columns.** A job has many quotes, many bookings and many
// invoices, and C6.13 will add more kinds; a column per kind would be a
// migration every time the business does something new.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { businessLocations } from "@/core/locations/schema";
import { assets } from "@/core/media/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";
import type { BlockNode } from "@/modules/cms/blocks/types";

export interface ProjectSeo {
  title?: string;
  description?: string;
}

export const PROJECT_PUBLICATION_STATUSES = ["draft", "published"] as const;
export const PROJECT_CONSENT_METHODS = [
  "contract",
  "email",
  "written",
  "verbal",
  "other",
] as const;

export const PROJECT_STATUSES = [
  "enquiry",
  "quoted",
  "active",
  "on_hold",
  "complete",
  "cancelled",
] as const;

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Who it is for. Nullable, because internal work is real work: a rebrand of
     * your own site is a project with no client, and refusing to record it
     * would push it onto a whiteboard.
     */
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "restrict",
    }),
    /**
     * What to call the client publicly (§4.7).
     *
     * "A Fortune 500 retailer" is a first-class option rather than a fib, and
     * it exists so a business can publish work it is not allowed to name.
     */
    clientDisplayName: text("client_display_name"),
    title: text("title").notNull(),
    /** Stable once set: C8.01 publishes at this address (§5's slug rule). */
    slug: text("slug").notNull(),
    summary: text("summary"),
    status: text("status", { enum: PROJECT_STATUSES }).notNull().default("enquiry"),
    /** Whose job it is inside the business. */
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    locationId: uuid("location_id").references(() => businessLocations.id, {
      onDelete: "set null",
    }),
    /** The services this work used — product ids, untyped: catalog is a module. */
    serviceProductIds: uuid("service_product_ids")
      .array()
      .notNull()
      .default(sql`'{}'`),
    startedOn: date("started_on"),
    /** When the work happened, which is what a case study dates itself by. */
    occurredOn: date("occurred_on"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** The owner's own notes. Never shown to the client (C8.01 publishes blocks). */
    notes: text("notes"),
    /** Owner-authored case-study copy. A CMS snapshot is made only on publish. */
    blocks: jsonb("blocks").$type<BlockNode[]>().notNull().default([]),
    coverAssetId: uuid("cover_asset_id").references(() => assets.id, {
      onDelete: "set null",
    }),
    featured: boolean("featured").notNull().default(false),
    seo: jsonb("seo").$type<ProjectSeo>().notNull().default({}),
    publicationStatus: text("publication_status", {
      enum: PROJECT_PUBLICATION_STATUSES,
    })
      .notNull()
      .default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /** Untyped CMS page id: the operational module still installs without CMS. */
    publicPageId: uuid("public_page_id"),
    /** Permission to publish contact-linked client work (MASTER.md §4.5). */
    clientConsentGivenAt: timestamp("client_consent_given_at", {
      withTimezone: true,
    }),
    clientConsentMethod: text("client_consent_method", {
      enum: PROJECT_CONSENT_METHODS,
    }),
    clientConsentNote: text("client_consent_note"),
    /** Compare-and-swap token for block-editor autosave. */
    version: integer("version").notNull().default(1),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("projects_slug_idx").on(t.slug),
    index("projects_contact_idx").on(t.contactId),
    index("projects_status_idx").on(t.status, t.occurredOn),
    index("projects_publication_idx").on(t.publicationStatus, t.publishedAt),
    index("projects_featured_idx").on(t.featured, t.publishedAt),
    check("projects_title", sql`char_length(${t.title}) between 1 and 200`),
    check("projects_slug", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    // A finished job has a finishing time. A row claiming otherwise is the
    // shape a bug leaves, and it is the column every report dates from.
    check(
      "projects_complete_has_time",
      sql`${t.status} <> 'complete' or ${t.completedAt} is not null`,
    ),
    check(
      "projects_publication_time",
      sql`(${t.publicationStatus} = 'published' and ${t.publishedAt} is not null) or ${t.publicationStatus} = 'draft'`,
    ),
    check(
      "projects_publication_status",
      sql`${t.publicationStatus} in ('draft','published')`,
    ),
    check(
      "projects_consent_complete",
      sql`(${t.clientConsentGivenAt} is null and ${t.clientConsentMethod} is null) or (${t.clientConsentGivenAt} is not null and ${t.clientConsentMethod} is not null)`,
    ),
    check(
      "projects_consent_method",
      sql`${t.clientConsentMethod} is null or ${t.clientConsentMethod} in ('contract','email','written','verbal','other')`,
    ),
    check("projects_version_positive", sql`${t.version} > 0`),
  ],
);

/**
 * What a project is made of (§4.7, C6.15).
 *
 * Polymorphic on purpose. A job has many quotes, many bookings and many
 * invoices, and C6.13 will attach more; a column per kind would be a migration
 * every time the business does something new. The `kind` is a closed set here
 * and the id is untyped, because half the things a project links to live in
 * modules this one must not depend on (§11).
 */
export const PROJECT_LINK_KINDS = [
  "quote",
  "contract",
  "booking",
  "invoice",
  "rental",
  "form_submission",
] as const;

export const projectLinks = pgTable(
  "project_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: PROJECT_LINK_KINDS }).notNull(),
    /** Untyped by a foreign key: these live in modules projects may not import. */
    targetId: uuid("target_id").notNull(),
    /** What to call it on screen, so a list reads without ten more queries. */
    label: text("label"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("project_links_unique_idx").on(t.projectId, t.kind, t.targetId),
    index("project_links_target_idx").on(t.kind, t.targetId),
  ],
);

// The checklist moved to core's `tasks` in C7.02, and the definition went with
// it: a table this file still declared would be a second answer to "what is on
// the list", and `registry-completeness` is right to insist that every table a
// schema file names is a table the platform actually uses.
//
// `project_tasks` still exists in the database. `0102_tasks.sql` copied its
// rows across and stopped writing to it, but dropping it in the same release
// that stopped using it is what the schema-compat gate refuses — the previous
// release still selects from it, and a rollback would find it gone. The
// contract half is one `DROP TABLE project_tasks` in a later release.

/**
 * The measurable claim, if there is one (§4.7's `ProjectOutcome`).
 *
 * `method` is not decoration. "Traffic up 40%" is a number somebody will ask
 * about, and a business that cannot say how it was measured is a business
 * making it up — so the column that holds the answer is beside the one that
 * holds the claim, and C8.01 renders both.
 */
export const projectOutcomes = pgTable(
  "project_outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    value: text("value").notNull(),
    unit: text("unit"),
    method: text("method"),
    position: integer("position").notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("project_outcomes_project_idx").on(t.projectId, t.position),
    check("project_outcomes_label", sql`char_length(${t.label}) between 1 and 120`),
    check("project_outcomes_value", sql`char_length(${t.value}) between 1 and 120`),
  ],
);

export const PROJECT_FILE_ROLES = [
  "hero",
  "gallery",
  "before",
  "after",
  "process",
  "detail",
  "document",
] as const;

/**
 * Ordered media and documents, with before/after pairing (§4.7's `ProjectMedia`).
 *
 * §4.7: "Before/after is a pairing, not two uploads." `pairKey` is what lets a
 * renderer show a slider rather than two pictures side by side, and it has to
 * exist from the first version because retrofitting it means asking an owner
 * to re-upload work they have already filed.
 */
export const projectFiles = pgTable(
  "project_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    role: text("role", { enum: PROJECT_FILE_ROLES }).notNull().default("gallery"),
    /** Ties a `before` to its `after`. Null for everything else. */
    pairKey: text("pair_key"),
    caption: text("caption"),
    position: integer("position").notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("project_files_project_idx").on(t.projectId, t.position),
    uniqueIndex("project_files_unique_idx").on(t.projectId, t.assetId, t.role),
    uniqueIndex("project_files_pair_role_idx")
      .on(t.projectId, t.pairKey, t.role)
      .where(sql`${t.pairKey} is not null`),
    // A pairing needs a key, and a key means nothing on anything else.
    check(
      "project_files_pairing",
      sql`(${t.role} in ('before','after')) = (${t.pairKey} is not null)`,
    ),
  ],
);

export const TESTIMONIAL_STATUSES = ["draft", "published", "withdrawn"] as const;

/**
 * A project quote backed by the Contact spine, never pasted anonymous praise.
 *
 * C8.09 later broadens reviews and display walls. This table is deliberately
 * the narrower proof attached to work: who said it, which work it describes,
 * and the permission that lets the business repeat it publicly.
 */
export const projectTestimonials = pgTable(
  "project_testimonials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    displayName: text("display_name").notNull(),
    role: text("role"),
    body: text("body").notNull(),
    rating: integer("rating"),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
    consentGivenAt: timestamp("consent_given_at", { withTimezone: true }).notNull(),
    consentMethod: text("consent_method", { enum: PROJECT_CONSENT_METHODS }).notNull(),
    consentNote: text("consent_note"),
    status: text("status", { enum: TESTIMONIAL_STATUSES }).notNull().default("draft"),
    displayLocations: text("display_locations")
      .array()
      .notNull()
      .default(sql`ARRAY['project']::text[]`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("project_testimonials_project_idx").on(t.projectId, t.status, t.createdAt),
    index("project_testimonials_contact_idx").on(t.contactId),
    check("project_testimonials_name", sql`char_length(${t.displayName}) between 1 and 200`),
    check("project_testimonials_body", sql`char_length(${t.body}) between 1 and 5000`),
    check(
      "project_testimonials_rating",
      sql`${t.rating} is null or ${t.rating} between 1 and 5`,
    ),
    check(
      "project_testimonials_locations",
      sql`${t.displayLocations} <@ ARRAY['project','service','portfolio']::text[]`,
    ),
    check(
      "project_testimonials_status",
      sql`${t.status} in ('draft','published','withdrawn')`,
    ),
    check(
      "project_testimonials_consent_method",
      sql`${t.consentMethod} in ('contract','email','written','verbal','other')`,
    ),
  ],
);

export const PROJECT_COLLECTION_KINDS = [
  "portfolio",
  "service",
  "industry",
  "season",
] as const;
export const PROJECT_COLLECTION_STATUSES = ["draft", "published"] as const;

/** Curated public grouping: one project may prove several bodies of work. */
export const projectCollections = pgTable(
  "project_collections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    kind: text("kind", { enum: PROJECT_COLLECTION_KINDS }).notNull(),
    description: text("description"),
    coverAssetId: uuid("cover_asset_id").references(() => assets.id, {
      onDelete: "set null",
    }),
    position: integer("position").notNull().default(0),
    publicationStatus: text("publication_status", {
      enum: PROJECT_COLLECTION_STATUSES,
    })
      .notNull()
      .default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /** Untyped CMS page id for the same optional-module reason as Project. */
    publicPageId: uuid("public_page_id"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("project_collections_slug_idx").on(t.slug),
    index("project_collections_public_idx").on(t.publicationStatus, t.position),
    check("project_collections_name", sql`char_length(${t.name}) between 1 and 160`),
    check("project_collections_slug", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check(
      "project_collections_kind",
      sql`${t.kind} in ('portfolio','service','industry','season')`,
    ),
    check(
      "project_collections_status",
      sql`${t.publicationStatus} in ('draft','published')`,
    ),
    check(
      "project_collections_publication_time",
      sql`(${t.publicationStatus} = 'published' and ${t.publishedAt} is not null) or ${t.publicationStatus} = 'draft'`,
    ),
  ],
);

export const projectCollectionItems = pgTable(
  "project_collection_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => projectCollections.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("project_collection_items_unique_idx").on(t.collectionId, t.projectId),
    index("project_collection_items_project_idx").on(t.projectId, t.collectionId),
    index("project_collection_items_order_idx").on(t.collectionId, t.position),
  ],
);
