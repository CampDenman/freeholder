// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: original UTF-8 ranges remain bounded across independent REST phases.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { jsonSourceCursorSchema, readJsonSourcePhase } from "@/core/import/json-source-ranges";
import { IMPORT_SOURCE_RANGE_MAX_BYTES } from "@/core/import/source-range";

function original(bytes: Uint8Array) {
  const reads: number[] = [];
  return { reads, source: { bytes: bytes.byteLength, readRange: async (start: number, end: number) => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeLessThanOrEqual(bytes.byteLength);
    expect(end - start).toBeLessThanOrEqual(IMPORT_SOURCE_RANGE_MAX_BYTES);
    reads.push(end - start);
    return bytes.slice(start, end);
  } } };
}
const encoded = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe("bounded original REST JSON ranges (C3.47)", () => {
  it("resumes 500+1 objects with fresh readers and exact UTF-8 offsets/digests", async () => {
    const rows = Array.from({ length: 501 }, (_, id) => ({ id, content: { rendered: `Arabic العربية Español Français ${id} \" } ] \\` }, embedded: [{ author: "Fictional reader" }] }));
    const bytes = encoded(rows);
    const first = await readJsonSourcePhase(original(bytes).source);
    expect(first.entries).toHaveLength(500); expect(first.done).toBe(false);
    expect(first.cursor.ordinal).toBe(500);
    expect(first.cursor.nextByte).toBe(first.entries.at(-1)?.end);
    const second = await readJsonSourcePhase(original(bytes).source, jsonSourceCursorSchema.parse(JSON.parse(JSON.stringify(first.cursor))));
    expect(second.entries).toHaveLength(1); expect(second.done).toBe(true);
    expect(second.cursor).toEqual({ ordinal: 501, nextByte: bytes.byteLength });
    const entries = [...first.entries, ...second.entries];
    expect(entries.map(entry => entry.value)).toEqual(rows);
    for (const entry of entries) {
      const range = bytes.slice(entry.start, entry.end);
      expect(entry.digest).toBe(createHash("sha256").update(range).digest("hex"));
      expect(JSON.parse(new TextDecoder().decode(range))).toEqual(rows[entry.ordinal]);
    }
  });

  it("recognizes empty arrays, an initial UTF-8 BOM and legal trailing whitespace", async () => {
    const bytes = new TextEncoder().encode("\ufeff \r\n[ \t ]\r\n");
    expect(await readJsonSourcePhase(original(bytes).source)).toEqual({ entries: [], done: true, cursor: { nextByte: bytes.byteLength, ordinal: 0 } });
  });

  it.each(["{}", "[1]", "[null]", "[[]]", '[{"id":1},]', '[{"id":1},,{"id":2}]', '[{"id":1} {"id":2}]', '[{"id":1}]false', '[{"id":1}', '[{"id":]}]', '[{"id":"unfinished}]'])
    ("refuses malformed or unsupported array input %s", async input => {
      await expect(readJsonSourcePhase(original(new TextEncoder().encode(input)).source)).rejects.toThrow();
    });

  it("refuses a trailing comma at the exact 500-object continuation boundary", async () => {
    const bytes = new TextEncoder().encode(`${JSON.stringify(Array.from({ length: 500 }, (_, id) => ({ id }))).slice(0, -1)},]`);
    const first = await readJsonSourcePhase(original(bytes).source);
    expect(first.done).toBe(false);
    await expect(readJsonSourcePhase(original(bytes).source, first.cursor)).rejects.toThrow(/trailing commas/);
  });

  it("preserves strings and nested containers across a 4 MiB private chunk boundary", async () => {
    const rows = [{ id: 1, content: "x".repeat(4 * 1024 * 1024 - 40) + "\\\" العربية } ]", nested: [{ value: { other: true } }] }, { id: 2 }];
    const bytes = encoded(rows), fixture = original(bytes);
    const result = await readJsonSourcePhase(fixture.source);
    expect(result.done).toBe(true);
    expect(result.entries.map(entry => entry.value)).toEqual(rows);
    expect(fixture.reads.some(size => size === 4 * 1024 * 1024)).toBe(true);
  });

  it("refuses invalid UTF-8 rather than changing original reader or content bytes", async () => {
    const bytes = Uint8Array.from([0x5b, 0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d, 0x5d]);
    await expect(readJsonSourcePhase(original(bytes).source)).rejects.toThrow();
  });

  it("validates original cursors and the independent total-record budget", async () => {
    const bytes = encoded([{ id: 1 }]);
    await expect(readJsonSourcePhase(original(bytes).source, { nextByte: bytes.byteLength + 1, ordinal: 0 })).rejects.toThrow(/outside/);
    await expect(readJsonSourcePhase(original(bytes).source, { nextByte: 0, ordinal: 1 })).rejects.toThrow(/outside/);
    const two = encoded([{ id: 1 }, { id: 2 }]);
    await expect(readJsonSourcePhase(original(two).source, { nextByte: 9, ordinal: 10_000 })).rejects.toThrow(/total record budget/);
    await expect(readJsonSourcePhase({ bytes: bytes.byteLength, readRange: async () => new Uint8Array(0) })).rejects.toThrow(/incomplete range/);
  });
});
