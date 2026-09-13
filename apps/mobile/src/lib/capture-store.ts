// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Durable, session-bound capture queue (C10.18). Picker URIs are copied into
// the app document directory so a process death does not lose the bytes.
import { Directory, File, Paths } from "expo-file-system";
import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import {
  captureBatchOwner,
  createCaptureBatchStore,
  type Cache,
  type CaptureFile,
} from "@freeholder/mobile-app";

const ROOT = "freeholder-capture-batches";

function root(): Directory {
  return new Directory(Paths.document, ROOT);
}

async function ownerFolder(owner: string): Promise<Directory> {
  const hash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, owner);
  return new Directory(root(), hash);
}

function fileCache(): Cache {
  return {
    async get(key) {
      const hash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, key);
      const handle = new File(root(), `${hash}.json`);
      if (!handle.exists) return null;
      return handle.text();
    },
    async set(key, value) {
      root().create({ intermediates: true, idempotent: true });
      const hash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, key);
      const handle = new File(root(), `${hash}.json`);
      handle.create({ overwrite: true });
      handle.write(value);
    },
    async delete(key) {
      const hash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, key);
      const handle = new File(root(), `${hash}.json`);
      if (handle.exists) handle.delete();
    },
  };
}

function deleteIfExists(handle: File | Directory) {
  if (handle.exists) handle.delete();
}

async function retainCaptureFile(owner: string, itemId: string, file: CaptureFile): Promise<CaptureFile> {
  const folder = new Directory(await ownerFolder(owner), "files");
  folder.create({ intermediates: true, idempotent: true });
  const dest = new File(folder, `${itemId}.bin`);
  deleteIfExists(dest);
  if (file.uri) {
    new File(file.uri).copySync(dest);
  } else if (file.bytes) {
    dest.create({ overwrite: true });
    dest.write(file.bytes);
  } else {
    throw new Error("Nothing to upload.");
  }
  return {
    filename: file.filename,
    contentType: file.contentType,
    byteLength: file.byteLength || dest.size || 0,
    uri: dest.uri,
  };
}

function releaseCaptureFile(file: CaptureFile) {
  if (!file.uri || !file.uri.includes(ROOT)) return;
  deleteIfExists(new File(file.uri));
}

let owner: string | null = null;

const store = createCaptureBatchStore(fileCache(), {
  retainFile: (file, itemId) => {
    if (!owner) throw new Error("Those capture files belong to a different account.");
    return retainCaptureFile(owner, itemId, file);
  },
  releaseFile: async (file) => {
    releaseCaptureFile(file);
  },
  wipe: async () => {
    if (!owner) return;
    deleteIfExists(await ownerFolder(owner));
  },
});

export async function bindCaptureBatches(session: { instanceUrl: string; token: string }): Promise<void> {
  owner = captureBatchOwner(session);
  await store.bind(owner);
}

export async function clearCaptureBatches(): Promise<void> {
  await store.clear();
  owner = null;
}

export const captureBatches = store;
