// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { copyManifestObjects, type TransferStore } from "../../scripts/media-transfer.mjs";

function memoryStore(entries: Record<string, Uint8Array> = {}): TransferStore & { entries: Map<string, Uint8Array> } {
  const stored = new Map(Object.entries(entries));
  return {
    entries: stored,
    async get(key) {
      const value = stored.get(key);
      return value ? new Uint8Array(value) : undefined;
    },
    async put(key, bytes) {
      stored.set(key, new Uint8Array(bytes));
    },
  };
}

const bytes = new TextEncoder().encode("owned media bytes");
const manifest = {
  format: "freeholder-media-manifest/v1" as const,
  objects: [{ key: "2026/08/asset.txt", bytes: bytes.byteLength, contentType: "text/plain" }],
  integrity: { missingInventoryKeys: [] },
};

describe("media migration", () => {
  it("copies every manifest object and verifies target bytes", async () => {
    const source = memoryStore({ "2026/08/asset.txt": bytes });
    const target = memoryStore();
    await expect(copyManifestObjects({ manifest, source, target })).resolves.toEqual({
      objects: 1,
      bytes: bytes.byteLength,
      dryRun: false,
    });
    expect(target.entries.get("2026/08/asset.txt")).toEqual(bytes);
  });

  it("refuses incomplete source inventories and missing bytes", async () => {
    await expect(copyManifestObjects({
      manifest: { ...manifest, integrity: { missingInventoryKeys: ["missing"] } },
      source: memoryStore(),
      target: memoryStore(),
    })).rejects.toThrow(/missing inventory/i);
    await expect(copyManifestObjects({ manifest, source: memoryStore(), target: memoryStore() }))
      .rejects.toThrow(/source media object is missing/i);
  });
});
