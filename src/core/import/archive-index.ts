// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: bounded actual ZIP-file phases; no synthetic WordPress records.
import { createHash } from "node:crypto";
import { z } from "zod";
import { ARCHIVE_LIMITS, parseArchiveOriginalPage, type ArchiveAsset, type ArchivePage, type ArchiveSource } from "./archive";
import { readArchiveDirectory, readArchiveOriginalFiles, type ArchiveDirectory, type ArchiveDirectoryFile } from "./archive-directory";
import { bodyImageRefs, toCmsSlug } from "./wordpress";

const MAX_METADATA_BYTES = 16 * 1024 * 1024;
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export const archiveIndexCursorSchema = z.object({
  format: z.literal("archive-zip"), directoryFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  ordinal: z.number().int().min(0).max(10_000),
  bodyBytes: z.number().int().min(0).max(ARCHIVE_LIMITS.expandedBytes),
  metadataBytes: z.number().int().min(0).max(MAX_METADATA_BYTES),
});
export type ArchiveIndexCursor = z.infer<typeof archiveIndexCursorSchema>;
export type ArchiveIndexedFile = {
  format: "archive-zip"; ordinal: number; identity: string; file: ArchiveDirectoryFile;
  factsDigest: string; contentDigest?: string;
  page?: Omit<ArchivePage, "body">;
  images?: Array<{ src: string; alt?: string }>;
};

function originalSlug(file: ArchiveDirectoryFile, base: URL) {
  const relative = new URL(file.url!).pathname.slice(base.pathname.length - 1);
  return toCmsSlug(relative.replace(/(?:^|\/)index\.html?$/i, "").replace(/\.html?$/i, ""));
}
function reserveSlug(initial: string, used: Set<string>) {
  let slug = initial;
  for (let n = 2; used.has(slug); n++) slug = `${initial || "home"}-${n}`;
  used.add(slug);
}

/** The caller supplies a manifest-authorized range reader. Only normalized
 * original-file facts and page metadata leave this parser, never shadow bodies.
 * A directory fingerprint binds facts, not ownership or whole-upload bytes. */
export async function indexArchivePhase(source: ArchiveSource, directory: ArchiveDirectory, previous?: ArchiveIndexCursor): Promise<{
  cursor: ArchiveIndexCursor; entries: ArchiveIndexedFile[]; done: boolean;
}> {
  const deadline = Date.now() + ARCHIVE_LIMITS.timeoutMs;
  const cursor = archiveIndexCursorSchema.parse(previous ?? {
    format: "archive-zip", directoryFingerprint: directory.directoryFingerprint,
    ordinal: 0, bodyBytes: 0, metadataBytes: 0,
  });
  if (cursor.directoryFingerprint !== directory.directoryFingerprint || cursor.ordinal > directory.files.length) throw new Error("The original ZIP directory or indexing cursor changed.");
  const base = new URL(directory.origin), selected: ArchiveDirectoryFile[] = [];
  let phaseBytes = 0;
  for (const file of directory.files.slice(cursor.ordinal, cursor.ordinal + 500)) {
    const bytes = file.kind === "ignored" ? 0 : file.bytes;
    if (phaseBytes + bytes > ARCHIVE_LIMITS.bodyBytes) {
      // The ordinary reader permits one media file up to 25MB by itself.
      if (!selected.length && file.kind === "asset" && bytes <= ARCHIVE_LIMITS.mediaBytes) selected.push(file);
      break;
    }
    phaseBytes += bytes;
    selected.push(file);
  }
  const eligible = selected.filter(file => file.kind !== "ignored");
  const payloads = eligible.length ? await readArchiveOriginalFiles(source, directory, eligible.map(file => file.path)) : new Map<string, Uint8Array>();
  if (!eligible.length) {
    const current = await readArchiveDirectory(source, directory.origin);
    if (current.directoryFingerprint !== directory.directoryFingerprint || current.root !== directory.root) throw new Error("The accepted original ZIP directory changed.");
  }
  const assets = new Map<string, ArchiveAsset>();
  for (const file of directory.files.filter(file => file.kind === "asset")) {
    const url = new URL(file.url!), key = url.host.toLowerCase() + url.pathname;
    assets.set(key, { path: file.path, key, sourceUrl: url.href, filename: file.relativePath.split("/").at(-1)!, digest: "", crc32: file.crc32, bytes: file.bytes, aliases: [key], referenced: false });
  }
  // Reconstruct only bounded slug facts, so resuming at a phase boundary cannot
  // silently rename collisions differently from an uninterrupted parse.
  const used = new Set<string>();
  for (const file of directory.files.slice(0, cursor.ordinal)) if (file.kind === "page") reserveSlug(originalSlug(file, base), used);
  const entries: ArchiveIndexedFile[] = [];
  for (const file of selected) {
    if (Date.now() > deadline) throw new Error("The ZIP indexing phase exceeded its time budget.");
    const entry: ArchiveIndexedFile = { format: "archive-zip", ordinal: cursor.ordinal,
      identity: sha(`archive-zip\0${file.path}`), file, factsDigest: sha(JSON.stringify(file)) };
    if (file.kind !== "ignored") entry.contentDigest = sha(payloads.get(file.path)!);
    if (file.kind === "page") {
      const bytes = payloads.get(file.path)!;
      const page = parseArchiveOriginalPage(bytes, file.url!, { base, assetByUrl: assets, used, unresolvedImages: new Set(), preserveRootTarget: true });
      const { body: _body, ...metadata } = page;
      entry.page = metadata;
      const images = bodyImageRefs(page.body);
      if (images.length) entry.images = images;
      cursor.bodyBytes += bytes.byteLength;
    }
    const metadataBytes = Buffer.byteLength(JSON.stringify(entry));
    if (metadataBytes > 16 * 1024 || cursor.metadataBytes + metadataBytes > MAX_METADATA_BYTES || cursor.bodyBytes > ARCHIVE_LIMITS.expandedBytes) throw new Error("The complete ZIP graph exceeds its original body or metadata budget.");
    entries.push(entry); cursor.ordinal++; cursor.metadataBytes += metadataBytes;
  }
  if (Date.now() > deadline) throw new Error("The ZIP indexing phase exceeded its time budget.");
  return { cursor, entries, done: cursor.ordinal === directory.files.length };
}
