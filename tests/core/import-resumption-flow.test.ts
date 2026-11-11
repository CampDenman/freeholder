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
import { commitImport, listImports, publishImport, reconcileImport, rollbackImport, startImport } from "@/core/import/service";
import { beginSourceUpload, previewFromUpload, uploadSourceChunk } from "@/core/import/source-upload";
import { hasDatabase, OWNER, truncateSpine, failure } from "../helpers/spine";
import { runImportResumptionProcess } from "../helpers/import-resumption-process";
import { sourceGraphReview } from "@/core/import/graph-query";
import { markImportGraphWriter } from "@/core/import/graph-writer";

const ORIGIN = "https://resumption-source.example";
function source(count: number): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?><rss xmlns:wp="urn:wordpress" xmlns:content="urn:content"><channel><title>Fictional resumed source</title><link>${ORIGIN}</link><wp:wxr_version>1.2</wp:wxr_version>${Array.from({ length: count }, (_, index) => `<item><title>Fictional page ${index}</title><link>${ORIGIN}/resumed/page-${index}</link><wp:post_id>${index + 1}</wp:post_id><wp:post_name>page-${index}</wp:post_name><wp:post_type>page</wp:post_type><wp:status>publish</wp:status><content:encoded><![CDATA[<p>Original source page ${index}.</p>${index === 0 ? `<p><a href="${ORIGIN}/resumed/page-${count - 1}">Last source page</a></p>` : ""}]]></content:encoded></item>`).join("")}</channel></rss>`);
}

describe.runIf(hasDatabase)("durable large-source import (C3.47)", { timeout: 180_000 }, () => {
  beforeEach(async () => { await truncateSpine(); resetStorageForTests(); await ensureDefaults.call({}, OWNER); });
  afterAll(closeDb);
  it("fences overlapping restore workers and a verified source result arriving after cancellation", async () => {
    const run = await startImport.call({ origin: ORIGIN, kind: "wordpress-wxr" }, OWNER), bytes = source(501);
    const initial = await beginSourceUpload.call({ id: run.id, filename: "fictional-restore-race.xml", bytes: bytes.byteLength }, OWNER);
    await uploadSourceChunk.call({ id: run.id, uploadId: initial.uploadId, index: 0, bytes }, OWNER);
    let staged = await previewFromUpload.call({ id: run.id, uploadId: initial.uploadId }, OWNER);
    for (let phase = 0; phase < 4 && staged.status === "discover"; phase++) staged = await previewFromUpload.call({ id: run.id, uploadId: initial.uploadId }, OWNER);
    const restored = await beginSourceUpload.call({ id: run.id, filename: "fictional-restore-race-again.xml", bytes: bytes.byteLength, graph: staged.graph }, OWNER);
    await uploadSourceChunk.call({ id: run.id, uploadId: restored.uploadId, index: 0, bytes }, OWNER);
    const store = storage(), original = store.get.bind(store);
    let arrived!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { arrived = resolve; }), pending = new Promise<void>(resolve => { release = resolve; });
    const spy = vi.spyOn(store, "get").mockImplementationOnce(async key => { const value = await original(key); arrived(); await pending; return value; });
    const active = failure(previewFromUpload.call({ id: run.id, uploadId: restored.uploadId }, OWNER));
    try {
      await entered;
      expect(await failure(previewFromUpload.call({ id: run.id, uploadId: restored.uploadId }, OWNER))).toMatchObject({ code: "conflict" });
      expect(await failure(commitImport.call({ id: run.id, graph: staged.graph }, OWNER))).toMatchObject({ code: "conflict" });
      expect(await rollbackImport.call({ id: run.id, graph: staged.graph }, OWNER)).toMatchObject({ status: "rolled_back" });
    } finally { release(); spy.mockRestore(); }
    expect(await active).toMatchObject({ code: "conflict" });
    expect((await db().select().from(importSourceGraphs))[0]).toMatchObject({ state: "invalidated", leaseToken: null });
    const [after] = await db().select().from(importRuns).where(eq(importRuns.id, run.id));
    expect(after!.checkpoint).not.toHaveProperty("retainedSource");
    expect(after!.checkpoint).not.toHaveProperty("sourceGraphRebind");
    expect(after!.checkpoint).not.toHaveProperty("sourceUpload");
    expect(await db().select().from(pages).where(sql`${pages.slug} like 'resumed/page-%'`)).toEqual([]);
  });
  it("restores only identical expired source bytes one verified chunk at a time after a committed batch", async () => {
    const run = await startImport.call({ origin: ORIGIN, kind: "wordpress-wxr" }, OWNER);
    const bytes = new TextEncoder().encode(new TextDecoder().decode(source(501)).replace("</channel>", `<!--${"x".repeat(4 * 1024 * 1024)}--></channel>`));
    const send = async (upload: Awaited<ReturnType<typeof beginSourceUpload.call>>, value: Uint8Array<ArrayBuffer>) => {
      for (let index = 0; index < upload.chunkCount; index++) await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index, bytes: value.slice(index * upload.chunkBytes, (index + 1) * upload.chunkBytes) }, OWNER);
    };
    const initial = await beginSourceUpload.call({ id: run.id, filename: "fictional-original.xml", bytes: bytes.byteLength }, OWNER);
    expect(initial.chunkCount).toBe(2);
    await send(initial, bytes);
    let staged = await previewFromUpload.call({ id: run.id, uploadId: initial.uploadId }, OWNER);
    for (let phase = 0; phase < 4 && staged.status === "discover"; phase++) staged = await previewFromUpload.call({ id: run.id, uploadId: initial.uploadId }, OWNER);
    expect(await commitImport.call({ id: run.id, graph: staged.graph }, OWNER)).toMatchObject({ status: "previewed", counts: { pages: 500 } });
    const [graph] = await db().select().from(importSourceGraphs);
    await db().transaction(async tx => {
      await markImportGraphWriter(tx);
      await tx.execute(sql`update ${importRuns} set checkpoint=jsonb_set(checkpoint,'{retainedSource,expiresAt}',to_jsonb('1970-01-01T00:00:00.000Z'::text)) where id=${run.id}`);
    });
    expect(await failure(commitImport.call({ id: run.id, graph: staged.graph }, OWNER))).toMatchObject({ code: "conflict" });
    expect(await failure(beginSourceUpload.call({ id: run.id, filename: "fictional-original.xml", bytes: bytes.byteLength }, OWNER))).toMatchObject({ code: "conflict" });
    const wrong = bytes.slice(); wrong[200] = wrong[200] === 65 ? 66 : 65;
    const changed = await beginSourceUpload.call({ id: run.id, filename: "fictional-changed.xml", bytes: bytes.byteLength, graph: staged.graph }, OWNER);
    await send(changed, wrong);
    expect(await failure(previewFromUpload.call({ id: run.id, uploadId: changed.uploadId }, OWNER))).toMatchObject({ code: "conflict" });
    const restored = await beginSourceUpload.call({ id: run.id, filename: "fictional-original-again.xml", bytes: bytes.byteLength, graph: staged.graph }, OWNER);
    await send(restored, bytes);
    expect(await previewFromUpload.call({ id: run.id, uploadId: restored.uploadId }, OWNER)).toMatchObject({ sourceRestored: false, graph: staged.graph, counts: { pages: 500 } });
    expect((await db().select().from(importRuns).where(eq(importRuns.id, run.id)))[0]!.checkpoint).toMatchObject({ retainedSource: { uploadId: initial.uploadId } });
    expect(JSON.stringify(await listImports.call({}, OWNER))).not.toContain("sourceGraphRebind");
    expect(await previewFromUpload.call({ id: run.id, uploadId: restored.uploadId }, OWNER)).toMatchObject({ sourceRestored: true, graph: staged.graph });
    const [after] = await db().select().from(importSourceGraphs);
    expect(after).toMatchObject({ generation: graph!.generation, sourceStartedAt: graph!.sourceStartedAt, sourceRevision: graph!.sourceRevision, planDigest: graph!.planDigest, planRevision: graph!.planRevision, commitOrdinal: graph!.commitOrdinal });
    expect(await commitImport.call({ id: run.id, graph: staged.graph }, OWNER)).toMatchObject({ status: "committed", counts: { pages: 501 } });
    expect((await db().select().from(pages).where(sql`${pages.slug} like 'resumed/page-%'`))).toHaveLength(501);
  });
  it("requires the caller's reviewed graph version and exposes only bounded source metadata", async () => {
    const run = await startImport.call({ origin: ORIGIN, kind: "wordpress-wxr" }, OWNER), bytes = source(501);
    const upload = await beginSourceUpload.call({ id: run.id, filename: "fictional-reviewed-source.xml", bytes: bytes.byteLength }, OWNER);
    await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes }, OWNER);
    let staged = await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER);
    for (let phase = 0; phase < 4 && staged.status === "discover"; phase++) staged = await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER);
    expect(staged.graph).toBeDefined();
    const credential = mintApiKey();
    const [key] = await db().insert(apiKeys).values({ name: "Fictional graph reviewer", prefix: credential.prefix, tokenHash: credential.tokenHash, scopes: ["imports.sourceGraph"] }).returning();
    const reviewer = await actorFromRequest(new Request("https://instance.example/api/mcp", { headers: { authorization: `Bearer ${credential.token}` } }));
    const first = await sourceGraphReview.call({ id: run.id }, reviewer);
    expect(first).toMatchObject({ version: staged.graph, indexed: 501, indexComplete: true, planFrozen: false, nextOrdinal: 49 });
    expect(first.entries).toHaveLength(50);
    expect(first.entries[0]).toMatchObject({ ordinal: 0, title: "Fictional page 0", sourceUrl: `${ORIGIN}/resumed/page-0`, destinationPath: "resumed/page-0", applied: false });
    expect(JSON.stringify(first)).not.toContain("Original source page");
    expect(JSON.stringify(first)).not.toContain(key!.id);
    const last = await sourceGraphReview.call({ id: run.id, afterOrdinal: 499 }, reviewer);
    expect(last.entries.map(entry => entry.ordinal)).toEqual([500]);
    expect(last.nextOrdinal).toBeNull();
    expect(await failure(commitImport.call({ id: run.id, graph: first.version }, reviewer))).toMatchObject({ code: "permission" });
    expect(await failure(commitImport.call({ id: run.id }, OWNER))).toMatchObject({ code: "conflict" });
    expect(await failure(commitImport.call({ id: run.id, graph: { ...first.version, planRevision: first.version.planRevision + 1 } }, OWNER))).toMatchObject({ code: "conflict" });
    expect(await failure(rollbackImport.call({ id: run.id }, OWNER))).toMatchObject({ code: "conflict" });
    expect(await db().select().from(pages).where(sql`${pages.slug} like 'resumed/page-%'`)).toEqual([]);
    expect((await db().select().from(importSourceGraphs))[0]).toMatchObject({ planDigest: null, commitOrdinal: 0, leaseToken: null });
    expect(await rollbackImport.call({ id: run.id, graph: first.version }, OWNER)).toMatchObject({ status: "rolled_back" });
  });
  it("freezes the accepted plan, entry identity and original source date across later batches", async () => {
    const run = await startImport.call({ origin: ORIGIN, kind: "wordpress-wxr" }, OWNER), bytes = source(501);
    const upload = await beginSourceUpload.call({ id: run.id, filename: "fictional-frozen-plan.xml", bytes: bytes.byteLength }, OWNER);
    await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes }, OWNER);
    let staged = await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER);
    for (let phase = 0; phase < 4 && staged.status === "discover"; phase++) staged = await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER);
    expect(await commitImport.call({ id: run.id, graph: staged.graph }, OWNER)).toMatchObject({ status: "previewed", counts: { pages: 500 } });
    const [graph] = await db().select().from(importSourceGraphs), [entry] = await db().select().from(importSourceEntries);
    expect(graph!.planDigest).toMatch(/^[a-f0-9]{64}$/);
    await expect(db().update(importSourceGraphs).set({ planDigest: "f".repeat(64) }).where(eq(importSourceGraphs.id, graph!.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db().update(importSourceGraphs).set({ sourceStartedAt: new Date() }).where(eq(importSourceGraphs.id, graph!.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(db().update(importSourceEntries).set({ targetSlug: "changed-after-acceptance" }).where(eq(importSourceEntries.id, entry!.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    const [child] = await db().select().from(importRuns).where(sql`${importRuns.checkpoint} ? 'sourceGraphBatch'`);
    expect(await failure(sourceGraphReview.call({ id: child!.id }, OWNER))).toMatchObject({ code: "not_found" });
    await expect(db().update(importRuns).set({ checkpoint: {} }).where(eq(importRuns.id, child!.id))).rejects.toMatchObject({ cause: { code: "55000" } });
    expect(await commitImport.call({ id: run.id, graph: staged.graph }, OWNER)).toMatchObject({ status: "committed", counts: { pages: 501 } });
    const [after] = await db().select().from(importSourceGraphs);
    expect(after).toMatchObject({ planDigest: graph!.planDigest, sourceStartedAt: graph!.sourceStartedAt });
  });
  it("refuses an older writer dropping graph ownership or committing an empty root", async () => {
    const run = await startImport.call({ origin: ORIGIN, kind: "wordpress-wxr" }, OWNER), bytes = source(501);
    const upload = await beginSourceUpload.call({ id: run.id, filename: "fictional-old-writer.xml", bytes: bytes.byteLength }, OWNER);
    await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes }, OWNER);
    await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER);
    await expect(db().execute(sql`update ${importRuns} set status='committed', preview='{}'::jsonb, checkpoint=checkpoint-'sourceGraph' where id=${run.id}`)).rejects.toMatchObject({ cause: { code: "55000" } });
    expect((await db().select().from(importRuns))[0]).toMatchObject({ status: "discover", counts: { indexed: 0 } });
    expect(await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER)).toMatchObject({ status: "discover", counts: { indexed: 500 } });
  });
  it.each(["renamed", "replaced"])("binds the source upload to the immutable key when its friendly name is %s", async change => {
    const run = await startImport.call({ origin: ORIGIN, kind: "wordpress-wxr" }, OWNER), bytes = source(501), credential = mintApiKey();
    const scopes = ["imports.beginSourceUpload", "imports.uploadSourceChunk", "imports.previewFromUpload"];
    const [key] = await db().insert(apiKeys).values({ name: "Original source uploader", prefix: credential.prefix, tokenHash: credential.tokenHash, scopes }).returning();
    const request = (token: string) => new Request("https://instance.example/api/mcp", { headers: { authorization: `Bearer ${token}` } });
    const original = await actorFromRequest(request(credential.token));
    await expect.poll(async () => (await db().select({ seen: apiKeys.lastUsedAt }).from(apiKeys).where(eq(apiKeys.id, key!.id)))[0]!.seen).not.toBeNull();
    const upload = await beginSourceUpload.call({ id: run.id, filename: "fictional-key-owned.xml", bytes: bytes.byteLength }, original);
    await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes }, original);
    await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, original);
    expect(JSON.stringify(await listImports.call({}, OWNER))).not.toContain(key!.id);
    let token = credential.token;
    if (change === "renamed") await db().update(apiKeys).set({ name: "Renamed source uploader" }).where(eq(apiKeys.id, key!.id));
    else {
      await db().update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, key!.id));
      const replacement = mintApiKey(); token = replacement.token;
      await db().insert(apiKeys).values({ name: key!.name, prefix: replacement.prefix, tokenHash: replacement.tokenHash, scopes });
    }
    const current = await actorFromRequest(request(token));
    if (change === "renamed") expect(await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, current)).toMatchObject({ status: "discover", counts: { indexed: 500 } });
    else expect(await failure(previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, current))).toMatchObject({ code: "not_found" });
  });
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
    const staged = await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER);
    const store = storage(), original = store.get.bind(store);
    let arrived!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { arrived = resolve; }), pending = new Promise<void>(resolve => { release = resolve; });
    const spy = vi.spyOn(store, "get").mockImplementationOnce(async key => { const value = await original(key); arrived(); await pending; return value; });
    const active = failure(previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER));
    try {
      await entered;
      expect(await failure(previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER))).toMatchObject({ code: "conflict" });
      expect(await rollbackImport.call({ id: run.id, graph: staged.graph }, OWNER)).toMatchObject({ status: "rolled_back" });
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
    await closeDb(); resetStorageForTests();
    const firstProcess = await runImportResumptionProcess(run.id, upload.uploadId);
    expect(firstProcess.pid).not.toBe(process.pid);
    expect(firstProcess.result).toMatchObject({ status: "discover", counts: { indexed: 500 } });
    const secondProcess = await runImportResumptionProcess(run.id, upload.uploadId);
    expect(secondProcess.pid).not.toBe(firstProcess.pid);
    expect(secondProcess.result).toMatchObject({ status: "previewed", counts: { indexed: 501, pages: 501 } });
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
    let phaseStarted = performance.now();
    const mark = (phase: string) => { const now = performance.now(); console.info(`[durable import qualification] ${phase}: ${Math.round(now - phaseStarted)}ms`); phaseStarted = now; };
    const run = await startImport.call({ origin: ORIGIN, kind: "wordpress-wxr" }, OWNER), bytes = source(501);
    const upload = await beginSourceUpload.call({ id: run.id, filename: "fictional-resumable-export.xml", bytes: bytes.byteLength }, OWNER);
    for (let index = 0; index < upload.chunkCount; index++) await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index, bytes: bytes.slice(index * upload.chunkBytes, (index + 1) * upload.chunkBytes) }, OWNER);
    const staged = await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER);
    // The synchronous phase budget remains 500. A larger parser limit would
    // skip this durable interruption boundary and does not satisfy the case.
    expect(staged.status).toBe("discover");
    await closeDb(); resetStorageForTests();
    const firstProcess = await runImportResumptionProcess(run.id, upload.uploadId);
    expect(firstProcess.result).toMatchObject({ status: "discover", counts: { indexed: 500 } });
    const secondProcess = await runImportResumptionProcess(run.id, upload.uploadId);
    expect(firstProcess.pid).not.toBe(secondProcess.pid);
    expect(secondProcess.result).toMatchObject({ status: "previewed", counts: { indexed: 501 } });
    expect(secondProcess.result).toMatchObject({ status: "previewed", error: null, counts: { pages: 501 }, graph: staged.graph });
    mark("upload and index");
    let committed = await commitImport.call({ id: run.id, graph: staged.graph }, OWNER);
    for (let phase = 0; phase < 8 && committed.status === "previewed"; phase++) committed = await commitImport.call({ id: run.id, graph: staged.graph }, OWNER);
    expect(committed).toMatchObject({ status: "committed", counts: { pages: 501 } });
    const imported = await db().select().from(pages).where(sql`${pages.slug} like 'resumed/page-%'`);
    expect(imported).toHaveLength(501);
    expect(new Set(imported.map(page => page.id)).size).toBe(501);
    expect(imported.every(page => page.status === "draft")).toBe(true);
    mark("commit");
    let reconciled = await reconcileImport.call({ id: run.id, graph: staged.graph }, OWNER);
    for (let phase = 0; phase < 8 && reconciled.status === "committed"; phase++) reconciled = await reconcileImport.call({ id: run.id, graph: staged.graph }, OWNER);
    expect(reconciled).toMatchObject({ status: "reconciled", counts: { pages: 501 }, checkpoint: { reconciliation: { found: { pages: 501 }, matches: true } } });
    mark("reconcile");
    let published = await publishImport.call({ id: run.id, graph: staged.graph }, OWNER);
    for (let phase = 0; phase < 8 && published.status === "reconciled"; phase++) published = await publishImport.call({ id: run.id, graph: staged.graph }, OWNER);
    expect(published.status).toBe("published");
    expect((await db().select().from(pages).where(sql`${pages.slug} like 'resumed/page-%'`)).filter(page => page.status === "published")).toHaveLength(501);
    mark("publish");
    let rolledBack = await rollbackImport.call({ id: run.id, graph: staged.graph }, OWNER);
    for (let phase = 0; phase < 8 && rolledBack.status !== "rolled_back"; phase++) rolledBack = await rollbackImport.call({ id: run.id, graph: staged.graph }, OWNER);
    expect(rolledBack.status).toBe("rolled_back");
    expect(await db().select().from(pages).where(sql`${pages.slug} like 'resumed/page-%'`)).toHaveLength(0);
    mark("rollback");
  });
});
