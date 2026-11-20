// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: real-response facts stay distinct from uploaded source manifests.
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { crawlRestCollectionUrl, readCrawlOriginalResponse } from "@/core/import/crawl-original";

const site = "https://fictional-crawl.example/site-a/";
const budget = () => ({ remainingBytes: 1024 * 1024, deadline: Date.now() + 30_000 });
const response = (body: string, status = 200, headers: Record<string, string> = {}) => ({ status, bytes: new TextEncoder().encode(body), headers: new Headers({ "content-type": "text/html", ...headers }) });

describe("one actual public crawl response (C3.47)", () => {
  it("binds actual original URL, HTTP facts, UTF-8 bytes and digest without copying private headers into metadata", async () => {
    const original = response("<main>Actual 🌲 source</main>", 200, { "set-cookie": "fictional-cookie=private", "authorization": "fictional-private-value", "x-source-body": "Original private header" });
    const download = vi.fn(async (_url: string, _options: { maxBytes: number; timeoutMs: number; headers: Record<string, string> }) => original);
    const result = await readCrawlOriginalResponse({ site, url: `${site}article`, role: "html" }, budget(), { download });
    expect(result.body).toBe(original.bytes);
    expect(result.facts).toEqual({ version: 1, method: "GET", requestedUrl: `${site}article`, role: "html", status: 200, contentType: "text/html", contentEncoding: "identity", bytes: original.bytes.byteLength, digest: createHash("sha256").update(original.bytes).digest("hex") });
    expect(JSON.stringify(result.facts)).not.toMatch(/Actual|cookie|private-value|x-source-body/);
    expect(download).toHaveBeenCalledTimes(1);
    const [requested, options] = download.mock.calls[0]!;
    expect(requested).toBe(`${site}article`);
    expect(options.maxBytes).toBe(1024 * 1024);
    expect(options.timeoutMs).toBeGreaterThan(0); expect(options.timeoutMs).toBeLessThanOrEqual(30_000);
    expect(options.headers).toEqual({ "User-Agent": "Freeholder-Importer/1.0", "Accept-Encoding": "identity" });
  });

  it("retains an actual missing robots response without manufacturing a policy body", async () => {
    const original = response("", 404, { "content-type": "" });
    const result = await readCrawlOriginalResponse({ site, url: "https://fictional-crawl.example/robots.txt", role: "robots" }, budget(), { download: async () => original });
    expect(result.facts).toMatchObject({ role: "robots", status: 404, bytes: 0, digest: createHash("sha256").update(original.bytes).digest("hex") });
    expect(result.body).toHaveLength(0);
  });

  it.each([301, 401, 404, 429, 503])("refuses page HTTP%i after exactly one response without including its body", async status => {
    const download = vi.fn(async () => response("Fictional private response body", status));
    const error = await readCrawlOriginalResponse({ site, url: `${site}article`, role: "html" }, budget(), { download }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error); expect(String(error)).toContain(`HTTP ${status}`); expect(String(error)).not.toContain("private response body");
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("keeps an actual WordPress page and totals on its selected instance", async () => {
    const url = crawlRestCollectionUrl(site, "posts", 2), download = vi.fn(async () => response("[]", 200, { "content-type": "application/json", "x-wp-total": "101", "x-wp-totalpages": "2" }));
    expect(new URL(url).pathname).toBe("/site-a/wp-json/wp/v2/posts");
    expect(new URL(url).searchParams.get("page")).toBe("2");
    expect((await readCrawlOriginalResponse({ site, url, role: "rest-posts", page: 2 }, budget(), { download })).facts).toMatchObject({ totalRecords: 101, totalPages: 2, requestedUrl: url });
    // Record counts and original record identities are checked by the bounded
    // indexing/apply phase, not inferred from these HTTP header facts.
  });

  it("refuses another same-host WordPress instance before any provider read", async () => {
    const download = vi.fn(async () => response("[]"));
    await expect(readCrawlOriginalResponse({ site, url: crawlRestCollectionUrl("https://fictional-crawl.example/site-b/", "pages", 1), role: "rest-pages", page: 1 }, budget(), { download })).rejects.toThrow(/selected WordPress instance/);
    expect(download).not.toHaveBeenCalled();
  });

  it.each(["https://other.example/a", "http://127.0.0.1/a", "https://fictional-crawl.example/a#fragment", "https://fictional-crawl.example/a#"])('refuses unapproved original URL %s before any provider read', async url => {
    const download = vi.fn(async () => response("body"));
    await expect(readCrawlOriginalResponse({ site, url, role: "html" }, budget(), { download })).rejects.toThrow();
    expect(download).not.toHaveBeenCalled();
  });

  it("refuses compressed, binary and invalid UTF-8 source bodies without exposing their content", async () => {
    for (const original of [response("Fictional source secret", 200, { "content-encoding": "gzip" }), response("Fictional source secret", 200, { "content-type": "application/pdf" }), { ...response("Fictional source secret"), bytes: new Uint8Array([0xff, 0xfe]) }]) {
      const error = await readCrawlOriginalResponse({ site, url: `${site}article`, role: "html" }, budget(), { download: async () => original }).catch((value: unknown) => value);
      expect(error).toBeInstanceOf(Error); expect(String(error)).not.toContain("Fictional source secret");
    }
  });

  it("checks the same deadline after a response and refuses bytes beyond the remaining complete-source budget", async () => {
    let now = 10;
    const download = vi.fn(async () => { now = 31; return response("actual body"); });
    await expect(readCrawlOriginalResponse({ site, url: `${site}article`, role: "html" }, { remainingBytes: 100, deadline: 30 }, { download, now: () => now })).rejects.toThrow(/original deadline/);
    await expect(readCrawlOriginalResponse({ site, url: `${site}article`, role: "html" }, { ...budget(), remainingBytes: 3 }, { download: async () => response("actual body") })).rejects.toThrow(/remaining byte budget/);
  });

  it.each([{ "x-wp-total": "101", "x-wp-totalpages": "1" }, { "x-wp-total": "10001", "x-wp-totalpages": "101" }, { "x-wp-total": "secret-original-header", "x-wp-totalpages": "1" }])("refuses incomplete or excessive REST header facts", async headers => {
    await expect(readCrawlOriginalResponse({ site, url: crawlRestCollectionUrl(site, "pages", 1), role: "rest-pages" }, budget(), { download: async () => response("[]", 200, { "content-type": "application/json", ...headers }) })).rejects.toThrow();
  });
});
