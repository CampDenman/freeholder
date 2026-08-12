// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The storage adapter contract (MASTER.md §12). One suite runs against every
// implementation that can be exercised without a cloud account, because an
// interface whose implementations are only tested individually drifts.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalStorage } from "@/adapters/storage/local";
import { resetEnvForTests } from "@/core/env";
import { createS3Storage } from "@/adapters/storage/s3";
import { storageKey } from "@/adapters/storage/types";
import type { StorageAdapter } from "@/adapters/storage/types";

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array | undefined) =>
  data ? new TextDecoder().decode(data) : undefined;

let root: string;

afterEach(() => vi.restoreAllMocks());

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

  it("supports bounded inspection and streaming without loading by contract", async () => {
    await storage.put(
      "2026/07/inspect.bin",
      bytes("0123456789"),
      "application/octet-stream",
    );
    expect(await storage.head("2026/07/inspect.bin")).toMatchObject({
      bytes: 10,
    });
    expect(text(await storage.readRange("2026/07/inspect.bin", 2, 5))).toBe(
      "2345",
    );
    const stream = await storage.stream("2026/07/inspect.bin");
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream!) chunks.push(chunk);
    expect(text(Buffer.concat(chunks))).toBe("0123456789");
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

  it("does not claim direct multipart support", () => {
    expect(storage.directMultipart).toBeUndefined();
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

  it("presigns resumable multipart parts without exposing credentials", async () => {
    const storage = createS3Storage(config);
    const signed = await storage.directMultipart!.signPart(
      "2026/07/large.mp4",
      "provider-upload-id",
      7,
      90,
    );
    const url = new URL(signed.url);
    expect(signed.method).toBe("PUT");
    expect(url.searchParams.get("uploadId")).toBe("provider-upload-id");
    expect(url.searchParams.get("partNumber")).toBe("7");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("90");
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
    expect(signed.url).not.toContain(config.secretAccessKey);
  });

  it("initiates, resumes, and completes the S3 multipart protocol", async () => {
    const requests: Request[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requests.push(request);
      const url = new URL(request.url);
      if (request.method === "POST" && url.searchParams.has("uploads")) {
        return new Response(
          "<InitiateMultipartUploadResult><UploadId>up-123</UploadId></InitiateMultipartUploadResult>",
        );
      }
      if (request.method === "GET" && url.searchParams.get("uploadId")) {
        return new Response(
          "<ListPartsResult><Part><PartNumber>1</PartNumber><ETag>etag-one</ETag><Size>8388608</Size></Part></ListPartsResult>",
        );
      }
      if (request.method === "POST" && url.searchParams.get("uploadId")) {
        return new Response("<CompleteMultipartUploadResult />");
      }
      if (request.method === "HEAD") {
        return new Response(null, {
          headers: {
            "content-length": "8388608",
            "content-type": "video/mp4",
            etag: "whole-etag",
          },
        });
      }
      return new Response(null, { status: 500 });
    });

    const multipart = createS3Storage(config).directMultipart!;
    await expect(multipart.create("2026/07/movie.mp4", "video/mp4")).resolves.toEqual({
      uploadId: "up-123",
    });
    await expect(
      multipart.listParts("2026/07/movie.mp4", "up-123"),
    ).resolves.toEqual([{ partNumber: 1, etag: "etag-one", bytes: 8388608 }]);
    await expect(
      multipart.complete("2026/07/movie.mp4", "up-123", [
        { partNumber: 1, etag: '"etag-one"' },
      ]),
    ).resolves.toMatchObject({ bytes: 8388608, contentType: "video/mp4" });
    expect(requests.map((request) => request.method)).toEqual([
      "POST",
      "GET",
      "POST",
      "HEAD",
    ]);
  });

  it("never exposes an unvalidated direct upload through a public bucket", () => {
    expect(createS3Storage({ ...config, isPublic: true }).directMultipart).toBeUndefined();
  });
});

describe("the local adapter refuses production (§18 storage mandate)", () => {
  // The guard reads through env(), which parses once and caches — so varying
  // the environment means dropping that cache on both sides of the body.
  const withEnv = (vars: Record<string, string | undefined>, body: () => void) => {
    const previous = { ...process.env };
    Object.assign(process.env, vars);
    for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
    resetEnvForTests();
    try {
      body();
    } finally {
      process.env = previous;
      resetEnvForTests();
    }
  };

  it("throws in production rather than losing an owner's media quietly", () => {
    // A droplet's disk is not backed up and does not survive a rebuild. Media
    // is the least recoverable thing a business owns, so this fails loudly at
    // boot instead of at restore time.
    withEnv(
      { NODE_ENV: "production", FREEHOLDER_UNSAFE_LOCAL_STORAGE: undefined },
      () => {
        expect(() =>
          createLocalStorage({ root: ".data/media", publicPath: "/media" }),
        ).toThrow(/development only/);
      },
    );
  });

  it("names the way out, so the error is actionable", () => {
    withEnv(
      { NODE_ENV: "production", FREEHOLDER_UNSAFE_LOCAL_STORAGE: undefined },
      () => {
        try {
          createLocalStorage({ root: ".data/media", publicPath: "/media" });
        } catch (error) {
          const message = (error as Error).message;
          expect(message).toContain("freeholder.config.ts");
          expect(message).toContain("FREEHOLDER_UNSAFE_LOCAL_STORAGE=1");
        }
      },
    );
  });

  it("obeys a deliberate override", () => {
    withEnv(
      { NODE_ENV: "production", FREEHOLDER_UNSAFE_LOCAL_STORAGE: "1" },
      () => {
        expect(() =>
          createLocalStorage({ root: ".data/media", publicPath: "/media" }),
        ).not.toThrow();
      },
    );
  });

  it("says nothing outside production", () => {
    withEnv({ NODE_ENV: "development" }, () => {
      expect(() =>
        createLocalStorage({ root: ".data/media", publicPath: "/media" }),
      ).not.toThrow();
    });
  });
});

describe("the environment can override the configured adapter", () => {
  it("is how one published image serves differently-configured instances", async () => {
    // freeholder.config.ts is checked in and describes *an* instance (§17),
    // which cannot be true of a single artifact shared by all of them.
    const previous = { ...process.env };
    try {
      // Object.assign rather than direct assignment: Next types NODE_ENV as
      // read-only, and the test needs to vary it.
      Object.assign(process.env, {
        FREEHOLDER_STORAGE: "local",
        NODE_ENV: "development",
      });
      const { storage, resetStorageForTests } = await import(
        "@/adapters/storage"
      );
      resetStorageForTests();
      expect(storage().id).toBe("local");
      resetStorageForTests();
    } finally {
      process.env = previous;
    }
  });
});
