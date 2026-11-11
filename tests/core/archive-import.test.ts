// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.22: real ZIP fixtures, bounded random access and no filesystem extraction.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readStaticArchive, type ArchiveSource } from "@/core/import/archive";

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
  it.each(["traversal", "backslash", "absolute", "duplicates", "symlink", "foreign-base", "damaged-checksum", "oversized", "unsupported-compression", "encrypted", "truncated"])("refuses hostile or damaged %s ZIPs before retaining any asset", async (name) => {
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
});
