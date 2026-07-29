// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// The storage adapter contract (MASTER.md §12). One suite runs against every
// implementation that can be exercised without a cloud account, because an
// interface whose implementations are only tested individually drifts.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalStorage } from "@/adapters/storage/local";
import { createS3Storage } from "@/adapters/storage/s3";
import { storageKey } from "@/adapters/storage/types";
import type { StorageAdapter } from "@/adapters/storage/types";

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array | undefined) =>
  data ? new TextDecoder().decode(data) : undefined;

let root: string;

async function localAdapter(): Promise<StorageAdapter> {
  root = await mkdtemp(join(tmpdir(), "freeholder-storage-"));
  return createLocalStorage({ root, publicPath: "/media" });
}

describe("storageKey()", () => {
  const at = new Date("2026-07-28T11:00:00Z");

  it("groups by year and month so a bucket stays navigable by hand", () => {
    expect(storageKey("photo.jpg", at, "abc123")).toBe(
      "2026/07/abc123-photo.jpg",
    );
  });

  it("cannot escape its prefix, whatever the filename was", () => {
    // The filename comes from an upload, so it is attacker-influenced.
    for (const hostile of [
      "../../etc/passwd",
      "..\\..\\windows\\system32",
      "/absolute/path.jpg",
      "a/b/c.jpg",
    ]) {
      const key = storageKey(hostile, at, "r");
      expect(key.startsWith("2026/07/r-")).toBe(true);
      expect(key).not.toContain("..");
      expect(key.split("/")).toHaveLength(3);
    }
  });

  it("keeps keys short and never empty", () => {
    expect(storageKey("!!!.???", at, "r")).toMatch(/^2026\/07\/r-/);
    expect(storageKey("", at, "r")).toBe("2026/07/r-file");
    expect(storageKey(`${"x".repeat(500)}.jpg`, at, "r").length).toBeLessThan(
      100,
    );
  });

  it("distinguishes two uploads of the same name in the same second", () => {
    expect(storageKey("photo.jpg", at, "aaa")).not.toBe(
      storageKey("photo.jpg", at, "bbb"),
    );
  });
});

describe("the local adapter", () => {
  let storage: StorageAdapter;

  beforeEach(async () => {
    storage = await localAdapter();
  });

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("round-trips what it was given", async () => {
    await storage.put("2026/07/a-note.txt", bytes("coastal light"), "text/plain");
    expect(text(await storage.get("2026/07/a-note.txt"))).toBe("coastal light");
  });

  it("answers undefined for something never stored", async () => {
    expect(await storage.get("2026/07/absent.txt")).toBeUndefined();
  });

  it("treats deleting what is not there as success", async () => {
    // The caller's intent — "this should not exist" — is already satisfied.
    await expect(storage.delete("2026/07/absent.txt")).resolves.toBeUndefined();
  });

  it("really deletes", async () => {
    await storage.put("2026/07/gone.txt", bytes("x"), "text/plain");
    await storage.delete("2026/07/gone.txt");
    expect(await storage.get("2026/07/gone.txt")).toBeUndefined();
  });

  it("refuses a key that would escape the storage root", async () => {
    // Defence in depth: storageKey() already prevents this, but the adapter
    // must not depend on its caller having been careful.
    for (const escape of ["../outside.txt", "a/../../outside.txt"]) {
      await expect(
        storage.put(escape, bytes("nope"), "text/plain"),
      ).rejects.toThrow(/escapes the storage root/);
      await expect(storage.get(escape)).rejects.toThrow(
        /escapes the storage root/,
      );
    }
  });

  it("builds a URL under the media path", async () => {
    expect(await storage.url("2026/07/a b.jpg")).toBe("/media/2026/07/a%20b.jpg");
  });
});

describe("the S3 adapter", () => {
  const config = {
    endpoint: "https://sfo3.digitaloceanspaces.com",
    region: "sfo3",
    bucket: "freeholder-media",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "secret",
  };

  it("signs a private read, and the signature expires", async () => {
    const storage = createS3Storage(config);
    const url = new URL(await storage.url("2026/07/photo.jpg", { expiresIn: 60 }));

    expect(url.origin).toBe("https://sfo3.digitaloceanspaces.com");
    expect(url.pathname).toBe("/freeholder-media/2026/07/photo.jpg");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
    // The secret itself must never reach a URL that ends up in an <img src>.
    expect(url.toString()).not.toContain("secret");
  });

  it("does not sign a public bucket, so the URL is cacheable", async () => {
    const storage = createS3Storage({ ...config, isPublic: true });
    expect(await storage.url("2026/07/photo.jpg")).toBe(
      "https://sfo3.digitaloceanspaces.com/freeholder-media/2026/07/photo.jpg",
    );
  });

  it("serves a public bucket from a CDN when one is configured", async () => {
    const storage = createS3Storage({
      ...config,
      isPublic: true,
      publicBaseUrl: "https://cdn.example.com/",
    });
    expect(await storage.url("2026/07/photo.jpg")).toBe(
      "https://cdn.example.com/2026/07/photo.jpg",
    );
  });

  it("defaults to private, because guessing wrong exposes an owner's files", async () => {
    expect(createS3Storage(config).isPublic).toBe(false);
  });

  it("can ask the browser to download under a chosen name", async () => {
    const storage = createS3Storage(config);
    const url = new URL(
      await storage.url("2026/07/x.jpg", { downloadAs: "Aurora Coast.jpg" }),
    );
    expect(url.searchParams.get("response-content-disposition")).toBe(
      'attachment; filename="Aurora Coast.jpg"',
    );
  });
});
