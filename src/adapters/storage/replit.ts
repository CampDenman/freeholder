// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Replit Object Storage (MASTER.md §12, §20 — Replit is the Tier-1 recipe).
//
// The client is imported *dynamically*, and `@replit/object-storage` is an
// optional dependency. A DigitalOcean droplet or a Docker self-host should not
// install a Replit-only package to satisfy an import it will never evaluate,
// and §14's one-command deploy is slower for everybody if it does. The cost is
// this file having to say something useful when the package is absent, which
// is cheaper than the alternative.
//
// Replit Object Storage buckets are private and have no public URL, so `url()`
// hands back a path served by the platform's own media route. That is the same
// shape a private S3 bucket takes, which is why the contract makes `url` async
// and `isPublic` explicit rather than assuming either.
import type { StorageAdapter, StoredObject } from "@/adapters/storage/types";

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
  ): Promise<{ ok: boolean; error?: { message: string } }>;
  downloadAsBytes(
    name: string,
  ): Promise<{ ok: boolean; value?: Buffer[]; error?: { message: string } }>;
  delete(name: string): Promise<{ ok: boolean; error?: { message: string } }>;
}

async function connect(config: ReplitConfig): Promise<ReplitClient> {
  try {
    // The specifier is a variable so TypeScript does not try to resolve a
    // package that is deliberately not installed here. The shape is declared
    // above instead, which is the honest cost of an optional dependency.
    const specifier = "@replit/object-storage";
    const mod = (await import(specifier)) as {
      Client: new (options?: { bucketId?: string }) => ReplitClient;
    };
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
  let client: Promise<ReplitClient> | undefined;
  const clientOnce = () => (client ??= connect(config));

  return {
    id: "replit",
    // Objects are not reachable without going through the app.
    isPublic: false,

    async put(key, body, contentType): Promise<StoredObject> {
      const result = await (
        await clientOnce()
      ).uploadFromBytes(key, Buffer.from(body));
      if (!result.ok) {
        throw new Error(
          `storage: upload of ${key} failed — ${result.error?.message ?? "unknown error"}`,
        );
      }
      return { key, bytes: body.byteLength, contentType };
    },

    async get(key): Promise<Uint8Array<ArrayBuffer> | undefined> {
      const result = await (await clientOnce()).downloadAsBytes(key);
      if (!result.ok || !result.value?.length) return undefined;
      return new Uint8Array(result.value[0]!);
    },

    async delete(key): Promise<void> {
      const result = await (await clientOnce()).delete(key);
      // Deleting what is not there already satisfies the caller.
      if (!result.ok && !/not found/i.test(result.error?.message ?? "")) {
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
