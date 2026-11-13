// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: one actual HTTP response, never a fabricated uploaded crawl export.
import { createHash } from "node:crypto";
import { z } from "zod";
import { requestPinnedBytes } from "@/core/http/pinned-download";
import { insideServiceTransaction } from "@/core/plugins/context";
import { assertPublicHttpUrl } from "./contract";

export const crawlRequestRoleSchema = z.enum(["robots", "html", "sitemap", "rss", "atom", "rest-pages", "rest-posts"]);
export type CrawlRequestRole = z.infer<typeof crawlRequestRoleSchema>;
export const crawlOriginalFactsSchema = z.object({
  version: z.literal(1), method: z.literal("GET"), requestedUrl: z.string().url().max(8_192),
  role: crawlRequestRoleSchema, status: z.union([z.literal(200), z.literal(404)]),
  contentType: z.string().max(255), contentEncoding: z.literal("identity"),
  bytes: z.number().int().min(0).max(20 * 1024 * 1024), digest: z.string().regex(/^[a-f0-9]{64}$/),
  totalRecords: z.number().int().min(0).max(10_000).optional(), totalPages: z.number().int().min(0).max(100).optional(),
}).strict().superRefine((facts, ctx) => {
  const rest = facts.role === "rest-pages" || facts.role === "rest-posts";
  if (facts.status === 404 && facts.role !== "robots") ctx.addIssue({ code: "custom", message: "Only a missing robots response may use HTTP404." });
  if (rest ? facts.totalRecords === undefined || facts.totalPages !== Math.ceil(facts.totalRecords / 100) : facts.totalRecords !== undefined || facts.totalPages !== undefined) ctx.addIssue({ code: "custom", message: "REST pagination facts must belong to their actual collection response." });
});
export type CrawlOriginalFacts = z.infer<typeof crawlOriginalFactsSchema>;
export type CrawlOriginalRequest = { site: string; url: string; role: CrawlRequestRole; page?: number };
type Download = Pick<Awaited<ReturnType<typeof requestPinnedBytes>>, "status" | "bytes" | "headers">;
type DownloadResponse = (url: string, options: { maxBytes: number; timeoutMs: number; headers: Record<string, string> }) => Promise<Download>;

/** Same selected WordPress instance, including its original subdirectory. */
export function crawlRestCollectionUrl(site: string, collection: "pages" | "posts", page: number): string {
  const selected = assertPublicHttpUrl(site);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100) throw new Error("The REST source page is outside its complete-source budget.");
  const root = selected.pathname.includes("/wp-json/") ? selected.pathname.slice(0, selected.pathname.indexOf("/wp-json/") + 1) : selected.pathname.replace(/\/?$/, "/");
  const url = new URL(`${root}wp-json/wp/v2/${collection}`, selected);
  url.search = new URLSearchParams({ per_page: "100", page: String(page), _embed: "1", orderby: "id", order: "asc" }).toString();
  return url.href;
}
function requestedUrl(request: CrawlOriginalRequest): URL {
  const site = assertPublicHttpUrl(request.site), target = assertPublicHttpUrl(request.url);
  if (target.origin !== site.origin || target.href.includes("#")) throw new Error("A crawl response must keep its approved original origin and exact request URL.");
  if (request.role === "robots" && target.href !== new URL("/robots.txt", site).href) throw new Error("The robots request must use the source origin's actual robots URL.");
  if (request.role === "rest-pages" || request.role === "rest-posts") {
    if (target.href !== crawlRestCollectionUrl(site.href, request.role === "rest-pages" ? "pages" : "posts", request.page ?? 1)) throw new Error("The REST request no longer matches the selected WordPress instance and original page.");
  } else if (request.page !== undefined) throw new Error("A non-REST response cannot claim a collection page.");
  return target;
}
const acceptedTypes = (role: CrawlRequestRole): string[] => role === "robots" ? ["text/plain"]
  : role === "rest-pages" || role === "rest-posts" ? ["application/json", "application/ld+json"]
  : role === "sitemap" ? ["application/xml", "text/xml"]
  : role === "rss" || role === "atom" ? ["application/xml", "text/xml", "application/rss+xml", "application/atom+xml"]
  : ["text/html", "application/xhtml+xml"];

/** Claim/current actor/robots/rate admission belongs to the enclosing services.
 * This primitive makes one pinned read outside their transactions. It returns
 * only the actual body plus minimal response facts for private receipt capture;
 * neither cookies nor arbitrary response headers enter normalized metadata. */
export async function readCrawlOriginalResponse(request: CrawlOriginalRequest, budget: { remainingBytes: number; deadline: number }, dependencies: { download?: DownloadResponse; now?: () => number } = {}): Promise<{ facts: CrawlOriginalFacts; body: Uint8Array<ArrayBuffer> }> {
  if (insideServiceTransaction()) throw new Error("Read crawl source bytes outside the service transaction.");
  const target = requestedUrl(request), now = dependencies.now ?? Date.now;
  if (!Number.isSafeInteger(budget.remainingBytes) || budget.remainingBytes <= 0 || budget.remainingBytes > 100 * 1024 * 1024 || !Number.isFinite(budget.deadline)) throw new Error("The original crawl byte or time budget is invalid.");
  const maxBytes = Math.min(budget.remainingBytes, request.role === "robots" ? 512 * 1024 : 20 * 1024 * 1024), remainingMs = budget.deadline - now();
  if (remainingMs <= 0) throw new Error("The bounded crawl response exceeded its original deadline.");
  const response = await (dependencies.download ?? requestPinnedBytes)(target.href, { maxBytes, timeoutMs: Math.min(30_000, remainingMs), headers: { "User-Agent": "Freeholder-Importer/1.0", "Accept-Encoding": "identity" } });
  if (now() > budget.deadline) throw new Error("The bounded crawl response exceeded its original deadline.");
  if (response.bytes.byteLength > maxBytes) throw new Error("The original crawl response exceeded its remaining byte budget.");
  if (response.status !== 200 && !(request.role === "robots" && response.status === 404)) throw new Error(`The source answered HTTP ${response.status}; use its final public URL.`);
  const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase(), encoding = response.headers.get("content-encoding");
  if (encoding && encoding.toLowerCase() !== "identity") throw new Error("The source ignored the uncompressed download requirement.");
  if (response.status === 200) {
    if (!acceptedTypes(request.role).includes(contentType)) throw new Error("The source returned an unexpected content type.");
    try { new TextDecoder("utf-8", { fatal: true }).decode(response.bytes); }
    catch { throw new Error("The source did not return valid UTF-8 text."); }
  }
  const rest = request.role === "rest-pages" || request.role === "rest-posts";
  const total = (name: string) => {
    const raw = response.headers.get(name);
    if (!raw || !/^\d+$/.test(raw)) throw new Error("WordPress REST must report its actual total pages and records.");
    return Number(raw);
  };
  const facts = crawlOriginalFactsSchema.parse({ version: 1, method: "GET", requestedUrl: target.href, role: request.role, status: response.status, contentType, contentEncoding: "identity", bytes: response.bytes.byteLength, digest: createHash("sha256").update(response.bytes).digest("hex"), ...(rest ? { totalRecords: total("x-wp-total"), totalPages: total("x-wp-totalpages") } : {}) });
  return { facts, body: response.bytes };
}
