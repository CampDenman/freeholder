// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Consent evidence and privacy-rights workflow (MASTER.md C1.08, §30).
import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { contacts } from "@/core/contacts/schema";
import { assets } from "@/core/media/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

/** Immutable proof of one consent decision; current state is derived history. */
export const consentRecords = pgTable(
  "consent_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    purpose: text("purpose", {
      enum: ["marketing", "analytics", "data_processing"],
    }).notNull(),
    channel: text("channel", {
      enum: ["email", "sms", "push", "web"],
    }),
    state: text("state", {
      enum: ["granted", "denied", "withdrawn"],
    }).notNull(),
    method: text("method", {
      enum: [
        "form",
        "preference_center",
        "double_opt_in",
        "verbal",
        "written",
        "contract",
        "import",
        "system",
      ],
    }).notNull(),
    /** The words presented when consent was collected, by stable version. */
    termsVersion: text("terms_version"),
    sourceUrl: text("source_url"),
    /** Evidence supplied by the trusted request boundary, never by form JSON. */
    ip: text("ip"),
    evidence: jsonb("evidence").notNull().default({}),
    actor: text("actor").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("consent_records_contact_idx").on(t.contactId, t.occurredAt),
    index("consent_records_effective_idx").on(
      t.contactId,
      t.purpose,
      t.channel,
      t.occurredAt,
    ),
    check(
      "consent_records_purpose",
      sql`${t.purpose} in ('marketing', 'analytics', 'data_processing')`,
    ),
    check(
      "consent_records_purpose_channel",
      sql`(${t.purpose} = 'marketing' and ${t.channel} in ('email', 'sms', 'push'))
        or (${t.purpose} = 'analytics' and ${t.channel} = 'web')
        or (${t.purpose} = 'data_processing' and ${t.channel} is null)`,
    ),
    check(
      "consent_records_state",
      sql`${t.state} in ('granted', 'denied', 'withdrawn')`,
    ),
    check(
      "consent_records_method",
      sql`${t.method} in ('form', 'preference_center', 'double_opt_in', 'verbal', 'written', 'contract', 'import', 'system')`,
    ),
    check(
      "consent_records_expiry_after_event",
      sql`${t.expiresAt} is null or ${t.expiresAt} > ${t.occurredAt}`,
    ),
  ],
);

/** A verified, deadline-bearing request rather than an unaudited inbox note. */
export const dataRequests = pgTable(
  "data_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["access", "export", "correction", "erasure"],
    }).notNull(),
    status: text("status", {
      enum: [
        "submitted",
        "verified",
        "in_progress",
        "completed",
        "partially_completed",
        "denied",
        "cancelled",
      ],
    })
      .notNull()
      .default("submitted"),
    jurisdiction: text("jurisdiction"),
    details: jsonb("details").notNull().default({}),
    requestedBy: text("requested_by").notNull(),
    verificationMethod: text("verification_method"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    responseDueAt: timestamp("response_due_at", { withTimezone: true })
      .notNull(),
    resolution: text("resolution"),
    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("data_requests_contact_idx").on(t.contactId, t.createdAt),
    index("data_requests_status_due_idx").on(t.status, t.responseDueAt),
    check(
      "data_requests_kind",
      sql`${t.kind} in ('access', 'export', 'correction', 'erasure')`,
    ),
    check(
      "data_requests_status",
      sql`${t.status} in ('submitted', 'verified', 'in_progress', 'completed', 'partially_completed', 'denied', 'cancelled')`,
    ),
    check(
      "data_requests_verified_state",
      sql`${t.status} not in ('verified', 'in_progress', 'completed', 'partially_completed') or ${t.verifiedAt} is not null`,
    ),
    check(
      "data_requests_fulfilled_state",
      sql`${t.status} not in ('completed', 'partially_completed', 'denied') or ${t.fulfilledAt} is not null`,
    ),
  ],
);

/** A protected, checksum-backed JSON file delivered through authenticated code. */
export const dataRequestArtifacts = pgTable(
  "data_request_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dataRequestId: uuid("data_request_id")
      .notNull()
      .references(() => dataRequests.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mime: text("mime").notNull().default("application/json"),
    body: jsonb("body").notNull(),
    sha256: text("sha256").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastDownloadedAt: timestamp("last_downloaded_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("data_request_artifacts_request_idx").on(t.dataRequestId),
    index("data_request_artifacts_expiry_idx").on(t.expiresAt),
    check(
      "data_request_artifacts_sha256_length",
      sql`length(${t.sha256}) = 64`,
    ),
    check(
      "data_request_artifacts_expiry_after_creation",
      sql`${t.expiresAt} > ${t.createdAt}`,
    ),
  ],
);


export const MEDIA_CONSENT_STATES = ["granted", "withdrawn"] as const;
export const MEDIA_CONSENT_METHODS = [
  "contract",
  "form",
  "email",
  "written",
  "verbal",
  "other",
] as const;
export const MEDIA_CONSENT_SURFACES = [
  "project",
  "portfolio",
  "service",
  "social",
  "advertising",
] as const;

/**
 * Permission to publish media of an identifiable person or their property
 * (MASTER.md §4.18, C8.16).
 *
 * The same shape `consent_records` uses above, and for the same reason:
 * immutable proof of one decision, with the current state derived from the
 * history. A withdrawal is a *new row*, never an edit — which matters more
 * here than almost anywhere, because "we published lawfully from March until
 * they asked us to stop in September" is precisely the record a clinic or a
 * surgeon needs to keep, and an implementation that clears the old columns
 * destroys the evidence at the exact moment it starts mattering.
 *
 * Scoped to the work it covers rather than to the person as a whole. Somebody
 * who agreed to one before-and-after has not agreed to every photograph of
 * them the business will ever hold, and a model that cannot express that
 * difference will eventually be used as though they had.
 */
export const mediaConsents = pgTable(
  "media_consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    /** What it covers: `project` and the project id. */
    subjectKind: text("subject_kind").notNull(),
    subjectId: uuid("subject_id").notNull(),
    state: text("state", { enum: MEDIA_CONSENT_STATES }).notNull(),
    method: text("method", { enum: MEDIA_CONSENT_METHODS }).notNull(),
    /** Where it may appear. A grant for a portfolio is not a grant for ads. */
    surfaces: text("surfaces").array().notNull().default(sql`ARRAY['project']::text[]`),
    note: text("note"),
    /** The signed form, where there is one. Provenance for the permission. */
    evidenceAssetId: uuid("evidence_asset_id").references(() => assets.id, {
      onDelete: "set null",
    }),
    /** When the decision took effect. Not when somebody typed it in. */
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    /**
     * When a grant lapses, if it was given for a period.
     *
     * Consent with an end date is normal in this domain and unrepresentable
     * without a column for it — and consent that has quietly lapsed reads
     * exactly like consent that still holds, which is the failure worth
     * designing against.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /**
     * Who recorded it: `user:<id>`, `agent:<key-name>`, or `system`.
     *
     * Text rather than a users foreign key, following `audit_log`: an actor is
     * not always a person, and typing the column uuid would assert something
     * untrue of every fact an agent or a scheduled job records.
     */
    recordedBy: text("recorded_by"),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index("media_consents_subject_idx").on(
      t.subjectKind,
      t.subjectId,
      t.effectiveAt,
    ),
    index("media_consents_contact_idx").on(t.contactId, t.effectiveAt),
    check(
      "media_consents_expiry_after_effective",
      sql`${t.expiresAt} is null or ${t.expiresAt} > ${t.effectiveAt}`,
    ),
    // A withdrawal does not expire; only a grant has a period.
    check(
      "media_consents_withdrawal_has_no_expiry",
      sql`${t.state} <> 'withdrawn' or ${t.expiresAt} is null`,
    ),
    check(
      "media_consents_surfaces",
      sql`${t.surfaces} <@ ARRAY['project','portfolio','service','social','advertising']::text[]`,
    ),
    check("media_consents_surfaces_present", sql`array_length(${t.surfaces}, 1) >= 1`),
  ],
);

/** A named reason to retain one scope while fulfilling an erasure request. */
export const privacyRetentionExceptions = pgTable(
  "privacy_retention_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dataRequestId: uuid("data_request_id")
      .notNull()
      .references(() => dataRequests.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    reason: text("reason", {
      enum: [
        "legal_obligation",
        "legal_claim",
        "contractual_obligation",
        "accounting_tax",
        "security_fraud",
      ],
    }).notNull(),
    legalBasis: text("legal_basis").notNull(),
    notes: text("notes"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("privacy_retention_exceptions_scope_idx").on(
      t.dataRequestId,
      t.scope,
    ),
    index("privacy_retention_exceptions_expiry_idx").on(t.expiresAt),
    check(
      "privacy_retention_exceptions_reason",
      sql`${t.reason} in ('legal_obligation', 'legal_claim', 'contractual_obligation', 'accounting_tax', 'security_fraud')`,
    ),
    check(
      "privacy_retention_exceptions_expiry_after_creation",
      sql`${t.expiresAt} is null or ${t.expiresAt} > ${t.createdAt}`,
    ),
  ],
);
