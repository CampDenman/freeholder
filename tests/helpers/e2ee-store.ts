// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Synthetic local-device state shared by native and browser migration tests.
import type { DeviceRecord, E2eeStore, ReadMessage, StoredKeyPackage } from "@/modules/members/e2ee/engine";

export function memoryStore(): E2eeStore {
  let device: DeviceRecord | null = null;
  const packages = new Map<string, StoredKeyPackage>();
  const groups = new Map<string, { state: Uint8Array | null; cursor: number }>();
  const messages = new Map<string, Map<string, ReadMessage>>();
  const callKeys = new Map<string, string>();
  const seen = new Map<string, string[]>();
  let historyKey: Uint8Array | null = null;
  return {
    device: async () => device,
    saveDevice: async (d) => { device = d; },
    keyPackage: async (id) => packages.get(id) ?? null,
    saveKeyPackages: async (list) => { for (const p of list) packages.set(p.id, p); },
    dropKeyPackage: async (id) => { packages.delete(id); },
    group: async (id) => groups.get(id) ?? null,
    saveGroup: async (id, state, cursor) => { groups.set(id, { state, cursor }); },
    messages: async (id) => new Map(messages.get(id) ?? []),
    saveMessage: async (id, mid, m) => { messages.set(id, new Map(messages.get(id) ?? []).set(mid, m)); },
    dropMessage: async (id, mid) => { messages.get(id)?.delete(mid); },
    historyKey: async () => historyKey,
    saveHistoryKey: async (key) => { historyKey = key; },
    conversations: async () => [...messages.keys()],
    seenDevices: async (id) => seen.get(id) ?? null,
    saveSeenDevices: async (id, devices) => { seen.set(id, devices); },
    callKey: async (id) => callKeys.get(id) ?? null,
    saveCallKey: async (id, key) => { callKeys.set(id, key); },
    clear: async () => { device = null; packages.clear(); groups.clear(); messages.clear(); callKeys.clear(); seen.clear(); historyKey = null; },
  };
}
