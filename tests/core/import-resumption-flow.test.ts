// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: actual large-source phases retain their original bytes and CMS ownership.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, closeDb } from "@/core/db";
import { resetStorageForTests, storage } from "@/adapters/storage";
import { pages } from "@/modules/cms/schema";
import { importRuns, importSourceEntries, importSourceGraphs } from "@/core/plugins/schema";
import { apiKeys } from "@/core/apikeys/schema";
import { mintApiKey } from "@/core/apikeys/tokens";
import { actorFromRequest } from "@/core/http/actor";
import { ensureDefaults } from "@/modules/cms/service";
import { commitImport, publishImport, reconcileImport, rollbackImport, startImport } from "@/core/import/service";
import { beginSourceUpload, previewFromUpload, uploadSourceChunk } from "@/core/import/source-upload";
import { hasDatabase, OWNER, truncateSpine, failure } from "../helpers/spine";

const ORIGIN = "https://resumption-source.example";
function source(count: number): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?><rss xmlns:wp="urn:wordpress" xmlns:content="urn:content"><channel><title>Fictional resumed source</title><link>${ORIGIN}</link><wp:wxr_version>1.2</wp:wxr_version>${Array.from({ length: count }, (_, index) => `<item><title>Fictional page ${index}</title><link>${ORIGIN}/resumed/page-${index}</link><wp:post_id>${index + 1}</wp:post_id><wp:post_name>page-${index}</wp:post_name><wp:post_type>page</wp:post_type><wp:status>publish</wp:status><content:encoded><![CDATA[<p>Original source page ${index}.</p>${index === 0 ? `<p><a href="${ORIGIN}/resumed/page-${count - 1}">Last source page</a></p>` : ""}]]></content:encoded></item>`).join("")}</channel></rss>`);
}

describe.runIf(hasDatabase)("durable large-source import (C3.47)", { timeout: 180_000 }, () => {
  beforeEach(async () => { await truncateSpine(); resetStorageForTests(); await ensureDefaults.call({}, OWNER); });
  afterAll(closeDb);
  it.each(["revoked", "expired", "scopes narrowed"])("rechecks the exact HTTP key after I/O when it is %s", async outcome => {
    const run = await startImport.call({ origin: ORIGIN, kind: "wordpress-wxr" }, OWNER), bytes = source(501);
    const credential = mintApiKey();
    const [key] = await db().insert(apiKeys).values({ name: "Fictional importer", prefix: credential.prefix, tokenHash: credential.tokenHash, scopes: ["imports.beginSourceUpload", "imports.uploadSourceChunk", "imports.previewFromUpload"] }).returning();
    const actor = await actorFromRequest(new Request("https://instance.example/api/mcp", { headers: { authorization: `Bearer ${credential.token}` } }));
    expect(actor).toMatchObject({ kind: "agent", keyId: key!.id });
    await expect.poll(async () => (await db().select({ seen: apiKeys.lastUsedAt }).from(apiKeys).where(eq(apiKeys.id, key!.id)))[0]!.seen).not.toBeNull();
    const upload = await beginSourceUpload.call({ id: run.id, filename: "fictional-authority-export.xml", bytes: bytes.byteLength }, actor);
    await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes }, actor);
    await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, actor);
    const store = storage(), original = store.get.bind(store);
    let arrived!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { arrived = resolve; }), pending = new Promise<void>(resolve => { release = resolve; });
    const spy = vi.spyOn(store, "get").mockImplementationOnce(async storageKey => { const value = await original(storageKey); arrived(); await pending; return value; });
    const active = failure(previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, actor));
    try {
      await entered;
      await db().update(apiKeys).set(outcome === "expired" ? { expiresAt: new Date(0) } : outcome === "scopes narrowed" ? { scopes: [] } : { revokedAt: new Date() }).where(eq(apiKeys.id, key!.id));
      if (outcome === "revoked") {
        const replacement = mintApiKey();
        await db().insert(apiKeys).values({ name: key!.name, prefix: replacement.prefix, tokenHash: replacement.tokenHash, scopes: ["imports.previewFromUpload"] });
      }
    } finally { release(); spy.mockRestore(); }
    expect(await active).toMatchObject({ code: "permission" });
    expect(await db().select().from(importSourceEntries)).toEqual([]);
    expect((await db().select().from(importRuns))[0]).toMatchObject({ status: "discover", counts: { indexed: 0 } });
  });
  it("refuses overlapping workers and a late index result after cancellation", async () => {
    const run = await startImport.call({ origin: ORIGIN, kind: "wordpress-wxr" }, OWNER), bytes = source(501);
    const upload = await beginSourceUpload.call({ id: run.id, filename: "fictional-concurrent-export.xml", bytes: bytes.byteLength }, OWNER);
    await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes }, OWNER);
    await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER);
    const store = storage(), original = store.get.bind(store);
    let arrived!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { arrived = resolve; }), pending = new Promise<void>(resolve => { release = resolve; });
    const spy = vi.spyOn(store, "get").mockImplementationOnce(async key => { const value = await original(key); arrived(); await pending; return value; });
    const active = failure(previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER));
    try {
      await entered;
      expect(await failure(previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER))).toMatchObject({ code: "conflict" });
      expect(await rollbackImport.call({ id: run.id }, OWNER)).toMatchObject({ status: "rolled_back" });
    } finally { release(); spy.mockRestore(); }
    expect(await active).toMatchObject({ code: "conflict" });
    expect(await db().select().from(importSourceEntries)).toEqual([]);
    expect((await db().select().from(importSourceGraphs))[0]).toMatchObject({ state: "invalidated", leaseToken: null });
  });
  it("persists all 501 original entry spans across bounded indexing and a fresh connection", async () => {
    const run = await startImport.call({ origin: ORIGIN, kind: "wordpress-wxr" }, OWNER), bytes = source(501);
    const upload = await beginSourceUpload.call({ id: run.id, filename: "fictional-indexed-export.xml", bytes: bytes.byteLength }, OWNER);
    for (let index = 0; index < upload.chunkCount; index++) await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index, bytes: bytes.slice(index * upload.chunkBytes, (index + 1) * upload.chunkBytes) }, OWNER);
    expect(await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER)).toMatchObject({ status: "discover", counts: { indexed: 0 } });
    expect(await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER)).toMatchObject({ status: "discover", counts: { indexed: 500 } });
    await closeDb(); resetStorageForTests();
    expect(await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER)).toMatchObject({ status: "previewed", counts: { indexed: 501, pages: 501 } });
    const entries = await db().select().from(importSourceEntries);
    expect(entries).toHaveLength(501);
    expect(new Set(entries.map(entry => entry.sourceIdentity)).size).toBe(501);
    for (const entry of entries) expect(new TextDecoder().decode(bytes.slice(entry.startByte, entry.endByte))).toContain(`<wp:post_id>${Number(entry.ordinal) + 1}</wp:post_id>`);
    expect(await db().select().from(pages).where(sql`${pages.slug} like 'resumed/page-%'`)).toEqual([]);
    const [graph] = await db().select().from(importSourceGraphs), [stored] = await db().select().from(importRuns);
    expect(graph).toMatchObject({ state: "indexed", leaseToken: null, leaseActor: null, leaseUntil: null });
    expect(stored!.checkpoint).toHaveProperty("retainedSource");
    expect(stored!.checkpoint).not.toHaveProperty("sourceUpload");
    expect(JSON.stringify(entries)).not.toContain("Original source page");
  });
  it("indexes and commits 501 source pages through bounded resumable phases, then publishes and rolls back", async () => {
    const run = await startImport.call({ origin: ORIGIN, kind: "wordpress-wxr" }, OWNER), bytes = source(501);
    const upload = await beginSourceUpload.call({ id: run.id, filename: "fictional-resumable-export.xml", bytes: bytes.byteLength }, OWNER);
    for (let index = 0; index < upload.chunkCount; index++) await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index, bytes: bytes.slice(index * upload.chunkBytes, (index + 1) * upload.chunkBytes) }, OWNER);
    let staged = await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER);
    // The synchronous phase budget remains 500. A larger parser limit would
    // skip this durable interruption boundary and does not satisfy the case.
    expect(staged.status).toBe("discover");
    await closeDb(); resetStorageForTests();
    for (let phase = 0; phase < 8 && staged.status === "discover"; phase++) staged = await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER);
    expect(staged).toMatchObject({ status: "previewed", error: null, counts: { pages: 501 } });
    let committed = await commitImport.call({ id: run.id }, OWNER);
    for (let phase = 0; phase < 8 && committed.status === "previewed"; phase++) committed = await commitImport.call({ id: run.id }, OWNER);
    expect(committed).toMatchObject({ status: "committed", counts: { pages: 501 } });
    const imported = await db().select().from(pages).where(sql`${pages.slug} like 'resumed/page-%'`);
    expect(imported).toHaveLength(501);
    expect(new Set(imported.map(page => page.id)).size).toBe(501);
    expect(imported.every(page => page.status === "draft")).toBe(true);
    await reconcileImport.call({ id: run.id }, OWNER);
    let published = await publishImport.call({ id: run.id }, OWNER);
    for (let phase = 0; phase < 8 && published.status === "reconciled"; phase++) published = await publishImport.call({ id: run.id }, OWNER);
    expect(published.status).toBe("published");
    let rolledBack = await rollbackImport.call({ id: run.id }, OWNER);
    for (let phase = 0; phase < 8 && rolledBack.status !== "rolled_back"; phase++) rolledBack = await rollbackImport.call({ id: run.id }, OWNER);
    expect(rolledBack.status).toBe("rolled_back");
    expect(await db().select().from(pages).where(sql`${pages.slug} like 'resumed/page-%'`)).toHaveLength(0);
  });
});
