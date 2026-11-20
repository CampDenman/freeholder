// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: bounded discovery uses actual response bytes, not shadow page exports.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { discoverCrawlPhase, type DiscoverySource } from "@/core/import/crawl-discovery";
import { parseSitemap } from "@/core/import/parsers";
import { parseGenericFeed } from "@/core/import/generic-feed";
import { crawlRestCollectionUrl, type CrawlRequestRole } from "@/core/import/crawl-original";

const site = "https://fictional-frontier.example/site-a/";
const original = (role: CrawlRequestRole, value: string, url: string, extra: Record<string, number> = {}) => {
  const bytes = new TextEncoder().encode(value);
  return { bytes, facts: { version: 1, method: "GET", requestedUrl: url, role, status: 200, contentType: role.startsWith("rest-") ? "application/json" : role === "robots" ? "text/plain" : role === "sitemap" ? "application/xml" : role === "rss" ? "application/rss+xml" : "text/html", contentEncoding: "identity", bytes: bytes.byteLength, digest: createHash("sha256").update(bytes).digest("hex"), ...extra } };
};
const html: DiscoverySource = { kind: "html", siteUrl: site, sourceUrl: `${site}start` };

describe("actual HTTP original frontier discovery (C3.47)", () => {
  it("continues real501-link HTML in500+1 target facts without returning any source body", () => {
    const response = original("html", `<main>Private original body marker.${Array.from({ length: 501 }, (_, index) => `<a href="/archive/${index}">Real link</a>`).join("")}</main>`, html.sourceUrl);
    const request = { role: "html" as const, depth: 0, restPage: null };
    const first = discoverCrawlPhase(html, request, response.facts, response.bytes);
    expect(first).toMatchObject({ previous: 0, next: 500, done: false, pageRecords: 1 }); expect(first.targets).toHaveLength(500);
    const second = discoverCrawlPhase(html, request, response.facts, response.bytes, first.next);
    expect(second).toMatchObject({ previous: 500, next: 501, done: true, pageRecords: 0 }); expect(second.targets).toHaveLength(1);
    expect(new Set([...first.targets, ...second.targets].map(target => target.url)).size).toBe(501);
    expect(JSON.stringify([first, second])).not.toContain("Private original body marker");
  });

  it("keeps an actual robots404 body as bytes without treating its error text as discovery content", () => {
    const response = original("robots", "", "https://fictional-frontier.example/robots.txt"), bytes = new Uint8Array([255]);
    const facts = { ...response.facts, status: 404, bytes: bytes.byteLength, digest: createHash("sha256").update(bytes).digest("hex") };
    expect(discoverCrawlPhase(html, { role: "robots", depth: 0, restPage: null }, facts, bytes).targets).toMatchObject([{ url: html.sourceUrl, role: "html" }]);
  });

  it("keeps original selected WordPress instance endpoints and both actual collections", () => {
    const response = original("robots", "User-agent: *", "https://fictional-frontier.example/robots.txt");
    const plan = discoverCrawlPhase({ kind: "wordpress-rest", siteUrl: site, sourceUrl: site }, { role: "robots", depth: 0, restPage: null }, response.facts, response.bytes);
    expect(plan.targets.map(target => new URL(target.url).pathname)).toEqual(["/site-a/wp-json/wp/v2/pages", "/site-a/wp-json/wp/v2/posts"]);
    expect(plan.targets.map(target => target.role)).toEqual(["rest-pages", "rest-posts"]);
  });

  it("checks actual REST records and only schedules its next declared source page", () => {
    const records = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, type: "post", link: `${site}post-${index}` }));
    const response = original("rest-posts", JSON.stringify(records), crawlRestCollectionUrl(site, "posts", 1), { totalRecords: 101, totalPages: 2 });
    const plan = discoverCrawlPhase({ kind: "wordpress-rest", siteUrl: site, sourceUrl: site }, { role: "rest-posts", depth: 1, restPage: 1 }, response.facts, response.bytes);
    expect(plan.pageRecords).toBe(100); expect(plan.targets).toHaveLength(1); expect(plan.targets[0]).toMatchObject({ role: "rest-posts", restPage: 2 });
    expect(plan.targets[0]!.url).toBe(crawlRestCollectionUrl(site, "posts", 2));
  });

  it("refuses record count contradictions, repeated source IDs and malformed JSON without source excerpts", () => {
    const source: DiscoverySource = { kind: "wordpress-rest", siteUrl: site, sourceUrl: site }, request = { role: "rest-pages" as const, depth: 1, restPage: 1 };
    for (const value of [JSON.stringify([{ id: 1, type: "page", link: `${site}one` }]), JSON.stringify([{ id: 1, type: "page", link: `${site}one` }, { id: 1, type: "page", link: `${site}two` }]), "[PRIVATE_ORIGINAL_DIAGNOSTIC]"]) {
      const response = original("rest-pages", value, crawlRestCollectionUrl(site, "pages", 1), { totalRecords: 2, totalPages: 1 });
      let failure: unknown; try { discoverCrawlPhase(source, request, response.facts, response.bytes); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(Error); expect(String(failure)).not.toContain("PRIVATE_ORIGINAL_DIAGNOSTIC");
    }
  });

  it("uses feed metadata only as a link to the actual rendered original, without its excerpt", () => {
    const response = original("rss", `<rss><channel><item><title>Original feed entry</title><link>${site}article</link><description>PRIVATE_FEED_EXCERPT</description></item></channel></rss>`, `${site}feed`);
    const plan = discoverCrawlPhase({ kind: "rss", siteUrl: site, sourceUrl: `${site}feed` }, { role: "rss", depth: 0, restPage: null }, response.facts, response.bytes);
    expect(plan.targets).toMatchObject([{ url: `${site}article`, role: "html", entryMetadata: { title: "Original feed entry", kind: "post" } }]);
    expect(JSON.stringify(plan)).not.toContain("PRIVATE_FEED_EXCERPT"); expect(plan.pageRecords).toBe(0);
  });

  it("deduplicates actual anchors, ignores other origins/assets and preserves the depth fence", () => {
    const response = original("html", '<a href="/next#one">One</a><a href="/next#two">Two</a><a href="https://other.example/no">Other</a><a href="/image.png">Asset</a>', html.sourceUrl);
    expect(discoverCrawlPhase(html, { role: "html", depth: 0, restPage: null }, response.facts, response.bytes).targets).toMatchObject([{ url: "https://fictional-frontier.example/next", depth: 1 }]);
    expect(discoverCrawlPhase(html, { role: "html", depth: 4, restPage: null }, response.facts, response.bytes).targets).toHaveLength(0);
  });

  it("continues501real sitemap URLs while preserving the ordinary synchronous limit", () => {
    const xml = `<urlset>${Array.from({ length: 501 }, (_, index) => `<url><loc>${site}original-${index}</loc></url>`).join("")}</urlset>`;
    expect(() => parseSitemap(xml)).toThrow(/500/);
    const response = original("sitemap", xml, `${site}sitemap.xml`), source: DiscoverySource = { kind: "sitemap", siteUrl: site, sourceUrl: `${site}sitemap.xml` }, request = { role: "sitemap" as const, depth: 0, restPage: null };
    const first = discoverCrawlPhase(source, request, response.facts, response.bytes);
    const second = discoverCrawlPhase(source, request, response.facts, response.bytes, first.next);
    expect(first.targets).toHaveLength(500); expect(second.targets).toHaveLength(1); expect(second.done).toBe(true);
  });

  it("continues501real feed permalinks without parsing their excerpts as page bodies", () => {
    const xml = `<rss><channel>${Array.from({ length: 501 }, (_, index) => `<item><title>Original${index}</title><link>${site}original-${index}</link><description>PRIVATE_FEED_EXCERPT</description></item>`).join("")}</channel></rss>`;
    expect(() => parseGenericFeed(xml, `${site}feed`)).toThrow(/500/);
    const response = original("rss", xml, `${site}feed`), source: DiscoverySource = { kind: "rss", siteUrl: site, sourceUrl: `${site}feed` }, request = { role: "rss" as const, depth: 0, restPage: null };
    const first = discoverCrawlPhase(source, request, response.facts, response.bytes);
    const second = discoverCrawlPhase(source, request, response.facts, response.bytes, first.next);
    expect(first.targets).toHaveLength(500); expect(second.targets).toHaveLength(1); expect(second.done).toBe(true);
    expect(JSON.stringify([first, second])).not.toContain("PRIVATE_FEED_EXCERPT");
  });

  it("refuses a changed original body, wrong same-host instance and out-of-range source cursor", () => {
    const response = original("html", '<a href="/real">Original</a>', html.sourceUrl), changed = response.bytes.slice(); changed[0] = 32;
    expect(() => discoverCrawlPhase(html, { role: "html", depth: 0, restPage: null }, response.facts, changed)).toThrow(/changed/);
    expect(() => discoverCrawlPhase(html, { role: "html", depth: 0, restPage: null }, response.facts, response.bytes, 2)).toThrow(/cursor/);
    const wrong = original("rest-pages", "[]", crawlRestCollectionUrl("https://fictional-frontier.example/site-b/", "pages", 1), { totalRecords: 0, totalPages: 0 });
    expect(() => discoverCrawlPhase({ kind: "wordpress-rest", siteUrl: site, sourceUrl: site }, { role: "rest-pages", depth: 1, restPage: 1 }, wrong.facts, wrong.bytes)).toThrow(/another instance/);
  });
});
