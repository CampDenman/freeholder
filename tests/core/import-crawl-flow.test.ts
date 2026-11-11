// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Public discovery → real draft/rollback and lifecycle races (C3.22/C3.23).
import type * as PinnedDownload from "@/core/http/pinned-download";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { importRuns } from "@/core/plugins/schema";
import { auditLog } from "@/core/events/schema";
import { getExternalService, getService, type Actor } from "@/core/service";
import { pages } from "@/modules/cms/schema";
import { ensureDefaults } from "@/modules/cms/service";
import { commitImport, mapImport, previewFromSource, previewFromUrl, previewImport, publishImport, reconcileImport, rollbackImport, startImport } from "@/core/import/service";
import { beginSourceUpload } from "@/core/import/source-upload";
import { ANONYMOUS, CUSTOMER, OWNER, closeDb, failure, hasDatabase, truncateSpine } from "../helpers/spine";

const download = vi.hoisted(() => vi.fn<typeof PinnedDownload.requestPinnedBytes>());
vi.mock("@/core/http/pinned-download", async importActual => ({ ...await importActual<typeof PinnedDownload>(), requestPinnedBytes: download }));
const record = { id: 15, link: "https://source.example/2024/old-title", slug: "old-title", title: { rendered: "Imported title" }, content: { rendered: "<p>Body from the source.</p>" }, date_gmt: "2024-04-02T09:00:00", _embedded: { author: [{ slug: "fictional", name: "Fictional Author" }], "wp:term": [[{ taxonomy: "category", slug: "journal", name: "Journal" }]] } };
function answer(text: string, status = 200, headers: Record<string, string> = {}) { return { status, contentType: undefined, headers: new Headers({ "content-type": text.startsWith("[") || text.startsWith("{") ? "application/json" : text.startsWith("<rss") ? "application/rss+xml" : text.startsWith("<sitemap") || text.startsWith("<urlset") ? "application/xml" : text.startsWith("<") ? "text/html" : "text/plain", ...headers }), bytes: new TextEncoder().encode(text) }; }

describe.runIf(hasDatabase)("public-source import studio (C3.22)", () => {
  beforeEach(async () => {
    await truncateSpine();
    await ensureDefaults.call({}, OWNER);
    download.mockReset();
    download.mockImplementation(async (raw: string) => {
      if (raw.endsWith("/robots.txt")) return answer("", 404);
      const posts = new URL(raw).pathname.endsWith("/posts");
      return answer(JSON.stringify(posts ? [record] : []), 200, { "x-wp-totalpages": posts ? "1" : "0", "x-wp-total": posts ? "1" : "0" });
    });
  });
  afterAll(closeDb);

  it("stages real REST records without publishing, then preserves dates, byline and rollback ownership", async () => {
    const started = await startImport.call({ origin: "https://source.example", kind: "wordpress-rest" }, OWNER);
    const previewed = await previewFromUrl.call({ id: started.id, url: "https://source.example/" }, OWNER);
    expect(previewed).toMatchObject({ status: "previewed", counts: { pages: 1, posts: 1, authors: 1, categories: 1 }, checkpoint: { crawl: { requests: 3, blocked: [] } } });
    expect(await db().select().from(pages).where(eq(pages.slug, "2024/old-title"))).toHaveLength(0);
    const committed = await commitImport.call({ id: started.id }, OWNER);
    expect(committed.status).toBe("committed");
    const [draft] = await db().select().from(pages).where(eq(pages.slug, "2024/old-title"));
    expect(draft).toMatchObject({ status: "draft" });
    expect(JSON.stringify(draft!.blocks)).toContain("Body from the source.");
    await reconcileImport.call({ id: started.id }, OWNER);
    await publishImport.call({ id: started.id }, OWNER);
    const [published] = await db().select().from(pages).where(eq(pages.id, draft!.id));
    expect(published!.publishedAt!.toISOString()).toBe("2024-04-02T09:00:00.000Z");
    await rollbackImport.call({ id: started.id }, OWNER);
    expect(await db().select().from(pages).where(eq(pages.id, draft!.id))).toHaveLength(0);
  });


  it("supports one exact public verb without exposing its phases or changing audit identity", async () => {
    const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-rest" }, OWNER);
    const key: Actor = { kind: "agent", keyName: "source-reader", scopes: ["imports.previewFromUrl"] };
    const result = await previewFromUrl.call({ id: run.id, url: "https://source.example/" }, key);
    expect(result.status).toBe("previewed");
    expect(key.scopes).toEqual(["imports.previewFromUrl"]);
    const [entry] = await db().select().from(auditLog).where(eq(auditLog.action, "imports.applyCrawl"));
    expect(entry).toMatchObject({ actor: "agent:source-reader", subjectType: "import_run", subjectId: run.id });
    expect(() => getExternalService("imports.applyCrawl")).toThrow();
    expect(() => getExternalService("imports.crawlSource")).toThrow();
    expect((await failure(getService("imports.crawlSource").call({ id: run.id, url: "https://source.example/" }, key))).code).toBe("permission");
  });
  it("refuses anonymous, customer and different-origin crawls before any transport", async () => {
    const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-rest" }, OWNER);
    expect((await failure(previewFromUrl.call({ id: run.id, url: "https://source.example" }, ANONYMOUS))).code).toBe("permission");
    expect((await failure(previewFromUrl.call({ id: run.id, url: "https://source.example" }, CUSTOMER))).code).toBe("permission");
    expect((await failure(previewFromUrl.call({ id: run.id, url: "https://different.example" }, OWNER))).code).toBe("validation");
    expect(download).not.toHaveBeenCalled();
  });

  it("cannot restage or remap committed, reconciled, published or rolled-back runs", async () => {
    const run = await startImport.call({ origin: "https://source.example/existing.html", kind: "html" }, OWNER);
    await previewFromSource.call({ id: run.id, payload: "<h1>Existing</h1><p>Owned body</p>" }, OWNER);
    await commitImport.call({ id: run.id }, OWNER);
    for (const status of ["committed", "reconciled", "published", "rolled_back"] as const) {
      await db().update(importRuns).set({ status }).where(eq(importRuns.id, run.id));
      const [before] = await db().select().from(importRuns).where(eq(importRuns.id, run.id));
      for (const attempt of [
        () => previewFromSource.call({ id: run.id, payload: "<h1>Overwrite</h1>" }, OWNER),
        () => previewImport.call({ id: run.id, pages: [{ url: "https://source.example/new", slug: "new", title: "New" }] }, OWNER),
        () => mapImport.call({ id: run.id, mapping: [{ url: "https://source.example/new", slug: "new", title: "New", kind: "page" }] }, OWNER),
        () => previewFromUrl.call({ id: run.id, url: "https://source.example/" }, OWNER),
      ]) expect((await failure(attempt())).code).toBe("conflict");
      const [after] = await db().select().from(importRuns).where(eq(importRuns.id, run.id));
      expect(after).toEqual(before);
    }
    expect(download).not.toHaveBeenCalled();
  });


  it("preserves owned page rollback evidence when a recovery state is marked failed", async () => {
    const run = await startImport.call({ origin: "https://source.example/owned-page.html", kind: "html" }, OWNER);
    await previewFromSource.call({ id: run.id, payload: "<title>Owned page</title><main><h1>Owned page</h1><p>Keep this recovery ledger.</p></main>" }, OWNER);
    const committed = await commitImport.call({ id: run.id }, OWNER);
    const checkpoint = committed.checkpoint as { createdPageIds: string[] };
    expect(checkpoint.createdPageIds).toHaveLength(1);
    await db().update(importRuns).set({ status: "failed" }).where(eq(importRuns.id, run.id));
    expect((await failure(previewFromSource.call({ id: run.id, payload: "<h1>Replacement</h1>" }, OWNER))).code).toBe("conflict");
    expect((await failure(previewFromUrl.call({ id: run.id, url: "https://source.example/" }, OWNER))).code).toBe("conflict");
    expect((await failure(beginSourceUpload.call({ id: run.id, filename: "replacement.html", bytes: 100 }, OWNER))).code).toBe("conflict");
    const [saved] = await db().select().from(importRuns).where(eq(importRuns.id, run.id));
    expect(saved!.checkpoint).toEqual(committed.checkpoint);
    await rollbackImport.call({ id: run.id }, OWNER);
    expect(await db().select().from(pages).where(eq(pages.id, checkpoint.createdPageIds[0]!))).toHaveLength(0);
    expect(download).not.toHaveBeenCalled();
  });

  it("blocks commit while a replacement source upload is outstanding", async () => {
    const run = await startImport.call({ origin: "https://source.example", kind: "html" }, OWNER);
    await previewFromSource.call({ id: run.id, payload: "<h1>Original preview</h1>" }, OWNER);
    await beginSourceUpload.call({ id: run.id, filename: "replacement.html", bytes: 100 }, OWNER);
    expect((await failure(commitImport.call({ id: run.id }, OWNER))).code).toBe("conflict");
    expect((await failure(previewFromSource.call({ id: run.id, payload: "<h1>Third source</h1>" }, OWNER))).code).toBe("conflict");
  });
  it("holds a delayed crawl result when another preview changed the run", async () => {
    const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-rest" }, OWNER);
    let changed = false;
    download.mockImplementation(async () => {
      if (!changed) {
        changed = true;
        await previewImport.call({ id: run.id, pages: [{ url: "https://source.example/new", slug: "new", title: "Newer preview" }] }, OWNER);
        return answer("", 404);
      }
      return answer("[]", 200, { "x-wp-totalpages": "0", "x-wp-total": "0" });
    });
    expect((await failure(previewFromUrl.call({ id: run.id, url: "https://source.example/" }, OWNER))).code).toBe("conflict");
    const [saved] = await db().select().from(importRuns).where(eq(importRuns.id, run.id));
    expect(saved).toMatchObject({ status: "previewed", preview: { pages: [{ title: "Newer preview" }] } });
  });

  it("keeps a network failure visible and can retry the same uncommitted run", async () => {
    const run = await startImport.call({ origin: "https://source.example", kind: "wordpress-rest" }, OWNER);
    const implementation = download.getMockImplementation()!;
    download.mockResolvedValueOnce(answer("private source body not shown", 503));
    const failed = await previewFromUrl.call({ id: run.id, url: "https://source.example/" }, OWNER);
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("HTTP 503");
    download.mockImplementation(implementation);
    expect(await previewFromUrl.call({ id: run.id, url: "https://source.example/" }, OWNER)).toMatchObject({ status: "previewed", error: null });
  });
});
