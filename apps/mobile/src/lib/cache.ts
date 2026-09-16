// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.30: public memory cache and a bounded, session-bound encrypted vault.
import { encryptedCache, privateCacheScope, type Cache, type CacheStorage, type Session } from "@freeholder/mobile-app";
import { AESEncryptionKey, AESSealedData, aesEncryptAsync, aesDecryptAsync, digestStringAsync, CryptoDigestAlgorithm } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";

export function createMemoryCache(): Cache {
  const store = new Map<string, string>();
  return {
  async get(key) {
    return store.get(key) ?? null;
  },
  async set(key, value) {
    store.set(key, value);
  },
  async delete(key) {
    store.delete(key);
  },
  };
}

export const memoryCache = createMemoryCache();

const KEY = "freeholder.private-cache-key";
const MAX_ENTRY = 8 * 1024 * 1024;
const MAX_TOTAL = 20 * 1024 * 1024;
const MAX_FILES = 64;
const directory = () => new Directory(Paths.cache, "freeholder-private-v1");
const hash = (value: string) => digestStringAsync(CryptoDigestAlgorithm.SHA256, value);

export function privateCacheOwner(session: Pick<Session, "instanceUrl" | "token">): string {
  return JSON.stringify([session.instanceUrl, session.token]);
}

function clearFiles() {
  const folder = directory();
  // This is a fixed, app-owned cache directory, never a user-selected path.
  if (folder.exists) folder.delete();
}

async function clearVault() {
  // Destroy the key even when the OS refuses to remove a cache file.
  try { clearFiles(); } finally { await SecureStore.deleteItemAsync(KEY); }
}

async function openVault(owner: string): Promise<CacheStorage> {
  const ownerHash = await hash(owner);
  let key: InstanceType<typeof AESEncryptionKey> | null = null;
  try {
    const record = JSON.parse(await SecureStore.getItemAsync(KEY) ?? "null");
    if (record?.owner === ownerHash && typeof record.key === "string") {
      key = await AESEncryptionKey.import(record.key, "hex");
    }
  } catch { /* An unavailable or damaged key is a cache miss, never plaintext fallback. */ }
  if (!key) {
    await clearVault();
    key = await AESEncryptionKey.generate();
    await SecureStore.setItemAsync(KEY, JSON.stringify({ owner: ownerHash, key: await key.encoded("hex") }), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }
  const encryptionKey = key;
  const fileFor = async (cacheKey: string) => new File(directory(), `${await hash(cacheKey)}.sealed`);
  const storage: CacheStorage = {
    async get(cacheKey) {
      const file = await fileFor(cacheKey);
      if (!file.exists) return null;
      if (file.size > MAX_ENTRY) { file.delete(); return null; }
      return file.text();
    },
    async set(cacheKey, value) {
      if (value.length > MAX_ENTRY) return;
      const file = await fileFor(cacheKey);
      const folder = directory();
      folder.create({ intermediates: true, idempotent: true });
      const others = folder.list().filter((entry): entry is File => entry instanceof File && entry.uri !== file.uri)
        .sort((a, b) => (a.modificationTime ?? 0) - (b.modificationTime ?? 0));
      let size = others.reduce((total, entry) => total + entry.size, 0);
      while (others.length >= MAX_FILES || size + value.length > MAX_TOTAL) {
        const oldest = others.shift();
        if (!oldest) break;
        size -= oldest.size;
        oldest.delete();
      }
      file.create({ overwrite: true });
      file.write(value);
    },
    async delete(cacheKey) {
      const file = await fileFor(cacheKey);
      if (file.exists) file.delete();
    },
    async clear() { clearFiles(); },
  };
  return encryptedCache(storage, {
    async seal(plaintext) {
      const sealed = await aesEncryptAsync(new TextEncoder().encode(plaintext), encryptionKey);
      return sealed.combined("base64");
    },
    async open(ciphertext) {
      const plaintext = await aesDecryptAsync(AESSealedData.fromCombined(ciphertext), encryptionKey);
      return new TextDecoder().decode(plaintext);
    },
  });
}

export const privateCaches = privateCacheScope({ open: openVault, clear: clearVault });
