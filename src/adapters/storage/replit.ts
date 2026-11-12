// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Replit Object Storage (MASTER.md §12, §20 — Replit is the Tier-1 recipe).
//
// The official client is a production dependency because Replit is Tier 1.
// It remains dynamically imported so non-Replit processes do not initialize a
// provider SDK they never use.
//
// Replit Object Storage buckets are private and have no public URL, so `url()`
// hands back a path served by the platform's own media route. That is the same
// shape a private S3 bucket takes, which is why the contract makes `url` async
// and `isPublic` explicit rather than assuming either.
import type { Bucket } from "@google-cloud/storage";
import { createHash } from "node:crypto";
import type { StorageAdapter, StoredObject } from "@/adapters/storage/types";
import { storageNamespace } from "@/core/media/storage-quota";

export interface ReplitConfig {
  /** Omitted on Replit, where the default bucket is discovered from the env. */
  bucketId?: string;
  /** Route that streams an object through the app, since reads are private. */
  mediaPath: string;
}

interface ReplitClient {
  uploadFromBytes(
    name: string,
    contents: Buffer,
  ): Promise<{ ok: boolean; error?: { message: string; statusCode?: number } }>;
  downloadAsBytes(
    name: string,
  ): Promise<{ ok: boolean; value?: Buffer[]; error?: { message: string; statusCode?: number } }>;
  delete(name: string): Promise<{ ok: boolean; error?: { message: string; statusCode?: number } }>;
}

function requireOriginalEndpoint(): void {
  if (process.env.STORAGE_EMULATOR_HOST !== undefined) throw new Error("Replit storage refuses STORAGE_EMULATOR_HOST; restore the original provider endpoint.");
}

async function connect(config: ReplitConfig): Promise<ReplitClient> {
  requireOriginalEndpoint();
  try {
    // Keep the narrow local shape so provider SDK changes are contained at the
    // adapter boundary rather than leaking through core.
    const specifier = "@replit/object-storage";
    const mod = (await import(specifier)) as {
      Client: new (options?: { bucketId?: string }) => ReplitClient;
    };
    requireOriginalEndpoint();
    return new mod.Client(
      config.bucketId ? { bucketId: config.bucketId } : undefined,
    );
  } catch {
    throw new Error(
      'Storage is set to "replit" but @replit/object-storage is not installed. ' +
        "Run `pnpm add @replit/object-storage`, or set storage to \"s3\" in " +
        "freeholder.config.ts if this instance is not on Replit.",
    );
  }
}

export function createReplitStorage(config: ReplitConfig): StorageAdapter {
  // Resolve the same default-bucket protocol used by pinned official SDK1.0.0
  // once, then give the SDK that explicit ID. A later default cannot silently
  // become evidence about an older bucket.
  let bucket: Promise<string> | undefined;
  const bucketOnce = () => { requireOriginalEndpoint(); return (bucket ??= (async () => {
    if (config.bucketId) return config.bucketId;
    const response = await fetch("http://127.0.0.1:1106/object-storage/default-bucket", { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("Replit's original object-storage bucket is unavailable.");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Replit returned an empty bucket response.");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 8_192) throw new Error("Replit's bucket response exceeded its bound.");
        chunks.push(part.value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const id = value && typeof value === "object" && "bucketId" in value ? value.bucketId : undefined;
    if (typeof id !== "string" || !/^[a-zA-Z0-9._-]{1,255}$/.test(id)) throw new Error("Replit did not return a valid original bucket ID.");
    return id;
  })()); };
  let client: Promise<ReplitClient> | undefined;
  const clientOnce = async () => {
    requireOriginalEndpoint();
    const value = await (client ??= bucketOnce().then(bucketId => connect({ ...config, bucketId })));
    requireOriginalEndpoint();
    return value;
  };
  let writableBucket: Promise<Bucket> | undefined;
  const writableOnce = async () => {
    requireOriginalEndpoint();
    const value = await (writableBucket ??= (async () => {
      const bucketId = await bucketOnce();
      const { Storage } = await import("@google-cloud/storage");
      requireOriginalEndpoint();
      // Exact official Replit1.0.0 credential-broker protocol. Its upload
      // wrapper cannot disable GCS's autonomous checksum-error DELETE.
      return new Storage({ projectId: "", retryOptions: { autoRetry: false, maxRetries: 0 }, credentials: {
        audience: "replit", subject_token_type: "access_token", type: "external_account",
        token_url: "http://127.0.0.1:1106/token", universe_domain: "googleapis.com",
        credential_source: { url: "http://127.0.0.1:1106/credential", format: { type: "json", subject_token_field_name: "access_token" } },
      } }).bucket(bucketId);
    })());
    requireOriginalEndpoint();
    return value;
  };

  return {
    id: "replit",
    // Objects are not reachable without going through the app.
    isPublic: false,
    async binding() {
      const bucketId = await bucketOnce();
      requireOriginalEndpoint();
      return { kind: "replit", namespace: storageNamespace({ id: "replit", bucket: bucketId }), location: { bucket: bucketId } };
    },

    async put(key, body, contentType, observation): Promise<StoredObject> {
      const file = (await writableOnce()).file(key);
      requireOriginalEndpoint();
      try {
        // Never authorize SDK integrity cleanup. Verify every target byte
        // ourselves, while retaining the positive ACK before readback.
        await file.save(Buffer.from(body), { validation: false, metadata: { contentType } });
      } catch {
        throw new Error("storage: original Replit upload was not acknowledged");
      }
      await observation?.onAccepted?.();
      requireOriginalEndpoint();
      const [actual] = await file.download({ validation: false });
      if (actual.length !== body.byteLength || createHash("sha256").update(actual).digest("hex") !== createHash("sha256").update(body).digest("hex")) throw new Error("storage: original Replit upload failed full-byte verification");
      return { key, bytes: body.byteLength, contentType };
    },

    async get(key): Promise<Uint8Array<ArrayBuffer> | undefined> {
      const result = await (await clientOnce()).downloadAsBytes(key);
      if (!result.ok) {
        if (result.error?.statusCode === 404) return undefined;
        throw new Error(`storage: read of ${key} failed`);
      }
      if (!result.value) throw new Error("storage: provider omitted the successful read result");
      return new Uint8Array(Buffer.concat(result.value));
    },

    async head(key) {
      const body = await this.get(key);
      return body
        ? { key, bytes: body.byteLength, contentType: "application/octet-stream" }
        : undefined;
    },

    async readRange(key, start, endInclusive) {
      const body = await this.get(key);
      return body?.slice(start, endInclusive + 1);
    },

    async stream(key) {
      const body = await this.get(key);
      if (!body) return undefined;
      return (async function* () {
        yield body;
      })();
    },

    async delete(key): Promise<void> {
      const result = await (await clientOnce()).delete(key);
      // Deleting what is not there already satisfies the caller.
      if (!result.ok && result.error?.statusCode !== 404) {
        throw new Error(
          `storage: delete of ${key} failed — ${result.error?.message ?? "unknown error"}`,
        );
      }
    },

    async url(key): Promise<string> {
      return `${config.mediaPath.replace(/\/+$/, "")}/${encodeURI(key)}`;
    },
  };
}
