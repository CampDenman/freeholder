// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One deterministic registry shape for built-in and plugin adapters (C5.01).

import type { AdapterStatus } from "./types";

export interface RegisteredAdapter {
  readonly id: string;
  readonly status: AdapterStatus;
}

export class AdapterRegistry<T extends RegisteredAdapter> {
  readonly #family: AdapterStatus["family"];
  readonly #byId = new Map<string, T>();

  constructor(family: AdapterStatus["family"], adapters: readonly T[] = []) {
    this.#family = family;
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: T): void {
    if (adapter.status.family !== this.#family) {
      throw new Error(
        `${adapter.id} is a ${adapter.status.family} adapter, not ${this.#family}.`,
      );
    }
    if (this.#byId.has(adapter.id)) {
      throw new Error(`${this.#family} adapter "${adapter.id}" is already registered.`);
    }
    this.#byId.set(adapter.id, adapter);
  }

  get(id: string): T {
    const adapter = this.#byId.get(id);
    if (!adapter) throw new Error(`Unknown ${this.#family} adapter "${id}".`);
    return adapter;
  }

  list(): readonly T[] {
    return [...this.#byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  available(): readonly T[] {
    return this.list().filter((adapter) => adapter.status.available);
  }
}
