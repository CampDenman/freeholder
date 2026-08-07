// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Forms and their submissions (MASTER.md §4.6, §36).
//
// A form is a *definition* — its fields are rows in jsonb, not code — for the
// same reason a page's blocks are (§32). An owner adding a "how did you hear
// about us?" question is a database write, not a deploy.
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";
import { contacts } from "@/core/contacts/schema";

export const forms = pgTable(
  "forms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [uniqueIndex("forms_slug_idx").on(t.slug)],
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
    data: jsonb("data").notNull().default({}),
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
