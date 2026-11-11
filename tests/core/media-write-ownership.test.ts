// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12/C3.22/C11.08: failed client acknowledgement is not provider absence.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { mediaObjects, mediaUploads, assets } from "@/core/media/schema";
import { beginUpload, cleanupOrphanedMedia, uploadAsset } from "@/core/media/service";
import { resetStorageForTests, storage } from "@/adapters/storage";
import { resetEnvForTests } from "@/core/env";
import { ready } from "@/core/runtime";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("media provider-write ownership (C1.12/C3.22)", () => {
  let root: string;
  let releaseLate: (() => void) | undefined;
  let lateWrites: Promise<unknown>[];
  beforeAll(ready, 60_000);
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values({ id: OWNER.userId, email: "owner@example.test", role: "owner" });
    root = mkdtempSync(join(tmpdir(), "freeholder-media-write-fixture-"));
    vi.stubEnv("FREEHOLDER_STORAGE", "local");
    vi.stubEnv("LOCAL_STORAGE_ROOT", root);
    resetEnvForTests(); resetStorageForTests();
    releaseLate = undefined; lateWrites = [];
  });
  afterEach(async () => {
    releaseLate?.();
    await Promise.allSettled(lateWrites);
    vi.restoreAllMocks(); vi.unstubAllEnvs();
    resetEnvForTests(); resetStorageForTests();
    if (root) rmSync(root, { recursive: true, force: true });
  });
  afterAll(closeDb);
  const pdf = () => new Uint8Array(Buffer.from("%PDF-1.7\nSynthetic private media fixture.\n%%EOF\n"));

  it("keeps the original object witness when a completed PUT loses its acknowledgement", async () => {
    const store = storage(), put = store.put.bind(store), body = pdf();
    let writtenKey = "";
    vi.spyOn(store, "put").mockImplementation(async (key, bytes, contentType) => {
      writtenKey = key;
      await put(key, bytes, contentType);
      throw new Error("Synthetic lost provider PUT acknowledgement");
    });
    await failure(uploadAsset.call({ filename: "original.pdf", contentType: "application/pdf", bytes: body }, OWNER));
    expect(await store.get(writtenKey)).toEqual(body);
    expect(await db().select().from(assets)).toHaveLength(0);
    expect((await db().select().from(mediaObjects)).map(row => row.key)).toContain(writtenKey);
  });

  it("keeps ownership when an unknown PUT writes bytes after its caller already failed", async () => {
    const store = storage(), put = store.put.bind(store), body = pdf();
    const gate = new Promise<void>(resolve => { releaseLate = resolve; });
    let writtenKey = "";
    vi.spyOn(store, "put").mockImplementation(async (key, bytes, contentType) => {
      writtenKey = key;
      lateWrites.push(gate.then(() => put(key, bytes, contentType)));
      throw new Error("Synthetic timeout before the provider's later write");
    });
    await failure(uploadAsset.call({ filename: "late.pdf", contentType: "application/pdf", bytes: body }, OWNER));
    releaseLate!(); await Promise.all(lateWrites);
    expect(await store.get(writtenKey)).toEqual(body);
    expect((await db().select().from(mediaObjects)).map(row => row.key)).toContain(writtenKey);
  });

  it("keeps every parallel rendition witness after one PUT loses its acknowledgement", async () => {
    const store = storage(), put = store.put.bind(store);
    const body = new Uint8Array(await sharp({ create: { width: 1800, height: 1200, channels: 3, background: { r: 40, g: 90, b: 140 } } }).png().toBuffer());
    const variantKeys: string[] = [];
    vi.spyOn(store, "put").mockImplementation(async (key, bytes, contentType) => {
      const writing = put(key, bytes, contentType);
      lateWrites.push(writing);
      const stored = await writing;
      if (contentType !== "image/png") {
        variantKeys.push(key);
        if (variantKeys.length === 1) throw new Error("Synthetic lost rendition acknowledgement");
      }
      return stored;
    });
    await failure(uploadAsset.call({ filename: "renditions.png", contentType: "image/png", bytes: body }, OWNER));
    await Promise.allSettled(lateWrites);
    expect(variantKeys.length).toBeGreaterThan(1);
    const tracked = new Set((await db().select().from(mediaObjects)).map(row => row.key));
    for (const key of variantKeys) {
      expect(await store.get(key)).not.toBeNull();
      expect(tracked.has(key)).toBe(true);
    }
  });

  it("does not forget an unresolved writer merely because the orphan window passed", async () => {
    const store = storage(), put = store.put.bind(store), body = pdf();
    const gate = new Promise<void>(resolve => { releaseLate = resolve; });
    let writtenKey = "";
    vi.spyOn(store, "put").mockImplementation(async (key, bytes, contentType) => {
      writtenKey = key;
      lateWrites.push(gate.then(() => put(key, bytes, contentType)));
      throw new Error("Synthetic unknown writer still has an outstanding provider operation");
    });
    await failure(uploadAsset.call({ filename: "unresolved.pdf", contentType: "application/pdf", bytes: body }, OWNER));
    // Isolate the sweeper independently of the already-proved catch deletion:
    // restore only the actual original reservation if that old catch lost it.
    if (!(await db().select().from(mediaObjects).where(eq(mediaObjects.key, writtenKey))).length) {
      await db().insert(mediaObjects).values({ key: writtenKey, role: "original", state: "pending", bytes: body.byteLength, contentType: "application/pdf" });
    }
    const result = await cleanupOrphanedMedia(new Date(Date.now() + 2 * 86_400_000));
    releaseLate!(); await Promise.all(lateWrites);
    expect(await store.get(writtenKey)).toEqual(body);
    expect(result.orphanedObjects).toBe(0);
    expect((await db().select().from(mediaObjects)).map(row => row.key)).toContain(writtenKey);
  });

  it("does not acknowledge deletion in a replacement storage namespace", async () => {
    const original = storage(), put = original.put.bind(original), body = pdf();
    const reservation = await beginUpload.call({ filename: "original-store.pdf", contentType: "application/pdf", bytes: body.byteLength }, OWNER);
    let writtenKey = "";
    vi.spyOn(original, "put").mockImplementation(async (key, bytes, contentType) => {
      writtenKey = key;
      const result = await put(key, bytes, contentType);
      await db().update(mediaUploads).set({ state: "aborted" }).where(eq(mediaUploads.id, reservation.id));
      return result;
    });
    await failure(uploadAsset.call({ uploadId: reservation.id, filename: "original-store.pdf", contentType: "application/pdf", bytes: body }, OWNER));
    expect(await original.get(writtenKey)).toEqual(body);
    const replacementRoot = mkdtempSync(join(tmpdir(), "freeholder-replacement-store-fixture-"));
    try {
      vi.stubEnv("LOCAL_STORAGE_ROOT", replacementRoot);
      resetEnvForTests(); resetStorageForTests();
      const result = await cleanupOrphanedMedia(new Date(Date.now() + 2 * 86_400_000));
      expect(await original.get(writtenKey)).toEqual(body);
      expect(result.orphanedObjects).toBe(0);
      expect((await db().select().from(mediaObjects)).map(row => row.key)).toContain(writtenKey);
    } finally { rmSync(replacementRoot, { recursive: true, force: true }); }
  });
});
