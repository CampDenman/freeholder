// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.22: real ZIP fixtures, bounded random access and no filesystem extraction.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { readStaticArchive, type ArchiveSource } from "@/core/import/archive";
import { archivePlan, archivePreviewDigest, archiveSourcePath, stageStaticArchive } from "@/core/import/archive-plan";
import { archiveRangeSource } from "@/core/import/archive-source";
import { restoreStaticArchive } from "@/core/import/archive-commit";
import { staticArchivePlan } from "@/core/import/archive-plan";

function source(name: string): ArchiveSource {
  const bytes = readFileSync(`tests/fixtures/static-archive/${name}.zip`);
  return { bytes: bytes.length, async readRange(start, end) { return bytes.subarray(start, end); } };
}
describe("bounded static archives", () => {
  it("preserves nested source URLs, words, media and SEO without inventing WordPress records", async () => {
    const retained: Uint8Array[] = [];
    const archive = await readStaticArchive(source("site"), "https://archive.example/", async (asset, bytes) => {
      expect(asset.digest).toBe(createHash("sha256").update(bytes).digest("hex"));
      retained.push(bytes);
    });
    expect(archive.pages.map(page => [page.slug, page.title])).toEqual([["", "Northstar Studio"], ["about/team", "The team"]]);
    expect(archive.pages[0]!.body).toContain("Original words preserved.");
    expect(archive.pages[0]!.body).toContain('href="https://archive.example/about/team.html#people"');
    expect(archive.pages[1]!.body).toContain('src="https://archive.example/images/logo.png"');
    expect(archive.pages[0]!.seo.description).toBe("A fictional archive");
    expect(archive.pages[1]!.seo.noindex).toBe(true);
    expect(archive.assets).toHaveLength(1);
    expect(archive.assets[0]).toMatchObject({ sourceUrl: "https://archive.example/images/logo.png", referenced: true, altText: "Synthetic blue square" });
    expect(retained).toHaveLength(1);
    expect(archive.report.ignored).toEqual(["site/css/site.css", "site/js/site.js"]);
  });
  it.each(["traversal", "backslash", "absolute", "duplicates", "symlink", "foreign-base", "damaged-checksum", "oversized", "unsupported-compression", "encrypted", "truncated", "prototype", "constructor", "empty-media"])("refuses hostile or damaged %s ZIPs before retaining any asset", async (name) => {
    let retained = 0;
    await expect(readStaticArchive(source(name), "https://archive.example/", async () => { retained++; })).rejects.toThrow();
    expect(retained).toBe(0);
  });
  it("keeps percent-encoded literal names distinct from nested owned entries", async () => {
    const archive = await readStaticArchive(source("percent-paths"), "https://archive.example/", async () => {});
    expect(archive.pages.map(page => page.url)).toContain("https://archive.example/about%252Fteam.html");
    expect(archive.pages.map(page => page.url)).toContain("https://archive.example/about/team.html");
    expect(new Set(archive.pages.map(page => page.slug)).size).toBe(3);
  });
  it("refuses missing private source ranges and non-public source origins", async () => {
    const original = source("site");
    await expect(readStaticArchive({ ...original, async readRange(start, end) { return (await original.readRange(start, end)).subarray(1); } }, "https://archive.example/", async () => {})).rejects.toThrow();
    await expect(readStaticArchive(original, "http://127.0.0.1/", async () => {})).rejects.toThrow();
  });
  it("stages a subdirectory export with static metadata and literal paths", async () => {
    const staged = await stageStaticArchive(source("site"), "https://archive.example/legacy/");
    expect(staged.preview.sourceFormat).toBe("static-archive");
    expect(staged.preview.wordpress).toBeUndefined();
    expect(staged.preview.pages).toEqual(expect.arrayContaining([expect.objectContaining({ slug: "", url: "https://archive.example/legacy/index.html" }), expect.objectContaining({ slug: "about/team" })]));
    const site = { url: "https://archive.example/legacy/", hosts: ["archive.example"], basePath: "legacy" };
    expect(archiveSourcePath("about%252Fteam.html", site)).toBe("legacy/about%252Fteam.html");
    expect(archiveSourcePath("about/team.html", site)).toBe("legacy/about/team.html");
    expect(archiveSourcePath("https://archive.example/outside.html", site)).toBeNull();
    const credentialed = new URL(site.url); credentialed.username = "fixture";
    expect(archiveSourcePath(credentialed.href, site)).toBeNull();
  });
  it("binds lazy and responsive images to actual owned entries", async () => {
    const archive = await readStaticArchive(source("responsive-images"), "https://archive.example/", async () => {});
    expect(archive.pages[0]!.body.match(/\ssrc="https:\/\/archive.example\/images\/logo.png"/g)).toHaveLength(2);
    expect(archive.assets[0]!.referenced).toBe(true);
  });
  it("binds preview content independently of JSONB object key order", () => {
    const left = { pages: [{ title: "Original", body: "Words" }], archive: { version: 1, media: [] } };
    const right = { archive: { media: [], version: 1 }, pages: [{ body: "Words", title: "Original" }] };
    expect(archivePreviewDigest(left)).toBe(archivePreviewDigest(right));
    expect(archivePreviewDigest({ ...right, pages: [{ body: "Changed", title: "Original" }] })).not.toBe(archivePreviewDigest(left));
  });
  it("reads verified original chunks once across bounded ZIP ranges", async () => {
    const bytes = readFileSync("tests/fixtures/static-archive/site.zip"), chunkBytes = 300;
    const chunks = Array.from({ length: Math.ceil(bytes.length / chunkBytes) }, (_, index) => bytes.subarray(index * chunkBytes, (index + 1) * chunkBytes));
    const source = { bytes: bytes.length, chunkBytes, chunkDigests: chunks.map(chunk => createHash("sha256").update(chunk).digest("hex")) };
    const seen = new Map<number, number>();
    const reader = archiveRangeSource(source, async index => { seen.set(index, (seen.get(index) ?? 0) + 1); return chunks[index]!; });
    const staged = await stageStaticArchive(reader, "https://archive.example/");
    expect(staged.counts.pages).toBe(2);
    expect([...seen.values()].every(count => count === 1)).toBe(true);
    await expect(reader.readRange(-1, 1)).rejects.toThrow();
    await expect(reader.readRange(0, bytes.length + 1)).rejects.toThrow();
    const changed = archiveRangeSource(source, async index => { const bytes = new Uint8Array(chunks[index]!); bytes[0] = (bytes[0] ?? 0) ^ 1; return bytes; });
    await expect(stageStaticArchive(changed, "https://archive.example/")).rejects.toThrow("missing or changed");
  });
  it("restores only manifest-bound files and skips already accepted media receipts", async () => {
    const staged = await stageStaticArchive(source("site"), "https://archive.example/"), plan = staticArchivePlan(staged.preview)!;
    let uploads = 0;
    await restoreStaticArchive(source("site"), "https://archive.example/", { plan, previewDigest: archivePreviewDigest(staged.preview) }, new Set(), async asset => { uploads++; expect(asset.digest).toBe(plan.media[0]!.digest); });
    expect(uploads).toBe(1);
    await restoreStaticArchive(source("site"), "https://archive.example/", { plan, previewDigest: archivePreviewDigest(staged.preview) }, new Set(plan.media.map(asset => asset.key)), async () => { uploads++; });
    expect(uploads).toBe(1);
    const changed = structuredClone(plan); changed.media[0]!.digest = "0".repeat(64);
    await expect(restoreStaticArchive(source("site"), "https://archive.example/", { plan: changed, previewDigest: archivePreviewDigest(staged.preview) }, new Set(), async () => { uploads++; })).rejects.toThrow("differs");
    expect(uploads).toBe(1);
  });
  it("keeps provider callback time outside the ZIP decoding budget", async () => {
    let clock = Date.now(), accepted = 0;
    const time = vi.spyOn(Date, "now").mockImplementation(() => clock);
    try {
      await readStaticArchive(source("two-images"), "https://archive.example/", async () => { accepted++; clock += 65_000; });
      expect(accepted).toBe(2);
    } finally { time.mockRestore(); }
  });
  it("preserves outer content targets in new plans while resuming an exact version-one preview", async () => {
    const legacy = await readStaticArchive(source("root-target"), "https://archive.example/", async () => {}, { preserveRootTarget: false });
    const oldPlan = archivePlan(legacy), oldPreview = { sourceFormat: "static-archive", pages: legacy.pages, archive: oldPlan };
    expect(oldPlan.version).toBe(1);
    expect(legacy.pages[0]!.body).not.toContain('id="source-root"');
    await expect(restoreStaticArchive(source("root-target"), "https://archive.example/", { plan: oldPlan, previewDigest: archivePreviewDigest(oldPreview) }, new Set(), async () => {})).resolves.toBeUndefined();
    const current = await stageStaticArchive(source("root-target"), "https://archive.example/"), plan = staticArchivePlan(current.preview)!;
    expect(plan.version).toBe(2);
    expect(JSON.stringify(current.preview)).toContain('id=\\"source-root\\"');
    expect(archivePreviewDigest(current.preview)).not.toBe(archivePreviewDigest(oldPreview));
    await expect(restoreStaticArchive(source("root-target"), "https://archive.example/", { plan, previewDigest: archivePreviewDigest(current.preview) }, new Set(), async () => {})).resolves.toBeUndefined();
  });
  it("reports unsupported SVG without making allowed pages and raster media impossible to commit", async () => {
    const staged = await stageStaticArchive(source("unsupported-svg"), "https://archive.example/");
    expect(staged.counts).toMatchObject({ pages: 1, media: 1, filesNotImported: 1, mediaWarnings: 1 });
    expect(staticArchivePlan(staged.preview)).toMatchObject({ media: [{ filename: "picture.png" }], report: { ignored: ["logo.svg"], unresolvedImages: ["https://archive.example/logo.svg"] } });
    const legacy = await readStaticArchive(source("unsupported-svg"), "https://archive.example/", async () => {}, { preserveRootTarget: false });
    const plan = archivePlan(legacy), preview = { sourceFormat: "static-archive", pages: legacy.pages, archive: plan };
    expect(plan.media).toHaveLength(2);
    await expect(restoreStaticArchive(source("unsupported-svg"), "https://archive.example/", { plan, previewDigest: archivePreviewDigest(preview) }, new Set(), async () => {})).resolves.toBeUndefined();
  });
});
