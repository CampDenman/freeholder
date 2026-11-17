// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.22/C3.47: the selected same-host WordPress instance is not its host root.
import type * as PinnedDownload from "@/core/http/pinned-download";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { db } from "@/core/db";
import { stopJobs } from "@/core/jobs";
import { pluginPermissionConsents } from "@/core/plugins/schema";
import { seedDefaultRoles } from "@/core/roles/defaults";
import { seedCoreGuidanceFlows } from "@/core/guidance/definitions";
import { seedReviewedBuiltinPlugins } from "../helpers/plugin-consent";
import { previewFromUrl, startImport } from "@/core/import/service";
import { advanceCrawl } from "@/core/import/crawl-advance";
import { importCrawlSources } from "@/core/import/crawl-schema";
import { importRuns, importSourceEntries, importSourceGraphs } from "@/core/plugins/schema";
import { eq } from "drizzle-orm";
import { OWNER, closeDb, hasDatabase } from "../helpers/spine";

const download = vi.hoisted(() => vi.fn<typeof PinnedDownload.requestPinnedBytes>());
vi.mock("@/core/http/pinned-download", async original => ({ ...await original<typeof PinnedDownload>(), requestPinnedBytes: download }));
const HOST = "https://fictional-rest-instances.example", INSTANCE = `${HOST}/site-a/`;

describe.runIf(hasDatabase)("selected REST instance path (C3.22/C3.47)", () => {
  beforeEach(async () => {
    // This case owns a fresh UUID run and only stages a preview. It needs no
    // site-wide reset or CMS records; seed the same required shared defaults
    // as the ordinary fixture without deleting unrelated test data.
    await db().transaction(async tx => {
      await seedDefaultRoles(tx); await seedCoreGuidanceFlows(tx);
      // The common helper inserts a complete empty-site review set. This
      // append-only probe preserves the already-reviewed fixture site.
      const existing = await tx.select({ name: pluginPermissionConsents.name }).from(pluginPermissionConsents).limit(1);
      if (!existing.length) await seedReviewedBuiltinPlugins(tx, `user:${OWNER.userId}`);
    });
    download.mockReset();
    download.mockImplementation(async raw => {
      const path = new URL(raw).pathname;
      if (path === "/robots.txt") return { status: 404, contentType: "text/plain", headers: new Headers({ "content-type": "text/plain" }), bytes: new Uint8Array() };
      const instance = path.slice(0, path.indexOf("/wp-json/"));
      const posts = path.endsWith("/posts");
      return { status: 200, contentType: "application/json", headers: new Headers({ "content-type": "application/json", "x-wp-totalpages": posts ? "1" : "0", "x-wp-total": posts ? "1" : "0" }), bytes: new TextEncoder().encode(JSON.stringify(posts ? [{ id: 15, type: "post", status: "publish", link: `${HOST}${instance}/article`, title: { rendered: instance === "/site-a" ? "Selected instance article" : "Different host-root article" }, content: { rendered: "<p>Fictional public source.</p>" } }] : [])) };
    });
  });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  it("keeps the actual selected subdirectory in the persisted source, real crawl targets and staged site", async () => {
    const run = await startImport.call({ origin: INSTANCE, kind: "wordpress-rest" }, OWNER);
    // previewFromUrl only admits the source now; the real REST phases run
    // through advanceCrawl, so drive them until the staged preview exists.
    await previewFromUrl.call({ id: run.id, url: run.origin! }, OWNER);
    const [source] = await db().select().from(importCrawlSources).where(eq(importCrawlSources.runId, run.id));
    if (!source) throw new Error("The admitted REST source was not saved.");
    let previewed = run;
    for (let phase = 0; phase < 10 && previewed.status !== "previewed"; phase++) {
      await advanceCrawl.call({ id: run.id, generation: source.generation }, OWNER);
      [previewed] = await db().select().from(importRuns).where(eq(importRuns.id, run.id)) as [typeof run];
    }
    expect(previewed.status).toBe("previewed");
    // The staged site and its pages live in the normalized source graph now;
    // `preview` only names that graph generation.
    const [graph] = await db().select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, run.id));
    if (!graph) throw new Error("The staged REST source graph was not saved.");
    const header = z.object({ kind: z.literal("wordpress-rest"), siteUrl: z.string(), sourceUrl: z.string() }).parse(graph.headerMetadata);
    const entries = await db().select().from(importSourceEntries).where(eq(importSourceEntries.graphId, graph.id));
    const titles = z.array(z.object({ title: z.string() })).parse(entries.map(entry => entry.metadata));
    expect({ origin: run.origin, requests: download.mock.calls.map(([raw]) => new URL(raw).pathname).filter(path => path.includes("/wp-json/")), site: header.siteUrl, source: header.sourceUrl, title: titles[0]?.title }).toEqual({ origin: INSTANCE, requests: ["/site-a/wp-json/wp/v2/pages", "/site-a/wp-json/wp/v2/posts"], site: INSTANCE, source: INSTANCE, title: "Selected instance article" });
  });
});
