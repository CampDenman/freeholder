// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: preserve real static-file facts in the existing normalized graph.
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ArchiveIndexedFile } from "./archive-index";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const archiveFileFactSchema = z.object({
  format: z.literal("archive-zip"), path: z.string().min(1).max(1_024), relativePath: z.string().min(1).max(1_024),
  url: z.string().url().max(8_192).nullable(), kind: z.enum(["page", "asset", "ignored"]),
  start: z.number().int().min(0).max(104_857_599), end: z.number().int().positive().max(104_857_600),
  compressedBytes: z.number().int().min(0).max(104_857_600), bytes: z.number().int().min(0).max(104_857_600),
  crc32: z.number().int().min(0).max(0xffffffff), method: z.union([z.literal(0), z.literal(8)]),
}).strict().refine(file => file.end > file.start && (file.kind === "ignored" ? file.url === null : file.url !== null), "Original ZIP file facts are inconsistent.");
const seo = z.object({
  title: z.string().max(1_000).optional(), description: z.string().max(1_000).optional(),
  preserveTitle: z.boolean().optional(), preserveDescription: z.boolean().optional(),
  canonical: z.string().max(8_192).optional(), noindex: z.boolean().optional(), nofollow: z.boolean().optional(),
}).strict();
export const archiveGraphMetadataSchema = z.object({
  format: z.literal("archive-zip"), file: archiveFileFactSchema, factsDigest: digest, contentDigest: digest.optional(),
  url: z.string().max(8_192).optional(), slug: z.string().max(2_048).optional(), targetSlug: z.string().max(2_048).optional(),
  title: z.string().max(2_048).optional(), status: z.literal("publish").optional(),
  sourcePath: z.string().max(8_192).optional(), redirectFrom: z.string().max(8_192).optional(), seo: seo.optional(),
  images: z.array(z.object({ src: z.string().max(8_192), alt: z.string().max(500).optional() }).strict()).max(500).optional(),
}).strict().superRefine((metadata, ctx) => {
  const originalUrl = z.url().safeParse(metadata.file.url);
  if (metadata.factsDigest !== createHash("sha256").update(JSON.stringify(metadata.file)).digest("hex")) ctx.addIssue({ code: "custom", message: "The ZIP file facts no longer match their digest." });
  if (metadata.file.kind !== "ignored" && !metadata.contentDigest) ctx.addIssue({ code: "custom", message: "Content needs an actual original-file digest." });
  if (metadata.file.kind === "page" && (metadata.url !== metadata.file.url || metadata.slug === undefined || metadata.targetSlug !== metadata.slug || !metadata.title || !metadata.seo || !originalUrl.success || metadata.sourcePath !== new URL(originalUrl.data).pathname)) ctx.addIssue({ code: "custom", message: "A ZIP page needs its actual original URL and parsed page facts." });
  if (metadata.file.kind !== "page" && [metadata.slug, metadata.targetSlug, metadata.title, metadata.seo, metadata.sourcePath].some(value => value !== undefined)) ctx.addIssue({ code: "custom", message: "Non-page files cannot introduce page facts." });
});
export type ArchiveGraphMetadata = z.infer<typeof archiveGraphMetadataSchema>;
export const archiveGraphEntrySchema = z.object({
  ordinal: z.number().int().min(0).max(9_999), identity: digest,
  start: z.number().int().nonnegative(), end: z.number().int().positive(), digest,
  kind: z.enum(["page", "attachment", "skipped"]), metadata: archiveGraphMetadataSchema,
  bodyBytes: z.number().int().min(0).max(20 * 1024 * 1024),
}).strict().superRefine((entry, ctx) => {
  const file = entry.metadata.file;
  if (entry.start !== file.start || entry.end !== file.end || entry.digest !== (entry.metadata.contentDigest ?? entry.metadata.factsDigest) || entry.kind !== (file.kind === "asset" ? "attachment" : file.kind === "ignored" ? "skipped" : "page") || entry.bodyBytes !== (file.kind === "page" ? file.bytes : 0)) ctx.addIssue({ code: "custom", message: "The indexed ZIP row lost its original file binding." });
});

/** Attachment here means an actual static asset, never an invented WP entity. */
export function archiveGraphEntry(original: ArchiveIndexedFile): z.infer<typeof archiveGraphEntrySchema> {
  const page = original.page;
  const metadata = archiveGraphMetadataSchema.parse({
    format: "archive-zip", file: original.file, factsDigest: original.factsDigest,
    ...(original.contentDigest ? { contentDigest: original.contentDigest } : {}),
    ...(page ? { url: page.url, slug: page.slug, targetSlug: page.slug, title: page.title, status: page.status, sourcePath: page.sourcePath, seo: page.seo, ...(page.redirectFrom ? { redirectFrom: page.redirectFrom } : {}) } : {}),
    ...(original.images?.length ? { images: original.images } : {}),
  });
  if (Buffer.byteLength(JSON.stringify(metadata)) > 16_384) throw new Error("The original ZIP entry metadata exceeds its normalized graph budget.");
  return archiveGraphEntrySchema.parse({ ordinal: original.ordinal, identity: original.identity,
    start: original.file.start, end: original.file.end, digest: original.contentDigest ?? original.factsDigest,
    kind: original.file.kind === "asset" ? "attachment" : original.file.kind === "ignored" ? "skipped" : "page",
    metadata, bodyBytes: original.file.kind === "page" ? original.file.bytes : 0 });
}
