// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Agreements that need a signature (MASTER.md §4.3's `Contract`, C6.09).
//
// The rule that shapes every column here: **a signed document is evidence, and
// evidence does not change.** What somebody agreed to is `bodySnapshot` — the
// text as it stood at the moment they read it — not a pointer to a template
// somebody may edit next week. A reference would mean the business could
// rewrite an agreement after it was signed and nobody could tell, which is the
// one thing an e-signature exists to prevent.
//
// So the body is copied, hashed, and never touched again; the signature
// records who, when, from where and with what; and the hash lets anybody prove
// later that the two still match.
//
// C6.14 adds the authoring half — templates, variables, countersignature,
// export. It renders into `bodySnapshot` rather than replacing it: the
// snapshot is the seam, and it is deliberately the half that shipped first.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const CONTRACT_KINDS = ["waiver", "agreement"] as const;

/**
 * A reusable document an owner writes once (§4.3's `template_id`, C6.14).
 *
 * Templates are **versioned rather than edited in place**, for the same reason
 * a quote is (C6.12): an issued document points at the version it came from,
 * and an owner tightening their terms next month must not change what that
 * points to. Editing publishes a new version; the old one stays readable
 * because documents issued from it still name it.
 */
export const contractTemplates = pgTable(
  "contract_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    kind: text("kind", { enum: CONTRACT_KINDS }).notNull().default("waiver"),
    version: integer("version").notNull().default(1),
    title: text("title").notNull(),
    /** The words, with `{{variables}}` the renderer substitutes. */
    body: text("body").notNull(),
    /** What each variable means, and what to put there when nothing supplies it. */
    variables: jsonb("variables").notNull().default(sql`'[]'::jsonb`),
    /**
     * Whether a person on the business's side signs too.
     *
     * Countersignature is not decoration: a mutual agreement that only one
     * party signed is not an agreement, and which documents need it is the
     * owner's call rather than the platform's.
     */
    requiresCountersignature: boolean("requires_countersignature")
      .notNull()
      .default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("contract_templates_name_version_idx").on(t.name, t.version),
    index("contract_templates_kind_idx").on(t.kind, t.archivedAt),
    check("contract_templates_version", sql`${t.version} > 0`),
    check("contract_templates_name", sql`char_length(${t.name}) between 1 and 120`),
    check("contract_templates_body", sql`char_length(${t.body}) > 0`),
  ],
);
export const CONTRACT_STATUSES = ["issued", "signed", "declined", "void"] as const;

export const contractDocuments = pgTable(
  "contract_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    /**
     * What this document is attached to, untyped by a foreign key.
     *
     * A waiver hangs off a booking, an agreement will hang off a quote (C6.12)
     * or a project (C6.15), and contracts is a module that may not depend on
     * any of them. The pair is the join; the service that issues the document
     * is what checks the subject exists.
     */
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id"),
    /** The template version this was rendered from, when it came from one. */
    templateId: uuid("template_id").references(() => contractTemplates.id, {
      onDelete: "set null",
    }),
    kind: text("kind", { enum: CONTRACT_KINDS }).notNull().default("waiver"),
    title: text("title").notNull(),
    /** The words they read. Copied at issue, never edited afterwards. */
    bodySnapshot: text("body_snapshot").notNull(),
    /** SHA-256 of `bodySnapshot`, so a later reader can prove it is unchanged. */
    bodyHash: text("body_hash").notNull(),
    status: text("status", { enum: CONTRACT_STATUSES }).notNull().default("issued"),
    /** Signed, so somebody signs without an account (§4.4's no-login rule). */
    signToken: text("sign_token"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    /** Typed by the signer, not taken from the contact — that is the act. */
    signerName: text("signer_name"),
    signerEmail: text("signer_email"),
    signerIp: text("signer_ip"),
    signerUserAgent: text("signer_user_agent"),
    /**
     * SHA-256 over the body hash and every identifying fact of the signature.
     *
     * One value that changes if *anything* about the signing changes, so a
     * dispute is settled by recomputing rather than by trusting the row.
     */
    signatureHash: text("signature_hash"),
    declineReason: text("decline_reason"),
    /**
     * The business's own signature, where the template asks for one (C6.14).
     *
     * A mutual agreement that only one party signed is not an agreement. The
     * document is not *complete* until both are on it, which is why this is a
     * separate set of columns rather than a second row in the same shape: the
     * countersignature belongs to this document, not beside it.
     */
    countersignedAt: timestamp("countersigned_at", { withTimezone: true }),
    countersignerUserId: uuid("countersigner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    countersignerName: text("countersigner_name"),
    countersignatureHash: text("countersignature_hash"),
    /** Set from the template at issue, so the document knows its own rules. */
    requiresCountersignature: boolean("requires_countersignature")
      .notNull()
      .default(false),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("contract_documents_contact_idx").on(t.contactId),
    index("contract_documents_subject_idx").on(t.subjectType, t.subjectId),
    index("contract_documents_status_idx").on(t.status),
    uniqueIndex("contract_documents_sign_token_idx")
      .on(t.signToken)
      .where(sql`${t.signToken} is not null`),
    check(
      "contract_documents_title_valid",
      sql`char_length(${t.title}) between 1 and 200`,
    ),
    check("contract_documents_body_present", sql`char_length(${t.bodySnapshot}) > 0`),
    // A signed document without a time or a hash is not evidence of anything,
    // and a row that claims to be signed without them is the shape a bug
    // leaves. `signerName` is deliberately **not** here: erasure (§30) removes
    // the person and keeps the business's evidence, so a signed row with no
    // name is a legitimate end state rather than a broken one. The name is
    // required at the moment of signing, by the service, where it belongs.
    check(
      "contract_documents_signed_complete",
      sql`${t.status} <> 'signed'
        or (${t.signedAt} is not null and ${t.signatureHash} is not null)`,
    ),
  ],
);
