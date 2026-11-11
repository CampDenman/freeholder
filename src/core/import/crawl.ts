// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Read-only, bounded public-source discovery; callers stage the result later (C3.22).
import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { requestPinnedBytes } from "@/core/http/pinned-download";
import { assertPublicHttpUrl, DEFAULT_IMPORTER_LIMITS, enforceImporterLimits, robotsDisallow, type ImporterLimits } from "./contract";
import { parseSitemap, type ParsedPage } from "./parsers";
import { parseGenericHtml, type GenericPage } from "./generic-plan";
import { parseGenericFeed } from "./generic-feed";

export type CrawlKind = "wordpress-rest" | "sitemap" | "rss" | "atom" | "html";
export type CrawlResult = {
  kind: CrawlKind;
  sourceUrl: string;
  wordpress?: unknown[];
  pages: ParsedPage[];
  robotsTxt: string;
  report: { requests: number; bytes: number; blocked: string[] };
};

type Download = Pick<Awaited<ReturnType<typeof requestPinnedBytes>>, "status" | "bytes" | "headers">;
type CrawlDependencies = {
  download?: (url: string, options: { maxBytes: number; timeoutMs: number; headers: Record<string, string> }) => Promise<Download>;
  pause?: (milliseconds: number) => Promise<void>;
  limits?: ImporterLimits;
};

function links(html: string, base: string): string[] {
  const pending: DefaultTreeAdapterTypes.Node[] = [parse(html)];
  const found = new Set<string>();
  while (pending.length) {
    const node = pending.pop()!;
    if ("tagName" in node && node.tagName === "a") {
      const href = node.attrs.find(attribute => attribute.name === "href")?.value;
      if (href) try { const url = new URL(href, base); url.hash = ""; found.add(url.href); } catch { /* Invalid source markup is not a fetch target. */ }
    }
    if ("childNodes" in node) pending.push(...node.childNodes);
  }
  return [...found];
}

function sameOrigin(raw: string, origin: string): URL {
  const target = assertPublicHttpUrl(raw);
  if (target.origin !== origin) throw new Error("An import source cannot fetch another origin.");
  target.hash = "";
  return target;
}

/** No credentials, redirects, cookies or arbitrary headers cross this boundary. */
export async function crawlPublicSource(kind: CrawlKind, raw: string, dependencies: CrawlDependencies = {}): Promise<CrawlResult> {
  const start = assertPublicHttpUrl(raw);
  start.hash = "";
  const limits = dependencies.limits ?? DEFAULT_IMPORTER_LIMITS;
  const download = dependencies.download ?? requestPinnedBytes;
  const pause = dependencies.pause ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const report: CrawlResult["report"] = { requests: 0, bytes: 0, blocked: [] };
  const result: CrawlResult = { kind, sourceUrl: start.href, pages: [], robotsTxt: "", report };
  let robots = "";
  const deadline = Date.now() + 10 * 60_000;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const read = async (target: URL, options: { robots?: boolean; allowNotFound?: boolean; format?: "json" | "xml" | "feed" | "html" } = {}) => {
    if (!options.robots && robotsDisallow(robots, `${target.pathname}${target.search}`)) {
      report.blocked.push(target.href);
      return null;
    }
    // Source metadata, sitemap indexes and empty REST pages count too.
    if (report.requests >= limits.maxPages * 2 + 10) throw new Error("This import exceeded its request limit.");
    const remaining = limits.maxBytes - report.bytes;
    if (remaining <= 0) throw new Error(`This import exceeded the byte limit of ${limits.maxBytes}.`);
    if (report.requests > 0) await pause(Math.ceil(1000 / limits.requestsPerSecond));
    report.requests += 1;
    const timeRemaining = deadline - Date.now();
    if (timeRemaining <= 0) throw new Error("Source discovery timed out. Retry a smaller source or use its export file.");
    const response = await download(target.href, { maxBytes: options.robots ? Math.min(remaining, 512 * 1024) : remaining, timeoutMs: Math.min(30_000, timeRemaining), headers: { "User-Agent": "Freeholder-Importer/1.0", "Accept-Encoding": "identity" } });
    report.bytes += response.bytes.byteLength;
    enforceImporterLimits({ pages: result.pages.length, bytes: report.bytes, depth: 0 }, limits);
    if (response.status === 404 && options.allowNotFound) return null;
    if (response.status !== 200) throw new Error(`The source answered HTTP ${response.status}; use its final public URL.`);
    const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
    const accepted = options.robots ? ["text/plain"] : options.format === "json" ? ["application/json", "application/ld+json"] : options.format === "xml" ? ["application/xml", "text/xml"] : options.format === "feed" ? ["application/xml", "text/xml", "application/rss+xml", "application/atom+xml"] : ["text/html", "application/xhtml+xml"];
    if (!accepted.includes(contentType)) throw new Error("The source returned an unexpected content type. Use its HTML, JSON, XML or feed URL.");
    const encoding = response.headers.get("content-encoding");
    if (encoding && encoding.toLowerCase() !== "identity") throw new Error("The source ignored the uncompressed download requirement.");
    return { ...response, text: decoder.decode(response.bytes) };
  };
  const robotsResult = await read(new URL("/robots.txt", start), { robots: true, allowNotFound: true });
  robots = robotsResult?.text ?? "";
  result.robotsTxt = robots;
  if (kind === "wordpress-rest") {
    const rows: unknown[] = [];
    let totalRecords = 0;
    const root = start.pathname.includes("/wp-json/") ? start.pathname.slice(0, start.pathname.indexOf("/wp-json/") + 1) : start.pathname.replace(/\/?$/, "/");
    for (const type of ["pages", "posts"] as const) {
      let expectedPages: number | undefined;
      let total: number | undefined;
      for (let page = 1; ; page += 1) {
        const target = new URL(`${root}wp-json/wp/v2/${type}`, start);
        target.search = new URLSearchParams({ per_page: "100", page: String(page), _embed: "1", orderby: "id", order: "asc" }).toString();
        const response = await read(target, { format: "json" });
        if (!response) throw new Error("The source robots policy blocks its WordPress API.");
        const parsed: unknown = JSON.parse(response.text);
        if (!Array.isArray(parsed) || parsed.length > 100) throw new Error("WordPress REST returned an invalid page.");
        const pagesHeader = response.headers.get("x-wp-totalpages"), totalHeader = response.headers.get("x-wp-total");
        if (!pagesHeader || !/^\d+$/.test(pagesHeader) || !totalHeader || !/^\d+$/.test(totalHeader)) throw new Error("WordPress REST must report its total pages and records for a complete crawl.");
        const currentPages = Number(pagesHeader), currentTotal = Number(totalHeader);
        if (!Number.isSafeInteger(currentPages) || !Number.isSafeInteger(currentTotal) || currentPages !== Math.ceil(currentTotal / 100)) throw new Error("WordPress REST totals are inconsistent.");
        if (expectedPages !== undefined && (currentPages !== expectedPages || currentTotal !== total)) throw new Error("The WordPress source changed during discovery. Retry the crawl.");
        expectedPages = currentPages; total = currentTotal;
        if (parsed.length !== Math.min(100, Math.max(0, currentTotal - (page - 1) * 100))) throw new Error("WordPress REST omitted records from a declared page.");
        enforceImporterLimits({ pages: totalRecords + currentTotal, bytes: report.bytes, depth: 1 }, limits);
        for (const row of parsed) {
          if (!row || typeof row !== "object" || typeof (row as { link?: unknown }).link !== "string") throw new Error("A WordPress record has no public source URL.");
          const link = sameOrigin((row as { link: string }).link, start.origin);
          if (robotsDisallow(robots, `${link.pathname}${link.search}`)) { report.blocked.push(link.href); continue; }
          rows.push({ ...row, type: type === "posts" ? "post" : "page" });
        }
        if (page >= Math.max(1, expectedPages)) break;

      }
      totalRecords += total ?? 0;
    }
    const seen = new Set<string>();
    for (const row of rows) {
      const record = row as { id?: unknown; type: string; link: string };
      const key = String(record.id);
      if (!Number.isSafeInteger(record.id) || seen.has(key)) throw new Error("WordPress REST repeated or omitted record identities. Retry the crawl.");
      seen.add(key);
    }
    result.wordpress = rows;
    return result;
  }
  const seen = new Set<string>();
  const feedEntries = new Map<string, GenericPage>();
  const queue: Array<{ url: string; depth: number; kind: "sitemap" | "html" | "rss" | "atom" }> = [{ url: start.href, depth: 0, kind }];
  const scheduled = new Set([start.href]);
  const schedule = (url: URL, depth: number, targetKind: "sitemap" | "html" | "rss" | "atom") => {
    if (scheduled.has(url.href)) return;
    scheduled.add(url.href);
    if (scheduled.size > limits.maxPages * 2 + 10) throw new Error("This import exceeded its discovery limit.");
    queue.push({ url: url.href, depth, kind: targetKind });
  };
  while (queue.length) {
    const item = queue.shift()!;
    const target = sameOrigin(item.url, start.origin);
    if (seen.has(target.href)) continue;
    seen.add(target.href);
    enforceImporterLimits({ pages: result.pages.length, bytes: report.bytes, depth: item.depth }, limits);
    const response = await read(target, { format: item.kind === "sitemap" ? "xml" : item.kind === "rss" || item.kind === "atom" ? "feed" : "html" });
    if (!response) continue;
    if (item.kind === "sitemap") {
      const index = /<sitemapindex[\s>]/i.test(response.text);
      for (const entry of parseSitemap(response.text)) schedule(sameOrigin(entry.url, start.origin), index ? item.depth + 1 : item.depth, index ? "sitemap" : "html");
    } else if (item.kind === "rss" || item.kind === "atom") {
      for (const entry of parseGenericFeed(response.text, target.href)) {
        const url = sameOrigin(entry.url, start.origin);
        feedEntries.set(url.href, entry);
        schedule(url, item.depth, "html");
      }
    } else {
      const page = parseGenericHtml(response.text, target.href), entry = feedEntries.get(target.href);
      result.pages.push(entry ? { ...page, kind: "post", publishedAt: page.publishedAt ?? entry.publishedAt, status: page.status ?? entry.status } as GenericPage : page);
      enforceImporterLimits({ pages: result.pages.length, bytes: report.bytes, depth: item.depth }, limits);
      if (kind === "html" && item.depth < limits.maxDepth) for (const href of links(response.text, target.href)) {
        let link: URL;
        try { link = sameOrigin(href, start.origin); } catch { continue; }
        if (/\.(?:pdf|jpg|jpeg|png|webp|avif|gif|zip|mp3|mp4|css|js)$/i.test(link.pathname)) continue;
        schedule(link, item.depth + 1, "html");
      }
    }
    if (queue.length + seen.size > limits.maxPages * 2 + 10) throw new Error("This import exceeded its discovery limit.");
  }
  return result;
}
