// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { importSourceRanges } from "@/core/import/source-range";
import { indexWxrPhase, IMPORT_GRAPH_LIMITS } from "@/core/import/wxr-index";
import { IMPORT_SOURCE_CHUNK_BYTES } from "@/core/import/retained-source";

const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
function source(raw: string) {
  const bytes = new TextEncoder().encode(raw);
  return { bytes, reader: { bytes: bytes.byteLength, readRange: async (start: number, end: number) => bytes.slice(start, end) } };
}
const head = '\uFEFF<rss xmlns:wp="http://wordpress.org/export/1.2/"><channel><title>Café</title><link>https://source.example</link><wp:author><wp:author_login>owner</wp:author_login><wp:author_email>private-author@example.test</wp:author_email></wp:author>';
const page = (id: number) => `<item><title>Crème 😀 ${id}</title><link>https://source.example/page-${id}</link><wp:post_id>${id}</wp:post_id><wp:post_name>page-${id}</wp:post_name><wp:post_type>page</wp:post_type><wp:status>publish</wp:status><content:encoded><![CDATA[<p id="body">${id}</p>]]></content:encoded><wp:comment><wp:comment_id>${id}</wp:comment_id><wp:comment_author_email>private-reader@example.test</wp:comment_author_email><wp:comment_content>Private comment text</wp:comment_content></wp:comment></item>`;

describe("bounded immutable WXR entry index (C3.47)", () => {
  it("splits 501 real entries without expanding the 500-entry phase or copying private bodies", async () => {
    const { reader, bytes } = source(`${head}${Array.from({ length: 501 }, (_, index) => page(index)).join(" ")} </channel></rss>`);
    const first = await indexWxrPhase(reader);
    expect(first.done).toBe(false); expect(first.entries).toHaveLength(500); expect(first.cursor.ordinal).toBe(500);
    // A new reader/cursor has no shared parser state from the first phase.
    const second = await indexWxrPhase({ ...reader }, structuredClone(first.cursor));
    expect(second.done).toBe(true); expect(second.entries).toHaveLength(1); expect(second.cursor.ordinal).toBe(501);
    expect(second.entries[0]!.metadata.wpId).toBe("500");
    for (const entry of [...first.entries, ...second.entries]) expect(sha(bytes.slice(entry.start, entry.end))).toBe(entry.digest);
    const persisted = JSON.stringify({ first, second });
    for (const value of ["private-author@", "private-reader@", "Private comment text", '<p id="body">']) expect(persisted).not.toContain(value);
  });
  it("rejects changed headers and total-budget overflow instead of persisting a partial plan", async () => {
    const { reader, bytes } = source(`${head}${page(1)}</channel></rss>`);
    const phase = await indexWxrPhase(reader);
    bytes[10] = bytes[10]! ^ 1;
    await expect(indexWxrPhase(reader, phase.cursor)).rejects.toThrow(/header/);
    const fresh = source(`${head}${page(1)}</channel></rss>`);
    const before = await indexWxrPhase(fresh.reader);
    await expect(indexWxrPhase(fresh.reader, { ...before.cursor, nextByte: before.entries[0]!.start, ordinal: IMPORT_GRAPH_LIMITS.entries })).rejects.toThrow(/total/);
  });
  it("keeps attachments after the first page batch visible to the global graph", async () => {
    const { reader } = source(`${head}${Array.from({ length: 500 }, (_, index) => page(index)).join("")}<item><wp:post_id>9000</wp:post_id><wp:post_type>attachment</wp:post_type><wp:attachment_url>https://source.example/late.jpg</wp:attachment_url></item></channel></rss>`);
    const first = await indexWxrPhase(reader), second = await indexWxrPhase(reader, first.cursor);
    expect(second.entries).toMatchObject([{ kind: "attachment", metadata: { wpId: "9000", url: "https://source.example/late.jpg" } }]);
  });
});

describe("bounded source range cache", () => {
  it("evicts old chunks, verifies exact bytes and refuses oversized reads", async () => {
    const chunks = [1, 2, 3].map(value => new Uint8Array(IMPORT_SOURCE_CHUNK_BYTES).fill(value));
    const reads: number[] = [];
    const ranges = importSourceRanges({ bytes: IMPORT_SOURCE_CHUNK_BYTES * 3, chunkBytes: IMPORT_SOURCE_CHUNK_BYTES, chunkDigests: chunks.map(sha) }, async index => { reads.push(index); return chunks[index]!; });
    for (const index of [0, 1, 2, 0]) expect((await ranges.readRange(index * IMPORT_SOURCE_CHUNK_BYTES, index * IMPORT_SOURCE_CHUNK_BYTES + 1))[0]).toBe(index + 1);
    expect(reads).toEqual([0, 1, 2, 0]);
    await expect(ranges.readRange(-1, 1)).rejects.toThrow(/range/);
    chunks[1]![0] = 0;
    await expect(ranges.readRange(IMPORT_SOURCE_CHUNK_BYTES, IMPORT_SOURCE_CHUNK_BYTES + 1)).rejects.toThrow(/changed/);
  });
});
