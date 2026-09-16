// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.30: serialized persistence with synchronous revocation of old callers.
import type { Cache } from "./offline.js";

export interface CacheStorage extends Cache { clear(): Promise<void> }

export const noCache: Cache = {
  async get() { return null; },
  async set() {},
  async delete() {},
};

/** Platform storage sees authenticated ciphertext, never cached JSON. */
export function encryptedCache(storage: CacheStorage, cipher: {
  seal(plaintext: string): Promise<string>;
  open(ciphertext: string): Promise<string>;
}): CacheStorage {
  return {
    async get(key) {
      const ciphertext = await storage.get(key);
      if (ciphertext === null) return null;
      try {
        const entry = JSON.parse(await cipher.open(ciphertext));
        if (entry.key !== key || typeof entry.value !== "string") throw new Error("Invalid cache entry");
        return entry.value;
      } catch {
        await storage.delete(key);
        return null;
      }
    },
    async set(key, value) { await storage.set(key, await cipher.seal(JSON.stringify({ key, value }))); },
    delete: (key) => storage.delete(key),
    clear: () => storage.clear(),
  };
}

/** Serialize account transitions; a superseded asynchronous open stays revoked. */
export function privateCacheScope(platform: {
  open(owner: string): Promise<CacheStorage>;
  clear(): Promise<void>;
}) {
  let current: { owner: string; cache: ReturnType<typeof revocableCache> } | null = null;
  let revision = 0;
  let pending: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();
  function queue(work: () => Promise<void>) {
    const task = pending.then(work, work);
    pending = task.catch(() => {});
    return task;
  }
  function invalidate() {
    revision++;
    const old = current;
    current = null;
    const cleanup = old?.cache.revoke() ?? Promise.resolve();
    // Observe immediately, including while another platform operation is pending.
    void cleanup.catch(() => {});
    for (const listener of listeners) listener();
    return cleanup;
  }
  return {
    get: (owner: string): Cache => current?.owner === owner ? current.cache : noCache,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    activate(owner: string): Promise<void> {
      if (current?.owner === owner) return Promise.resolve();
      const cleanup = invalidate();
      const request = revision;
      return queue(async () => {
        await cleanup;
        if (revision !== request) return;
        const cache = revocableCache(await platform.open(owner));
        if (revision !== request) { await cache.revoke(); return; }
        current = { owner, cache };
        for (const listener of listeners) listener();
      });
    },
    clear(owner?: string): Promise<void> {
      if (owner !== undefined && current?.owner !== owner) return Promise.resolve();
      const cleanup = invalidate();
      return queue(async () => {
        // Still destroy the key if an OS file deletion failed.
        try { await cleanup; } finally { await platform.clear(); }
      });
    },
  };
}

export function revocableCache(storage: CacheStorage): Cache & { revoke(): Promise<void> } {
  let active = true;
  let pending: Promise<unknown> = Promise.resolve();
  function queue<T>(work: () => Promise<T>): Promise<T> {
    const task = pending.then(work, work);
    pending = task.catch(() => {});
    return task;
  }
  return {
    get: (key) => queue(async () => {
      if (!active) return null;
      const value = await storage.get(key);
      return active ? value : null;
    }),
    set: (key, value) => queue(async () => { if (active) await storage.set(key, value); }),
    delete: (key) => queue(async () => { if (active) await storage.delete(key); }),
    revoke: () => {
      active = false;
      return queue(() => storage.clear());
    },
  };
}
