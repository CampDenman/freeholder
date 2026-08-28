// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Private client galleries (MASTER.md §4.5, C8.03).
//
// Public proof-of-work is already a Project (C8.01/C8.02). A gallery of
// loose images is not a portfolio, and modelling it as one would fork the
// argument the business makes for itself. `kind` exists because §4.5 names
// `portfolio | client_delivery`; C8.03 only completes `client_delivery`.
// Public/sitemap paths refuse the other value until a later item asks for it.
//
// Watermark and download_policy columns live here so C8.04 does not have to
// migrate the access model. The watermark *pipeline* and GallerySelection
// wait for C8.04.
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
import { assets } from "@/core/media/schema";
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const GALLERY_KINDS = ["portfolio", "client_delivery"] as const;
export const GALLERY_ACCESS_MODES = ["password", "pin", "login"] as const;
export const GALLERY_DOWNLOAD_POLICIES = [
  "none",
  "web_res",
  "full_res",
  "limit_n",
] as const;
export const GALLERY_GUEST_ROLES = ["client", "partner"] as const;
export const GALLERY_ACCESS_ACTIONS = ["view", "download", "denied"] as const;
export const GALLERY_SELECTION_KINDS = ["favorite", "select", "reject"] as const;

export const galleries = pgTable(
  "galleries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Who this delivery is for. Required at create: an unowned private
     * gallery is a folder nobody can be given. Nullable after privacy
     * erasure so the business keeps the work and loses the person.
     */
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "restrict",
    }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    kind: text("kind", { enum: GALLERY_KINDS }).notNull().default("client_delivery"),
    coverAssetId: uuid("cover_asset_id").references(() => assets.id, {
      onDelete: "set null",
    }),
    access: text("access", { enum: GALLERY_ACCESS_MODES }).notNull(),
    /**
     * scrypt of the PIN or password. Null when access is `login`.
     * The raw secret is never stored: a dumped table must not be the gallery.
     */
    secretHash: text("secret_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    downloadPolicy: text("download_policy", { enum: GALLERY_DOWNLOAD_POLICIES })
      .notNull()
      .default("none"),
    /** Used only when download_policy is limit_n. */
    downloadLimit: integer("download_limit"),
    /**
     * Column for C8.04. C8.03 stores the owner's choice; it does not render
     * a watermarked variant.
     */
    watermark: boolean("watermark").notNull().default(false),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("galleries_slug_idx").on(t.slug),
    index("galleries_contact_idx").on(t.contactId),
    check("galleries_title", sql`char_length(${t.title}) between 1 and 160`),
    check(
      "galleries_slug",
      sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check("galleries_kind", sql`${t.kind} in ('portfolio', 'client_delivery')`),
    check("galleries_access", sql`${t.access} in ('password', 'pin', 'login')`),
    check(
      "galleries_download_policy",
      sql`${t.downloadPolicy} in ('none', 'web_res', 'full_res', 'limit_n')`,
    ),
    // A login-gated gallery has no shared secret. A PIN/password gallery
    // without a hash is a door that opens for anyone who asks.
    check(
      "galleries_secret",
      sql`(${t.access} = 'login' and ${t.secretHash} is null) or (${t.access} in ('password', 'pin') and ${t.secretHash} is not null)`,
    ),
    check(
      "galleries_download_limit",
      sql`(${t.downloadPolicy} = 'limit_n' and ${t.downloadLimit} is not null and ${t.downloadLimit} > 0) or (${t.downloadPolicy} <> 'limit_n' and ${t.downloadLimit} is null)`,
    ),
  ],
);

export const galleryItems = pgTable(
  "gallery_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    galleryId: uuid("gallery_id")
      .notNull()
      .references(() => galleries.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    canView: boolean("can_view").notNull().default(true),
    canDownload: boolean("can_download").notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("gallery_items_unique_idx").on(t.galleryId, t.assetId),
    index("gallery_items_order_idx").on(t.galleryId, t.position),
  ],
);

export const galleryGuests = pgTable(
  "gallery_guests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    galleryId: uuid("gallery_id")
      .notNull()
      .references(() => galleries.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    role: text("role", { enum: GALLERY_GUEST_ROLES }).notNull(),
    tokenHash: text("token_hash"),
    /**
     * Overlay, never elevation. A guest cannot be granted more than the
     * item allows — that check is in the service, and these columns are the
     * guest's own ceiling.
     */
    canView: boolean("can_view").notNull().default(true),
    canDownload: boolean("can_download").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("gallery_guests_person_idx").on(t.galleryId, t.contactId),
    uniqueIndex("gallery_guests_token_idx")
      .on(t.tokenHash)
      .where(sql`${t.tokenHash} is not null`),
    index("gallery_guests_contact_idx").on(t.contactId),
    check("gallery_guests_role", sql`${t.role} in ('client', 'partner')`),
  ],
);

export const gallerySessions = pgTable(
  "gallery_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    galleryId: uuid("gallery_id")
      .notNull()
      .references(() => galleries.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    guestId: uuid("guest_id").references(() => galleryGuests.id, {
      onDelete: "cascade",
    }),
    downloadsUsed: integer("downloads_used").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex("gallery_sessions_token_idx").on(t.tokenHash),
    index("gallery_sessions_gallery_idx").on(t.galleryId, t.expiresAt),
  ],
);

/**
 * Append-only. Merge repoints who it was; it does not delete that a view
 * happened. A gallery whose history vanishes the first time two contacts
 * are merged is not an audit.
 */
export const galleryAccessLogs = pgTable(
  "gallery_access_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    galleryId: uuid("gallery_id")
      .notNull()
      .references(() => galleries.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    action: text("action", { enum: GALLERY_ACCESS_ACTIONS }).notNull(),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("gallery_access_logs_gallery_idx").on(t.galleryId, t.at),
    index("gallery_access_logs_contact_idx").on(t.contactId),
    check(
      "gallery_access_logs_action",
      sql`${t.action} in ('view', 'download', 'denied')`,
    ),
  ],
);

/**
 * What the client said about one photograph (MASTER.md §4.5, C8.05).
 *
 * Keyed on the asset rather than the gallery item because §4.5 keys it that
 * way, and because the opinion is about the photograph: re-adding a removed
 * item should not lose the fact that the client had already rejected it.
 *
 * `contactId` is nullable so privacy erasure can unlink the person and leave
 * the owner's record of which work was chosen — the same trade the gallery row
 * and the access log make. Postgres treats NULLs as distinct in a unique
 * index, so erasing two people who both chose one photograph does not collide.
 */
export const gallerySelections = pgTable(
  "gallery_selections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    galleryId: uuid("gallery_id")
      .notNull()
      .references(() => galleries.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: GALLERY_SELECTION_KINDS }).notNull(),
    /** The client's note on this frame. Null is "chose, said nothing". */
    comment: text("comment"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    // One opinion per person per photograph. Changing your mind is an update,
    // not a second row, so the owner never has to reconcile two answers.
    uniqueIndex("gallery_selections_unique_idx").on(
      t.galleryId,
      t.contactId,
      t.assetId,
    ),
    index("gallery_selections_gallery_idx").on(t.galleryId, t.kind),
    index("gallery_selections_contact_idx").on(t.contactId),
    check(
      "gallery_selections_kind",
      sql`${t.kind} in ('favorite', 'select', 'reject')`,
    ),
    check(
      "gallery_selections_comment",
      sql`${t.comment} is null or char_length(${t.comment}) between 1 and 2000`,
    ),
  ],
);

/**
 * One pass of "the client chooses, the owner decides" (C8.06).
 *
 * A round is the unit of agreement over a selection set. The client submits,
 * the owner approves or sends it back, and sending it back opens the next
 * round rather than editing this one — which is what makes the history real
 * instead of a status field that forgets.
 *
 * `snapshot` freezes what was submitted, because selections stay editable: a
 * round that read live selections would rewrite its own history the moment the
 * client changed their mind in the next round. It holds asset, verdict and
 * comment and deliberately no contact id — an identity buried in jsonb is one
 * `contacts.merge` cannot repoint, and the spine already records whose opinion
 * each selection was.
 */
export const GALLERY_ROUND_STATES = [
  "open",
  "submitted",
  "approved",
  "reopened",
] as const;

export const galleryRounds = pgTable(
  "gallery_rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    galleryId: uuid("gallery_id")
      .notNull()
      .references(() => galleries.id, { onDelete: "cascade" }),
    /** 1, 2, 3 — the client and the owner both count rounds out loud. */
    sequence: integer("sequence").notNull(),
    state: text("state", { enum: GALLERY_ROUND_STATES }).notNull().default("open"),
    /** Who submitted it. Null after erasure, or while still open. */
    submittedByContactId: uuid("submitted_by_contact_id").references(
      () => contacts.id,
      { onDelete: "set null" },
    ),
    /** The owner's word when approving or sending it back. */
    note: text("note"),
    /** What was submitted, frozen. */
    snapshot: jsonb("snapshot").notNull().default([]),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("gallery_rounds_sequence_idx").on(t.galleryId, t.sequence),
    index("gallery_rounds_gallery_idx").on(t.galleryId, t.state),
    index("gallery_rounds_contact_idx").on(t.submittedByContactId),
    check("gallery_rounds_sequence", sql`${t.sequence} >= 1`),
    check(
      "gallery_rounds_state",
      sql`${t.state} in ('open', 'submitted', 'approved', 'reopened')`,
    ),
    // A decided round has to say when. A round that is still open must not.
    check(
      "gallery_rounds_decided",
      sql`(${t.state} in ('approved', 'reopened') and ${t.decidedAt} is not null) or (${t.state} in ('open', 'submitted') and ${t.decidedAt} is null)`,
    ),
    check(
      "gallery_rounds_submitted",
      sql`(${t.state} = 'open' and ${t.submittedAt} is null) or (${t.state} <> 'open' and ${t.submittedAt} is not null)`,
    ),
  ],
);
