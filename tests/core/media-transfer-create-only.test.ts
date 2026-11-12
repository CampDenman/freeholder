// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.08: target absence must still hold when the provider applies the PUT.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyManifestObjects, createReplitStore, createS3Store } from "../../scripts/media-transfer.mjs";

const provider = vi.hoisted(() => ({ read: vi.fn(), upload: vi.fn(), save: vi.fn() }));
vi.mock("@replit/object-storage", () => ({ Client: class {
  downloadAsBytes = provider.read;
  uploadFromBytes = provider.upload;
} }));
vi.mock("@google-cloud/storage", () => ({ Storage: class {
  bucket() { return { file: () => ({ save: provider.save }) }; }
} }));
const original = new TextEncoder().encode("Original exported bytes"), different = new TextEncoder().encode("Another writer's existing bytes");
const key = "2026/11/original-private-file.txt";
const manifest = { format: "freeholder-media-manifest/v1" as const, objects: [{ key, bytes: original.byteLength, contentType: "text/plain" }] };
const source = { async get() { return original; }, async put() { throw new Error("Source must stay read-only"); } };

describe("media transfer concurrent target ownership (C11.08)", () => {
  beforeEach(() => { provider.read.mockReset(); provider.upload.mockReset(); provider.save.mockReset(); });
  afterEach(() => vi.unstubAllGlobals());
  it("preserves an S3 target created after its absence check", async () => {
    let actual: Uint8Array | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.method === "GET") return actual ? new Response(new Uint8Array(actual)) : new Response(null, { status: 404 });
      // A different original writer wins after the earlier GET but before
      // this provider applies the transfer's request.
      actual = different;
      if (request.headers.get("if-none-match") === "*") return new Response(null, { status: 412 });
      actual = new Uint8Array(await request.arrayBuffer());
      return new Response(null, { status: 200 });
    }));
    const target = createS3Store({ TARGET_S3_ENDPOINT: "https://synthetic-s3.example.test", TARGET_S3_BUCKET: "original-target", TARGET_S3_REGION: "us-east-1",
      TARGET_S3_ACCESS_KEY_ID: "SYNTHETIC_KEY", TARGET_S3_SECRET_ACCESS_KEY: "synthetic-fixture-only-secret" }, "TARGET");
    await expect(copyManifestObjects({ manifest, source, target })).rejects.toThrow();
    expect(actual).toEqual(different);
  });
  it("preserves a Replit target created after its absence check", async () => {
    let actual: Uint8Array | undefined;
    provider.read.mockImplementation(async () => actual
      ? { ok: true, value: [Buffer.from(actual)] }
      : { ok: false, error: { statusCode: 404, message: "Synthetic absent target" } });
    provider.upload.mockImplementation(async (_key: string, bytes: Buffer) => { actual = different; actual = new Uint8Array(bytes); return { ok: true }; });
    provider.save.mockImplementation(async (bytes: Buffer, options: { preconditionOpts?: { ifGenerationMatch?: number } }) => {
      actual = different;
      if (options.preconditionOpts?.ifGenerationMatch === 0) throw Object.assign(new Error("Synthetic create-only conflict"), { code: 412 });
      actual = new Uint8Array(bytes);
    });
    const target = await createReplitStore({ TARGET_REPLIT_BUCKET_ID: "original-private-target" }, "TARGET");
    await expect(copyManifestObjects({ manifest, source, target })).rejects.toThrow();
    expect(actual).toEqual(different);
  });
  it.each(["s3", "replit"])("stops when %s refuses the precondition, without an overwrite fallback", async kind => {
    let unsafeWrites = 0, guardedWrites = 0;
    const config = { TARGET_S3_ENDPOINT: "https://synthetic-s3.example.test", TARGET_S3_BUCKET: "original-target", TARGET_S3_REGION: "us-east-1",
      TARGET_S3_ACCESS_KEY_ID: "SYNTHETIC_KEY", TARGET_S3_SECRET_ACCESS_KEY: "synthetic-fixture-only-secret" };
    vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
      if (request.method === "GET") return new Response(null, { status: 404 });
      if (request.headers.get("if-none-match") === "*") { guardedWrites += 1; return new Response(null, { status: 501 }); }
      unsafeWrites += 1;
      return new Response(null, { status: 200 });
    }));
    provider.read.mockResolvedValue({ ok: false, error: { statusCode: 404, message: "Synthetic absent target" } });
    provider.upload.mockImplementation(async () => { unsafeWrites += 1; return { ok: true }; });
    provider.save.mockImplementation(async (_bytes: Buffer, options: { preconditionOpts?: { ifGenerationMatch?: number } }) => {
      if (options.preconditionOpts?.ifGenerationMatch === 0) { guardedWrites += 1; throw Object.assign(new Error("Synthetic unsupported precondition"), { code: 400 }); }
      unsafeWrites += 1;
    });
    const target = kind === "s3" ? createS3Store(config, "TARGET") : await createReplitStore({ TARGET_REPLIT_BUCKET_ID: "original-private-target" }, "TARGET");
    await expect(copyManifestObjects({ manifest, source, target })).rejects.toThrow();
    expect(guardedWrites).toBe(1);
    expect(unsafeWrites).toBe(0);
  });
  it("still copies and byte-verifies an empty S3 target through the precondition", async () => {
    let actual: Uint8Array | undefined;
    vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
      if (request.method === "GET") return actual ? new Response(new Uint8Array(actual)) : new Response(null, { status: 404 });
      if (request.headers.get("if-none-match") !== "*") throw new Error("Synthetic provider requires a create-only write");
      if (actual) return new Response(null, { status: 412 });
      actual = new Uint8Array(await request.arrayBuffer());
      return new Response(null, { status: 200 });
    }));
    const target = createS3Store({ TARGET_S3_ENDPOINT: "https://synthetic-s3.example.test", TARGET_S3_BUCKET: "original-target", TARGET_S3_REGION: "us-east-1",
      TARGET_S3_ACCESS_KEY_ID: "SYNTHETIC_KEY", TARGET_S3_SECRET_ACCESS_KEY: "synthetic-fixture-only-secret" }, "TARGET");
    await expect(copyManifestObjects({ manifest, source, target })).resolves.toMatchObject({ objects: 1, skipped: 0 });
    expect(actual).toEqual(original);
  });
});
