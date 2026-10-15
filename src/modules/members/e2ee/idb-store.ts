// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.23: a browser device's keys, group states and read messages, kept in
// IndexedDB on that device and nowhere else. Clearing the site's data in the
// browser removes the device; its messages remain on the member's other
// devices.
import type { DeviceRecord, E2eeStore, ReadMessage, StoredKeyPackage } from "./engine";

const NAME = "freeholder-e2ee";
const STORES = ["device", "keyPackages", "groups", "messages", "callKeys"] as const;

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB request failed."));
  });
}

let opened: Promise<IDBDatabase> | null = null;
function database(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const open = indexedDB.open(NAME, 2);
    open.onupgradeneeded = () => {
      for (const store of STORES) if (!open.result.objectStoreNames.contains(store)) open.result.createObjectStore(store);
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("IndexedDB could not open."));
  });
  return opened;
}

async function get<T>(store: (typeof STORES)[number], key: string): Promise<T | null> {
  const db = await database();
  return ((await request(db.transaction(store).objectStore(store).get(key))) as T | undefined) ?? null;
}

async function put(store: (typeof STORES)[number], key: string, value: unknown): Promise<void> {
  const db = await database();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).put(value, key);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed."));
  });
}

async function remove(store: (typeof STORES)[number], key: string): Promise<void> {
  const db = await database();
  await request(db.transaction(store, "readwrite").objectStore(store).delete(key));
}

export const browserStore: E2eeStore = {
  device: () => get<DeviceRecord>("device", "self"),
  saveDevice: (device) => put("device", "self", device),
  keyPackage: (id) => get<StoredKeyPackage>("keyPackages", id),
  async saveKeyPackages(packages) {
    for (const p of packages) await put("keyPackages", p.id, p);
  },
  dropKeyPackage: (id) => remove("keyPackages", id),
  group: (conversationId) => get<{ state: Uint8Array | null; cursor: number }>("groups", conversationId),
  saveGroup: (conversationId, state, cursor) => put("groups", conversationId, { state, cursor }),
  async messages(conversationId) {
    const saved = await get<Record<string, ReadMessage>>("messages", conversationId);
    return new Map(Object.entries(saved ?? {}));
  },
  async saveMessage(conversationId, id, message) {
    const saved = (await get<Record<string, ReadMessage>>("messages", conversationId)) ?? {};
    await put("messages", conversationId, { ...saved, [id]: message });
  },
  async dropMessage(conversationId, id) {
    const saved = (await get<Record<string, ReadMessage>>("messages", conversationId)) ?? {};
    delete saved[id];
    await put("messages", conversationId, saved);
  },
  callKey: (callId) => get<string>("callKeys", callId),
  saveCallKey: (callId, key) => put("callKeys", callId, key),
  async clear() {
    const db = await database();
    for (const store of STORES) await request(db.transaction(store, "readwrite").objectStore(store).clear());
  },
};
