// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Where read-through cached content lives (C10.23).
//
// In memory for now, deliberately: §35.1's offline promise is "what you have
// already been shown", and a process-lifetime cache keeps that promise for the
// session a customer is actually in. Persisting it means deciding how long a
// gallery may sit on a phone after access is revoked, which is a real decision
// and belongs with the gallery screens (C10.27) rather than being made by
// accident here.
import type { Cache } from "@freeholder/mobile-app";

const store = new Map<string, string>();

export const memoryCache: Cache = {
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
