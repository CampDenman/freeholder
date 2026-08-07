// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Filesystem storage. **Development only** — §10 and §18 both say production
// mandates managed object storage, because a droplet's disk is not backed up,
// does not survive a rebuild, and cannot be shared by two app processes.
//
// It exists so `pnpm dev` works with no cloud account at all, and so the
// adapter contract has a second implementation keeping it honest: an interface
// with one implementation is just that implementation with extra steps.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { StorageAdapter, StoredObject } from "@/adapters/storage/types";
import { env } from "@/core/env";

export interface LocalConfig {
  /** Directory to write under. Created on demand. */
  root: string;
  /** Path the files are served from, for building URLs. */
  publicPath: string;
}

/**
 * §18's storage mandate, enforced rather than documented: media is the least
 * recoverable asset a business has, and a droplet's disk is not backed up, does
 * not survive a rebuild, and cannot be shared by two processes. A dead box must
 * never be able to take the photo archive with it.
 *
 * The override exists because a self-hoster who genuinely means it should not
 * be locked out of their own software — and it is named to be embarrassing in
 * a config review, which is the point.
 */
function refuseInProduction(): void {
  // Through env() like everything else: a guard that decides for itself what
  // production means can disagree with the platform that configured it, and
  // the disagreement is only discovered by losing an owner's media.
  const { NODE_ENV, FREEHOLDER_UNSAFE_LOCAL_STORAGE } = env();
  if (NODE_ENV !== "production") return;
  if (FREEHOLDER_UNSAFE_LOCAL_STORAGE === "1") {
    console.warn(
      "[storage] Using local disk in production because " +
        "FREEHOLDER_UNSAFE_LOCAL_STORAGE=1. Uploaded media will be lost if " +
        "this machine is rebuilt, and cannot be served by a second instance.",
    );
    return;
  }
  throw new Error(
    "Storage is set to \"local\", which is for development only: media on a " +
      "server's own disk is not backed up and does not survive a rebuild " +
      "(MASTER.md §18).\n" +
      "Set adapters.storage to \"s3\" in freeholder.config.ts and configure " +
      "S3_* in the environment — DigitalOcean Spaces, Cloudflare R2, MinIO and " +
      "AWS all work.\n" +
      "If you truly intend to keep media on this machine's disk, set " +
      "FREEHOLDER_UNSAFE_LOCAL_STORAGE=1.",
  );
}

export function createLocalStorage(config: LocalConfig): StorageAdapter {
  refuseInProduction();
  const root = resolve(config.root);

  /**
   * A key is attacker-influenced (it derives from an uploaded filename), so
   * every path is re-checked to be inside the root. Without this, a key
   * containing `../` writes anywhere the process can reach.
   */
  const pathFor = (key: string): string => {
    const target = resolve(join(root, key));
    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error(`storage: key escapes the storage root: ${key}`);
    }
    return target;
  };

  return {
    id: "local",
    isPublic: true,

    async put(key, body, contentType): Promise<StoredObject> {
      const target = pathFor(key);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, body);
      return { key, bytes: body.byteLength, contentType };
    },

    async get(key): Promise<Uint8Array<ArrayBuffer> | undefined> {
      try {
        return new Uint8Array(await readFile(pathFor(key)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
    },

    async delete(key): Promise<void> {
      // force: deleting what is not there already satisfies the caller.
      await rm(pathFor(key), { force: true });
    },

    async url(key): Promise<string> {
      return `${config.publicPath.replace(/\/+$/, "")}/${encodeURI(key)}`;
    },
  };
}
