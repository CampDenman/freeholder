// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: immutable ZIP directory facts and bounded reads, without fake WP IDs.
import { createHash } from "node:crypto";
import { fromRandomAccessReaderPromise, type Entry, type ZipFile } from "yauzl";
import { z } from "zod";
import { ARCHIVE_LIMITS, archiveEntryPath, assertArchiveEntry, ArchiveRangeReader, readArchiveEntryBytes, type ArchiveSource } from "./archive";
import { assertPublicHttpUrl } from "./contract";

const MAX_ENTRIES = 10_000, MAX_METADATA_BYTES = 16 * 1024 * 1024;
const HTML = /\.html?$/i;
const MEDIA = /\.(?:avif|gif|jpe?g|png|webp|mp4|webm|mp3|wav|ogg|m4a|pdf)$/i;
export type ArchiveDirectoryFile = {
  format: "archive-zip"; path: string; relativePath: string; url: string;
  kind: "page" | "asset" | "ignored"; start: number; end: number;
  compressedBytes: number; bytes: number; crc32: number; method: number;
};
export type ArchiveDirectory = {
  format: "archive-zip"; origin: string; root: string; directoryFingerprint: string;
  directoryEntries: number; expandedBytes: number; files: ArchiveDirectoryFile[];
};
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const publicUrl = (path: string, origin: string) => new URL(path.split("/").map(part => encodeURIComponent(part)).join("/"), origin).href;

async function open(source: ArchiveSource) {
  if (!Number.isSafeInteger(source.bytes) || source.bytes < 22 || source.bytes > ARCHIVE_LIMITS.compressedBytes) throw new Error("The ZIP is outside its original source-byte budget.");
  const budget = { deadline: Date.now() + ARCHIVE_LIMITS.timeoutMs, maxReads: MAX_ENTRIES * 4 + 32 };
  const zip = await fromRandomAccessReaderPromise(new ArchiveRangeReader(source, budget), source.bytes, { autoClose: false, lazyEntries: true, decodeStrings: true, strictFileNames: true, validateEntrySizes: true });
  return { zip, budget };
}

async function localFrame(source: ArchiveSource, entry: Entry, directoryStart: number) {
  const start = entry.relativeOffsetOfLocalHeader;
  if (!Number.isSafeInteger(start) || start < 0 || start + 30 > directoryStart) throw new Error("The ZIP entry starts outside its original file area.");
  const bytes = await source.readRange(start, start + 30);
  if (bytes.byteLength !== 30) throw new Error("The original ZIP local header is incomplete.");
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (header.getUint32(0, true) !== 0x04034b50 || header.getUint16(8, true) !== entry.compressionMethod || header.getUint16(6, true) !== entry.generalPurposeBitFlag) throw new Error("The original ZIP directory and local header disagree.");
  if (entry.generalPurposeBitFlag & 0x0800) {
    const name = await source.readRange(start + 30, start + 30 + header.getUint16(26, true));
    if (name.byteLength !== header.getUint16(26, true) || new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(name).normalize("NFC") !== entry.fileName.normalize("NFC")) throw new Error("The original ZIP directory and local file names disagree.");
  }
  const end = start + 30 + header.getUint16(26, true) + header.getUint16(28, true) + entry.compressedSize;
  if (!Number.isSafeInteger(end) || end > directoryStart) throw new Error("The ZIP file overlaps its directory or leaves the original source.");
  return { start, end };
}

async function directory(source: ArchiveSource, origin: string, zip: ZipFile, deadline: number): Promise<ArchiveDirectory> {
  const approved = assertPublicHttpUrl(origin);
  if (approved.search || approved.hash) throw new Error("A ZIP source needs a public site URL without query or fragment.");
  if (!approved.pathname.endsWith("/")) approved.pathname += "/";
  // Yauzl initializes this publicly exposed cursor to the validated central
  // directory offset. Runtime validation deliberately refuses a dependency
  // shape change (its current DefinitelyTyped declaration says boolean).
  const directoryStart = z.number().int().nonnegative().max(source.bytes).parse(zip.readEntryCursor);
  const rows: Array<{ entry: Entry; path: string; start: number; end: number }> = [];
  const names = new Set<string>();
  let count = 0, expandedBytes = 0, metadataBytes = 0;
  for await (const entry of zip.eachEntry()) {
    if (++count > MAX_ENTRIES || Date.now() > deadline) throw new Error("The complete ZIP directory exceeds its entry or time budget.");
    assertArchiveEntry(entry);
    const path = archiveEntryPath(entry.fileName), folded = path.toLocaleLowerCase("en");
    if (names.has(folded)) throw new Error("The ZIP repeats an ambiguous original path.");
    names.add(folded);
    expandedBytes += entry.uncompressedSize;
    metadataBytes += 46 + entry.fileNameLength + entry.extraFieldLength + entry.fileCommentLength;
    if (expandedBytes > ARCHIVE_LIMITS.expandedBytes || metadataBytes > MAX_METADATA_BYTES) throw new Error("The complete ZIP exceeds its expanded-byte or directory-metadata budget.");
    rows.push({ entry, path, start: entry.relativeOffsetOfLocalHeader, end: 0 });
  }
  // Visit local frames in physical order after reading the directory. An
  // adversarial directory order must not cause thousands of whole private
  // chunks to be downloaded repeatedly through the two-chunk range cache.
  rows.sort((a, b) => a.start - b.start);
  for (const row of rows) Object.assign(row, await localFrame(source, row.entry, directoryStart));
  for (let at = 1; at < rows.length; at++) if (rows[at]!.start < rows[at - 1]!.end) throw new Error("Original ZIP file frames overlap.");
  const files = rows.filter(row => !row.path.endsWith("/"));
  const useful = files.filter(row => HTML.test(row.path) || MEDIA.test(row.path));
  if (!useful.some(row => HTML.test(row.path))) throw new Error("The ZIP contains no original static HTML pages.");
  const first = useful[0]!.path.split("/")[0]!;
  const root = useful.every(row => row.path.includes("/") && row.path.startsWith(`${first}/`)) && useful.some(row => /^index\.html?$/i.test(row.path.slice(first.length + 1))) ? `${first}/` : "";
  const assets = files.filter(row => MEDIA.test(row.path));
  if (assets.length > ARCHIVE_LIMITS.mediaFiles || assets.some(row => row.entry.uncompressedSize === 0 || row.entry.uncompressedSize > ARCHIVE_LIMITS.mediaBytes)) throw new Error("The ZIP exceeds its media-file budget or contains invalid media sizes.");
  if (files.some(row => HTML.test(row.path) && row.entry.uncompressedSize > ARCHIVE_LIMITS.pageBytes)) throw new Error("An original ZIP page exceeds its page-byte budget.");
  const originalFiles: ArchiveDirectoryFile[] = files.map(({ entry, path, start, end }) => ({
    format: "archive-zip", path, relativePath: path.slice(root.length), url: publicUrl(path.slice(root.length), approved.href),
    kind: HTML.test(path) ? "page" : MEDIA.test(path) ? "asset" : "ignored", start, end,
    compressedBytes: entry.compressedSize, bytes: entry.uncompressedSize, crc32: entry.crc32 >>> 0, method: entry.compressionMethod,
  }));
  const encoded = JSON.stringify(originalFiles);
  if (Buffer.byteLength(encoded) > MAX_METADATA_BYTES) throw new Error("The complete ZIP normalized directory exceeds its metadata budget.");
  // This fingerprint binds accepted *directory facts*, not a claim that the
  // whole upload was hashed here. The supplied original-range reader owns its
  // manifest authorization and chunk digests independently.
  return { format: "archive-zip", origin: approved.href, root, directoryFingerprint: digest(encoded), directoryEntries: count, expandedBytes, files: originalFiles };
}

export async function readArchiveDirectory(source: ArchiveSource, origin: string): Promise<ArchiveDirectory> {
  const { zip, budget } = await open(source);
  try { return await directory(source, origin, zip, budget.deadline); }
  finally { zip.close(); }
}

/** Validate once, then read one bounded phase in physical source order. A
 * directory fingerprint does not replace original-manifest authorization. */
export async function readArchiveOriginalFiles(source: ArchiveSource, accepted: ArchiveDirectory, paths: string[]): Promise<Map<string, Uint8Array>> {
  if (!paths.length || paths.length > 500 || new Set(paths).size !== paths.length) throw new Error("Choose between one and 500 distinct original ZIP files.");
  const { zip, budget } = await open(source);
  let current: ArchiveDirectory;
  try {
    current = await directory(source, accepted.origin, zip, budget.deadline);
    if (current.directoryFingerprint !== accepted.directoryFingerprint || current.root !== accepted.root) throw new Error("The accepted original ZIP directory changed.");
  } finally { zip.close(); }
  const selected = paths.map(path => {
    const file = current.files.find(file => file.path === path);
    if (!file || file.kind === "ignored") throw new Error("This original ZIP file was not accepted as content or media.");
    return file;
  });
  const bytes = selected.reduce((total, file) => total + file.bytes, 0);
  if (bytes > ARCHIVE_LIMITS.bodyBytes && !(selected.length === 1 && selected[0]!.kind === "asset" && bytes <= ARCHIVE_LIMITS.mediaBytes)) throw new Error("The selected ZIP phase exceeds its ordinary page/body or single-media budget.");
  const needed = new Map(selected.map(file => [file.path, file]));
  const reopened = await open(source);
  try {
    const originals: Array<{ file: ArchiveDirectoryFile; entry: Entry }> = [];
    for await (const entry of reopened.zip.eachEntry()) {
      const file = needed.get(archiveEntryPath(entry.fileName));
      if (!file) continue;
      if (entry.relativeOffsetOfLocalHeader !== file.start || entry.crc32 >>> 0 !== file.crc32 || entry.compressedSize !== file.compressedBytes || entry.uncompressedSize !== file.bytes || entry.compressionMethod !== file.method) throw new Error("An accepted original ZIP file changed during its read.");
      originals.push({ file, entry });
    }
    if (originals.length !== needed.size) throw new Error("An accepted original ZIP file is unavailable.");
    originals.sort((a, b) => a.file.start - b.file.start);
    const result = new Map<string, Uint8Array>();
    for (const { file, entry } of originals) result.set(file.path, new Uint8Array(await readArchiveEntryBytes(reopened.zip, entry, file.kind === "page" ? ARCHIVE_LIMITS.pageBytes : ARCHIVE_LIMITS.mediaBytes, reopened.budget.deadline)));
    return result;
  } finally { reopened.zip.close(); }
}

/** Convenience for a single file; phase callers use the bounded batch above. */
export async function readArchiveOriginalFile(source: ArchiveSource, accepted: ArchiveDirectory, path: string): Promise<Uint8Array> {
  return (await readArchiveOriginalFiles(source, accepted, [path])).get(path)!;
}
