// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.22: one bounded reader over the retained original private ZIP chunks.
import { createHash } from "node:crypto";
import { ARCHIVE_LIMITS, type ArchiveSource } from "./archive";

export function archiveRangeSource(
  source: { bytes: number; chunkBytes: number; chunkDigests: readonly string[] },
  readChunk: (index: number) => Promise<Uint8Array>,
): ArchiveSource {
  if (!Number.isSafeInteger(source.bytes) || source.bytes < 22 || source.bytes > ARCHIVE_LIMITS.compressedBytes || !Number.isSafeInteger(source.chunkBytes) || source.chunkBytes <= 0 || source.chunkDigests.length !== Math.ceil(source.bytes / source.chunkBytes) || source.chunkDigests.some(digest => !/^[a-f0-9]{64}$/.test(digest))) throw new Error("The retained archive manifest is invalid.");
  // One attempt may cache at most the bounded original ZIP. Every chunk was
  // read through the run/upload/expiry authorizer supplied by the caller.
  const chunks = new Map<number, Promise<Uint8Array>>();
  const chunk = (index: number): Promise<Uint8Array> => {
    let pending = chunks.get(index);
    if (!pending) {
      pending = readChunk(index).then(bytes => {
        const expected = Math.min(source.chunkBytes, source.bytes - index * source.chunkBytes);
        if (bytes.byteLength !== expected || createHash("sha256").update(bytes).digest("hex") !== source.chunkDigests[index]) throw new Error("A retained archive chunk is missing or changed.");
        return bytes;
      }).catch(error => { chunks.delete(index); throw error; });
      chunks.set(index, pending);
    }
    return pending;
  };
  return {
    bytes: source.bytes,
    async readRange(start, end) {
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > source.bytes) throw new Error("The ZIP requests an invalid private range.");
      const out = new Uint8Array(end - start);
      let cursor = start;
      while (cursor < end) {
        const index = Math.floor(cursor / source.chunkBytes), bytes = await chunk(index);
        const from = cursor - index * source.chunkBytes, take = Math.min(bytes.byteLength - from, end - cursor);
        out.set(bytes.subarray(from, from + take), cursor - start);
        cursor += take;
      }
      return out;
    },
  };
}
