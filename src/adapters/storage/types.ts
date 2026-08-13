// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The storage adapter contract (MASTER.md §12). Core never imports a vendor
// SDK; it imports this interface, and the implementation is chosen by
// freeholder.config.ts. Swapping DigitalOcean Spaces for Cloudflare R2, MinIO
// or Replit Object Storage is a config change, not a code change — which is
// the whole point of "owning means being able to leave" (§1).
//
// Deliberately small. Every method here is one an owner's files genuinely
// need; anything vendor-specific stays behind the implementation.

export type StorageId = "s3" | "replit" | "local";

export interface StoredObject {
  key: string;
  bytes: number;
  contentType: string;
}

export interface StoredObjectHead {
  key: string;
  bytes: number;
  contentType: string;
  etag?: string;
}

export interface MultipartPart {
  partNumber: number;
  etag: string;
  bytes?: number;
}

/** Optional capability: only object stores that really support it expose it. */
export interface DirectMultipartStorage {
  create(key: string, contentType: string): Promise<{ uploadId: string }>;
  signPart(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresIn?: number,
  ): Promise<{ url: string; method: "PUT" }>;
  listParts(key: string, uploadId: string): Promise<MultipartPart[]>;
  complete(
    key: string,
    uploadId: string,
    parts: MultipartPart[],
  ): Promise<StoredObjectHead>;
  abort(key: string, uploadId: string): Promise<void>;
}

export interface SignedUrlOptions {
  /** Seconds. Implementations may cap this; none may ignore it. */
  expiresIn?: number;
  /** Ask the browser to download rather than display, under this filename. */
  downloadAs?: string;
  /** Override provider metadata with the server-verified canonical type. */
  contentType?: string;
}

export interface StorageAdapter {
  readonly id: StorageId;

  /**
   * Whether objects are reachable without a signature. Client galleries and
   * paywalled files (§4.5, §4.3) depend on the answer being *no* for private
   * buckets, so callers must ask rather than assume.
   */
  readonly isPublic: boolean;

  /** Present only when the browser can upload resumable parts directly. */
  readonly directMultipart?: DirectMultipartStorage;

  /**
   * The buffer type is named explicitly: a bare `Uint8Array` is backed by
   * `ArrayBufferLike`, which includes `SharedArrayBuffer` and is therefore not
   * a valid request body. Being precise here beats a cast in each adapter.
   */
  put(
    key: string,
    body: Uint8Array<ArrayBuffer>,
    contentType: string,
  ): Promise<StoredObject>;

  get(key: string): Promise<Uint8Array<ArrayBuffer> | undefined>;

  /** Metadata and a bounded prefix let completion validate huge files safely. */
  head(key: string): Promise<StoredObjectHead | undefined>;

  readRange(
    key: string,
    start: number,
    endInclusive: number,
  ): Promise<Uint8Array<ArrayBuffer> | undefined>;

  /** A fresh stream for hashing or an attached malware scanner. */
  stream(
    key: string,
  ): Promise<AsyncIterable<Uint8Array<ArrayBuffer>> | undefined>;

  delete(key: string): Promise<void>;

  /**
   * A URL a browser can fetch. For a private bucket this is signed and
   * expiring; for a public one it is the plain object URL and `expiresIn` is
   * moot. Async because signing is, and because a caller that awaits works
   * with every implementation.
   */
  url(key: string, options?: SignedUrlOptions): Promise<string>;
}

/**
 * Where an object lives. Keys are grouped by date so a bucket stays navigable
 * by hand years later, and end in a random segment so two files uploaded with
 * the same name in the same second cannot collide.
 */
export function storageKey(
  filename: string,
  at: Date,
  random: string,
): string {
  const year = at.getUTCFullYear();
  const month = String(at.getUTCMonth() + 1).padStart(2, "0");
  // Anything that could confuse a path, a shell, or a URL is replaced. The
  // original filename is kept on the Asset row; this is only the storage key.
  //
  // Runs of dots are collapsed as well as separators: "../../etc/passwd" is
  // already harmless once slashes are gone, but it would leave "..-..-etc" in
  // the key. A bucket listing full of dot-dot is alarming to read and trips
  // tooling that treats the sequence as meaningful, so it does not survive.
  const safe = filename
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(-80);
  return `${year}/${month}/${random}-${safe || "file"}`;
}
