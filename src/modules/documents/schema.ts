// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Documents shared with a client, and their history (MASTER.md §4.5, C8.13).
//
// §4.5 states the rule this schema is shaped by: "A document is revised, not
// replaced. Uploading a new file against a document writes a
// `DocumentVersion`; it never overwrites the last one."
//
// So there is no `asset_id` on `documents`. The bytes live on a version, the
// document is the name and the thread, and "which version did they actually
// sign" is answerable because nothing here can overwrite an answer.
//
// The other rule is about not inventing a second security model: "Documents
// reuse the gallery access vocabulary deliberately." `link`, `password` and
// `login`, a stated `expires_at`, and an append-only access log — the same
// words, the same shapes, and the same `hashPassword`/HMAC split that
// `galleries/tokens.ts` explains.
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { contacts } from "@/core/contacts/schema";
import { assets } from "@/core/media/schema";
import { users } from "@/core/auth/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const DOCUMENT_ACCESS_MODES = ["link", "password", "login"] as const;
export const DOCUMENT_DOWNLOAD_POLICIES = ["none", "view", "download"] as const;
export const DOCUMENT_ACCESS_ACTIONS = ["view", "download", "denied"] as const;

/**
 * A named file shared with somebody, with a history (§4.5).
 *
 * `subjectType` + `subjectId` are polymorphic and carry no foreign key, the
 * same shape `ContentUnlock` uses in §4.3. That is what lets a document hang
 * off a project, a quote or an invoice while this module requires only core:
 * a real reference would make documents unbootable on an instance with no
 * projects module, which is exactly the business that most needs somewhere to
 * put a signed contract.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    description: text("description"),
    /** "project", "quote", "invoice", "contact" — or null for a loose file. */
    subjectType: text("subject_type"),
    subjectId: uuid("subject_id"),
    /**
     * Who the document is *for*, which is not the same as what it is about.
     * A floor plan is about a project and for the client on it, and only the
     * second question decides whose portal it appears in.
     */
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "cascade",
    }),
    /**
     * The newest version. Denormalised because every list of documents shows
     * "last updated" and resolving that through a max() per row is the query
     * that makes a documents screen slow at exactly the point an owner has
     * enough documents to need the screen.
     *
     * No foreign key: versions reference documents, and a reference back would
     * be a cycle that neither table could be inserted into first.
     */
    currentVersionId: uuid("current_version_id"),
    status: text("status", { enum: ["draft", "shared", "archived"] })
      .notNull()
      .default("draft"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("documents_contact_idx").on(t.contactId, t.status),
    index("documents_subject_idx").on(t.subjectType, t.subjectId),
    index("documents_status_idx").on(t.status, t.updatedAt),
  ],
);

/**
 * One revision. Immutable once written (§4.5).
 *
 * There is deliberately no `updatedAt` and no service that edits a row here.
 * A version that could be changed after the fact answers "what did we send
 * them in March" with whatever somebody typed last, which is worse than not
 * answering — it is a confident wrong answer in a dispute.
 */
export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /** 1-based and contiguous, because "version 3" is what people say. */
    version: integer("version").notNull(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    /** What changed, in the owner's words. */
    note: text("note"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    // One row per version number per document. Two clients told about
    // different "version 2" documents is the failure this forecloses, and
    // under concurrent uploads only the index can.
    uniqueIndex("document_versions_number_idx").on(t.documentId, t.version),
    index("document_versions_document_idx").on(t.documentId, t.createdAt),
  ],
);

/**
 * Who may open it, how, and until when (§4.5).
 *
 * `pinnedVersionId` is the field that earns this table. §4.5: "a share either
 * follows the current version or is pinned to the one it was sent about —
 * pinned is what a countersigned contract needs, current is what a working
 * drawing needs, and guessing between them is how somebody signs the wrong
 * page."
 */
export const documentShares = pgTable(
  "document_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /** Null for a link anybody holding the token may open. */
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "cascade",
    }),
    access: text("access", { enum: DOCUMENT_ACCESS_MODES }).notNull(),
    /**
     * scrypt of the password. Null unless access is `password`.
     *
     * Not an HMAC, for the reason `galleries/tokens.ts` gives about PINs: a
     * password is a dictionary, and an HMAC of one is a document that opens
     * from a dumped hash.
     */
    secretHash: text("secret_hash"),
    /** HMAC of high-entropy random. Null when access is `login`. */
    tokenHash: text("token_hash"),
    /** Null means "whatever is current", which is a decision, not a default. */
    pinnedVersionId: uuid("pinned_version_id").references(
      () => documentVersions.id,
      { onDelete: "set null" },
    ),
    downloadPolicy: text("download_policy", { enum: DOCUMENT_DOWNLOAD_POLICIES })
      .notNull()
      .default("download"),
    /** Null means unlimited. Zero would mean "none", which is a policy. */
    downloadLimit: integer("download_limit"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /**
     * Revoked rather than deleted. "We took that back on the 4th" is a fact
     * somebody may need to prove, and a deleted row proves nothing.
     */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("document_shares_token_idx")
      .on(t.tokenHash)
      .where(sql`${t.tokenHash} is not null`),
    index("document_shares_document_idx").on(t.documentId),
    index("document_shares_contact_idx").on(t.contactId),
    // A password share with no password, or a link share with no token, is a
    // document that either cannot be opened or opens to anybody. Both are
    // configuration mistakes worth refusing at the column rather than
    // discovering from a client.
    check(
      "document_shares_secret",
      sql`(${t.access} = 'password' and ${t.secretHash} is not null) or (${t.access} <> 'password' and ${t.secretHash} is null)`,
    ),
    check(
      "document_shares_token",
      sql`(${t.access} = 'login' and ${t.tokenHash} is null) or (${t.access} <> 'login' and ${t.tokenHash} is not null)`,
    ),
    check(
      "document_shares_limit",
      sql`${t.downloadLimit} is null or ${t.downloadLimit} > 0`,
    ),
  ],
);

/**
 * Every open, and every refusal (§4.5).
 *
 * Append-only, and `contact_id` is `set null` rather than cascade for the same
 * reason `gallery_access_logs` is: merge repoints who it was; it does not
 * delete that a view happened. A document history that vanishes the first time
 * two duplicates are merged is not an audit.
 *
 * Denials are recorded too. "Somebody tried the link after it expired" is the
 * half of an access history that a log of successes cannot show, and it is
 * usually the half that matters in a dispute.
 */
export const documentAccessLogs = pgTable(
  "document_access_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").references(() => documentVersions.id, {
      onDelete: "set null",
    }),
    shareId: uuid("share_id").references(() => documentShares.id, {
      onDelete: "set null",
    }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    action: text("action", { enum: DOCUMENT_ACCESS_ACTIONS }).notNull(),
    /** Why a denial was a denial: "expired", "revoked", "limit", "secret". */
    reason: text("reason"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("document_access_logs_document_idx").on(t.documentId, t.at),
    index("document_access_logs_contact_idx").on(t.contactId),
    index("document_access_logs_share_idx").on(t.shareId),
  ],
);
