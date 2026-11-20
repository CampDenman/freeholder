// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: index actual response-local ranges, never a fabricated upload stream.
import { createHash } from "node:crypto";
import { z } from "zod";
import { crawlBodyDescriptorSchema, type CrawlBodyDescriptor } from "./crawl-body";
import { crawlOriginalFactsSchema, crawlRestCollectionUrl, type CrawlOriginalFacts } from "./crawl-original";
import { parseGenericHtml, stageGenericPages } from "./generic-plan";
import { indexRestPhase } from "./rest-index";
import { IMPORT_GRAPH_LIMITS, wxrEntryMetadataSchema } from "./wxr-index";

const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const seo = z.object({
  title: z.string().max(1_000).optional(), description: z.string().max(1_000).optional(),
  preserveTitle: z.boolean().optional(), preserveDescription: z.boolean().optional(),
  canonical: z.string().max(8_192).optional(), noindex: z.boolean().optional(), nofollow: z.boolean().optional(),
  ogTitle: z.string().max(1_000).optional(), ogDescription: z.string().max(1_000).optional(), ogImage: z.string().max(8_192).optional(),
}).strict();
const mediaRef = z.object({ key: z.string().max(4_096), sourceUrl: z.string().url().max(8_192), filename: z.string().max(255), aliases: z.string().max(8_192).array().max(16), referenced: z.boolean(), altText: z.string().max(500).optional() }).strict();
export const crawlGraphMetadataSchema = wxrEntryMetadataSchema.extend({
  format: z.literal("http-originals"),
  original: crawlBodyDescriptorSchema.extend({ requestId: z.uuid(), requestOrdinal: z.number().int().min(0).max(20009), role: z.enum(["html", "rest-pages", "rest-posts"]), requestedUrl: z.string().url().max(8_192), start: z.number().int().min(0), end: z.number().int().min(0) }).strict(),
  seo: seo.optional(), publishedAt: z.iso.datetime().optional(),
  mediaRefs: mediaRef.array().max(500).optional(),
}).strict().superRefine((metadata, ctx) => {
  const original = metadata.original;
  if (original.end < original.start || original.end > original.bytes || original.role === "html" && (original.start !== 0 || original.end !== original.bytes || metadata.wpId !== undefined)) ctx.addIssue({ code: "custom", message: "The graph entry lost its actual response-local byte range." });
});
export type CrawlGraphMetadata = z.infer<typeof crawlGraphMetadataSchema>;
export type CrawlIndexedEntry = { ordinal: number; identity: string; start: number; end: number; digest: string; kind: "page" | "post" | "skipped"; metadata: CrawlGraphMetadata; bodyBytes: number };
type Request = { id: string; ordinal: number; role: "html" | "rest-pages" | "rest-posts"; restPage: number | null; entryMetadata: unknown };
const feedMetadata = z.object({ url: z.string().url(), title: z.string(), publishedAt: z.string().optional(), status: z.enum(["draft", "publish"]).optional(), kind: z.literal("post").optional() });

/** One original response is charged in full once for this indexing phase.
 * Commit selection must likewise group by response ID and charge physical
 * response bytes once, rather than adding only small parsed record fragments.
 * The returned local ranges may overlap other response objects; they are never
 * reinterpreted as offsets into an invented concatenation.
 */
export async function indexCrawlOriginalResponse(input: {
  siteUrl: string; source: CrawlBodyDescriptor; request: Request; facts: CrawlOriginalFacts;
  ordinal: number; approvedMediaOrigins?: string[];
}, body: Uint8Array): Promise<{ entries: CrawlIndexedEntry[]; physicalBytes: number; bodyBytes: number; metadataBytes: number }> {
  const source = crawlBodyDescriptorSchema.parse(input.source), facts = crawlOriginalFactsSchema.parse(input.facts);
  if (!Number.isSafeInteger(input.ordinal) || input.ordinal < 0 || input.ordinal > IMPORT_GRAPH_LIMITS.entries || facts.role !== input.request.role || facts.digest !== source.digest || facts.bytes !== source.bytes || body.byteLength !== source.bytes || sha(body) !== source.digest || facts.status !== 200 || new URL(facts.requestedUrl).origin !== new URL(input.siteUrl).origin) throw new Error("The actual indexed HTTP response lost its source, bytes or cursor.");
  const original = (start: number, end: number) => ({ ...source, requestId: input.request.id, requestOrdinal: input.request.ordinal, role: input.request.role, requestedUrl: facts.requestedUrl, start, end });
  let entries: CrawlIndexedEntry[];
  if (input.request.role === "html" && body.byteLength === 0) {
    // An actual empty HTTP body remains in the manifest. It has no positive
    // source range, so it cannot invent a normalized graph entry.
    return { entries: [], physicalBytes: 0, bodyBytes: 0, metadataBytes: 0 };
  }
  if (input.request.role === "html") {
    const parsed = parseGenericHtml(new TextDecoder("utf-8", { fatal: true }).decode(body), facts.requestedUrl);
    const feed = input.request.entryMetadata === null ? null : feedMetadata.parse(input.request.entryMetadata);
    if (feed && feed.url !== facts.requestedUrl) throw new Error("The original feed metadata belongs to another rendered page.");
    const page = { ...parsed, ...(feed ? { title: feed.title, kind: "post" as const, ...(feed.publishedAt ? { publishedAt: feed.publishedAt } : {}), ...(feed.status ? { status: feed.status } : {}) } : {}) };
    // This is a candidate media-reference list, not permission to fetch. The
    // complete frozen graph plan must apply the actual captured robots policy.
    const staged = stageGenericPages([page], input.siteUrl, "", input.approvedMediaOrigins ?? []), accepted = staged.preview.pages[0]!;
    const metadata = crawlGraphMetadataSchema.parse({ format: "http-originals", original: original(0, body.byteLength), url: page.url, slug: accepted.slug, targetSlug: accepted.slug, title: page.title, status: page.status ?? "publish", sourcePath: new URL(page.url).pathname.replace(/^\/+|\/+$/g, ""), seo: page.seo, ...(page.publishedAt ? { publishedAt: page.publishedAt } : {}), ...(staged.preview.generic.media.length ? { mediaRefs: staged.preview.generic.media } : {}) });
    entries = [{ ordinal: input.ordinal, identity: sha(`http-originals\0url:${page.url}`), start: 0, end: body.byteLength, digest: source.digest, kind: page.kind, metadata, bodyBytes: Buffer.byteLength(page.body) }];
  } else {
    if (facts.requestedUrl !== crawlRestCollectionUrl(input.siteUrl, input.request.role === "rest-pages" ? "pages" : "posts", input.request.restPage ?? 1)) throw new Error("The original response belongs to another WordPress instance or page.");
    const indexed = await indexRestPhase({ bytes: body.byteLength, readRange: async (start, end) => {
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > body.byteLength) throw new Error("The original HTTP record range is invalid.");
      return body.slice(start, end);
    } }, undefined, input.siteUrl, input.request.role === "rest-pages" ? "page" : "post");
    if (!indexed.done || indexed.entries.length !== Math.min(100, Math.max(0, facts.totalRecords! - ((input.request.restPage ?? 1) - 1) * 100))) throw new Error("The actual WordPress response does not contain its declared original records.");
    entries = indexed.entries.map((entry, index) => {
      if (!["page", "post", "skipped"].includes(entry.kind) || !entry.metadata.wpId) throw new Error("The original REST collection introduced an unsupported or unbound entity.");
      const metadata = crawlGraphMetadataSchema.parse({ ...entry.metadata, format: "http-originals", original: original(entry.start, entry.end) });
      return { ordinal: input.ordinal + index, identity: sha(`http-originals\0wordpress:${entry.metadata.wpId}`), start: entry.start, end: entry.end, digest: entry.digest, kind: entry.kind as "page" | "post" | "skipped", metadata, bodyBytes: entry.bodyBytes };
    });
  }
  const metadataBytes = entries.reduce((total, entry) => total + Buffer.byteLength(JSON.stringify(entry.metadata)), 0), bodyBytes = entries.reduce((total, entry) => total + entry.bodyBytes, 0);
  if (input.ordinal + entries.length > IMPORT_GRAPH_LIMITS.entries || metadataBytes > IMPORT_GRAPH_LIMITS.metadataBytes || entries.some(entry => Buffer.byteLength(JSON.stringify(entry.metadata)) > IMPORT_GRAPH_LIMITS.entryMetadataBytes) || bodyBytes > 20 * 1024 * 1024) throw new Error("The original HTTP index exceeds its graph phase or metadata budget.");
  return { entries, physicalBytes: body.byteLength, bodyBytes, metadataBytes };
}
