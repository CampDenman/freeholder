// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: durable REST entry candidates retain ordinary phase and graph limits.
import { describe, expect, it } from "vitest";
import { indexRestPhase } from "@/core/import/rest-index";

const ORIGIN = "https://fictional-rest-source.example";
const source = (rows: unknown[]) => {
  const bytes = new TextEncoder().encode(JSON.stringify(rows));
  return { bytes: bytes.byteLength, readRange: async (start: number, end: number) => bytes.slice(start, end) };
};
const row = (id: number, body = "<p>Original REST body العربية.</p>") => ({ id, type: "page", status: "publish", link: `${ORIGIN}/rest/page-${id}`, title: { rendered: `Fictional REST page ${id}` }, content: { rendered: body } });

describe("durable REST index candidates (C3.47)", () => {
  it("indexes 500+1 original records with immutable header, identities and global placement", async () => {
    const rows = Array.from({ length: 501 }, (_, id) => row(id + 1));
    const first = await indexRestPhase(source(rows), undefined, ORIGIN);
    expect(first.entries).toHaveLength(500); expect(first.done).toBe(false);
    const next = await indexRestPhase(source(rows), first.cursor, ORIGIN);
    expect(next.entries).toHaveLength(1); expect(next.done).toBe(true);
    expect(next.cursor).toMatchObject({ ordinal: 501, nextByte: source(rows).bytes, header: first.cursor.header });
    expect(next.entries[0]).toMatchObject({ ordinal: 500, kind: "page", metadata: { wpId: "501", sourcePath: "rest/page-501", targetSlug: "rest/page-501" } });
    expect(new Set([...first.entries, ...next.entries].map(entry => entry.identity)).size).toBe(501);
  });

  it("records referenced media for complete review without copying bodies into metadata", async () => {
    const original = row(1, `<p>Original body.</p><img class="wp-image-9" src="${ORIGIN}/shared.jpg">`);
    const phase = await indexRestPhase(source([original]), undefined, ORIGIN);
    expect(phase.entries[0]?.metadata.images).toEqual([{ src: `${ORIGIN}/shared.jpg`, wpId: "9" }]);
    expect(JSON.stringify(phase.entries[0]?.metadata)).not.toContain("Original body");
    expect(phase.headerMetadata).toEqual({ site: { title: "", url: ORIGIN }, menus: [] });
  });

  it("stops at the original accepted record end when body bytes exceed one phase", async () => {
    const rows = [row(1, "x".repeat(10 * 1024 * 1024)), row(2, "y".repeat(11 * 1024 * 1024))];
    const first = await indexRestPhase(source(rows), undefined, ORIGIN);
    expect(first.entries).toHaveLength(1); expect(first.done).toBe(false);
    expect(first.cursor.nextByte).toBe(first.entries[0]?.end);
    const next = await indexRestPhase(source(rows), first.cursor, ORIGIN);
    expect(next.entries).toHaveLength(1); expect(next.done).toBe(true);
    expect(next.cursor).toMatchObject({ ordinal: 2, bodyBytes: 21 * 1024 * 1024 });
  });

  it("keeps skipped records explicit and binds reused numeric identities across types", async () => {
    const page = await indexRestPhase(source([row(9)]), undefined, ORIGIN);
    const skipped = await indexRestPhase(source([{ ...row(9), type: "unsupported" }]), undefined, ORIGIN);
    expect(skipped.entries[0]).toMatchObject({ kind: "skipped", metadata: { wpId: "9", reason: "post type: unsupported" }, bodyBytes: 0 });
    expect(skipped.entries[0]?.identity).toBe(page.entries[0]?.identity);
  });

  it("refuses missing identities and a changed original header", async () => {
    await expect(indexRestPhase(source([{ ...row(1), id: undefined }]), undefined, ORIGIN)).rejects.toThrow();
    const original = source(Array.from({ length: 501 }, (_, id) => row(id + 1)));
    const first = await indexRestPhase(original, undefined, ORIGIN);
    await expect(indexRestPhase(original, { ...first.cursor, header: { ...first.cursor.header!, digest: "a".repeat(64) } }, ORIGIN)).rejects.toThrow(/header changed/);
  });
});
