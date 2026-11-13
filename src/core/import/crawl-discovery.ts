// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: derive bounded frontier facts from actual captured HTTP bytes.
import { createHash } from "node:crypto";
import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { z } from "zod";
import { assertPublicHttpUrl, DEFAULT_IMPORTER_LIMITS, robotsDisallow } from "./contract";
import { parseSitemap } from "./parsers";
import { parseGenericFeedLinks } from "./generic-feed";
import { crawlOriginalFactsSchema, crawlRestCollectionUrl, type CrawlRequestRole } from "./crawl-original";

export const crawlTargetSchema = z.object({
  url: z.string().url().max(8_192), role: z.enum(["html", "sitemap", "rss", "atom", "rest-pages", "rest-posts"]),
  depth: z.number().int().min(0).max(4), restPage: z.number().int().min(1).max(100).optional(),
  entryMetadata: z.object({ url: z.string().url().max(8_192), title: z.string().max(2_048), publishedAt: z.string().optional(), status: z.enum(["draft", "publish"]).optional(), kind: z.literal("post").optional() }).strict().optional(),
}).strict();
export type CrawlTarget = z.infer<typeof crawlTargetSchema>;
export type DiscoverySource = { kind: "wordpress-rest" | "html" | "sitemap" | "rss" | "atom"; siteUrl: string; sourceUrl: string };
export type DiscoveryRequest = { role: CrawlRequestRole; depth: number; restPage: number | null };
function selectedUrl(raw: string, site: string): URL {
  const url = assertPublicHttpUrl(raw); url.hash = "";
  if (url.origin !== new URL(site).origin) throw new Error("An original crawl target cannot fetch another origin.");
  return url;
}
export function originalHtmlLinks(html: string, base: string): string[] {
  const pending: DefaultTreeAdapterTypes.Node[] = [parse(html)], result = new Set<string>();
  while (pending.length) {
    const node = pending.pop()!;
    if ("tagName" in node && node.tagName === "a") {
      const href = node.attrs.find(attribute => attribute.name === "href")?.value;
      if (href) try { const url = new URL(href, base); url.hash = ""; result.add(url.href); } catch { /* Invalid markup is not a request. */ }
    }
    if ("childNodes" in node) pending.push(...node.childNodes);
  }
  return [...result];
}

/** No body or feed excerpt enters the frontier result. WordPress record
 * identities/byte ranges are indexed separately from these pagination facts. */
export function discoverCrawlPhase(source: DiscoverySource, request: DiscoveryRequest, rawFacts: unknown, body: Uint8Array, previous = 0): {
  previous: number; next: number; done: boolean; targets: CrawlTarget[]; pageRecords: number;
} {
  const facts = crawlOriginalFactsSchema.parse(rawFacts);
  if (body.byteLength !== facts.bytes || createHash("sha256").update(body).digest("hex") !== facts.digest || facts.role !== request.role || !Number.isSafeInteger(previous) || previous < 0 || previous > 20010) throw new Error("The actual HTTP response or its discovery cursor changed.");
  let text: string;
  // Robots discovery schedules the selected first URL; it never interprets
  // or substitutes a404 error body as source content or policy text.
  try { text = request.role === "robots" ? "" : new TextDecoder("utf-8", { fatal: true }).decode(body); } catch { throw new Error("The original source is not valid UTF-8."); }
  selectedUrl(facts.requestedUrl, source.siteUrl);
  const roles: CrawlRequestRole[] = source.kind === "wordpress-rest" ? ["robots", "rest-pages", "rest-posts"] : source.kind === "html" ? ["robots", "html"] : ["robots", source.kind, "html"];
  if (!roles.includes(request.role) || !Number.isSafeInteger(request.depth) || request.depth < 0 || request.depth > 4) throw new Error("The original response no longer belongs to its source kind or depth.");
  if (request.role === "robots" && facts.requestedUrl !== new URL("/robots.txt", source.siteUrl).href) throw new Error("The original robots response belongs to another URL.");
  if ((request.role === "rest-pages" || request.role === "rest-posts") && facts.requestedUrl !== crawlRestCollectionUrl(source.siteUrl, request.role === "rest-pages" ? "pages" : "posts", request.restPage ?? 1)) throw new Error("The original REST response belongs to another instance or page.");
  const targets: CrawlTarget[] = [], seenTargets = new Set<string>();
  let pageRecords = 0;
  const target = (url: string, role: CrawlTarget["role"], depth: number, extra: Partial<CrawlTarget> = {}) => {
    const next = crawlTargetSchema.parse({ ...extra, url: selectedUrl(url, source.siteUrl).href, role, depth });
    const key = `${next.role}\0${next.url}`;
    if (seenTargets.has(key)) return;
    seenTargets.add(key); targets.push(next);
    if (targets.length > 20010) throw new Error("The complete source exceeds its discovery budget.");
  };
  if (request.role === "robots") {
    if (source.kind === "wordpress-rest") for (const collection of ["pages", "posts"] as const) target(crawlRestCollectionUrl(source.siteUrl, collection, 1), collection === "pages" ? "rest-pages" : "rest-posts", 1, { restPage: 1 });
    else target(source.sourceUrl, source.kind, 0);
  } else if (request.role === "rest-pages" || request.role === "rest-posts") {
    let records: unknown;
    try { records = JSON.parse(text); } catch { throw new Error("The original WordPress response is not valid JSON."); }
    const page = request.restPage ?? 1, total = facts.totalRecords!, pages = facts.totalPages!;
    if (!Array.isArray(records) || records.length !== Math.min(100, Math.max(0, total - (page - 1) * 100)) || page > Math.max(1, pages)) throw new Error("The original WordPress response omitted its declared records.");
    const seen = new Set<number>();
    for (const raw of records) {
      const record = z.object({ id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), link: z.string().url().max(8_192), type: z.literal(request.role === "rest-pages" ? "page" : "post") }).safeParse(raw);
      if (!record.success || seen.has(record.data.id)) throw new Error("The original WordPress response has invalid or repeated record identities.");
      seen.add(record.data.id); selectedUrl(record.data.link, source.siteUrl);
    }
    pageRecords = records.length;
    if (page < pages) target(crawlRestCollectionUrl(source.siteUrl, request.role === "rest-pages" ? "pages" : "posts", page + 1), request.role, 1, { restPage: page + 1 });
  } else if (request.role === "sitemap") {
    const index = /<sitemapindex[\s>]/i.test(text);
    for (const entry of parseSitemap(text, { ...DEFAULT_IMPORTER_LIMITS, maxPages: 20010 })) target(entry.url, index ? "sitemap" : "html", index ? request.depth + 1 : request.depth);
  } else if (request.role === "rss" || request.role === "atom") {
    for (const entry of parseGenericFeedLinks(text, facts.requestedUrl)) target(entry.url, "html", request.depth, { entryMetadata: { url: entry.url, title: entry.title, ...(entry.publishedAt ? { publishedAt: entry.publishedAt } : {}), ...(entry.status ? { status: entry.status } : {}), kind: "post" } });
  } else {
    pageRecords = 1;
    if (source.kind === "html" && request.depth < 4) for (const raw of originalHtmlLinks(text, facts.requestedUrl)) {
      let url: URL;
      try { url = selectedUrl(raw, source.siteUrl); } catch { continue; }
      if (/\.(?:pdf|jpe?g|png|webp|avif|gif|zip|mp3|mp4|css|js)$/i.test(url.pathname)) continue;
      target(url.href, "html", request.depth + 1);
    }
  }
  if (previous > targets.length) throw new Error("The original frontier cursor is outside its response.");
  const next = Math.min(previous + 500, targets.length);
  return { previous, next, done: next === targets.length, targets: targets.slice(previous, next), pageRecords: previous === 0 ? pageRecords : 0 };
}

export function crawlPolicyAllows(policy: string, raw: string): boolean {
  const url = assertPublicHttpUrl(raw); return !robotsDisallow(policy, `${url.pathname}${url.search}`);
}
