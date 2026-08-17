// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Contribution channel (MASTER.md §4.8, C1.30–C1.33).
//
// Owners and their agents compose a report on any instance. Nothing is sent
// until they submit. The default hub is freeholder.ai, which is just another
// instance with ingest enabled. This is not the update check: no identity
// leaves the box unless a person or a scoped agent asked.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { contacts } from "@/core/contacts/schema";
import { assets } from "@/core/media/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const CONTRIBUTE_KINDS = [
  "bug",
  "feature",
  "patch",
  "docs",
  "question",
] as const;

export const CONTRIBUTE_STATUSES = [
  "draft",
  "queued",
  "delivered",
  "received",
  "triage",
  "needs_info",
  "accepted",
  "duplicate",
  "wontfix",
  "shipped",
] as const;

export const CONTRIBUTE_SOURCES = [
  "admin",
  "mcp",
  "http",
  "public_form",
  "spoke",
] as const;

export const CONTRIBUTE_ASSET_ROLES = [
  "screenshot",
  "diff",
  "archive",
  "other",
] as const;

/** One row. Hub ingest is off until an operator turns it on. */
export const contributeSettings = pgTable(
  "contribute_settings",
  {
    id: integer("id").primaryKey().default(1),
    hubEnabled: boolean("hub_enabled").notNull().default(false),
    /**
     * Where this instance delivers a submitted report. Empty means file
     * locally only. The product default is https://freeholder.ai.
     */
    hubUrl: text("hub_url").notNull().default("https://freeholder.ai"),
    /** Shared HMAC secret for signed spoke deliveries. Null = unsigned ingest. */
    receiveSecret: text("receive_secret"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [check("contribute_settings_singleton", sql`${t.id} = 1`)],
);

export const contributions = pgTable(
  "contributions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    kind: text("kind", { enum: CONTRIBUTE_KINDS }).notNull(),
    status: text("status", { enum: CONTRIBUTE_STATUSES }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    locale: text("locale").notNull().default("en"),
    source: text("source", { enum: CONTRIBUTE_SOURCES }).notNull(),
    reporterEmail: text("reporter_email"),
    reporterName: text("reporter_name"),
    externalUrl: text("external_url"),
    hubReceiptId: uuid("hub_receipt_id"),
    contentHash: text("content_hash").notNull(),
    includeDoctor: boolean("include_doctor").notNull().default(false),
    doctorReport: jsonb("doctor_report"),
    platformVersion: text("platform_version"),
    dcoAttested: boolean("dco_attested").notNull().default(false),
    dcoSigner: text("dco_signer"),
    checklistId: text("checklist_id"),
    parentId: uuid("parent_id"),
    actor: text("actor").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("contributions_contact_idx").on(t.contactId),
    index("contributions_status_idx").on(t.status, t.createdAt),
    index("contributions_kind_idx").on(t.kind, t.createdAt),
    index("contributions_hash_idx").on(t.contentHash),
    check(
      "contributions_title_len",
      sql`char_length(${t.title}) between 1 and 200`,
    ),
    check(
      "contributions_body_len",
      sql`char_length(${t.body}) between 1 and 20000`,
    ),
  ],
);

export const contributionAssets = pgTable(
  "contribution_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contributionId: uuid("contribution_id")
      .notNull()
      .references(() => contributions.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    role: text("role", { enum: CONTRIBUTE_ASSET_ROLES }).notNull().default("other"),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("contribution_assets_unique_idx").on(t.contributionId, t.assetId),
    index("contribution_assets_contribution_idx").on(t.contributionId),
  ],
);

export const contributionEvents = pgTable(
  "contribution_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contributionId: uuid("contribution_id")
      .notNull()
      .references(() => contributions.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    body: text("body"),
    actor: text("actor").notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [index("contribution_events_contribution_idx").on(t.contributionId, t.createdAt)],
);
