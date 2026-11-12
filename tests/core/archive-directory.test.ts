// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: actual ZIP bytes retain file identities without synthetic WP records.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { readArchiveDirectory, readArchiveOriginalFile, readArchiveOriginalFiles } from "@/core/import/archive-directory";
import { sourceGraphCursorSchema, sourceGraphEntrySchema } from "@/core/import/source-index-contract";
import { archiveGraphEntry, archiveGraphEntrySchema } from "@/core/import/archive-graph-contract";
import { indexArchivePhase } from "@/core/import/archive-index";
import type { ArchiveSource } from "@/core/import/archive";

function bytesSource(bytes: Uint8Array): ArchiveSource {
  return { bytes: bytes.byteLength, async readRange(start, end) { return bytes.subarray(start, end); } };
}
const fixture = (name: string) => bytesSource(readFileSync(`tests/fixtures/static-archive/${name}.zip`));
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
// A minimal deterministic stored ZIP fixture, with real local/central headers.
// It exercises the installed ZIP library, rather than mocking its directory.
function storedZip(files: Array<{ path: string; body: string }>, reverseDirectory = false) {
  const count = files.length;
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (let index = 0; index < count; index++) {
    const name = Buffer.from(files[index]!.path);
    const body = Buffer.from(files[index]!.body);
    const checksum = crc32(body), header = Buffer.alloc(30), record = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6);
    header.writeUInt32LE(checksum, 14); header.writeUInt32LE(body.length, 18); header.writeUInt32LE(body.length, 22); header.writeUInt16LE(name.length, 26);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(0x0314, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0x0800, 8);
    record.writeUInt32LE(checksum, 16); record.writeUInt32LE(body.length, 20); record.writeUInt32LE(body.length, 24); record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE((0o100644 << 16) >>> 0, 38); record.writeUInt32LE(offset, 42);
    local.push(header, name, body); central.push(Buffer.concat([record, name])); offset += header.length + name.length + body.length;
  }
  if (reverseDirectory) central.reverse();
  const table = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(table.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, table, end]);
}
function largeZip(count = 501, reverseDirectory = false) {
  return storedZip(Array.from({ length: count }, (_, index) => ({ path: index ? `site/page-${index}.html` : "site/index.html", body: `<html><body><h1>Fictional original ${index}</h1></body></html>` })), reverseDirectory);
}

describe("original static ZIP directory facts (C3.47)", () => {
  it("retains 501 distinct real file frames without generating WordPress identities", async () => {
    const source = bytesSource(largeZip()), directory = await readArchiveDirectory(source, "https://fictional-zip.example/");
    expect(directory).toMatchObject({ format: "archive-zip", root: "site/", directoryEntries: 501 });
    expect(directory.files).toHaveLength(501);
    expect(new Set(directory.files.map(file => file.path)).size).toBe(501);
    expect(directory.files.every(file => file.kind === "page" && !Object.hasOwn(file, "wpId"))).toBe(true);
    for (let at = 1; at < directory.files.length; at++) expect(directory.files[at]!.start).toBeGreaterThanOrEqual(directory.files[at - 1]!.end);
    expect(new TextDecoder().decode(await readArchiveOriginalFile(source, directory, "site/page-500.html"))).toContain("Fictional original 500");
    const phase = await readArchiveOriginalFiles(source, directory, directory.files.slice(0, 500).map(file => file.path));
    expect(phase.size).toBe(500);
    expect(new TextDecoder().decode(phase.get("site/page-499.html"))).toContain("Fictional original 499");
    await expect(readArchiveOriginalFiles(source, directory, directory.files.map(file => file.path))).rejects.toThrow(/500/);
    await expect(readArchiveOriginalFiles(source, directory, ["site/index.html", "site/index.html"])).rejects.toThrow(/distinct/);
  });
  it("reads local frames in physical order despite an adversarial central-directory order", async () => {
    const bytes = largeZip(37, true), headers: number[] = [];
    await readArchiveDirectory({ bytes: bytes.length, async readRange(start, end) {
      if (end - start === 30) headers.push(start);
      return bytes.subarray(start, end);
    } }, "https://fictional-zip.example/");
    expect(headers).toHaveLength(37);
    expect(headers).toEqual([...headers].sort((a, b) => a - b));
  });
  it("checks the directory deadline while validating actual local frames", async () => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    const bytes = largeZip(3);
    try {
      await expect(readArchiveDirectory({ bytes: bytes.length, async readRange(start, end) {
        if (end - start === 30) now += 60_001;
        return bytes.subarray(start, end);
      } }, "https://fictional-zip.example/")).rejects.toThrow(/time budget/);
    } finally { clock.mockRestore(); }
  });
  it("accepts the complete 10000-entry directory budget and refuses its first excess entry", async () => {
    expect((await readArchiveDirectory(bytesSource(largeZip(10_000)), "https://fictional-zip.example/")).files).toHaveLength(10_000);
    await expect(readArchiveDirectory(bytesSource(largeZip(10_001)), "https://fictional-zip.example/")).rejects.toThrow(/entry/);
  });
  it("refuses invalid declared UTF-8 and contradictory original local names", async () => {
    const invalid = largeZip(1), footer = invalid.length - 22;
    const directoryStart = invalid.readUInt32LE(footer + 16);
    invalid[30] = 0xff; invalid[directoryStart + 46] = 0xff;
    await expect(readArchiveDirectory(bytesSource(invalid), "https://fictional-zip.example/")).rejects.toThrow();
    const contradictory = largeZip(1);
    contradictory[contradictory.readUInt32LE(contradictory.length - 22 + 16) + 46] = "X".charCodeAt(0);
    await expect(readArchiveDirectory(bytesSource(contradictory), "https://fictional-zip.example/")).rejects.toThrow(/names disagree/);
  });
  it("keeps ignored packaging outside the detected site root as an original path without inventing a public URL", async () => {
    const directory = await readArchiveDirectory(bytesSource(storedZip([
      { path: "site/index.html", body: "<h1>Fictional website</h1>" },
      { path: "README.txt", body: "Fictional export packaging, outside the site." },
    ])), "https://fictional-zip.example/");
    expect(directory.root).toBe("site/");
    expect(directory.files.find(file => file.path === "README.txt")).toMatchObject({ kind: "ignored", relativePath: "README.txt", url: null });
  });
  it("keeps actual static paths, supported media and ignored files separate", async () => {
    const source = fixture("site"), directory = await readArchiveDirectory(source, "https://archive.example/legacy/");
    expect(directory.files.filter(file => file.kind === "page").map(file => file.url)).toEqual(["https://archive.example/legacy/index.html", "https://archive.example/legacy/about/team.html"]);
    expect(directory.files.filter(file => file.kind === "asset")).toHaveLength(1);
    expect(directory.files.filter(file => file.kind === "ignored").map(file => file.path).sort()).toEqual(["site/css/site.css", "site/js/site.js"]);
    expect(new TextDecoder().decode(await readArchiveOriginalFile(source, directory, "site/index.html"))).toContain("Original words preserved.");
    await expect(readArchiveOriginalFile(source, directory, "site/css/site.css")).rejects.toThrow(/not accepted/);
  });
  it.each(["traversal", "backslash", "absolute", "duplicates", "symlink", "oversized", "unsupported-compression", "encrypted", "truncated", "prototype", "constructor", "empty-media"])("refuses hostile %s directory metadata", async name => {
    await expect(readArchiveDirectory(fixture(name), "https://archive.example/")).rejects.toThrow();
  });
  it("refuses CRC damage, changed acceptance facts and missing original ranges", async () => {
    const source = fixture("site"), directory = await readArchiveDirectory(source, "https://archive.example/");
    await expect(readArchiveOriginalFile(source, { ...directory, directoryFingerprint: "0".repeat(64) }, "site/index.html")).rejects.toThrow(/changed/);
    await expect(readArchiveDirectory({ ...source, async readRange(start, end) { return (await source.readRange(start, end)).subarray(1); } }, "https://archive.example/")).rejects.toThrow();
    const damaged = fixture("damaged-checksum"), damagedDirectory = await readArchiveDirectory(damaged, "https://archive.example/");
    const page = damagedDirectory.files.find(file => file.kind === "page")!;
    await expect(readArchiveOriginalFile(damaged, damagedDirectory, page.path)).rejects.toThrow();
  });
});


describe("bounded original ZIP indexing phases (C3.47)", () => {
  it("resumes actual 501 HTML files without shadow bodies or invented WP identities", async () => {
    const source = bytesSource(largeZip()), directory = await readArchiveDirectory(source, "https://fictional-zip.example/site-a/");
    const first = await indexArchivePhase(source, directory);
    expect(first.done).toBe(false); expect(first.entries).toHaveLength(500);
    expect(first.cursor.ordinal).toBe(500);
    const second = await indexArchivePhase(source, directory, first.cursor);
    expect(second.done).toBe(true); expect(second.entries).toHaveLength(1);
    expect(second.entries[0]).toMatchObject({ ordinal: 500, file: { path: "site/page-500.html" }, page: { sourcePath: "/site-a/page-500.html" } });
    const all = [...first.entries, ...second.entries];
    expect(new Set(all.map(entry => entry.identity)).size).toBe(501);
    expect(all.every(entry => entry.contentDigest?.length === 64 && !Object.hasOwn(entry.page!, "body") && !Object.hasOwn(entry, "wpId"))).toBe(true);
    expect(await indexArchivePhase(source, directory, first.cursor)).toEqual(second);
    await expect(indexArchivePhase(source, { ...directory, directoryFingerprint: "f".repeat(64) }, first.cursor)).rejects.toThrow(/changed/);
  });
  it("reconstructs global slug collisions when a phase resumes", async () => {
    const files = Array.from({ length: 499 }, (_, index) => ({ path: `site/page-${index}.html`, body: `<h1>Fictional ${index}</h1>` }));
    files[0] = { path: "site/index.html", body: "<h1>Fictional home</h1>" };
    files.push({ path: "site/about.html", body: "<h1>Original first</h1>" }, { path: "site/about/index.html", body: "<h1>Original later</h1>" });
    const source = bytesSource(storedZip(files)), directory = await readArchiveDirectory(source, "https://fictional-zip.example/");
    const first = await indexArchivePhase(source, directory);
    const second = await indexArchivePhase(source, directory, first.cursor);
    expect(first.entries.at(-1)?.page?.slug).toBe("about");
    expect(second.entries[0]?.page?.slug).toBe("about-2");
  });
  it("revalidates an ignored-only final phase against the original directory", async () => {
    const files = Array.from({ length: 500 }, (_, index) => ({ path: index ? `site/page-${index}.html` : "site/index.html", body: `<h1>Fictional ${index}</h1>` }));
    files.push({ path: "notes.txt", body: "Fictional original packaging" });
    const original = bytesSource(storedZip(files)), directory = await readArchiveDirectory(original, "https://fictional-zip.example/");
    const first = await indexArchivePhase(original, directory);
    expect(first.cursor.ordinal).toBe(500);
    files[500] = { path: "other.txt", body: "Fictional changed packaging" };
    await expect(indexArchivePhase(bytesSource(storedZip(files)), directory, first.cursor)).rejects.toThrow(/changed/);
    const final = await indexArchivePhase(original, directory, first.cursor);
    expect(final).toMatchObject({ done: true, entries: [{ file: { path: "notes.txt", kind: "ignored", url: null } }] });
  });

  it("hashes actual media bytes in their own bounded phase without emitting payload copies", async () => {
    const body = "F".repeat(21 * 1024 * 1024);
    const source = bytesSource(storedZip([{ path: "site/index.html", body: "<h1>Fictional media archive</h1>" }, { path: "site/film.mp4", body }]));
    const directory = await readArchiveDirectory(source, "https://fictional-zip.example/");
    const first = await indexArchivePhase(source, directory);
    expect(first.entries).toHaveLength(1); expect(first.done).toBe(false);
    const media = await indexArchivePhase(source, directory, first.cursor);
    expect(media.entries).toHaveLength(1); expect(media.done).toBe(true);
    expect(media.entries[0]).toMatchObject({ file: { path: "site/film.mp4", kind: "asset", bytes: body.length }, contentDigest: createHash("sha256").update(body).digest("hex") });
    expect(media.cursor.bodyBytes).toBe(first.cursor.bodyBytes);
    expect(JSON.stringify(media.entries)).not.toContain(body.slice(0, 100));
  });

  it("maps actual static files to normalized graph rows and refuses fake identities or body copies", async () => {
    const source = bytesSource(storedZip([
      { path: "site/index.html", body: "<html><head><title>Fictional source title</title></head><body><h1>Fictional article</h1></body></html>" },
      { path: "site/image.png", body: "fictional original media bytes" },
      { path: "notes.txt", body: "fictional packaging" },
    ]));
    const directory = await readArchiveDirectory(source, "https://fictional-zip.example/");
    const phase = await indexArchivePhase(source, directory);
    const rows = phase.entries.map(archiveGraphEntry);
    expect(rows.map(row => row.kind)).toEqual(["page", "attachment", "skipped"]);
    expect(rows[0]?.metadata).toMatchObject({ format: "archive-zip", title: "Fictional source title", sourcePath: "/index.html" });
    expect(rows[1]?.metadata.contentDigest).toBe(createHash("sha256").update("fictional original media bytes").digest("hex"));
    expect(rows[2]?.metadata).not.toHaveProperty("contentDigest");
    expect(archiveGraphEntrySchema.safeParse({ ...rows[0], metadata: { ...rows[0]!.metadata, wpId: "1001" } }).success).toBe(false);
    expect(archiveGraphEntrySchema.safeParse({ ...rows[0], metadata: { ...rows[0]!.metadata, body: "shadow source body" } }).success).toBe(false);
    expect(sourceGraphEntrySchema.safeParse({ ...rows[0], metadata: { ...rows[0]!.metadata, body: "shadow source body" } }).success).toBe(false);
    expect(sourceGraphCursorSchema.safeParse({ format: "archive-zip", directoryFingerprint: null, ordinal: 1, nextByte: 20, bodyBytes: 0, metadataBytes: 0 }).success).toBe(false);
    expect(sourceGraphCursorSchema.parse({ nextByte: 0, ordinal: 0, bodyBytes: 0, metadataBytes: 0, header: null })).toEqual({ nextByte: 0, ordinal: 0, bodyBytes: 0, metadataBytes: 0, header: null });
    expect(archiveGraphEntrySchema.safeParse({ ...rows[0], start: rows[0]!.start + 1 }).success).toBe(false);
  });

});
