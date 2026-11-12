// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Forms and their submissions (MASTER.md §4.6, §36).
//
// A form is a *definition* — its fields are rows in jsonb, not code — for the
// same reason a page's blocks are (§32). An owner adding a "how did you hear
// about us?" question is a database write, not a deploy.
import { sql } from "drizzle-orm";
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
import { dataRequests } from "@/core/privacy/schema";
import { contacts } from "@/core/contacts/schema";
import { assets } from "@/core/media/schema";

/** What an intake form opens (C3.37). Validated by `intakeSchema` in service.ts. */
export interface FormIntake {
  projectTitle: string;
}

export const forms = pgTable(
  "forms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Set = in trash (C11.14). Only the definition goes: submissions stay
     * live, because they are evidence of what somebody told the business.
     */
    trashedAt: timestamp("trashed_at", { withTimezone: true }),
    /** Stable handle a block points at, so renaming a form keeps pages working. */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** Field definitions — see fields.ts for the schema they are parsed with. */
    fields: jsonb("fields").notNull().default([]),
    submitLabel: text("submit_label"),
    successMessage: text("success_message"),
    /**
     * What a submission does to the spine.
     *
     * `contact` resolves the submitter into a Contact (§4.1's identity rule);
     * `none` stores the submission alone, for the survey that should not
     * quietly build a mailing list.
     */
    destination: text("destination", { enum: ["contact", "none"] })
      .notNull()
      .default("contact"),
    /** Addresses to notify. Empty means nobody is told, which is a choice. */
    notify: text("notify").array().notNull().default([]),
    status: text("status", { enum: ["active", "closed"] })
      .notNull()
      .default("active"),
    /**
     * Set = an intake form (C3.37): each accepted submission opens a project
     * for the person who sent it, titled from `projectTitle` (`{name}` and
     * any other field key are filled from the answers). Null is an ordinary
     * form. Kept as a small document because it is configuration of the
     * form, not a fact about any one submission.
     */
    intake: jsonb("intake").$type<FormIntake | null>(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("forms_slug_idx").on(t.slug),
    index("forms_trash_idx").on(t.trashedAt).where(sql`${t.trashedAt} is not null`),
  ],
);

export const formSubmissions = pgTable(
  "form_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    /**
     * Null when the form does not resolve contacts, or when the submitter gave
     * no email. A submission is kept either way — throwing away what somebody
     * typed because it does not fit the CRM is the wrong trade.
     */
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    data: jsonb("submitted_data").notNull().default({}),
    sourceUrl: text("source_url"),
    /**
     * §36 wants a quarantine queue rather than a bin. A false positive that
     * silently discards a real enquiry is worse than the spam it prevented,
     * so suspected spam is stored, flagged, and reviewable.
     */
    status: text("status", { enum: ["received", "spam"] })
      .notNull()
      .default("received"),
    /** Which trap fired, for an owner deciding whether to trust the verdict. */
    spamReasons: text("spam_reasons").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("form_submissions_form_idx").on(t.formId, t.createdAt),
    index("form_submissions_contact_idx").on(t.contactId),
    index("form_submissions_status_idx").on(t.status),
  ],
);

/**
 * A file answer's link to the private asset it became (C3.38).
 *
 * The answer itself lives in `form_submissions.data` as {assetId, filename,
 * bytes, mime}; this row is what makes it *one* attachment. The unique asset
 * index is the reuse refusal — a file uploaded for one submission cannot be
 * attached to a second, by the same person or anyone else — and it is how
 * the owner opens the file from the submission without a public URL.
 *
 * No contact column: the person is the submission's contact, so a merge or an
 * erasure reaches these rows through their submission.
 */
export const formSubmissionFiles = pgTable(
  "form_submission_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => formSubmissions.id, { onDelete: "cascade" }),
    fieldKey: text("field_key").notNull(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("form_submission_files_asset_idx").on(t.assetId),
    uniqueIndex("form_submission_files_field_idx").on(t.submissionId, t.fieldKey),
  ],
);

/** C3.34/C11.08: original provider intent, independent of event retries. */
export type LeadCopyAttempt = {
  id: string; attempt: number; observed: "running" | "unknown" | "copied" | "not_copied";
  humanOutcome?: "copied" | "not_copied"; reviewDigest?: string;
  reviewHistory?: Array<{ outcome: "copied" | "not_copied"; digest: string }>;
  responseDigest?: string; providerRef?: string; httpStatus?: number;
};
export const formLeadCopies = pgTable("form_lead_copies", {
  id: uuid("id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id").references(() => formSubmissions.id, { onDelete: "set null" }),
  kind: text("kind", { enum: ["site_notice", "legacy_review"] }).notNull(),
  provider: text("provider").notNull().default("paradise"),
  originalBaseUrl: text("original_base_url"),
  resourceDigest: text("resource_digest"),
  requestDigest: text("request_digest"),
  noticeDigest: text("notice_digest"),
  encryptedRequest: text("encrypted_request"),
  state: text("state", { enum: ["ready", "running", "unknown", "copied", "not_copied", "cancelled"] }).notNull(),
  attempts: jsonb("attempts").$type<LeadCopyAttempt[]>().notNull().default([]),
  admittedAttempt: integer("admitted_attempt").notNull().default(1),
  revision: integer("revision").notNull().default(0),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  remoteErasedAt: timestamp("remote_erased_at", { withTimezone: true }),
  remoteErasureDigest: text("remote_erasure_digest"),
  privacyPending: boolean("privacy_pending").notNull().default(false),
  lastReconciledAt: timestamp("last_reconciled_at", { withTimezone: true }),
  legacyOutcome: text("legacy_outcome", { enum: ["copied", "not_copied"] }),
  legacyReviews: jsonb("legacy_reviews").$type<Array<{ outcome: "copied" | "not_copied"; digest: string }>>().notNull().default([]),
  erasureRequests: jsonb("erasure_requests").$type<string[]>().notNull().default([]),
  erasureRequestId: uuid("erasure_request_id").references(() => dataRequests.id, { onDelete: "restrict" }),
  reviewDigest: text("review_digest"),
  providerRef: text("provider_ref"),
  providerRefDigest: text("provider_ref_digest"),
  lastError: text("last_error"),
  createdAt: createdAtColumn(), updatedAt: updatedAtColumn(),
}, t => [uniqueIndex("form_lead_copies_submission_idx").on(t.submissionId), index("form_lead_copies_state_idx").on(t.state, t.createdAt), index("form_lead_copies_privacy_idx").on(t.lastReconciledAt.asc().nullsFirst(), t.id).where(sql`${t.privacyPending}`)]);
