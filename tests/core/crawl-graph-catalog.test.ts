// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: the complete file plan uses actual source metadata and saved policy.
import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildCrawlGraphCatalog } from "@/core/import/crawl-graph-catalog";
import { indexCrawlOriginalResponse } from "@/core/import/crawl-index";
import type { CrawlOriginalFacts } from "@/core/import/crawl-original";

const site = "https://fictional-http-catalog.example/";
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const header = { format: "http-originals" as const, sourceId: randomUUID(), generation: randomUUID(), sourceRevision: sha("actual sealed source revision"), siteUrl: site, sourceUrl: `${site}article`, kind: "html" as const, robotsResponseId: randomUUID(), requests: 2, capturedBytes: 1000 };
async function metadata(html: string, path = "article") {
  const body = new TextEncoder().encode(html), url = `${site}${path}`;
  const facts: CrawlOriginalFacts = { version: 1, method: "GET", requestedUrl: url, role: "html", status: 200, contentType: "text/html", contentEncoding: "identity", bytes: body.byteLength, digest: sha(body) };
  const result = await indexCrawlOriginalResponse({ siteUrl: site, source: { runId: randomUUID(), sourceId: header.sourceId, generation: header.generation, responseId: randomUUID(), bytes: facts.bytes, digest: facts.digest }, request: { id: randomUUID(), ordinal: 1, role: "html", restPage: null, entryMetadata: null }, facts, ordinal: 0 }, body);
  return result.entries[0]!.metadata;
}

describe("complete actual HTTP file review (C3.47)", () => {
  it("deduplicates shared source files globally and applies the captured robots policy before any fetch", async () => {
    const first = await metadata('<main><img src="shared.png" alt="Actual source alt"><img src="blocked.png"></main>');
    const second = await metadata('<main><img src="shared.png"></main>', "second");
    const result = buildCrawlGraphCatalog(header, [first, second], "User-agent: *\nDisallow: /blocked.png");
    expect(result.media).toMatchObject([{ key: `${site}shared.png`, sourceUrl: `${site}shared.png`, altText: "Actual source alt" }]);
    expect(result.media).toHaveLength(1);
    expect(result.catalog.report).toMatchObject({ indexed: 2, unresolvedMedia: [`${site}blocked.png`] });
  });
  it("does not infer external-origin approval or accept contradictory shared file mappings", async () => {
    const entry = await metadata('<main><img src="shared.png"></main>');
    const external = { ...entry, mediaRefs: [{ ...entry.mediaRefs![0]!, sourceUrl: "https://fictional-unapproved-files.example/image.png" }] };
    expect(buildCrawlGraphCatalog(header, [external], "").media).toEqual([]);
    expect(() => buildCrawlGraphCatalog(header, [entry, { ...entry, mediaRefs: [{ ...entry.mediaRefs![0]!, sourceUrl: `${site}different.png` }] }], "")).toThrow(/different original URLs/);
    expect(() => buildCrawlGraphCatalog(header, [{ ...entry, original: { ...entry.original, generation: randomUUID() } }], "")).toThrow(/generation/);
  });
  it("enforces the complete-source file cap across individually bounded pages", async () => {
    const first: Awaited<ReturnType<typeof metadata>>[] = [];
    for (let page = 0; page < 20; page++) first.push(await metadata(`<main>${Array.from({ length: 25 }, (_, i) => `<img src="image-${page * 25 + i}.png">`).join("")}</main>`, `page-${page}`));
    const later = await metadata('<main><img src="image-500.png"></main>', "later");
    const complete = { ...header, requests: 22, capturedBytes: 100_000 };
    expect(buildCrawlGraphCatalog(complete, first, "").media).toHaveLength(500);
    expect(() => buildCrawlGraphCatalog(complete, [...first, later], "")).toThrow(/file budget/);
  });
});
