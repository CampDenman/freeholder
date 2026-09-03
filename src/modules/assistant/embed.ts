// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Local embeddings for retrieval (MASTER.md §31, C9.22).
//
// Grounding must not spend the answer budget. A visitor question that only
// needs to find the parking policy should not call a billed model to embed
// "where do I park". This hash-and-bucket embedder is deterministic, has no
// key, and is the same function for indexing and for querying, so cosine
// search in pgvector is a real retrieval path even on an instance that has
// not configured a provider.
export const EMBEDDING_DIMENSIONS = 256;

/** L2-normalised 256-d bag of hashed tokens. */
export function embedText(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const tokens = text
    .toLowerCase()
    .normalize("NFKD")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1);
  for (const token of tokens) {
    const features = token.length >= 4 ? [token, token.slice(0, 4)] : [token];
    for (const feature of features) {
      let hash = 2166136261;
      for (let i = 0; i < feature.length; i += 1) {
        hash = Math.imul(hash ^ feature.charCodeAt(i), 16777619);
      }
      const unsigned = hash >>> 0;
      const a = unsigned % EMBEDDING_DIMENSIONS;
      const b = (unsigned >>> 8) % EMBEDDING_DIMENSIONS;
      vec[a] = (vec[a] ?? 0) + 1;
      vec[b] = (vec[b] ?? 0) + 0.5;
    }
  }
  let norm = 0;
  for (const value of vec) norm += value * value;
  const scale = norm > 0 ? 1 / Math.sqrt(norm) : 0;
  return vec.map((value) => value * scale);
}

