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
import { index, integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { uuid } from "drizzle-orm/pg-core";
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
    bytes: integer("bytes").notNull(),
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
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index("assets_kind_idx").on(t.kind),
    index("assets_created_at_idx").on(t.createdAt),
  ],
);
