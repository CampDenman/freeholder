// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Filesystem storage. The development default, and (C3.44) a supported
// production mode for a single-server install that keeps its media directory
// across updates and backs it up: the native Linux installer's
// /var/lib/freeholder/media, or the Docker recipe's named volume. What §18
// still refuses is the implicit relative directory, which lives inside the
// release or the container layer and is thrown away by a rebuild.
//
// One app process only: two processes on two machines cannot share it. Move
// to S3-compatible storage before scaling out (deploy/linux/README.md).
import { accessSync, constants, createReadStream, statSync } from "node:fs";
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { StorageAdapter, StoredObject } from "@/adapters/storage/types";
import { env } from "@/core/env";
import { localStorageMode } from "@/adapters/storage/local-mode";

export interface LocalConfig {
  /** Directory to write under. Created on demand. */
  root: string;
  /** Path the files are served from, for building URLs. */
  publicPath: string;
}

/**
 * §18's storage mandate, enforced rather than documented: media is the least
 * recoverable asset a business has. A production instance may keep it on
 * local disk only in a directory it names explicitly (an absolute
 * LOCAL_STORAGE_ROOT), which the self-host recipes keep across updates and
 * include in the nightly backup. That directory must already exist: creating
 * it on demand would quietly write to the container layer when a volume was
 * forgotten.
 *
 * The legacy override remains for an implicit directory, and it is still
 * named to be embarrassing in a config review.
 */
function refuseInProduction(root: string): void {
  // Through env() like everything else: a guard that decides for itself what
  // production means can disagree with the platform that configured it, and
  // the disagreement is only discovered by losing an owner's media.
  const current = env();
  const mode = localStorageMode(current);
  if (mode === "development") return;
  if (mode === "persistent") {
    let directory = false;
    try {
      directory = statSync(/* turbopackIgnore: true */ root).isDirectory();
      accessSync(/* turbopackIgnore: true */ root, constants.W_OK);
    } catch {
      directory = false;
    }
    if (!directory) {
      throw new Error(
        `LOCAL_STORAGE_ROOT (${root}) must be an existing directory this ` +
          "process can write. Create it on persistent disk (the self-host " +
          "installers do), or mount the recipe's media volume there.",
      );
    }
    return;
  }
  if (mode === "unsafe") {
    console.warn(
      "[storage] Using local disk in production because " +
        "FREEHOLDER_UNSAFE_LOCAL_STORAGE=1. Uploaded media will be lost if " +
        "this machine is rebuilt, and cannot be served by a second instance.",
    );
    return;
  }
  throw new Error(
    "Storage is set to \"local\" without a persistent directory. In " +
      "production, local disk is for development only unless it is a " +
      "directory you keep and back up (MASTER.md §18).\n" +
      "Set LOCAL_STORAGE_ROOT to an absolute path on persistent disk (the " +
      "self-host installers use /var/lib/freeholder/media), or set " +
      "adapters.storage to \"s3\" in freeholder.config.ts and configure S3_* " +
      "in the environment: DigitalOcean Spaces, Cloudflare R2, MinIO and AWS " +
      "all work.\n" +
      "To keep media in an implicit directory anyway, set " +
      "FREEHOLDER_UNSAFE_LOCAL_STORAGE=1.",
  );
}

export function createLocalStorage(config: LocalConfig): StorageAdapter {
  const root = resolve(config.root);
  refuseInProduction(root);

  /**
   * A key is attacker-influenced (it derives from an uploaded filename), so
   * every path is re-checked to be inside the root. Without this, a key
   * containing `../` writes anywhere the process can reach.
   */
  const pathFor = (key: string): string => {
    // Both components are runtime values. Without the trace annotation,
    // Turbopack treats local media reads as permission to package the whole
    // repository into the production standalone output.
    const target = resolve(join(/* turbopackIgnore: true */ root, key));
    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error(`storage: key escapes the storage root: ${key}`);
    }
    return target;
  };

  return {
    id: "local",
    // Objects are served by the app's /media route, which re-checks the
    // object inventory on every request; nothing reaches them directly.
    isPublic: false,

    async put(key, body, contentType): Promise<StoredObject> {
      const target = pathFor(key);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, body);
      return { key, bytes: body.byteLength, contentType };
    },

    async get(key): Promise<Uint8Array<ArrayBuffer> | undefined> {
      try {
        return new Uint8Array(
          await readFile(/* turbopackIgnore: true */ pathFor(key)),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
    },

    async head(key) {
      try {
        const facts = await stat(/* turbopackIgnore: true */ pathFor(key));
        return {
          key,
          bytes: facts.size,
          // Local storage has no sidecar metadata; callers already own the
          // authoritative type on the upload/asset row.
          contentType: "application/octet-stream",
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
    },

    async readRange(key, start, endInclusive) {
      try {
        const handle = await open(
          /* turbopackIgnore: true */ pathFor(key),
          "r",
        );
        try {
          const length = Math.max(0, endInclusive - start + 1);
          const buffer = Buffer.alloc(length);
          const { bytesRead } = await handle.read(buffer, 0, length, start);
          return new Uint8Array(buffer.subarray(0, bytesRead));
        } finally {
          await handle.close();
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
    },

    async stream(key) {
      try {
        await stat(/* turbopackIgnore: true */ pathFor(key));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
      const source = createReadStream(
        /* turbopackIgnore: true */ pathFor(key),
      );
      return (async function* () {
        for await (const chunk of source) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          yield new Uint8Array(buffer);
        }
      })();
    },

    async verifyPhysicalAbsence(key): Promise<void> {
      // This adapter has no remote generations, trash or upload sessions.
      // Original writer receipts separately fence concurrent admissions.
      try { await stat(/* turbopackIgnore: true */ pathFor(key)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
      throw new Error("storage: the original local object is still present");
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
