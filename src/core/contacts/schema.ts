// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The Contact Spine (MASTER.md §2 principle 3, §4.1). Contact is the center
// of gravity: every module references contact_id, and anything notable that
// happens to a contact lands in timeline_events — the append-only integration
// contract between modules. custom_fields is jsonb by design (§8): genuinely
// owner-defined schemaless data, with generated columns when a field gets hot.
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
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    domain: text("domain"),
    customFields: jsonb("custom_fields").notNull().default({}),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("organizations_domain_idx").on(t.domain),
    index("organizations_name_search_idx").using(
      "gin",
      t.name.op("gin_trgm_ops"),
    ),
    index("organizations_domain_search_idx").using(
      "gin",
      t.domain.op("gin_trgm_ops"),
    ),
  ],
);

/** Owner-authored schema for the deliberately schemaless JSONB value maps. */
export const customFieldDefinitions = pgTable(
  "custom_field_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entity: text("entity", { enum: ["contact", "organization"] }).notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    kind: text("kind", {
      enum: ["text", "number", "boolean", "date", "select"],
    }).notNull(),
    helpText: text("help_text"),
    options: text("options").array().notNull().default([]),
    position: integer("position").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("custom_field_definitions_entity_key_idx").on(t.entity, t.key),
    index("custom_field_definitions_order_idx").on(t.entity, t.active, t.position),
  ],
);

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
    /** Carrier-observed reachability for the current `phone` value. */
    phoneStatus: text("phone_status", { enum: ["unknown", "valid", "invalid"] })
      .notNull()
      .default("unknown"),
    phoneInvalidAt: timestamp("phone_invalid_at", { withTimezone: true }),
    phoneInvalidReason: text("phone_invalid_reason"),
    phoneInvalidProviderCode: text("phone_invalid_provider_code"),
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
    index("contacts_tags_idx").using("gin", t.tags),
    index("contacts_name_search_idx").using("gin", t.name.op("gin_trgm_ops")),
    index("contacts_email_search_idx").using(
      "gin",
      t.email.op("gin_trgm_ops"),
    ),
    index("contacts_normalized_name_idx").on(
      sql`regexp_replace(lower(trim(${t.name})), '[[:space:]]+', ' ', 'g')`,
    ),
    index("contacts_normalized_phone_idx").on(
      sql`(case
        when regexp_replace(${t.phone}, '[^0-9]', '', 'g') ~ '^1[0-9]{10}$'
          then substring(regexp_replace(${t.phone}, '[^0-9]', '', 'g') from 2)
        else regexp_replace(${t.phone}, '[^0-9]', '', 'g')
      end)`,
    ),
    check(
      "contacts_phone_state_consistent",
      sql`(${t.phoneStatus} = 'invalid' and ${t.phoneInvalidAt} is not null)
        or (${t.phoneStatus} <> 'invalid' and ${t.phoneInvalidAt} is null
          and ${t.phoneInvalidReason} is null and ${t.phoneInvalidProviderCode} is null)`,
    ),
    check(
      "contacts_phone_status_allowed",
      sql`${t.phoneStatus} in ('unknown', 'valid', 'invalid')`,
    ),
  ],
);

/** A typed, auditable edge between two identities on the Contact spine. */
export const contactRelationships = pgTable(
  "contact_relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromContactId: uuid("from_contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    toContactId: uuid("to_contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["household", "employer", "referred_by", "partner", "guardian", "contact_book"],
    }).notNull(),
    since: date("since", { mode: "string" }),
    notes: text("notes"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("contact_relationships_edge_idx").on(
      t.fromContactId,
      t.toContactId,
      t.kind,
    ),
    index("contact_relationships_to_idx").on(t.toContactId),
    check(
      "contact_relationships_not_self",
      sql`${t.fromContactId} <> ${t.toContactId}`,
    ),
  ],
);

/** A human-reviewable suspicion, never permission to merge automatically. */
export const mergeCandidates = pgTable(
  "merge_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactAId: uuid("contact_a_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    contactBId: uuid("contact_b_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    contactAName: text("contact_a_name").notNull(),
    contactAEmail: text("contact_a_email"),
    contactBName: text("contact_b_name").notNull(),
    contactBEmail: text("contact_b_email"),
    score: integer("score").notNull(),
    /** [{ code, points, value? }] — translated by each human surface. */
    reasons: jsonb("reasons").notNull().default([]),
    status: text("status", { enum: ["open", "dismissed", "merged"] })
      .notNull()
      .default("open"),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("merge_candidates_pair_idx").on(t.contactAId, t.contactBId),
    index("merge_candidates_a_idx").on(t.contactAId),
    index("merge_candidates_b_idx").on(t.contactBId),
    index("merge_candidates_status_score_idx").on(t.status, t.score),
  ],
);

/** The evidence needed for a conservative, conflict-checked merge undo. */
export const contactMergeOperations = pgTable(
  "contact_merge_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id").references(() => mergeCandidates.id, {
      onDelete: "set null",
    }),
    survivingContactId: uuid("surviving_contact_id").notNull(),
    duplicateContactId: uuid("duplicate_contact_id").notNull(),
    survivorBefore: jsonb("survivor_before").notNull(),
    duplicateBefore: jsonb("duplicate_before").notNull(),
    survivorAfter: jsonb("survivor_after").notNull(),
    referenceState: jsonb("reference_state").notNull().default([]),
    undoable: boolean("undoable").notNull().default(true),
    undoBlockers: text("undo_blockers").array().notNull().default([]),
    mergedAt: timestamp("merged_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
  },
  (t) => [
    index("contact_merge_operations_candidate_idx").on(t.candidateId),
    index("contact_merge_operations_survivor_idx").on(
      t.survivingContactId,
      t.mergedAt,
    ),
    index("contact_merge_operations_merged_at_idx").on(t.mergedAt),
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

/**
 * Short-lived proof that the current holder controls a contact's email.
 * Linking the Contact to a User happens only when this proof is consumed.
 */
export const customerMagicLinks = pgTable(
  "customer_magic_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    /** Anonymous explicit choice, made canonical only after token proof. */
    locale: text("locale"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("customer_magic_links_token_idx").on(t.tokenHash),
    index("customer_magic_links_contact_expiry_idx").on(t.contactId, t.expiresAt),
  ],
);
