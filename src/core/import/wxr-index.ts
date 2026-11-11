// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: bounded indexing into the immutable original, without shadow bodies.
import { createHash } from "node:crypto";
import { z } from "zod";
import { DEFAULT_IMPORTER_LIMITS } from "./contract";
import { type ImportSourceRanges, IMPORT_SOURCE_RANGE_MAX_BYTES } from "./source-range";
import { WxrStreamReader, wordpressExportBuilder, wordpressItemPlacement, type WxrSourceRange } from "./wordpress";

export const IMPORT_GRAPH_LIMITS = Object.freeze({ entries: 10_000, bodyBytes: 100 * 1024 * 1024, metadataBytes: 16 * 1024 * 1024, entryMetadataBytes: 16_384 });
const sha = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");
const headerSchema = z.object({ start: z.literal(0), end: z.number().int().positive().max(IMPORT_SOURCE_RANGE_MAX_BYTES), digest: z.string().regex(/^[a-f0-9]{64}$/) });
export const wxrIndexCursorSchema = z.object({
  nextByte: z.number().int().nonnegative(), ordinal: z.number().int().nonnegative().max(IMPORT_GRAPH_LIMITS.entries),
  bodyBytes: z.number().int().nonnegative().max(IMPORT_GRAPH_LIMITS.bodyBytes),
  metadataBytes: z.number().int().nonnegative().max(IMPORT_GRAPH_LIMITS.metadataBytes),
  header: headerSchema.nullable(),
});
export type WxrIndexCursor = z.infer<typeof wxrIndexCursorSchema>;
export type WxrIndexedEntry = {
  ordinal: number; start: number; end: number; digest: string; identity: string;
  kind: "page" | "post" | "attachment" | "menu" | "skipped";
  metadata: { wpId?: string; url?: string; slug?: string; title?: string; status?: string; reason?: string; sourcePath?: string | null; targetSlug?: string };
  bodyBytes: number;
};
const metadataSchema = z.object({
  wpId: z.string().max(128).optional(), url: z.string().max(8_192).optional(),
  slug: z.string().max(2_048).optional(), title: z.string().max(2_048).optional(),
  status: z.string().max(64).optional(), reason: z.string().max(256).optional(),
  sourcePath: z.string().max(8_192).nullable().optional(), targetSlug: z.string().max(2_048).optional(),
});
export const wxrIndexedEntrySchema = z.object({
  ordinal: z.number().int().nonnegative().max(IMPORT_GRAPH_LIMITS.entries - 1),
  start: z.number().int().nonnegative(), end: z.number().int().positive(),
  digest: z.string().regex(/^[a-f0-9]{64}$/), identity: z.string().regex(/^[a-f0-9]{64}$/),
  kind: z.enum(["page", "post", "attachment", "menu", "skipped"]), metadata: metadataSchema,
  bodyBytes: z.number().int().nonnegative().max(DEFAULT_IMPORTER_LIMITS.maxBytes),
});
class PhaseComplete extends Error {}

/** Every result is a candidate until the caller commits its source/lease CAS. */
export async function indexWxrPhase(source: ImportSourceRanges, previous?: WxrIndexCursor, origin?: string): Promise<{ cursor: WxrIndexCursor; entries: WxrIndexedEntry[]; done: boolean }> {
  const cursor = wxrIndexCursorSchema.parse(previous ?? { nextByte: 0, ordinal: 0, bodyBytes: 0, metadataBytes: 0, header: null });
  if (cursor.nextByte > source.bytes || (cursor.nextByte > 0 && (!cursor.header || cursor.header.end > cursor.nextByte)) || (cursor.nextByte === 0 && cursor.ordinal !== 0)) throw new Error("The import graph cursor is outside its immutable source.");
  const builder = wordpressExportBuilder(), entries: WxrIndexedEntry[] = [];
  let phaseBodyBytes = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  if (cursor.header) {
    const bytes = await source.readRange(0, cursor.header.end);
    if (sha(bytes) !== cursor.header.digest) throw new Error("The original import header no longer matches its index.");
    builder.readHead(decoder.decode(bytes));
  }
  const head = (xml: string, range: WxrSourceRange): void => {
    if (range.start !== 0 || range.end > IMPORT_SOURCE_RANGE_MAX_BYTES) throw new Error("The import graph header exceeds its byte budget.");
    builder.readHead(xml);
    cursor.header = headerSchema.parse({ ...range, digest: sha(xml) });
  };
  const item = (xml: string, range: WxrSourceRange): void => {
    if (entries.length >= DEFAULT_IMPORTER_LIMITS.maxPages) throw new PhaseComplete();
    builder.readItem(xml);
    const parsed = builder.takeEntries(), page = parsed.items[0], attachment = parsed.attachments[0], menu = parsed.menuItems[0];
    const kind = page?.kind ?? (attachment ? "attachment" : menu ? "menu" : "skipped");
    const placement = page ? wordpressItemPlacement(page, builder.finish().site, origin ?? builder.finish().site.url) : undefined;
    const metadata = metadataSchema.parse(page ? { wpId: page.wpId, url: page.url, slug: page.slug, title: page.title, status: page.wpStatus, sourcePath: placement!.sourcePath, targetSlug: placement!.slug } : attachment ? { wpId: attachment.wpId, url: attachment.sourceUrl, title: attachment.title } : menu ? { wpId: menu.wpId, url: menu.url, title: menu.label } : { reason: Object.keys(parsed.skipped).join(", ") || "unrecognized item" });
    const bodyBytes = page ? Buffer.byteLength(page.body) : 0;
    if (bodyBytes > DEFAULT_IMPORTER_LIMITS.maxBytes) throw new Error("One import entry exceeds the phase body-byte budget.");
    if (phaseBodyBytes + bodyBytes > DEFAULT_IMPORTER_LIMITS.maxBytes) throw new PhaseComplete();
    const metadataBytes = Buffer.byteLength(JSON.stringify(metadata));
    if (metadataBytes > IMPORT_GRAPH_LIMITS.entryMetadataBytes || cursor.ordinal + 1 > IMPORT_GRAPH_LIMITS.entries || cursor.bodyBytes + bodyBytes > IMPORT_GRAPH_LIMITS.bodyBytes || cursor.metadataBytes + metadataBytes > IMPORT_GRAPH_LIMITS.metadataBytes) throw new Error("The complete import graph exceeds its total entry, body or metadata budget.");
    // IDs and URLs establish identity; title, author and comment fields do not.
    // Unknown items use their original span so skipped entries stay explicit.
    const identity = sha(`${kind}\0${metadata.wpId ? `id:${metadata.wpId}` : metadata.url ? `url:${metadata.url}` : `offset:${range.start}`}`);
    entries.push({ ordinal: cursor.ordinal, ...range, digest: sha(xml), identity, kind, metadata, bodyBytes });
    cursor.nextByte = range.end; cursor.ordinal++; cursor.bodyBytes += bodyBytes; cursor.metadataBytes += metadataBytes; phaseBodyBytes += bodyBytes;
  };
  const reader = new WxrStreamReader(head, item, { offset: cursor.nextByte, headerRead: Boolean(cursor.header) });
  const start = cursor.nextByte;
  try {
    // Small decoder slices prevent a source chunk containing thousands of
    // tiny entries from bypassing the phase boundary.
    for (let at = start; at < source.bytes; at += 65_536) {
      if (at - start >= IMPORT_SOURCE_RANGE_MAX_BYTES) {
        if (entries.length) return { cursor, entries, done: false };
        throw new Error("One import entry exceeds the phase source-byte budget.");
      }
      reader.push(decoder.decode(await source.readRange(at, Math.min(at + 65_536, source.bytes)), { stream: true }));
    }
    reader.push(decoder.decode()); reader.end();
    return { cursor: { ...cursor, nextByte: source.bytes }, entries, done: true };
  } catch (error) {
    if (error instanceof PhaseComplete) return { cursor, entries, done: false };
    throw error;
  }
}
