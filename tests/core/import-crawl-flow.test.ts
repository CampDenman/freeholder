// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Public discovery → real draft/rollback and lifecycle races (C3.22/C3.23).
import type * as PinnedDownload from "@/core/http/pinned-download";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users, totpFactors } from "@/core/auth/schema";
import { createSession } from "@/core/auth/sessions";
import { actorFromToken, actorFromRequest } from "@/core/http/actor";
import { apiKeys } from "@/core/apikeys/schema";
import { mintApiKey } from "@/core/apikeys/tokens";
import { ready } from "@/core/runtime";
import { stopJobs } from "@/core/jobs";
import { resetStorageForTests } from "@/adapters/storage";
import { advanceCrawl } from "@/core/import/crawl-advance";
import { crawlProgress } from "@/core/import/crawl-query";
import { cancelCrawl } from "@/core/import/crawl-retirement";
import { restartCrawlReview } from "@/core/import/crawl-recovery";
import { sourceGraphReview } from "@/core/import/graph-query";
import { importCrawlResponses, importCrawlSources } from "@/core/import/crawl-schema";
import { blogAuthors, blogTerms } from "@/modules/cms/blog-schema";
import { importRuns } from "@/core/plugins/schema";
import { auditLog } from "@/core/events/schema";
import { getExternalService, getService, type Actor } from "@/core/service";
import { pages } from "@/modules/cms/schema";
import { ensureDefaults } from "@/modules/cms/service";
import { commitImport, listImports, mapImport, previewFromSource, previewFromUrl, previewImport, publishImport, reconcileImport, rollbackImport, startImport } from "@/core/import/service";
import { beginSourceUpload } from "@/core/import/source-upload";
import { ANONYMOUS, CUSTOMER, OWNER, closeDb, failure, hasDatabase, truncateSpine } from "../helpers/spine";

const download = vi.hoisted(() => vi.fn<typeof PinnedDownload.requestPinnedBytes>());
vi.mock("@/core/http/pinned-download", async importActual => ({ ...await importActual<typeof PinnedDownload>(), requestPinnedBytes: download }));
const record = { id: 15, type: "post", status: "publish", link: "https://source.example/2024/old-title", slug: "old-title", title: { rendered: "Imported title" }, content: { rendered: "<p>Body from the source.</p>" }, date_gmt: "2024-04-02T09:00:00", _embedded: { author: [{ slug: "fictional", name: "Fictional Author" }], "wp:term": [[{ taxonomy: "category", slug: "journal", name: "Journal" }]] } };
function answer(text: string, status = 200, headers: Record<string, string> = {}) { return { status, contentType: undefined, headers: new Headers({ "content-type": text.startsWith("[") || text.startsWith("{") ? "application/json" : text.startsWith("<rss") ? "application/rss+xml" : text.startsWith("<sitemap") || text.startsWith("<urlset") ? "application/xml" : text.startsWith("<") ? "text/html" : "text/plain", ...headers }), bytes: new TextEncoder().encode(text) }; }

let owner: Actor;
async function finishSavedPreview(id: string) {
  const initial = await crawlProgress.call({ id }, owner);
  let ready = false;
  for (let phase = 0; phase < 20; phase++) {
    const result = await advanceCrawl.call({ id, generation: initial.generation }, owner);
    if (result.step === "previewed") { ready = true; break; }
  }
  expect(ready).toBe(true);
  const [run] = (await listImports.call({}, owner)).filter(row => row.id === id);
  if (!run) throw new Error("The public import receipt is missing.");
  return { run, review: await sourceGraphReview.call({ id }, owner), progress: await crawlProgress.call({ id }, owner) };
}

describe.runIf(hasDatabase)("public-source import studio (C3.22)", () => {
  beforeAll(ready);
  beforeEach(async () => {
    await truncateSpine(); resetStorageForTests();
    await db().insert(users).values({ id: OWNER.userId, email: "fictional-public-flow-owner@example.test", role: "owner" });
    await db().insert(totpFactors).values({ userId: OWNER.userId, encryptedSecret: "fictional-public-flow-factor" });
    const session = await db().transaction(tx => createSession(tx, OWNER.userId, { twoFactorVerified: true }));
    owner = await actorFromToken(session.token);
    if (owner.kind !== "user" || !owner.sessionId) throw new Error("The actual freshly verified owner is unavailable.");
    await ensureDefaults.call({}, owner);
    download.mockReset();
    download.mockImplementation(async (raw: string) => {
      if (raw.endsWith("/robots.txt")) return answer("", 404);
      const posts = new URL(raw).pathname.endsWith("/posts");
      return answer(JSON.stringify(posts ? [record] : []), 200, { "x-wp-totalpages": posts ? "1" : "0", "x-wp-total": posts ? "1" : "0" });
    });
  });
  afterAll(async () => { await stopJobs(); await closeDb(); });

  it("stages real REST records without publishing, then preserves dates, byline and rollback ownership", async () => {
    const started = await startImport.call({ origin: "https://source.example", kind: "wordpress-rest" }, owner);
    expect(await previewFromUrl.call({ id: started.id, url: "https://source.example/" }, owner)).toMatchObject({ status: "discover" });
    expect(download).not.toHaveBeenCalled();
    const previewed = await finishSavedPreview(started.id);
    expect(previewed.run).toMatchObject({ status: "previewed", counts: { posts: 1, indexed: 1 } });
    expect(previewed.progress).toMatchObject({ requests: 3, pages: 1, indexed: 1, planReady: true, recoveryRequired: false });
    expect(await db().select().from(pages).where(eq(pages.slug, "2024/old-title"))).toHaveLength(0);
    let committed = await commitImport.call({ id: started.id, graph: previewed.review.version }, owner);
    for (let phase = 0; phase < 4 && committed.status === "previewed"; phase++) committed = await commitImport.call({ id: started.id, graph: previewed.review.version }, owner);
    expect(committed.status).toBe("committed");
    expect(await db().select().from(blogAuthors)).toHaveLength(1);
    expect(await db().select().from(blogTerms)).toHaveLength(1);
    const [draft] = await db().select().from(pages).where(eq(pages.slug, "2024/old-title"));
    expect(draft).toMatchObject({ status: "draft" });
    expect(JSON.stringify(draft!.blocks)).toContain("Body from the source.");
    let reconciled = await reconcileImport.call({ id: started.id, graph: previewed.review.version }, owner);
    for (let phase = 0; phase < 4 && reconciled.status === "committed"; phase++) reconciled = await reconcileImport.call({ id: started.id, graph: previewed.review.version }, owner);
    expect(reconciled.status).toBe("reconciled");
    let publishedRun = await publishImport.call({ id: started.id, graph: previewed.review.version }, owner);
    for (let phase = 0; phase < 4 && publishedRun.status === "reconciled"; phase++) publishedRun = await publishImport.call({ id: started.id, graph: previewed.review.version }, owner);
    expect(publishedRun.status).toBe("published");
    const [published] = await db().select().from(pages).where(eq(pages.id, draft!.id));
    expect(published!.publishedAt!.toISOString()).toBe("2024-04-02T09:00:00.000Z");
    let reversed = await rollbackImport.call({ id: started.id, graph: previewed.review.version }, owner);
    for (let phase = 0; phase < 4 && reversed.status !== "rolled_back"; phase++) reversed = await rollbackImport.call({ id: started.id, graph: previewed.review.version }, owner);
    expect(reversed.status).toBe("rolled_back");
    expect(await db().select().from(pages).where(eq(pages.id, draft!.id))).toHaveLength(0);
  });


  it("keeps exact start authority separate from continuation and hides every actual private phase", async () => {
    const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-rest" }, owner);
    const credential = mintApiKey(), scopes = ["imports.previewFromUrl"];
    const [keyRow] = await db().insert(apiKeys).values({ name: "source-reader", prefix: credential.prefix, tokenHash: credential.tokenHash, scopes }).returning();
    const key = await actorFromRequest(new Request("https://instance.example/api/mcp", { headers: { authorization: `Bearer ${credential.token}` } }));
    if (key.kind !== "agent" || key.keyId !== keyRow!.id) throw new Error("The actual restricted connector was not resolved.");
    await expect.poll(async () => (await db().select({ seen: apiKeys.lastUsedAt }).from(apiKeys).where(eq(apiKeys.id, keyRow!.id)))[0]?.seen).not.toBeNull();
    expect(await previewFromUrl.call({ id: run.id, url: "https://source.example/" }, key)).toMatchObject({ status: "discover" });
    expect(key.scopes).toEqual(scopes);
    const progress = await crawlProgress.call({ id: run.id }, owner);
    expect((await failure(advanceCrawl.call({ id: run.id, generation: progress.generation }, key))).code).toBe("permission");
    const [entry] = await db().select().from(auditLog).where(eq(auditLog.action, "imports.initializeCrawl"));
    expect(entry).toMatchObject({ actor: "agent:source-reader", subjectType: "import_run", subjectId: run.id });
    expect(() => getExternalService("imports.initializeCrawl")).toThrow();
    expect(() => getExternalService("imports.claimCrawlCapture")).toThrow();
    expect((await failure(getService("imports.claimCrawlCapture").call({ id: run.id, generation: progress.generation, storageNamespace: "a".repeat(64) }, key))).code).toBe("permission");
    expect(download).not.toHaveBeenCalled();
  });
  it("refuses anonymous, customer and different-origin crawls before any transport", async () => {
    const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-rest" }, owner);
    expect((await failure(previewFromUrl.call({ id: run.id, url: "https://source.example" }, ANONYMOUS))).code).toBe("permission");
    expect((await failure(previewFromUrl.call({ id: run.id, url: "https://source.example" }, CUSTOMER))).code).toBe("permission");
    expect((await failure(previewFromUrl.call({ id: run.id, url: "https://different.example" }, owner))).code).toBe("validation");
    expect(download).not.toHaveBeenCalled();
  });

  it("cannot restage or remap committed, reconciled, published or rolled-back runs", async () => {
    const run = await startImport.call({ origin: "https://source.example/existing.html", kind: "html" }, owner);
    await previewFromSource.call({ id: run.id, payload: "<h1>Existing</h1><p>Owned body</p>" }, owner);
    await commitImport.call({ id: run.id }, owner);
    for (const status of ["committed", "reconciled", "published", "rolled_back"] as const) {
      await db().update(importRuns).set({ status }).where(eq(importRuns.id, run.id));
      const [before] = await db().select().from(importRuns).where(eq(importRuns.id, run.id));
      for (const attempt of [
        () => previewFromSource.call({ id: run.id, payload: "<h1>Overwrite</h1>" }, owner),
        () => previewImport.call({ id: run.id, pages: [{ url: "https://source.example/new", slug: "new", title: "New" }] }, owner),
        () => mapImport.call({ id: run.id, mapping: [{ url: "https://source.example/new", slug: "new", title: "New", kind: "page" }] }, owner),
        () => previewFromUrl.call({ id: run.id, url: "https://source.example/" }, owner),
      ]) expect((await failure(attempt())).code).toBe("conflict");
      const [after] = await db().select().from(importRuns).where(eq(importRuns.id, run.id));
      expect(after).toEqual(before);
    }
    expect(download).not.toHaveBeenCalled();
  });


  it("preserves owned page rollback evidence when a recovery state is marked failed", async () => {
    const run = await startImport.call({ origin: "https://source.example/owned-page.html", kind: "html" }, owner);
    await previewFromSource.call({ id: run.id, payload: "<title>Owned page</title><main><h1>Owned page</h1><p>Keep this recovery ledger.</p></main>" }, owner);
    const committed = await commitImport.call({ id: run.id }, owner);
    const checkpoint = committed.checkpoint as { createdPageIds: string[] };
    expect(checkpoint.createdPageIds).toHaveLength(1);
    await db().update(importRuns).set({ status: "failed" }).where(eq(importRuns.id, run.id));
    expect((await failure(previewFromSource.call({ id: run.id, payload: "<h1>Replacement</h1>" }, owner))).code).toBe("conflict");
    expect((await failure(previewFromUrl.call({ id: run.id, url: "https://source.example/" }, owner))).code).toBe("conflict");
    expect((await failure(beginSourceUpload.call({ id: run.id, filename: "replacement.html", bytes: 100 }, owner))).code).toBe("conflict");
    const [saved] = await db().select().from(importRuns).where(eq(importRuns.id, run.id));
    expect(saved!.checkpoint).toEqual(committed.checkpoint);
    await rollbackImport.call({ id: run.id }, owner);
    expect(await db().select().from(pages).where(eq(pages.id, checkpoint.createdPageIds[0]!))).toHaveLength(0);
    expect(download).not.toHaveBeenCalled();
  });

  it("blocks commit while a replacement source upload is outstanding", async () => {
    const run = await startImport.call({ origin: "https://source.example", kind: "html" }, owner);
    await previewFromSource.call({ id: run.id, payload: "<h1>Original preview</h1>" }, owner);
    await beginSourceUpload.call({ id: run.id, filename: "replacement.html", bytes: 100 }, owner);
    expect((await failure(commitImport.call({ id: run.id }, owner))).code).toBe("conflict");
    expect((await failure(previewFromSource.call({ id: run.id, payload: "<h1>Third source</h1>" }, owner))).code).toBe("conflict");
  });
  it("refuses a delayed actual GET result after public cancellation without applying a stale preview", async () => {
    const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-rest" }, owner);
    await previewFromUrl.call({ id: run.id, url: "https://source.example/" }, owner);
    const progress = await crawlProgress.call({ id: run.id }, owner);
    download.mockImplementationOnce(async () => {
      await cancelCrawl.call({ id: run.id }, owner);
      return answer("", 404);
    });
    expect((await failure(advanceCrawl.call({ id: run.id, generation: progress.generation }, owner))).code).toBe("conflict");
    const [saved] = await db().select().from(importRuns).where(eq(importRuns.id, run.id));
    expect(saved).toMatchObject({ status: "failed", preview: {} });
    expect(await crawlProgress.call({ id: run.id }, owner)).toMatchObject({ state: "invalidated", invalidated: true, indexed: 0, planReady: false });
    expect(await db().select().from(pages).where(eq(pages.slug, "2024/old-title"))).toHaveLength(0);
  });

  it("keeps failed original transport in recovery and starts a distinct explicit review without rewriting its old receipt", async () => {
    const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-rest" }, owner);
    await previewFromUrl.call({ id: run.id, url: "https://source.example/" }, owner);
    const progress = await crawlProgress.call({ id: run.id }, owner), implementation = download.getMockImplementation()!;
    download.mockResolvedValueOnce(answer("private source body not shown", 503));
    expect((await failure(advanceCrawl.call({ id: run.id, generation: progress.generation }, owner))).code).toBe("conflict");
    const [failed] = await db().select().from(importRuns).where(eq(importRuns.id, run.id));
    expect(failed?.error).toContain("recovery"); expect(failed?.error).not.toContain("private source body");
    expect(await crawlProgress.call({ id: run.id }, owner)).toMatchObject({ recoveryRequired: true, planReady: false });
    const originalResponses = await db().select().from(importCrawlResponses);
    expect(originalResponses).toHaveLength(1); expect(originalResponses[0]?.wrapperFinishedAt).toBeInstanceOf(Date);
    download.mockImplementation(implementation);
    const created = await restartCrawlReview.call({ id: run.id, generation: progress.generation, origin: "https://source.example", url: "https://source.example/", confirmation: "START NEW SOURCE REVIEW" }, owner);
    expect(created.id).not.toBe(run.id); expect(created.generation).not.toBe(progress.generation);
    expect((await finishSavedPreview(created.id)).run).toMatchObject({ status: "previewed", error: null });
    expect(await db().select().from(importCrawlResponses).where(eq(importCrawlResponses.id, originalResponses[0]!.id))).toEqual(originalResponses);
    expect((await db().select().from(importCrawlSources).where(eq(importCrawlSources.runId, created.id)))[0]?.recoveryOfSourceId).toBe((await db().select().from(importCrawlSources).where(eq(importCrawlSources.runId, run.id)))[0]?.id);
  });
});
