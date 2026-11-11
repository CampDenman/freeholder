// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Public-source limits, complete pagination and authority boundaries (C3.22).
import { describe, expect, it, vi } from "vitest";
import { crawlPublicSource } from "@/core/import/crawl";
import { robotsDisallow, DEFAULT_IMPORTER_LIMITS } from "@/core/import/contract";

function response(text: string, status = 200, headers: Record<string, string> = {}) {
  return { status, headers: new Headers({ "content-type": text.startsWith("[") || text.startsWith("{") ? "application/json" : text.startsWith("<rss") ? "application/rss+xml" : text.startsWith("<sitemap") || text.startsWith("<urlset") ? "application/xml" : text.startsWith("<") ? "text/html" : "text/plain", ...headers }), bytes: new TextEncoder().encode(text) };
}
const noWait = async () => {};
const record = (id: number, type = "page") => ({ id, type, link: `https://source.example/${type}/${id}`, slug: `${type}-${id}`, title: { rendered: `Record ${id}` }, content: { rendered: `<p>Body ${id}</p>` } });

describe("bounded public source crawl (C3.22)", () => {
  it("paginates both WordPress collections with embeds and preserves source subdirectories", async () => {
    const download = vi.fn(async (raw: string, options: { headers: Record<string, string> }) => {
      expect(options.headers["User-Agent"]).toBe("Freeholder-Importer/1.0");
      const url = new URL(raw);
      if (url.pathname === "/robots.txt") return response("User-agent: *\nDisallow: /private");
      expect(url.pathname).toMatch(/^\/journal\/wp-json\/wp\/v2\/(pages|posts)$/);
      expect(url.searchParams.get("_embed")).toBe("1");
      const posts = url.pathname.endsWith("/posts");
      const rows = posts ? [record(103, "post")] : url.searchParams.get("page") === "1" ? Array.from({ length: 100 }, (_, index) => record(index + 1)) : [record(101)];
      return response(JSON.stringify(rows), 200, { "x-wp-totalpages": posts ? "1" : "2", "x-wp-total": posts ? "1" : "101" });
    });
    const pause = vi.fn(noWait);
    const result = await crawlPublicSource("wordpress-rest", "https://source.example/journal", { download, pause });
    expect(result.wordpress).toHaveLength(102);
    expect(result.wordpress?.at(-1)).toMatchObject({ type: "post", id: 103 });
    expect(result.report).toMatchObject({ requests: 4, blocked: [] });
    expect(pause.mock.calls).toEqual([[500], [500], [500]]);
    expect(download.mock.calls.every(([, options]) => !Object.keys(options?.headers ?? {}).some(header => /authorization|cookie/i.test(header)))).toBe(true);
  });

  it.each([
    { title: "missing totals", headers: {}, rows: [record(1)] },
    { title: "inconsistent totals", headers: { "x-wp-totalpages": "2", "x-wp-total": "1" }, rows: [record(1)] },
    { title: "short final page", headers: { "x-wp-totalpages": "1", "x-wp-total": "2" }, rows: [record(1)] },
    { title: "short intermediate page", headers: { "x-wp-totalpages": "2", "x-wp-total": "101" }, rows: [record(1)] },
    { title: "repeated record", headers: { "x-wp-totalpages": "1", "x-wp-total": "2" }, rows: [record(1), record(1)] },
  ])("refuses $title instead of claiming complete REST discovery", async ({ headers, rows }) => {
    const download = vi.fn(async (raw: string) => raw.endsWith("/robots.txt") ? response("", 404) : response(JSON.stringify(rows), 200, headers as Record<string, string>));
    await expect(crawlPublicSource("wordpress-rest", "https://source.example", { download, pause: noWait })).rejects.toThrow(/WordPress/);
  });

  it("refuses a changed source and off-origin records without following them", async () => {
    const download = vi.fn(async (raw: string) => raw.endsWith("/robots.txt") ? response("", 404) : response(JSON.stringify([{ ...record(1), link: "https://other.example/stolen" }]), 200, { "x-wp-totalpages": "1", "x-wp-total": "1" }));
    await expect(crawlPublicSource("wordpress-rest", "https://source.example", { download, pause: noWait })).rejects.toThrow(/another origin/);
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("reads sitemap indexes then rendered pages and refuses a cross-origin sitemap entry", async () => {
    const files: Record<string, string> = {
      "/sitemap.xml": "<sitemapindex><sitemap><loc>https://source.example/posts.xml</loc></sitemap></sitemapindex>",
      "/posts.xml": "<urlset><url><loc>https://source.example/a</loc></url><url><loc>https://source.example/hidden</loc></url></urlset>",
      "/a": "<title>Page A</title><main><h1>A</h1><p>Actual body</p></main>",
    };
    const download = vi.fn(async (raw: string) => { const url = new URL(raw); return url.pathname === "/robots.txt" ? response("User-agent: *\nDisallow: /hidden") : response(files[url.pathname]!, files[url.pathname] ? 200 : 404); });
    const result = await crawlPublicSource("sitemap", "https://source.example/sitemap.xml", { download, pause: noWait });
    expect(result.pages).toMatchObject([{ url: "https://source.example/a", title: "Page A" }]);
    expect(result.pages[0]?.body).toContain("Actual body");
    expect(result.report.blocked).toEqual(["https://source.example/hidden"]);
    expect(download.mock.calls.some(([url]) => url.endsWith("/hidden"))).toBe(false);
    await expect(crawlPublicSource("sitemap", "https://source.example/sitemap.xml", { download: async raw => raw.endsWith("robots.txt") ? response("", 404) : response("<urlset><loc>https://other.example/private</loc></urlset>"), pause: noWait })).rejects.toThrow(/another origin/);
  });

  it("crawls relative HTML links once, preserving source URLs and refusing credentialed/private starts", async () => {
    const download = vi.fn(async (raw: string) => {
      const url = new URL(raw);
      if (url.pathname === "/robots.txt") return response("", 404);
      return response(`<title>${url.pathname}</title><main><p>Readable</p><a href=/next#one>Next</a><a href=/next#two>Again</a><a href=https://other.example/no>Off origin</a><a href=javascript:bad()>Bad</a><a href=/photo.jpg>Photo</a></main>`);
    });
    const result = await crawlPublicSource("html", "https://source.example/", { download, pause: noWait });
    expect(result.pages.map(page => page.url)).toEqual(["https://source.example/", "https://source.example/next"]);
    expect(download).toHaveBeenCalledTimes(3);
    await expect(crawlPublicSource("html", "http://127.0.0.1/", { download })).rejects.toThrow(/public/);
    const credentialed = new URL("https://source.example/");
    credentialed.username = "fixture";
    credentialed.password = "deliberately-invalid";
    await expect(crawlPublicSource("html", credentialed.href, { download })).rejects.toThrow(/credentials/);
    expect(download).toHaveBeenCalledTimes(3);
  });


  it("deduplicates repeated site navigation before counting the discovery queue", async () => {
    const shared = Array.from({ length: 19 }, (_, index) => `<a href="/p${index}">Page</a>`).join("");
    const download = vi.fn(async (raw: string) => raw.endsWith("/robots.txt") ? response("", 404) : response(`<title>Page</title><main><p>Content</p>${shared}</main>`));
    const result = await crawlPublicSource("html", "https://source.example/", { download, pause: noWait, limits: { ...DEFAULT_IMPORTER_LIMITS, maxPages: 20 } });
    expect(result.pages).toHaveLength(20);
    expect(download).toHaveBeenCalledTimes(21);
  });

  it("refuses changed WordPress totals between pages", async () => {
    const download = vi.fn(async (raw: string) => {
      if (raw.endsWith("/robots.txt")) return response("", 404);
      const first = new URL(raw).searchParams.get("page") === "1";
      return response(JSON.stringify(first ? Array.from({ length: 100 }, (_, index) => record(index + 1)) : [record(101), record(102)]), 200, { "x-wp-totalpages": "2", "x-wp-total": first ? "101" : "102" });
    });
    await expect(crawlPublicSource("wordpress-rest", "https://source.example", { download, pause: noWait })).rejects.toThrow(/changed during discovery/);
    expect(download).toHaveBeenCalledTimes(3);
  });
  it("fetches feed entries as rendered pages and does not trust the feed excerpt as the complete body", async () => {
    const download = vi.fn(async (raw: string) => raw.endsWith("/robots.txt") ? response("", 404) : raw.endsWith("/feed.xml") ? response("<rss><channel><item><title>Excerpt</title><link>https://source.example/post</link><pubDate>Tue, 02 Apr 2024 09:00:00 GMT</pubDate><description>Truncated</description></item></channel></rss>") : response("<title>Complete post</title><article><p>Full source body</p></article>"));
    const result = await crawlPublicSource("rss", "https://source.example/feed.xml", { download, pause: noWait });
    expect(result.pages[0]).toMatchObject({ title: "Complete post", body: "<p>Full source body</p>", kind: "post", publishedAt: "2024-04-02T09:00:00.000Z" });
  });

  it.each([301, 401, 429, 503])("refuses source HTTP %i without following a redirect or ignoring a robots outage", async status => {
    const download = vi.fn(async () => response("body must not be shown", status));
    await expect(crawlPublicSource("html", "https://source.example/", { download })).rejects.toThrow(`HTTP ${status}`);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("counts actual UTF-8 bytes and rejects compressed bodies, excess pages and sitemap depth", async () => {
    const download = vi.fn(async (raw: string) => raw.endsWith("robots.txt") ? response("", 404) : response("<main>🌲🌲🌲</main>"));
    await expect(crawlPublicSource("html", "https://source.example/", { download, pause: noWait, limits: { ...DEFAULT_IMPORTER_LIMITS, maxBytes: 12 } })).rejects.toThrow(/byte limit/);
    await expect(crawlPublicSource("html", "https://source.example/", { download: async raw => raw.endsWith("robots.txt") ? response("", 404) : response("compressed", 200, { "content-type": "text/html", "content-encoding": "gzip" }), pause: noWait })).rejects.toThrow(/uncompressed/);
    await expect(crawlPublicSource("sitemap", "https://source.example/root", { download: async raw => raw.endsWith("robots.txt") ? response("", 404) : response(`<sitemapindex><loc>${raw}/next</loc></sitemapindex>`), pause: noWait, limits: { ...DEFAULT_IMPORTER_LIMITS, maxDepth: 1 } })).rejects.toThrow(/depth limit/);
  });
});


describe("crawler robots policy (C3.22)", () => {
  it("combines matching product groups, preferring them over wildcard groups", () => {
    const policy = "User-agent: *\nDisallow: /\nUser-agent: OtherBot\nUser-agent: FREEHOLDER-IMPORTER\nDisallow: /private\nUser-agent: Freeholder-Importer\nDisallow: /secret\n";
    expect(robotsDisallow(policy, "/public")).toBe(false);
    expect(robotsDisallow(policy, "/private/one")).toBe(true);
    expect(robotsDisallow(policy, "/secret")).toBe(true);
  });
  it("uses longest allow/disallow matches, comments, wildcards and exact-end rules", () => {
    const policy = "User-agent: *\nDisallow: /private # comment\nAllow: /private/public\nDisallow: /*?secret=*$\nDisallow: /exact$\nAllow: /tie\nDisallow: /tie\n";
    expect(robotsDisallow(policy, "/private/x")).toBe(true);
    expect(robotsDisallow(policy, "/private/public/x")).toBe(false);
    expect(robotsDisallow(policy, "/page?secret=value")).toBe(true);
    expect(robotsDisallow(policy, "/exact")).toBe(true);
    expect(robotsDisallow(policy, "/exactly")).toBe(false);
    expect(robotsDisallow(policy, "/tie")).toBe(false);
  });
  it("compares UTF-8/encoded unreserved characters while preserving encoded reserved octets", () => {
    expect(robotsDisallow("User-agent: *\nDisallow: /café", "/caf%C3%A9/page")).toBe(true);
    expect(robotsDisallow("User-agent: *\nDisallow: /%7Eprivate", "/~private")).toBe(true);
    expect(robotsDisallow("User-agent: *\nDisallow: /a%2Fb", "/a/b")).toBe(false);
    expect(robotsDisallow("User-agent: *\nDisallow: /a%2Fb", "/a%2fb")).toBe(true);
  });
});

// A successful status alone must not convert downloads or soft errors into pages.
describe("source response format boundaries (C3.22)", () => {
  it.each(["application/pdf", "application/octet-stream", "image/png", ""])('refuses HTTP200 %s on an HTML target', async contentType => {
    const download = vi.fn(async (raw: string) => raw.endsWith("/robots.txt") ? response("", 404) : response("%PDF-1.7 binary download", 200, { "content-type": contentType }));
    await expect(crawlPublicSource("html", "https://source.example/download", { download, pause: noWait })).rejects.toThrow(/content type/);
    expect(download).toHaveBeenCalledTimes(2);
  });
  it("does not treat a robots soft-error HTML page as unrestricted access", async () => {
    const download = vi.fn(async () => response("<title>Error</title>", 200, { "content-type": "text/html" }));
    await expect(crawlPublicSource("html", "https://source.example/", { download })).rejects.toThrow(/content type/);
    expect(download).toHaveBeenCalledTimes(1);
  });
  it("never resolves external XML entities or treats them as source URLs", async () => {
    const download = vi.fn(async (raw: string) => raw.endsWith("/robots.txt") ? response("", 404) : response('<!DOCTYPE urlset [<!ENTITY xxe SYSTEM "http://169.254.169.254/latest">]><urlset><url><loc>&xxe;</loc></url></urlset>', 200, { "content-type": "application/xml" }));
    await expect(crawlPublicSource("sitemap", "https://source.example/map.xml", { download, pause: noWait })).rejects.toThrow(/URL/);
    expect(download).toHaveBeenCalledTimes(2);
  });
});
