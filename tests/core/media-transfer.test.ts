// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { copyManifestObjects, type TransferStore } from "../../scripts/media-transfer.mjs";
import { buildMediaManifest } from "../../src/core/portability/ownership-export.mjs";

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
  it("checks legacy asset-only original digests before copying corrupt source", async () => {
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const corrupted = new Uint8Array(bytes);
    corrupted[0] ^= 1;
    const target = memoryStore();
    const legacy = { ...manifest, assets: [{ id: "original", storageKey: manifest.objects[0].key, checksumSha256: checksum }] };
    await expect(copyManifestObjects({ manifest: legacy, source: memoryStore({ [manifest.objects[0].key]: corrupted }), target }))
      .rejects.toThrow(/source.*checksum/i);
    expect(target.entries.size).toBe(0);
    await expect(copyManifestObjects({ manifest: legacy, source: memoryStore({ [manifest.objects[0].key]: bytes }), target }))
      .resolves.toEqual({ objects: 1, bytes: bytes.length, dryRun: false });
  });

  it("rejects conflicting object and asset digests before any store access", async () => {
    const checksum = createHash("sha256").update(bytes).digest("hex");
    let reads = 0;
    const source = { async get() { reads++; return bytes; }, async put() {} };
    const target = memoryStore();
    await expect(copyManifestObjects({ manifest: { ...manifest,
      objects: [{ ...manifest.objects[0], checksumSha256: checksum }],
      assets: [{ storageKey: manifest.objects[0].key, checksumSha256: "0".repeat(64) }],
    }, source, target })).rejects.toThrow(/conflicting source checksums/i);
    expect(reads).toBe(0);
    expect(target.entries.size).toBe(0);
  });

  it("preserves the known original digest in the exported object inventory", () => {
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const exported = buildMediaManifest(
      [{ id: "original", storage_key: "original.txt", checksum_sha256: checksum,
        variants: { small: [{ key: "small.txt" }] } }],
      [{ key: "original.txt", asset_id: "original", bytes: bytes.length },
        { key: "small.txt", asset_id: "original", bytes: 3 }],
    );
    expect(exported.objects[0].checksumSha256).toBe(checksum);
    // A resized derivative must never inherit the original file's digest.
    expect(exported.objects[1].checksumSha256).toBeUndefined();
  });

  it("refuses same-size source corruption against a known original digest before writing", async () => {
    const corrupted = new Uint8Array(bytes);
    corrupted[0] ^= 1;
    const target = memoryStore();
    const originalChecksum = createHash("sha256").update(bytes).digest("hex");
    const checked = { ...manifest, objects: [{ ...manifest.objects[0], checksumSha256: originalChecksum }] };
    await expect(copyManifestObjects({ manifest: checked, source: memoryStore({ "2026/08/asset.txt": corrupted }), target }))
      .rejects.toThrow(/source.*checksum/i);
    expect(target.entries.size).toBe(0);
    await expect(copyManifestObjects({ manifest: checked, source: memoryStore({ "2026/08/asset.txt": corrupted }), target, dryRun: true }))
      .rejects.toThrow(/source.*checksum/i);
  });

  it("refuses duplicate object keys before a namespace collision can overwrite bytes", async () => {
    const target = memoryStore();
    await expect(copyManifestObjects({
      manifest: { ...manifest, objects: [...manifest.objects, { ...manifest.objects[0], contentType: "application/octet-stream" }] },
      source: memoryStore({ "2026/08/asset.txt": bytes }), target,
    })).rejects.toThrow(/duplicate.*key/i);
    expect(target.entries.size).toBe(0);
  });

  it("rejects malformed known digests before writing, and accepts a matching digest", async () => {
    const source = memoryStore({ "2026/08/asset.txt": bytes });
    const target = memoryStore();
    await expect(copyManifestObjects({ manifest: { ...manifest, objects: [{ ...manifest.objects[0], checksumSha256: "invalid" }] }, source, target }))
      .rejects.toThrow(/checksum/i);
    expect(target.entries.size).toBe(0);
    const checksum = createHash("sha256").update(bytes).digest("hex").toUpperCase();
    await expect(copyManifestObjects({ manifest: { ...manifest, objects: [{ ...manifest.objects[0], checksumSha256: checksum }] }, source, target }))
      .resolves.toEqual({ objects: 1, bytes: bytes.length, dryRun: false });
  });

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
