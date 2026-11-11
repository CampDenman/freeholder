// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C11.08: permission failures are not evidence that bytes are absent.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReplitStorage } from "@/adapters/storage/replit";

const fake = vi.hoisted(() => ({
  clients: [] as Array<{ bucketId?: string }>,
  read: vi.fn(), remove: vi.fn(), upload: vi.fn(),
}));
vi.mock("@replit/object-storage", () => ({ Client: class {
  constructor(options: { bucketId?: string }) { fake.clients.push(options); }
  downloadAsBytes = fake.read;
  delete = fake.remove;
  uploadFromBytes = fake.upload;
} }));
describe("Replit original storage evidence (C1.12/C11.08)", () => {
  beforeEach(() => { fake.clients.length = 0; fake.read.mockReset(); fake.remove.mockReset(); fake.upload.mockReset(); });
  afterEach(() => { vi.unstubAllGlobals(); });
  it("refuses a forbidden read/delete even when its provider message says not found", async () => {
    const store = createReplitStorage({ bucketId: "original-private-bucket", mediaPath: "/media" });
    fake.read.mockResolvedValue({ ok: false, error: { message: "not found", statusCode: 403 } });
    fake.remove.mockResolvedValue({ ok: false, error: { message: "not found", statusCode: 403 } });
    await expect(store.head("private-key")).rejects.toThrow();
    await expect(store.delete("private-key")).rejects.toThrow();
    fake.read.mockResolvedValue({ ok: false, error: { message: "missing", statusCode: 404 } });
    fake.remove.mockResolvedValue({ ok: false, error: { message: "missing", statusCode: 404 } });
    expect(await store.head("private-key")).toBeUndefined();
    await expect(store.delete("private-key")).resolves.toBeUndefined();
  });
  it("pins the discovered original bucket for its receipt and all subsequent SDK requests", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ bucketId: "original-private-bucket" }))
      .mockResolvedValue(Response.json({ bucketId: "replacement-private-bucket" }));
    vi.stubGlobal("fetch", fetcher);
    fake.read.mockResolvedValue({ ok: true, value: [Buffer.from("first"), Buffer.from("second")] });
    const store = createReplitStorage({ mediaPath: "/media" }), binding = await store.binding!();
    expect(await store.get("private-key")).toEqual(new Uint8Array(Buffer.from("firstsecond")));
    expect(await store.binding!()).toEqual(binding);
    expect(fake.clients).toEqual([{ bucketId: "original-private-bucket" }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(binding.location).toEqual({ bucket: "original-private-bucket" });
  });
  it("stops an oversized bucket-discovery response before reading the rest", async () => {
    let cancelled = false;
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8_193)); }, cancel() { cancelled = true; } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    const store = createReplitStorage({ mediaPath: "/media" });
    await expect(store.binding!()).rejects.toThrow(/bound/);
    expect(cancelled).toBe(true);
    expect(fake.clients).toHaveLength(0);
  });
});
