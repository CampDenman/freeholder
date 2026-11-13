// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: original HTTP record ranges and physical budgets are independent.
import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { crawlGraphMetadataSchema, indexCrawlOriginalResponse } from "@/core/import/crawl-index";
import { crawlRestCollectionUrl, type CrawlOriginalFacts } from "@/core/import/crawl-original";

const site = "https://fictional-http-index.example/instance/";
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function original(body: string, role: "html" | "rest-pages" | "rest-posts" = "html", records = 0) {
  const bytes = new TextEncoder().encode(body), url = role === "html" ? `${site}article` : crawlRestCollectionUrl(site, role === "rest-pages" ? "pages" : "posts", 1);
  const facts: CrawlOriginalFacts = { version: 1, method: "GET", requestedUrl: url, role, status: 200, contentType: role === "html" ? "text/html" : "application/json", contentEncoding: "identity", bytes: bytes.byteLength, digest: hash(bytes), ...(role === "html" ? {} : { totalRecords: records, totalPages: Math.ceil(records / 100) }) };
  return { bytes, input: { siteUrl: site, source: { runId: randomUUID(), sourceId: randomUUID(), generation: randomUUID(), responseId: randomUUID(), digest: facts.digest, bytes: facts.bytes }, request: { id: randomUUID(), ordinal: 1, role, restPage: role === "html" ? null : 1, entryMetadata: null as unknown }, facts, ordinal: 0 } };
}

describe("actual HTTP response-local graph index (C3.47)", () => {
  it("keeps actual HTML metadata and media references without inventing WordPress identities or shadow bodies", async () => {
    const fixture = original('<title>Actual source title</title><meta name="description" content="Actual source description"><main><p>PRIVATE_ORIGINAL_HTTP_TEXT</p><img src="photo.png" alt="Actual source alt"></main>');
    const result = await indexCrawlOriginalResponse(fixture.input, fixture.bytes), entry = result.entries[0]!;
    expect(entry).toMatchObject({ ordinal: 0, kind: "page", start: 0, end: fixture.bytes.byteLength, digest: hash(fixture.bytes), metadata: { format: "http-originals", title: "Actual source title", sourcePath: "instance/article", original: { responseId: fixture.input.source.responseId, requestId: fixture.input.request.id } } });
    expect(entry.metadata.mediaRefs).toMatchObject([{ sourceUrl: `${site}photo.png`, altText: "Actual source alt" }]);
    expect(entry.metadata.wpId).toBeUndefined(); expect(JSON.stringify(result)).not.toMatch(/PRIVATE_ORIGINAL_HTTP_TEXT|uploadId/);
    expect(result.physicalBytes).toBe(fixture.bytes.byteLength);
  });
  it("retains an actual empty response without fabricating a positive byte range", async () => {
    const fixture = original("");
    expect(await indexCrawlOriginalResponse(fixture.input, fixture.bytes)).toEqual({ entries: [], physicalBytes: 0, bodyBytes: 0, metadataBytes: 0 });
  });
  it("inherits only the actual feed metadata bound to this rendered original URL", async () => {
    const fixture = original("<title>Rendered title</title><main>Actual rendered content</main>");
    fixture.input.request.entryMetadata = { url: fixture.input.facts.requestedUrl, title: "Actual feed title", publishedAt: "2050-01-02T09:00:00.000Z", status: "draft", kind: "post" };
    expect((await indexCrawlOriginalResponse(fixture.input, fixture.bytes)).entries[0]).toMatchObject({ kind: "post", metadata: { title: "Actual feed title", status: "draft", publishedAt: "2050-01-02T09:00:00.000Z" } });
    fixture.input.request.entryMetadata = { url: `${site}another`, title: "Other original" };
    await expect(indexCrawlOriginalResponse(fixture.input, fixture.bytes)).rejects.toThrow(/another rendered/);
  });
  it("preserves actual REST record UTF8 offsets and byte digests inside the original response", async () => {
    const records = [{ id: 81, type: "page", link: `${site}first`, title: { rendered: "Actual first" }, content: { rendered: "<p>Actual emoji 🌿</p>" } }, { id: 82, type: "page", link: `${site}second`, title: { rendered: "Actual second" }, content: { rendered: "<p>Actual second body</p>" } }];
    const fixture = original(JSON.stringify(records), "rest-pages", 2), result = await indexCrawlOriginalResponse(fixture.input, fixture.bytes);
    expect(result.entries.map(entry => entry.metadata.wpId)).toEqual(["81", "82"]); expect(result.entries.map(entry => entry.kind)).toEqual(["page", "page"]);
    for (let index = 0; index < result.entries.length; index++) {
      const entry = result.entries[index]!, bytes = fixture.bytes.slice(entry.start, entry.end);
      expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual(records[index]); expect(hash(bytes)).toBe(entry.digest);
      expect(entry.metadata.original).toMatchObject({ responseId: fixture.input.source.responseId, digest: fixture.input.facts.digest, bytes: fixture.bytes.byteLength, start: entry.start, end: entry.end });
    }
    expect(JSON.stringify(result.entries.map(entry => entry.metadata))).not.toContain("Actual second body");
  });
  it("charges the full physical response even when record bodies are tiny", async () => {
    const fixture = original(JSON.stringify([{ id: 83, type: "page", link: `${site}padded`, title: { rendered: "Actual padded record" }, content: { rendered: "Small" }, originalExtra: "PRIVATE_EXTRA".repeat(50_000) }]), "rest-pages", 1);
    const result = await indexCrawlOriginalResponse(fixture.input, fixture.bytes);
    expect(result.physicalBytes).toBe(fixture.bytes.byteLength); expect(result.physicalBytes).toBeGreaterThan(500_000); expect(result.bodyBytes).toBe(5);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_EXTRA");
  });
  it("refuses changed body bytes, another WordPress instance and a source-wide ordinal overflow", async () => {
    const fixture = original("<title>Actual</title><main>Actual</main>"), changed = fixture.bytes.slice(); changed[0] = 32;
    await expect(indexCrawlOriginalResponse(fixture.input, changed)).rejects.toThrow(/source|bytes|cursor/);
    const rest = original(JSON.stringify([{ id: 84, type: "page", link: `${site}one` }, { id: 85, type: "page", link: `${site}two` }]), "rest-pages", 2);
    await expect(indexCrawlOriginalResponse({ ...rest.input, siteUrl: "https://fictional-http-index.example/another/" }, rest.bytes)).rejects.toThrow(/another WordPress/);
    await expect(indexCrawlOriginalResponse({ ...rest.input, ordinal: 9999 }, rest.bytes)).rejects.toThrow(/budget/);
  });
  it("makes response-local range and HTML non-WordPress identity contradictions explicit", async () => {
    const fixture = original("<main>Actual</main>"), entry = (await indexCrawlOriginalResponse(fixture.input, fixture.bytes)).entries[0]!;
    expect(crawlGraphMetadataSchema.safeParse({ ...entry.metadata, wpId: "invented" }).success).toBe(false);
    expect(crawlGraphMetadataSchema.safeParse({ ...entry.metadata, original: { ...entry.metadata.original, end: fixture.bytes.byteLength + 1 } }).success).toBe(false);
  });
});
