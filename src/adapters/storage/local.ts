// Copyright (C) 2026 Camp Denman Society
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

export interface LocalConfig {
  /** Directory to write under. Created on demand. */
  root: string;
  /** Path the files are served from, for building URLs. */
  publicPath: string;
}

export function createLocalStorage(config: LocalConfig): StorageAdapter {
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
