// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: REST records use the same original graph budgets as WXR entries.
import { createHash } from "node:crypto";
import { z } from "zod";
import { DEFAULT_IMPORTER_LIMITS } from "./contract";
import { readJsonSourcePhase } from "./json-source-ranges";
import { IMPORT_SOURCE_RANGE_MAX_BYTES, type ImportSourceRanges } from "./source-range";
import { bodyImageRefs, wordpressExportFromRest, wordpressItemPlacement } from "./wordpress";
import { IMPORT_GRAPH_LIMITS, wxrEntryMetadataSchema, wxrHeaderMetadataSchema, wxrIndexCursorSchema, type WxrIndexCursor, type WxrIndexedEntry } from "./wxr-index";

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const identity = z.object({ id: z.number().int().positive(), type: z.string().optional() });

export async function indexRestPhase(source: ImportSourceRanges, previous: WxrIndexCursor | undefined, origin: string): Promise<{ cursor: WxrIndexCursor; entries: WxrIndexedEntry[]; done: boolean; headerMetadata: z.infer<typeof wxrHeaderMetadataSchema> }> {
  const cursor = wxrIndexCursorSchema.parse(previous ?? { nextByte: 0, ordinal: 0, bodyBytes: 0, metadataBytes: 0, header: null });
  if (cursor.nextByte > 0 && !cursor.header) throw new Error("The original REST source header is missing.");
  const phase = await readJsonSourcePhase(source, { nextByte: cursor.nextByte, ordinal: cursor.ordinal });
  const headerEnd = cursor.header?.end ?? phase.entries[0]?.start ?? source.bytes;
  if (headerEnd <= 0 || headerEnd > IMPORT_SOURCE_RANGE_MAX_BYTES) throw new Error("The original REST header exceeds its source-range budget.");
  const headerDigest = sha(await source.readRange(0, headerEnd));
  if (cursor.header && headerDigest !== cursor.header.digest) throw new Error("The original REST header changed.");
  cursor.header = { start: 0, end: headerEnd, digest: headerDigest };
  const entries: WxrIndexedEntry[] = [];
  let bodyBytes = 0, done = phase.done;
  for (const entry of phase.entries) {
    const record = identity.parse(entry.value);
    const exported = wordpressExportFromRest([entry.value], origin), page = exported.items[0];
    const kind = page?.kind ?? "skipped";
    const placement = page ? wordpressItemPlacement(page, exported.site, origin) : undefined;
    const images = page ? [...bodyImageRefs(page.body), ...(page.featuredUrl ? [{ src: page.featuredUrl }] : [])] : [];
    const metadata = wxrEntryMetadataSchema.parse(page ? {
      wpId: String(record.id), url: page.url, slug: page.slug, title: page.title, status: page.wpStatus,
      sourcePath: placement!.sourcePath, targetSlug: placement!.slug, ...(images.length ? { images } : {}),
    } : { wpId: String(record.id), reason: Object.keys(exported.skipped).join(", ") || "unrecognized REST record" });
    const bytes = page ? Buffer.byteLength(page.body) : 0;
    if (bytes > DEFAULT_IMPORTER_LIMITS.maxBytes) throw new Error("One REST entry exceeds the phase body-byte budget.");
    if (bodyBytes + bytes > DEFAULT_IMPORTER_LIMITS.maxBytes) { done = false; break; }
    const metadataBytes = Buffer.byteLength(JSON.stringify(metadata));
    if (metadataBytes > IMPORT_GRAPH_LIMITS.entryMetadataBytes || cursor.ordinal + 1 > IMPORT_GRAPH_LIMITS.entries || cursor.bodyBytes + bytes > IMPORT_GRAPH_LIMITS.bodyBytes || cursor.metadataBytes + metadataBytes > IMPORT_GRAPH_LIMITS.metadataBytes) throw new Error("The complete REST source exceeds its graph record, body or metadata budget.");
    entries.push({ ordinal: cursor.ordinal, start: entry.start, end: entry.end, digest: entry.digest, identity: sha(`rest\0id:${record.id}`), kind, metadata, bodyBytes: bytes });
    cursor.nextByte = entry.end; cursor.ordinal++; cursor.bodyBytes += bytes; cursor.metadataBytes += metadataBytes; bodyBytes += bytes;
  }
  if (done) cursor.nextByte = source.bytes;
  return { cursor, entries, done, headerMetadata: wxrHeaderMetadataSchema.parse({ site: { title: "", url: origin }, menus: [] }) };
}
