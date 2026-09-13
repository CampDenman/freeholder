// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Durable on-device capture batch metadata (C10.18). File bytes stay at their
// picker URI; this store only remembers what has and has not been uploaded.
import { Directory, File, Paths } from "expo-file-system";
import { createCaptureBatchStore, type Cache } from "@freeholder/mobile-app";

function fileCache(): Cache {
  const folder = () => new Directory(Paths.document, "freeholder-capture-batches");
  const file = () => new File(folder(), "batches.json");
  return {
    async get() {
      const handle = file();
      if (!handle.exists) return null;
      return handle.text();
    },
    async set(_key, value) {
      folder().create({ intermediates: true, idempotent: true });
      const handle = file();
      handle.create({ overwrite: true });
      handle.write(value);
    },
    async delete() {
      const handle = file();
      if (handle.exists) handle.delete();
    },
  };
}

export const captureBatches = createCaptureBatchStore(fileCache());
