// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Media services (MASTER.md §3 core/media, §4.5, §18).
//
// The only door to the asset library. Uploading writes bytes to the storage
// adapter and a row to the database, in that order and deliberately: an object
// with no row is litter a sweep can find, whereas a row with no object is a
// broken image on a customer's screen.
import { z } from "zod";
import { count, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { assets } from "@/core/media/schema";
import { defineService, ServiceError } from "@/core/service";
import { storage } from "@/adapters/storage";
import { storageKey } from "@/adapters/storage/types";
import {
  buildRenditions,
  isRasterImage,
  kindFor,
  readImageFacts,
  toVariantSet,
  type Rendition,
  type VariantFormat,
  type VariantSet,
} from "@/core/media/variants";

/** 25 MB. Large enough for a camera JPEG, small enough to bound a request. */
const MAX_BYTES = 25 * 1024 * 1024;

export const uploadAsset = defineService({
  name: "media.upload",
  summary: "Store a file and derive its responsive renditions.",
  kind: "mutation",
  permission: "staff",
  input: z.object({
    filename: z.string().min(1).max(255),
    contentType: z.string().min(1).max(255),
    bytes: z.instanceof(Uint8Array),
    altText: z.string().max(500).optional(),
  }),
  handler: async (input, ctx) => {
    const body = input.bytes;
    if (body.byteLength === 0) {
      throw new ServiceError("validation", "That file is empty.");
    }
    if (body.byteLength > MAX_BYTES) {
      throw new ServiceError(
        "validation",
        `That file is larger than ${Math.floor(MAX_BYTES / 1024 / 1024)} MB.`,
      );
    }

    const store = storage();
    const at = new Date();
    const key = storageKey(input.filename, at, randomUUID().slice(0, 8));
    await store.put(key, body, input.contentType);

    const facts = isRasterImage(input.contentType)
      ? await readImageFacts(body)
      : undefined;

    let variants: VariantSet = {};
    if (facts) {
      const built = await buildRenditions(body, facts, (format, width) =>
        `${key}.${width}.${format}`,
      );
      // Uploaded before the row is written, so a variant key on the row always
      // points at something that exists.
      for (const rendition of built) {
        await store.put(rendition.key, rendition.body, rendition.contentType);
      }
      variants = toVariantSet(built);
    }

    const [asset] = await ctx.tx
      .insert(assets)
      .values({
        kind: kindFor(input.contentType),
        storageKey: key,
        filename: input.filename,
        mime: input.contentType,
        bytes: body.byteLength,
        width: facts?.width,
        height: facts?.height,
        variants,
        altText: input.altText,
      })
      .returning();

    ctx.setSubject("asset", asset!.id);
    ctx.queueEvent("media.uploaded", { assetId: asset!.id, kind: asset!.kind });
    return asset!;
  },
});

export const listAssets = defineService({
  name: "media.list",
  summary: "The asset library, newest first.",
  kind: "query",
  permission: "staff",
  input: z.object({
    kind: z.enum(["image", "video", "doc", "audio"]).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).default(0),
  }),
  handler: async (input, ctx) => {
    const where = input.kind ? eq(assets.kind, input.kind) : undefined;
    const rows = await ctx.tx
      .select()
      .from(assets)
      .where(where)
      .orderBy(desc(assets.createdAt))
      .limit(input.limit)
      .offset(input.offset);
    const [totals] = await ctx.tx
      .select({ n: count() })
      .from(assets)
      .where(where);
    return { rows, total: totals?.n ?? 0 };
  },
});

export const getAsset = defineService({
  name: "media.get",
  summary: "One asset by id.",
  kind: "query",
  permission: "staff",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const [asset] = await ctx.tx
      .select()
      .from(assets)
      .where(eq(assets.id, input.id))
      .limit(1);
    if (!asset) throw new ServiceError("not_found", "That file is not here.");
    return asset;
  },
});

export interface ResolvedSource {
  format: VariantFormat;
  /** A `srcset` value: "url 400w, url 800w". */
  srcset: string;
  type: string;
}

export interface ResolvedImage {
  src: string;
  sources: ResolvedSource[];
  width: number | null;
  height: number | null;
  altText: string | null;
}

/**
 * Everything a public page needs to render an asset (§5, §36).
 *
 * Public, because it is what draws an image on a page a visitor is reading —
 * and it returns URLs rather than bytes, so a public bucket is served straight
 * from the CDN and a private one through a signed link, without the caller
 * knowing which it is.
 */
export const resolveImage = defineService({
  name: "media.resolveImage",
  summary: "URLs and dimensions for rendering one image.",
  kind: "query",
  permission: "public",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx): Promise<ResolvedImage | null> => {
    const [asset] = await ctx.tx
      .select()
      .from(assets)
      .where(eq(assets.id, input.id))
      .limit(1);
    // Null rather than an error: a block pointing at a deleted asset should
    // leave a gap in a page, never take the page down.
    if (!asset || asset.kind !== "image") return null;

    const store = storage();
    const variants = asset.variants as VariantSet;
    const sources: ResolvedSource[] = [];
    for (const [format, renditions] of Object.entries(variants) as [
      VariantFormat,
      Rendition[],
    ][]) {
      if (!renditions?.length) continue;
      const entries = await Promise.all(
        renditions.map(async (r) => `${await store.url(r.key)} ${r.width}w`),
      );
      sources.push({
        format,
        srcset: entries.join(", "),
        type: `image/${format}`,
      });
    }

    return {
      src: await store.url(asset.storageKey),
      sources,
      width: asset.width,
      height: asset.height,
      altText: asset.altText,
    };
  },
});

export const setAltText = defineService({
  name: "media.setAltText",
  summary: "Describe an image for people who cannot see it.",
  kind: "mutation",
  permission: "staff",
  input: z.object({
    id: z.string().uuid(),
    altText: z.string().max(500),
  }),
  handler: async (input, ctx) => {
    const [asset] = await ctx.tx
      .update(assets)
      .set({ altText: input.altText })
      .where(eq(assets.id, input.id))
      .returning();
    if (!asset) throw new ServiceError("not_found", "That file is not here.");
    ctx.setSubject("asset", asset.id);
    return asset;
  },
});

/**
 * Remove a file and every rendition of it.
 *
 * Storage is emptied before the row goes, for the same reason uploads write
 * bytes first: if this fails halfway, what is left is a row whose object is
 * gone — visible, reportable, fixable — rather than an orphaned object nobody
 * knows about paying rent in a bucket forever.
 */
export const deleteAsset = defineService({
  name: "media.delete",
  summary: "Delete a file and its renditions.",
  kind: "mutation",
  permission: "owner",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const [asset] = await ctx.tx
      .select()
      .from(assets)
      .where(eq(assets.id, input.id))
      .limit(1);
    if (!asset) throw new ServiceError("not_found", "That file is not here.");

    const store = storage();
    const variants = asset.variants as VariantSet;
    for (const renditions of Object.values(variants)) {
      for (const rendition of renditions ?? []) {
        await store.delete(rendition.key);
      }
    }
    await store.delete(asset.storageKey);
    await ctx.tx.delete(assets).where(eq(assets.id, asset.id));

    ctx.setSubject("asset", asset.id);
    ctx.queueEvent("media.deleted", { assetId: asset.id });
    return { ok: true };
  },
});

export default [
  uploadAsset,
  listAssets,
  getAsset,
  resolveImage,
  setAltText,
  deleteAsset,
];
