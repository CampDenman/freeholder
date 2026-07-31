// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// The Contact Spine (MASTER.md §2 principle 3, §4.1). Contact is the center
// of gravity: every module references contact_id, and anything notable that
// happens to a contact lands in timeline_events — the append-only integration
// contract between modules. custom_fields is jsonb by design (§8): genuinely
// owner-defined schemaless data, with generated columns when a field gets hot.
import {
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

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  domain: text("domain"),
  customFields: jsonb("custom_fields").notNull().default({}),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Nullable 1:1 — a contact may never log in; a login may serve staff only. */
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    orgId: uuid("org_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    /** Where this contact came from: form slug, import, manual, referral code… */
    source: text("source"),
    tags: text("tags").array().notNull().default([]),
    customFields: jsonb("custom_fields").notNull().default({}),
    lifecycleStage: text("lifecycle_stage", {
      enum: ["lead", "prospect", "customer", "repeat"],
    })
      .notNull()
      .default("lead"),
    /** BCP-47. Customer-facing everything follows this (§4.9). */
    preferredLocale: text("preferred_locale"),
    timezone: text("timezone"),
    /** ISO-3166-1 alpha-2. Tax follows location, not locale (§4.9). */
    country: text("country"),
    ownerNotes: text("owner_notes"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("contacts_user_id_idx").on(t.userId),
    index("contacts_org_id_idx").on(t.orgId),
    // One contact per email address — the spine's identity rule (§2 principle
    // 3), enforced by the database rather than by every caller remembering.
    // Postgres permits many NULLs in a unique index, so contacts without an
    // email (walk-ins, phone-only leads) are unaffected. Addresses are
    // lowercased by the service layer before they ever reach this column.
    uniqueIndex("contacts_email_idx").on(t.email),
    index("contacts_lifecycle_stage_idx").on(t.lifecycleStage),
  ],
);

export const timelineEvents = pgTable(
  "timeline_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    /** Who did it: "user:<id>", "agent:<key-name>", or "system". */
    actor: text("actor").notNull(),
    /** Dotted past-tense verb: "contact.created", "quote.sent", "invoice.paid"… */
    eventType: text("event_type").notNull(),
    subjectType: text("subject_type").notNull(),
    /** Polymorphic like audit_log.subject_id — see that column. */
    subjectId: text("subject_id"),
    payload: jsonb("payload").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("timeline_events_contact_id_idx").on(t.contactId, t.occurredAt),
    index("timeline_events_subject_idx").on(t.subjectType, t.subjectId),
  ],
);
