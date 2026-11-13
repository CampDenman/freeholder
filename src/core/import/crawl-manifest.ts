// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: seal actual response membership, without fabricating an uploaded file.
import { createHash } from "node:crypto";
import { crawlOriginalFactsSchema, crawlRestCollectionUrl, type CrawlRequestRole } from "./crawl-original";
import { assertPublicHttpUrl } from "./contract";

type Source = {
  id: string; generation: string; kind: "wordpress-rest" | "sitemap" | "rss" | "atom" | "html";
  siteUrl: string; sourceUrl: string; robotsResponseId: string;
  requestCounter: number; networkRequests: number; capturedBytes: number; reservedBytes: number; pageCount: number;
};
type Original = { id: string; keyDigest: string; storageNamespace: string; state: string; facts: unknown; discoveryComplete: boolean; retiredAt: Date | null };
export type CrawlManifestRequest = {
  id: string; ordinal: number; url: string; urlDigest: string; role: CrawlRequestRole; depth: number;
  restPage: number | null; state: string; acceptedResponseId: string | null; original: Original | null;
};
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

/** These are manifest addresses of distinct response objects. No concatenated
 * body, upload ID, fabricated WordPress entity or secret header is introduced.
 * Every later original-body read must still resolve its exact response receipt.
 */
export function sealCrawlManifest(source: Source, requests: CrawlManifestRequest[]) {
  const site = assertPublicHttpUrl(source.siteUrl), selected = assertPublicHttpUrl(source.sourceUrl);
  if (site.origin !== selected.origin || source.reservedBytes !== 0 || requests.length !== source.requestCounter || requests.length < 1 || requests.length > 20010 || source.pageCount < 0 || source.pageCount > 10000) throw new Error("The actual original frontier is incomplete or outside its source budget.");
  const responseIds = new Set<string>(), keys = new Set<string>(), urls = new Set<string>();
  let bytes = 0, networkRequests = 0;
  const entries = requests.map((request, ordinal) => {
    const url = assertPublicHttpUrl(request.url), urlKey = `${request.role}\0${request.urlDigest}`;
    if (request.ordinal !== ordinal || url.origin !== site.origin || url.hash || url.href !== request.url || request.urlDigest !== digest(request.url) || urls.has(urlKey) || !Number.isSafeInteger(request.depth) || request.depth < 0 || request.depth > 4) throw new Error("An original frontier row lost its exact source identity or ordinal.");
    urls.add(urlKey);
    if ((request.role === "rest-pages" || request.role === "rest-posts") && (source.kind !== "wordpress-rest" || request.url !== crawlRestCollectionUrl(source.siteUrl, request.role === "rest-pages" ? "pages" : "posts", request.restPage ?? 1))) throw new Error("The original REST response belongs to another selected instance.");
    if (ordinal === 0 && (request.role !== "robots" || request.url !== new URL("/robots.txt", site).href || request.acceptedResponseId !== source.robotsResponseId)) throw new Error("The complete source needs its exact first robots response.");
    if (request.state === "blocked") {
      if (request.role === "robots" || request.acceptedResponseId || request.original) throw new Error("A blocked URL cannot invent an HTTP response.");
      return { requestId: request.id, ordinal, url: request.url, urlDigest: request.urlDigest, role: request.role, depth: request.depth, state: "blocked" as const, robotsResponseId: source.robotsResponseId };
    }
    const original = request.original;
    if (request.state !== "accepted" || !original || request.acceptedResponseId !== original.id || original.state !== "stored" || original.retiredAt || !original.discoveryComplete || responseIds.has(original.id) || keys.has(original.keyDigest) || !/^[a-f0-9]{64}$/.test(original.keyDigest) || !/^[a-f0-9]{64}$/.test(original.storageNamespace)) throw new Error("The actual original response is missing, duplicated or unresolved.");
    const facts = crawlOriginalFactsSchema.parse(original.facts);
    if (facts.requestedUrl !== request.url || facts.role !== request.role) throw new Error("The captured response facts belong to another original request.");
    responseIds.add(original.id); keys.add(original.keyDigest); networkRequests += 1; bytes += facts.bytes;
    return { requestId: request.id, ordinal, url: request.url, urlDigest: request.urlDigest, role: request.role, depth: request.depth, state: "accepted" as const, responseId: original.id, keyDigest: original.keyDigest, storageNamespace: original.storageNamespace, facts };
  });
  if (bytes !== source.capturedBytes || bytes > 100 * 1024 * 1024 || networkRequests !== source.networkRequests) throw new Error("The actual response totals no longer match their admitted complete-source budget.");
  const manifest = { format: "http-originals" as const, version: 1 as const, sourceId: source.id, generation: source.generation, kind: source.kind, siteUrl: site.href, sourceUrl: selected.href, robotsResponseId: source.robotsResponseId, bytes, pages: source.pageCount, requests: entries };
  const serialized = JSON.stringify(manifest);
  if (Buffer.byteLength(serialized) > 16 * 1024 * 1024) throw new Error("The complete actual-response manifest exceeds its metadata budget.");
  return { manifest, revision: digest(serialized) };
}
