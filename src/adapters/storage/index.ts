// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Choosing the storage implementation (MASTER.md §12, §17): the id comes from
// freeholder.config.ts, the credentials from env. Instantiated once at first
// use, like the database pool — importing this module connects to nothing.
import config from "../../../freeholder.config";
import { env } from "@/core/env";
import { createLocalStorage } from "@/adapters/storage/local";
import { createReplitStorage } from "@/adapters/storage/replit";
import { createS3Storage } from "@/adapters/storage/s3";
import type { StorageAdapter } from "@/adapters/storage/types";

/** Where the app serves stored objects from when the bucket is private. */
export const MEDIA_PATH = "/media";

function build(): StorageAdapter {
  const e = env();
  // Environment wins over the checked-in default, so one published image can
  // serve instances that store their media in different places (§17).
  const choice = e.FREEHOLDER_STORAGE ?? config.adapters.storage;

  switch (choice) {
    case "s3": {
      // Named rather than defaulted: a half-configured bucket that silently
      // falls back to the local disk would lose an owner's files at the exact
      // moment they thought they were safely stored.
      const missing = (
        [
          ["S3_ENDPOINT", e.S3_ENDPOINT],
          ["S3_REGION", e.S3_REGION],
          ["S3_BUCKET", e.S3_BUCKET],
          ["S3_ACCESS_KEY_ID", e.S3_ACCESS_KEY_ID],
          ["S3_SECRET_ACCESS_KEY", e.S3_SECRET_ACCESS_KEY],
        ] as const
      )
        .filter(([, value]) => !value)
        .map(([name]) => name);
      if (missing.length > 0) {
        throw new Error(
          `Storage is set to "s3" but ${missing.join(", ")} ${
            missing.length === 1 ? "is" : "are"
          } not set. See .env.example.`,
        );
      }
      return createS3Storage({
        endpoint: e.S3_ENDPOINT!,
        region: e.S3_REGION!,
        bucket: e.S3_BUCKET!,
        accessKeyId: e.S3_ACCESS_KEY_ID!,
        secretAccessKey: e.S3_SECRET_ACCESS_KEY!,
        publicBaseUrl: e.S3_PUBLIC_BASE_URL,
        isPublic: e.S3_PUBLIC === "true",
      });
    }

    case "replit":
      return createReplitStorage({
        bucketId: e.REPLIT_BUCKET_ID,
        mediaPath: MEDIA_PATH,
      });

    case "local":
      return createLocalStorage({
        root: e.LOCAL_STORAGE_ROOT ?? ".data/media",
        publicPath: MEDIA_PATH,
      });
  }
}

let instance: StorageAdapter | undefined;

export function storage(): StorageAdapter {
  instance ??= build();
  return instance;
}

export function resetStorageForTests(): void {
  instance = undefined;
}

export type { StorageAdapter } from "@/adapters/storage/types";
