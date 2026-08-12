// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The asset library (MASTER.md §4.5, §18, §36).
//
// One row per uploaded file. The bytes never live here and never live on the
// instance's disk — §18 mandates managed object storage, because "media is the
// least-recoverable asset a business has; a dead droplet or wiped container
// must never be able to take the photo archive with it". This table holds the
// *key* and everything the platform knows about the file; the storage adapter
// holds the file.
import { sql } from "drizzle-orm";
import {
  bigint,
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
import { createdAtColumn, updatedAtColumn } from "@/core/db/columns";

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Broad category, decided from the mime type on upload. */
    kind: text("kind", { enum: ["image", "video", "doc", "audio"] }).notNull(),
    /** Where the original lives in the bucket. */
    storageKey: text("storage_key").notNull(),
    /** What the owner called it. The storage key is sanitised; this is not. */
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    /** Rollback lane used by release N-1, capped when an original exceeds int4. */
    legacyBytes: integer("bytes").notNull(),
    /** Accurate size for large audio/video; a trigger mirrors legacy writes. */
    bytes: bigint("byte_size", { mode: "number" }).notNull().default(0),
    /** Images and video. Kept so a page can reserve space and avoid reflow. */
    width: integer("width"),
    height: integer("height"),
    durationSeconds: integer("duration_seconds"),
    /**
     * Derived renditions, by format and width (§36: "automatic responsive
     * variants, AVIF/WebP"). Shaped
     * `{ webp: [{ width, height, key, bytes }], avif: [...] }`.
     *
     * jsonb rather than a table because the set is decided by the pipeline and
     * read as a whole — there is no query that asks for "all 800px webp
     * variants across every asset". If one ever appears, this normalizes.
     */
    variants: jsonb("variants").notNull().default({}),
    /**
     * §5 requires alt text on public images. Nullable because an upload cannot
     * block on it, but the SEO gate will fail a page that renders an image
     * without one — so this is a debt the platform tracks rather than ignores.
     */
    altText: text("alt_text"),
    /** §4.5 names blurhash. Not yet generated — see the backlog. */
    blurhash: text("blurhash"),
    /** Only ready assets may be resolved outside the media console. */
    status: text("status", {
      enum: ["processing", "ready", "quarantined", "failed", "trashed"],
    })
      .notNull()
      .default("ready"),
    /** Scanner truth is separate from structural validation truth. */
    scanStatus: text("scan_status", {
      enum: ["pending", "clean", "not_configured", "infected", "error"],
    })
      .notNull()
      .default("not_configured"),
    scanEngine: text("scan_engine"),
    scanMessage: text("scan_message"),
    scannedAt: timestamp("scanned_at", { withTimezone: true }),
    /** Digest of the original bytes, never of a browser's claim. */
    checksumSha256: text("checksum_sha256"),
    /** Safe extracted facts (codec/pages/etc.); never raw EXIF/GPS. */
    metadata: jsonb("metadata").notNull().default({}),
    /** Where this file came from and who introduced it. */
    provenance: jsonb("provenance").notNull().default({}),
    source: text("source", {
      enum: ["upload", "import", "generated", "migration"],
    })
      .notNull()
      .default("upload"),
    uploadedBy: text("uploaded_by"),
    /** Image crop anchor in basis points: 0..10000, default centre. */
    focalX: integer("focal_x").notNull().default(5000),
    focalY: integer("focal_y").notNull().default(5000),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("assets_storage_key_unique").on(t.storageKey),
    index("assets_kind_idx").on(t.kind),
    index("assets_status_created_at_idx").on(t.status, t.createdAt),
    index("assets_purge_after_idx").on(t.purgeAfter),
    index("assets_created_at_idx").on(t.createdAt),
    check("assets_bytes_nonnegative", sql`${t.bytes} >= 0`),
    check("assets_legacy_bytes_nonnegative", sql`${t.legacyBytes} >= 0`),
    check("assets_focal_x_range", sql`${t.focalX} between 0 and 10000`),
    check("assets_focal_y_range", sql`${t.focalY} between 0 and 10000`),
    check(
      "assets_trash_dates_consistent",
      sql`(${t.status} = 'trashed' and ${t.deletedAt} is not null and ${t.purgeAfter} is not null) or (${t.status} <> 'trashed' and ${t.deletedAt} is null and ${t.purgeAfter} is null)`,
    ),
  ],
);

/**
 * Durable browser-to-object-store upload state. S3 uses multipart upload;
 * adapters without that capability truthfully fall back to the bounded proxy
 * path instead of pretending a direct URL exists.
 */
export const mediaUploads = pgTable(
  "media_uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    strategy: text("strategy", { enum: ["direct_multipart", "proxy"] })
      .notNull(),
    state: text("state", {
      enum: [
        "created",
        "uploading",
        "uploaded",
        "processing",
        "complete",
        "failed",
        "aborted",
        "expired",
      ],
    })
      .notNull()
      .default("created"),
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    declaredMime: text("declared_mime").notNull(),
    detectedMime: text("detected_mime"),
    expectedBytes: bigint("expected_bytes", { mode: "number" }).notNull(),
    providerUploadId: text("provider_upload_id"),
    assetId: uuid("asset_id").references(() => assets.id, {
      onDelete: "set null",
    }),
    uploadedBy: text("uploaded_by"),
    source: text("source", {
      enum: ["upload", "import", "generated", "migration"],
    })
      .notNull()
      .default("upload"),
    provenance: jsonb("provenance").notNull().default({}),
    mediaMetadata: jsonb("media_metadata").notNull().default({}),
    failureReason: text("failure_reason"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex("media_uploads_storage_key_unique").on(t.storageKey),
    index("media_uploads_state_expiry_idx").on(t.state, t.expiresAt),
    index("media_uploads_asset_idx").on(t.assetId),
    check("media_uploads_expected_bytes_positive", sql`${t.expectedBytes} > 0`),
  ],
);

/**
 * Storage inventory and orphan ledger. A pending row is committed before its
 * object is written; attaching it happens with the Asset transaction. If that
 * transaction dies, the daily sweep still knows the exact key to remove.
 */
export const mediaObjects = pgTable(
  "media_objects",
  {
    key: text("key").primaryKey(),
    assetId: uuid("asset_id").references(() => assets.id, {
      onDelete: "cascade",
    }),
    uploadId: uuid("upload_id").references(() => mediaUploads.id, {
      onDelete: "set null",
    }),
    role: text("role", { enum: ["original", "variant", "staged"] })
      .notNull(),
    state: text("state", { enum: ["pending", "attached"] })
      .notNull()
      .default("pending"),
    bytes: bigint("bytes", { mode: "number" }),
    contentType: text("content_type").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("media_objects_asset_idx").on(t.assetId),
    index("media_objects_pending_idx").on(t.state, t.createdAt),
    index("media_objects_upload_idx").on(t.uploadId),
    check(
      "media_objects_attachment_consistent",
      sql`(${t.state} = 'attached' and ${t.assetId} is not null) or ${t.state} = 'pending'`,
    ),
  ],
);
