// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Original private source ranges, bounded independently of total file size.
import { createHash } from "node:crypto";
import { IMPORT_SOURCE_CHUNK_BYTES, IMPORT_SOURCE_MAX_BYTES } from "./retained-source";

export type ImportSourceRanges = { bytes: number; readRange(start: number, end: number): Promise<Uint8Array> };
export const IMPORT_SOURCE_RANGE_MAX_BYTES = 32 * 1024 * 1024;

/** The supplied reader must authorize the current run/upload/expiry per read. */
export function importSourceRanges(
  source: { bytes: number; chunkBytes: number; chunkDigests: readonly string[] },
  readChunk: (index: number) => Promise<Uint8Array>,
): ImportSourceRanges {
  if (!Number.isSafeInteger(source.bytes) || source.bytes <= 0 || source.bytes > IMPORT_SOURCE_MAX_BYTES || source.chunkBytes !== IMPORT_SOURCE_CHUNK_BYTES || source.chunkDigests.length !== Math.ceil(source.bytes / source.chunkBytes) || source.chunkDigests.some(digest => !/^[a-f0-9]{64}$/.test(digest))) throw new Error("The immutable import source manifest is invalid.");
  // At most two verified chunks survive between reads. The caller cannot
  // accidentally retain a second full copy of a 100 MB original.
  const cache = new Map<number, Uint8Array>();
  const chunk = async (index: number): Promise<Uint8Array> => {
    const cached = cache.get(index);
    if (cached) { cache.delete(index); cache.set(index, cached); return cached; }
    const bytes = await readChunk(index);
    if (bytes.byteLength !== Math.min(source.chunkBytes, source.bytes - index * source.chunkBytes) || createHash("sha256").update(bytes).digest("hex") !== source.chunkDigests[index]) throw new Error("The immutable import source chunk is missing or changed.");
    cache.set(index, bytes);
    if (cache.size > 2) cache.delete(cache.keys().next().value!);
    return bytes;
  };
  return {
    bytes: source.bytes,
    async readRange(start, end) {
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > source.bytes || end - start > IMPORT_SOURCE_RANGE_MAX_BYTES) throw new Error("The import source requests an invalid or oversized private range.");
      const out = new Uint8Array(end - start);
      for (let cursor = start; cursor < end;) {
        const index = Math.floor(cursor / source.chunkBytes), bytes = await chunk(index);
        const from = cursor - index * source.chunkBytes, take = Math.min(bytes.byteLength - from, end - cursor);
        out.set(bytes.subarray(from, from + take), cursor - start);
        cursor += take;
      }
      return out;
    },
  };
}
