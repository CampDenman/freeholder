// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C3.47: actual paginated HTTP originals, bounded resume, shared media and reversal.
import { createServer, type Server } from "node:http";
import { writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/core/db";
import { users, totpFactors } from "@/core/auth/schema";
import { createSession } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import * as transport from "@/core/http/pinned-download";
import { importRuns, importSourceBatches, importSourceEntries, importSourceGraphs, importSourceMedia } from "@/core/plugins/schema";
import { assets } from "@/core/media/schema";
import { assetUsage } from "@/core/media/service";
import { resetStorageForTests, storage } from "@/adapters/storage";
import { stopJobs } from "@/core/jobs";
import { ready } from "@/core/runtime";
import { crawlProgress } from "@/core/import/crawl-query";
import { advanceCrawl } from "@/core/import/crawl-advance";
import { importCrawlRequests, importCrawlResponses, importCrawlSources } from "@/core/import/crawl-schema";
import { importCrawlEntryOriginals } from "@/core/import/crawl-graph-schema";
import { startImport, previewFromUrl, commitImport, reconcileImport, publishImport, rollbackImport } from "@/core/import/service";
import { ensureDefaults } from "@/modules/cms/service";
import { pages } from "@/modules/cms/schema";
import { GET as readPublicMedia } from "../../app/media/[...key]/route";
import { runCrawlIndexProcess } from "../helpers/crawl-index-process";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

let server: Server | undefined;
const observed: Array<{ path: string; cookie?: string; authorization?: string }> = [];
async function ownerSession() {
  const session = await db().transaction(tx => createSession(tx, OWNER.userId, { twoFactorVerified: true }));
  const actor = await actorFromToken(session.token);
  if (actor.kind !== "user" || !actor.sessionId) throw new Error("The actual owner session was not resolved.");
  return actor;
}
async function actualRestServer() {
  const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 20, g: 80, b: 120 } } }).png().toBuffer();
  let site = "";
  server = createServer((request, response) => {
    observed.push({ path: request.url!, cookie: request.headers.cookie, authorization: request.headers.authorization });
    const url = new URL(request.url!, "http://owned-loopback.test");
    if (url.pathname === "/robots.txt") { response.setHeader("content-type", "text/plain"); response.end("User-agent: *\nAllow: /\n"); return; }
    if (url.pathname === "/shared.png") { response.setHeader("content-type", "image/png"); response.end(image); return; }
    if (!["/wp-json/wp/v2/pages", "/wp-json/wp/v2/posts"].includes(url.pathname)) { response.statusCode = 404; response.end(); return; }
    const total = url.pathname.endsWith("/pages") ? 501 : 0, page = Number(url.searchParams.get("page"));
    if (url.searchParams.get("per_page") !== "100" || !Number.isSafeInteger(page) || page < 1 || page > Math.max(1, Math.ceil(total / 100))) {
      response.statusCode = 400; response.end(); return;
    }
    response.setHeader("content-type", "application/json"); response.setHeader("x-wp-total", String(total)); response.setHeader("x-wp-totalpages", String(Math.ceil(total / 100)));
    const records = Array.from({ length: Math.min(100, Math.max(0, total - (page - 1) * 100)) }, (_, index) => {
      const id = (page - 1) * 100 + index + 1;
      return { id, type: "page", status: "publish", slug: `actual-rest-${id}`, link: `${site}actual-rest-${id}/`, date_gmt: "2026-01-01T00:00:00", modified_gmt: "2026-01-01T00:00:00",
        title: { rendered: `Actual original REST ${id}` }, excerpt: { rendered: "" }, content: { rendered: `<p>Actual original body ${id}</p>${id === 1 || id === 501 ? `<img src="${site}shared.png" alt="Shared actual original">` : ""}` } };
    });
    response.end(JSON.stringify(records));
  });
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  site = `http://fictional-large-original.example:${(server.address() as AddressInfo).port}/`;
  if (process.env.FREEHOLDER_CRAWL_SERVER_OBSERVATION) await writeFile(process.env.FREEHOLDER_CRAWL_SERVER_OBSERVATION, JSON.stringify({ port: (server.address() as AddressInfo).port }), { flag: "wx", mode: 0o600 });
  const original = transport.requestPinnedBytes;
  // Only the test lookup permits the owned TCP server. Actual response and
  // image bytes still cross the real pinned HTTP transport; pacing stays real.
  const lookup = async () => [{ address: "127.0.0.1", family: 4 as const }];
  vi.spyOn(transport, "requestPinnedBytes").mockImplementation((raw, options) => original(raw, { ...options, allowLocal: true, lookup }));
  vi.spyOn(transport, "getPinnedBytes").mockImplementation(async (raw, options) => {
    const { status, contentType, bytes } = await original(raw, { ...options, method: "GET", allowLocal: true, lookup });
    return { status, contentType, bytes };
  });
  return { site, image };
}

describe.runIf(hasDatabase)("actual above500 HTTP source lifecycle (C3.47)", { timeout: 180_000 }, () => {
  beforeAll(ready);
  beforeEach(async () => { await truncateSpine(); resetStorageForTests(); observed.length = 0; });
  afterEach(async () => { vi.restoreAllMocks(); if (server) { const current = server; server = undefined; await new Promise<void>((resolve, reject) => current.close(error => error ? reject(error) : resolve())); } });
  afterAll(async () => { await stopJobs(); await closeDb(); });

  it("reviews501 actual REST records in separate index processes, resumes an accepted500-page child and reverses publication", async () => {
    await db().insert(users).values({ id: OWNER.userId, email: "fictional-large-http-owner@example.test", role: "owner" });
    await db().insert(totpFactors).values({ userId: OWNER.userId, encryptedSecret: "fictional-large-http-factor" });
    const owner = await ownerSession(), { site, image } = await actualRestServer();
    await ensureDefaults.call({}, owner);
    const initialPages = await db().select().from(pages);
    const originalPages = () => db().select().from(pages).where(sql`${pages.slug} like 'actual-rest-%'`);
    const run = await startImport.call({ origin: site, kind: "wordpress-rest" }, owner);
    expect(await previewFromUrl.call({ id: run.id, url: site }, owner)).toMatchObject({ status: "discover" });
    expect(observed).toEqual([]);
    expect(await crawlProgress.call({ id: run.id }, owner)).toMatchObject({ requests: 0, indexed: 0, pending: 1, planReady: false });
    const [source] = await db().select().from(importCrawlSources).where(eq(importCrawlSources.runId, run.id));
    if (!source) throw new Error("The actual crawl source was not admitted.");
    let captured = false;
    for (let phase = 0; phase < 40; phase++) {
      const result = await advanceCrawl.call({ id: run.id, generation: source.generation }, owner);
      const progress = await crawlProgress.call({ id: run.id }, owner);
      if (result.step === "discovered" && progress.requests === 8 && progress.pending === 0) { captured = true; break; }
    }
    expect(captured).toBe(true);
    expect(await crawlProgress.call({ id: run.id }, owner)).toMatchObject({ requests: 8, indexed: 0, pending: 0, planReady: false });
    // Both index phases execute in actual new processes. Only persisted IDs,
    // the explicit disposable database and private store configuration cross.
    await closeDb(); resetStorageForTests();
    const firstIndexer = await runCrawlIndexProcess(run.id, source.generation, OWNER.userId, "prefix500");
    expect(firstIndexer.pid).not.toBe(process.pid);
    expect(firstIndexer).toMatchObject({ beforeIndexed: 0, indexed: 500, planReady: false, transportCalls: 0 });
    const secondIndexer = await runCrawlIndexProcess(run.id, source.generation, OWNER.userId, "finish501");
    expect(secondIndexer.pid).not.toBe(process.pid); expect(secondIndexer.pid).not.toBe(firstIndexer.pid);
    expect(secondIndexer.sessionId).not.toBe(firstIndexer.sessionId);
    expect(secondIndexer).toMatchObject({ beforeIndexed: 500, indexed: 501, planReady: true, transportCalls: 0 });
    expect(await crawlProgress.call({ id: run.id }, owner)).toMatchObject({ requests: 8, indexed: 501, pending: 0, planReady: true, recoveryRequired: false });
    expect((await db().select().from(importCrawlSources).where(eq(importCrawlSources.id, source.id)))[0]).toMatchObject({ state: "sealed", networkRequests: 8, pageCount: 501, reservedBytes: 0 });
    const [graph] = await db().select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, run.id));
    if (!graph) throw new Error("The real HTTP source graph is missing.");
    expect(graph).toMatchObject({ state: "indexed", planMetadata: { report: { sourceFormat: "http-originals", indexed: 501, unresolvedMedia: [] } } });
    const version = { generation: graph.generation, sourceRevision: graph.sourceRevision, planRevision: graph.planRevision };
    expect(await db().select().from(importSourceEntries).where(eq(importSourceEntries.graphId, graph.id))).toHaveLength(501);
    expect(await db().select().from(importCrawlEntryOriginals).where(eq(importCrawlEntryOriginals.graphId, graph.id))).toHaveLength(501);
    expect(await originalPages()).toHaveLength(0);
    expect(await db().select().from(importSourceMedia).where(eq(importSourceMedia.graphId, graph.id))).toHaveLength(1);
    // First the real shared file, then an accepted bounded content child.
    expect(await commitImport.call({ id: run.id, graph: version }, owner)).toMatchObject({ status: "previewed", counts: { media: 1 } });
    await commitImport.call({ id: run.id, graph: version }, owner);
    const [interrupted] = await db().select().from(importSourceGraphs).where(eq(importSourceGraphs.id, graph.id));
    expect(interrupted).toMatchObject({ commitOrdinal: 500, batchCounter: 2 });
    expect(await originalPages()).toHaveLength(500);
    const resumedOwner = await ownerSession();
    expect(resumedOwner.sessionId).not.toBe(owner.sessionId);
    const committed = await commitImport.call({ id: run.id, graph: version }, resumedOwner);
    expect(committed).toMatchObject({ status: "committed", counts: { pages: 501, media: 1 } });
    expect(await commitImport.call({ id: run.id, graph: version }, resumedOwner)).toMatchObject({ status: "committed", counts: { pages: 501, media: 1 } });
    const allPages = await originalPages();
    expect(allPages).toHaveLength(501); expect(allPages.every(page => page.status === "draft")).toBe(true);
    const [asset] = await db().select().from(assets);
    if (!asset) throw new Error("Actual shared HTTP image bytes were not ingested.");
    expect(await db().select().from(assets)).toHaveLength(1);
    expect(Buffer.from((await storage().get(asset.storageKey))!)).toEqual(image);
    for (const slug of ["actual-rest-1", "actual-rest-501"]) expect(JSON.stringify(allPages.find(page => page.slug === slug)?.blocks)).toContain(asset.id);
    expect(observed.filter(item => item.path === "/shared.png")).toHaveLength(1);
    expect(observed.every(item => item.cookie === undefined && item.authorization === undefined)).toBe(true);
    const batches = await db().select().from(importSourceBatches).where(eq(importSourceBatches.graphId, graph.id));
    expect(batches).toHaveLength(3); expect(batches.filter(batch => batch.kind === "content").map(batch => batch.endOrdinal - batch.startOrdinal).sort((a, b) => a - b)).toEqual([1, 500]);
    let reconciled = await reconcileImport.call({ id: run.id, graph: version }, resumedOwner);
    for (let phase = 0; phase < 6 && reconciled.status === "committed"; phase++) reconciled = await reconcileImport.call({ id: run.id, graph: version }, resumedOwner);
    expect(reconciled.status).toBe("reconciled");
    let published = await publishImport.call({ id: run.id, graph: version }, resumedOwner);
    for (let phase = 0; phase < 6 && published.status === "reconciled"; phase++) published = await publishImport.call({ id: run.id, graph: version }, resumedOwner);
    expect(published.status).toBe("published");
    expect((await originalPages()).filter(page => page.status === "published")).toHaveLength(501);
    const publicRequest = () => readPublicMedia(new Request("http://qualification.test/media/original"), { params: Promise.resolve({ key: asset.storageKey.split("/") }) });
    expect((await publicRequest()).status).toBe(200);
    let reversed = await rollbackImport.call({ id: run.id, graph: version }, resumedOwner);
    for (let phase = 0; phase < 6 && reversed.status !== "rolled_back"; phase++) reversed = await rollbackImport.call({ id: run.id, graph: version }, resumedOwner);
    expect(reversed.status).toBe("rolled_back"); expect(await originalPages()).toHaveLength(0);
    expect(await db().select().from(pages)).toEqual(initialPages);
    expect((await db().select().from(assets)).map(item => ({ id: item.id, status: item.status }))).toEqual([{ id: asset.id, status: "trashed" }]);
    expect(await assetUsage.call({ id: asset.id }, resumedOwner)).toEqual({ pages: 0, sections: 0 });
    expect((await publicRequest()).status).toBe(404);
    expect((await db().select().from(importRuns).where(eq(importRuns.id, run.id)))[0]).toMatchObject({ status: "rolled_back", createdBy: `user:${OWNER.userId}` });
    expect((await db().select().from(importCrawlSources).where(eq(importCrawlSources.id, source.id)))[0]?.state).toBe("rolled_back");
    const requests = await db().select().from(importCrawlRequests).where(eq(importCrawlRequests.sourceId, source.id));
    expect(requests).toHaveLength(8);
    for (const request of requests) expect((await db().select().from(importCrawlResponses).where(eq(importCrawlResponses.id, request.acceptedResponseId!)))[0]?.state).toBe("retired");
  });
});
