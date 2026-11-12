// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.08: a failed read is not permission to overwrite an occupied target.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyManifestObjects, createReplitStore } from "../../scripts/media-transfer.mjs";

const provider = vi.hoisted(() => ({ read: vi.fn(), upload: vi.fn(), save: vi.fn() }));
vi.mock("@replit/object-storage", () => ({ Client: class {
  downloadAsBytes = provider.read;
  uploadFromBytes = provider.upload;
} }));
vi.mock("@google-cloud/storage", () => ({ Storage: class {
  bucket() { return { file: () => ({ save: provider.save }) }; }
} }));
const original = new TextEncoder().encode("original source bytes"), different = new TextEncoder().encode("target owner's different bytes");
const key = "2026/11/immutable-original.pdf";
const manifest = { format: "freeholder-media-manifest/v1" as const, objects: [{ key, bytes: original.byteLength, contentType: "application/pdf" }] };
const source = { async get() { return original; }, async put() { throw new Error("Source must remain read-only"); } };

describe("Replit media-transfer evidence (C11.08)", () => {
  beforeEach(() => { provider.read.mockReset(); provider.upload.mockReset(); provider.save.mockReset(); });
  it.each([403, 503])("preserves an occupied target when its first read returns HTTP%d", async statusCode => {
    let actual = different, firstRead = true;
    provider.read.mockImplementation(async () => {
      if (firstRead) { firstRead = false; return { ok: false, error: { statusCode, message: "Synthetic provider read refusal" } }; }
      return { ok: true, value: [Buffer.from(actual)] };
    });
    provider.upload.mockImplementation(async (_key: string, bytes: Buffer) => { actual = new Uint8Array(bytes); return { ok: true }; });
    const target = await createReplitStore({ TARGET_REPLIT_BUCKET_ID: "original-private-target" }, "TARGET");
    await expect(copyManifestObjects({ manifest, source, target })).rejects.toThrow();
    expect(actual).toEqual(different);
    expect(provider.upload).not.toHaveBeenCalled();
    expect(provider.save).not.toHaveBeenCalled();
  });
  it("still transfers and verifies a positively missing target", async () => {
    let actual: Uint8Array | undefined;
    provider.read.mockImplementation(async () => actual
      ? { ok: true, value: [Buffer.from(actual)] }
      : { ok: false, error: { statusCode: 404, message: "Synthetic positively missing target" } });
    provider.upload.mockImplementation(async (_key: string, bytes: Buffer) => { actual = new Uint8Array(bytes); return { ok: true }; });
    provider.save.mockImplementation(async (bytes: Buffer) => { actual = new Uint8Array(bytes); });
    const target = await createReplitStore({ TARGET_REPLIT_BUCKET_ID: "original-private-target" }, "TARGET");
    await expect(copyManifestObjects({ manifest, source, target })).resolves.toMatchObject({ objects: 1, skipped: 0 });
    expect(actual).toEqual(original);
    expect(provider.save).toHaveBeenCalledTimes(1);
    expect(provider.upload).not.toHaveBeenCalled();
  });
});
