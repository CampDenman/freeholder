// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
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
