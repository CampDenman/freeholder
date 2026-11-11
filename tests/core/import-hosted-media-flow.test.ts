// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.22: real hosted-source consent, fresh CDN policy and atomic media/CMS.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import type * as PinnedDownload from "@/core/http/pinned-download";
import { db } from "@/core/db";
import { resetStorageForTests } from "@/adapters/storage";
import { assets } from "@/core/media/schema";
import { importRuns } from "@/core/plugins/schema";
import { pages } from "@/modules/cms/schema";
import { ensureDefaults } from "@/modules/cms/service";
import { commitImport, previewFromSource, previewFromUrl, startImport } from "@/core/import/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const getPinnedBytes = vi.hoisted(() => vi.fn<typeof PinnedDownload.getPinnedBytes>());
vi.mock("@/core/http/pinned-download", async importActual => ({ ...await importActual<typeof PinnedDownload>(), getPinnedBytes }));
const ORIGIN = "https://hosted-source.example/team.html", CDN = "https://images.hosted-cdn.example";
const BODY = `<main><h1>Hosted team</h1><img src="${CDN}/image?id=one" alt="Fictional team"><p><a href="${CDN}/other-page.html">Another site</a></p></main>`;

describe.runIf(hasDatabase)("hosted media approval lifecycle (C3.22)", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await truncateSpine(); resetStorageForTests(); await ensureDefaults.call({}, OWNER);
    const png = new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 30, g: 90, b: 140 } } }).png().toBuffer());
    getPinnedBytes.mockReset();
    getPinnedBytes.mockImplementation(async url => url.endsWith("/robots.txt") ? { status: 200, contentType: "text/plain", bytes: new TextEncoder().encode("User-agent: *\nAllow: /\n") } : { status: 200, contentType: "application/octet-stream", bytes: png });
  });
  afterAll(closeDb);
  async function stage(approved = true) {
    const run = await startImport.call({ kind: "html", origin: ORIGIN, ...(approved ? { approvedMediaOrigins: [CDN] } : {}) }, OWNER);
    return previewFromSource.call({ id: run.id, payload: BODY }, OWNER);
  }
  it("imports explicitly approved CDN bytes through the ordinary permission and receipt boundary", async () => {
    const run = await stage();
    expect(run.counts).toMatchObject({ media: 1, mediaWarnings: 0 });
    const actor = { kind: "agent" as const, keyName: "exact-hosted-commit", scopes: ["imports.commit", "cms.*", "seo.*"] };
    expect((await failure(commitImport.call({ id: run.id }, actor))).code).toBe("permission");
    expect(await db().select().from(assets)).toHaveLength(1);
    expect(await db().select().from(pages).where(eq(pages.slug, "team"))).toHaveLength(0);
    expect((await commitImport.call({ id: run.id }, { ...actor, scopes: [...actor.scopes, "media.get"] })).counts).toMatchObject({ pages: 1, media: 1 });
    const [page] = await db().select().from(pages).where(eq(pages.slug, "team"));
    expect(JSON.stringify(page?.blocks)).toContain('"type":"image"');
    expect(JSON.stringify(page?.blocks)).toContain(`${CDN}/other-page.html`);
    expect(getPinnedBytes.mock.calls.filter(([url]) => !url.endsWith("/robots.txt")).map(([url]) => url)).toEqual([`${CDN}/image?id=one`]);
    expect(getPinnedBytes.mock.calls.every(([, options]) => options.allowLocal === false)).toBe(true);
    expect(getPinnedBytes.mock.calls.every(([, options]) => options.headers?.["User-Agent"] === "Freeholder-Importer/1.0")).toBe(true);
  });
  it("does not fetch unapproved CDN media or treat a media approval as page-crawl approval", async () => {
    const run = await stage(false);
    expect(run.counts).toMatchObject({ media: 0, mediaWarnings: 1 });
    await commitImport.call({ id: run.id }, OWNER);
    expect(getPinnedBytes).not.toHaveBeenCalled();
    const approvedRun = await stage();
    expect((await failure(previewFromUrl.call({ id: approvedRun.id, url: `${CDN}/other-page.html` }, OWNER))).code).toBe("validation");
    expect(getPinnedBytes).not.toHaveBeenCalled();
  });
  it("rechecks each CDN's current robots policy before file bytes and resumes after a permitted retry", async () => {
    const run = await stage(), ordinary = getPinnedBytes.getMockImplementation()!;
    getPinnedBytes.mockImplementation(async (url, options) => url === `${CDN}/robots.txt` ? { status: 200, contentType: "text/plain", bytes: new TextEncoder().encode("User-agent: *\nDisallow: /image\n") } : ordinary(url, options));
    expect((await failure(commitImport.call({ id: run.id }, OWNER))).code).toBe("conflict");
    expect(getPinnedBytes.mock.calls.map(([url]) => url)).toEqual([`${CDN}/robots.txt`]);
    expect(await db().select().from(assets)).toHaveLength(0);
    getPinnedBytes.mockImplementation(ordinary);
    expect((await commitImport.call({ id: run.id }, OWNER)).counts).toMatchObject({ media: 1 });
    expect(await db().select().from(assets)).toHaveLength(1);
  });
  it("refuses a stale or expanded preview media policy before any provider call", async () => {
    const run = await stage();
    await db().update(importRuns).set({ checkpoint: { ...(run.checkpoint as object), approvedMediaOrigins: [] } }).where(eq(importRuns.id, run.id));
    expect((await failure(commitImport.call({ id: run.id }, OWNER))).code).toBe("conflict");
    expect(getPinnedBytes).not.toHaveBeenCalled();
    expect(await db().select().from(assets)).toHaveLength(0);
    const preview = structuredClone(run.preview) as { generic: { mediaOrigins: string[] } };
    preview.generic.mediaOrigins.push("https://unapproved.example");
    await db().update(importRuns).set({ checkpoint: run.checkpoint, preview }).where(eq(importRuns.id, run.id));
    expect((await failure(commitImport.call({ id: run.id }, OWNER))).code).toBe("conflict");
    expect(getPinnedBytes).not.toHaveBeenCalled();
  });
  it("refuses an unverifiable CDN robots response before reading image bytes", async () => {
    const run = await stage();
    getPinnedBytes.mockResolvedValue({ status: 200, contentType: "text/html", bytes: new TextEncoder().encode("<html>Not a robots policy</html>") });
    expect((await failure(commitImport.call({ id: run.id }, OWNER))).code).toBe("conflict");
    expect(getPinnedBytes.mock.calls.map(([url]) => url)).toEqual([`${CDN}/robots.txt`]);
    expect(await db().select().from(assets)).toHaveLength(0);
  });
});
