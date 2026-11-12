// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: bounded original JSON-array ranges for the durable REST adapter.
import { createHash } from "node:crypto";
import { z } from "zod";
import { DEFAULT_IMPORTER_LIMITS } from "./contract";
import { IMPORT_SOURCE_CHUNK_BYTES, IMPORT_SOURCE_MAX_BYTES } from "./retained-source";
import { IMPORT_SOURCE_RANGE_MAX_BYTES, type ImportSourceRanges } from "./source-range";
import { IMPORT_GRAPH_LIMITS } from "./wxr-index";

export const jsonSourceCursorSchema = z.object({
  nextByte: z.number().int().nonnegative().max(IMPORT_SOURCE_MAX_BYTES),
  ordinal: z.number().int().nonnegative().max(IMPORT_GRAPH_LIMITS.entries),
});
export type JsonSourceCursor = z.infer<typeof jsonSourceCursorSchema>;
export type JsonSourceEntry = { ordinal: number; start: number; end: number; digest: string; value: unknown };
const whitespace = (byte: number | null) => byte !== null && [9, 10, 13, 32].includes(byte);

/** The caller supplies the manifest-verifying, currently authorized reader.
 * A candidate cursor is accepted only by the adapter's original-source CAS.
 * This function creates no graph, CMS record, credential or storage object.
 */
export async function readJsonSourcePhase(source: ImportSourceRanges, previous?: JsonSourceCursor): Promise<{ cursor: JsonSourceCursor; entries: JsonSourceEntry[]; done: boolean }> {
  const cursor = jsonSourceCursorSchema.parse(previous ?? { nextByte: 0, ordinal: 0 });
  if (!Number.isSafeInteger(source.bytes) || source.bytes <= 0 || source.bytes > IMPORT_SOURCE_MAX_BYTES || cursor.nextByte > source.bytes || (cursor.nextByte === 0 && cursor.ordinal !== 0)) throw new Error("The JSON cursor is outside its original source.");
  const entries: JsonSourceEntry[] = [];
  if (cursor.nextByte === source.bytes) return { cursor, entries, done: true };
  let position = cursor.nextByte, cachedStart = -1, phaseBytes = 0;
  let cached: Uint8Array = new Uint8Array(0);
  const byte = async (): Promise<number | null> => {
    if (position === source.bytes) return null;
    if (position < cachedStart || position >= cachedStart + cached.byteLength) {
      cachedStart = Math.floor(position / IMPORT_SOURCE_CHUNK_BYTES) * IMPORT_SOURCE_CHUNK_BYTES;
      const end = Math.min(source.bytes, cachedStart + IMPORT_SOURCE_CHUNK_BYTES);
      cached = await source.readRange(cachedStart, end);
      if (cached.byteLength !== end - cachedStart) throw new Error("The original JSON source returned an incomplete range.");
    }
    return cached[position - cachedStart]!;
  };
  const skipWhitespace = async () => { while (whitespace(await byte())) position++; };
  const finish = async () => {
    await skipWhitespace();
    if (position !== source.bytes) throw new Error("The original JSON array has trailing content.");
    cursor.nextByte = source.bytes;
    return { cursor, entries, done: true };
  };
  let allowEmpty = cursor.nextByte === 0;
  if (allowEmpty) {
    if (await byte() === 0xef) {
      position++; if (await byte() !== 0xbb) throw new Error("The JSON source has an invalid byte-order mark.");
      position++; if (await byte() !== 0xbf) throw new Error("The JSON source has an invalid byte-order mark.");
      position++;
    }
    await skipWhitespace();
    if (await byte() !== 0x5b) throw new Error("WordPress REST expected an original JSON array.");
    position++;
  } else {
    await skipWhitespace();
    if (await byte() !== 0x2c) throw new Error("The saved JSON cursor does not end at an original entry separator.");
    position++;
  }
  while (entries.length < DEFAULT_IMPORTER_LIMITS.maxPages) {
    await skipWhitespace();
    const first = await byte();
    if (first === 0x5d && allowEmpty) { position++; return finish(); }
    if (first !== 0x7b) throw new Error("Every REST source entry must be a JSON object; missing entries and trailing commas are refused.");
    if (cursor.ordinal >= IMPORT_GRAPH_LIMITS.entries) throw new Error("The JSON source exceeds its total record budget.");
    const start = position, stack: number[] = [];
    let inString = false, escaped = false;
    do {
      const next = await byte();
      if (next === null) throw new Error("The original JSON entry is incomplete.");
      if (position - start >= IMPORT_SOURCE_RANGE_MAX_BYTES) throw new Error("One JSON entry exceeds its source-range budget.");
      if (inString) {
        if (escaped) escaped = false;
        else if (next === 0x5c) escaped = true;
        else if (next === 0x22) inString = false;
      } else if (next === 0x22) inString = true;
      else if (next === 0x7b || next === 0x5b) stack.push(next);
      else if (next === 0x7d || next === 0x5d) {
        if (stack.pop() !== (next === 0x7d ? 0x7b : 0x5b)) throw new Error("The original JSON entry has unbalanced containers.");
      }
      position++;
    } while (stack.length || inString);
    const end = position;
    if (entries.length && phaseBytes + end - start > IMPORT_SOURCE_RANGE_MAX_BYTES) {
      return { cursor, entries, done: false };
    }
    const original = await source.readRange(start, end);
    if (original.byteLength !== end - start) throw new Error("The original JSON entry returned an incomplete range.");
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(original)); }
    catch {
      // Native JSON errors can quote original content. This message may be
      // retained on an import run; preserve position without copying its body.
      throw new Error(`Original JSON entry ${cursor.ordinal + 1} is not valid UTF-8 JSON.`);
    }
    await skipWhitespace();
    const separator = await byte();
    if (separator !== 0x2c && separator !== 0x5d) throw new Error("The original JSON array has an invalid entry separator.");
    position++;
    entries.push({ ordinal: cursor.ordinal++, start, end, digest: createHash("sha256").update(original).digest("hex"), value });
    phaseBytes += end - start;
    // Persist the exact accepted original end, not a delimiter lookahead. This
    // matches the shared graph CAS and never accepts an unindexed source byte.
    cursor.nextByte = end;
    if (separator === 0x5d) return finish();
    allowEmpty = false;
  }
  return { cursor, entries, done: false };
}
