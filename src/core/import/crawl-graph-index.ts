// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: short claim/apply transactions bind entries to actual HTTP responses.
// Private index phases require the matching guarded migration81 schema.
import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { importRuns, importSourceEntries, importSourceGraphs } from "@/core/plugins/schema";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { assertCurrentImportAuthority, currentImportAuthority } from "./authority";
import { crawlBodyDescriptorSchema, type CrawlBodyDescriptor } from "./crawl-body";
import { importCrawlEntryOriginals, importCrawlGraphs } from "./crawl-graph-schema";
import { crawlGraphMetadataSchema } from "./crawl-index";
import { crawlOriginalFactsSchema } from "./crawl-original";
import { importCrawlRequests, importCrawlResponses, importCrawlSources } from "./crawl-schema";
import { markImportCrawlWriter } from "./crawl-writer";
import { IMPORT_GRAPH_LIMITS } from "./wxr-index";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? { ...value as Record<string, unknown> } : {};
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const crawlGraphCursorSchema = z.object({
  format: z.literal("http-originals"), requestOrdinal: z.number().int().min(0).max(20_010),
  ordinal: z.number().int().min(0).max(IMPORT_GRAPH_LIMITS.entries),
  bodyBytes: z.number().int().min(0).max(IMPORT_GRAPH_LIMITS.bodyBytes),
  metadataBytes: z.number().int().min(0).max(4 * 1024 * 1024),
  physicalBytes: z.number().int().min(0).max(100 * 1024 * 1024),
}).strict();
export const crawlGraphHeaderSchema = z.object({
  format: z.literal("http-originals"), sourceId: z.uuid(), generation: z.uuid(), sourceRevision: digest,
  siteUrl: z.string().url().max(8_192), sourceUrl: z.string().url().max(8_192),
  kind: z.enum(["wordpress-rest", "sitemap", "rss", "atom", "html"]), robotsResponseId: z.uuid(),
  requests: z.number().int().min(1).max(20_010), capturedBytes: z.number().int().min(0).max(100 * 1024 * 1024),
}).strict();
const indexedEntry = z.object({
  ordinal: z.number().int().min(0).max(IMPORT_GRAPH_LIMITS.entries - 1), identity: digest,
  start: z.number().int().nonnegative(), end: z.number().int().positive(), digest,
  kind: z.enum(["page", "post", "skipped"]), metadata: crawlGraphMetadataSchema,
  bodyBytes: z.number().int().min(0).max(20 * 1024 * 1024),
}).strict();
type Cursor = z.infer<typeof crawlGraphCursorSchema>;
type Request = typeof importCrawlRequests.$inferSelect;
type Response = typeof importCrawlResponses.$inferSelect;
type GraphClaim = {
  graphId: string; leaseToken: string; sourceRevision: string; previous: Cursor; nextRequestOrdinal: number;
  siteUrl: string; source: CrawlBodyDescriptor | null; request: Request | null; response: Response | null;
};
const rootInput = z.object({ id: z.uuid(), generation: z.uuid() });

// Friendly key names are reusable. A phase belongs to the actual credential,
// while the ordinary service audit continues to retain the original actor.
async function executor(ctx: ServiceContext): Promise<string> {
  const actor = await currentImportAuthority(ctx);
  if ((actor.kind === "user" || actor.kind === "agent") && actor.keyId) return `key:${actor.keyId}`;
  if (actor.kind === "user") return `user:${actor.userId}`;
  throw new ServiceError("permission", "An original source phase needs its current authenticated caller.");
}
async function lockSource(input: z.infer<typeof rootInput>, ctx: ServiceContext) {
  await assertCurrentImportAuthority(ctx, "imports.advanceCrawl");
  await lockContactIdentityForRead(ctx.tx);
  await markImportCrawlWriter(ctx.tx);
  const [root] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1).for("update");
  const [source] = await ctx.tx.select().from(importCrawlSources).where(eq(importCrawlSources.runId, input.id)).limit(1).for("update");
  const binding = object(object(root?.checkpoint).sourceCrawl);
  if (!root || root.status !== "discover" || !source || source.state !== "sealed" || source.generation !== input.generation || source.expiresAt.getTime() <= Date.now() || !source.sourceRevision || !source.siteUrl || !source.sourceUrl || !source.robotsResponseId || binding.id !== source.id || binding.generation !== source.generation || binding.revision !== source.sourceRevision) throw new ServiceError("conflict", "This index lost its original sealed public source.");
  return { root, source, siteUrl: source.siteUrl, sourceUrl: source.sourceUrl, revision: source.sourceRevision, robotsResponseId: source.robotsResponseId };
}

export const claimCrawlGraphIndex = defineService({
  name: "imports.claimCrawlGraphIndex", orchestratedBy: "imports.advanceCrawl", external: false,
  summary: "Claim one bounded index phase over the saved original HTTP frontier.", kind: "mutation", permission: "scoped",
  auditInputFields: ["id", "generation"], input: rootInput, output: z.custom<GraphClaim>(),
  handler: async (input, ctx) => {
    const { root, source, siteUrl, sourceUrl, revision, robotsResponseId } = await lockSource(input, ctx);
    let [graph] = await ctx.tx.select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, root.id)).limit(1).for("update");
    if (!graph) {
      const cursor = crawlGraphCursorSchema.parse({ format: "http-originals", requestOrdinal: 0, ordinal: 0, bodyBytes: 0, metadataBytes: 0, physicalBytes: 0 });
      const header = crawlGraphHeaderSchema.parse({ format: "http-originals", sourceId: source.id, generation: source.generation, sourceRevision: revision, siteUrl, sourceUrl, kind: source.kind, robotsResponseId, requests: source.requestCounter, capturedBytes: source.capturedBytes });
      [graph] = await ctx.tx.insert(importSourceGraphs).values({ runId: root.id, generation: source.generation, sourceRevision: revision, sourceStartedAt: source.sourceStartedAt, cursor, headerMetadata: header }).returning();
      if (!graph) throw new ServiceError("internal", "The original response graph could not be reserved.");
      await ctx.tx.insert(importCrawlGraphs).values({ graphId: graph.id, sourceId: source.id, sourceGeneration: source.generation, sourceRevision: revision });
      await ctx.tx.update(importRuns).set({ checkpoint: { ...object(root.checkpoint), sourceGraph: { id: graph.id, generation: graph.generation, sourceRevision: graph.sourceRevision, planRevision: graph.planRevision } } }).where(eq(importRuns.id, root.id));
    }
    const [original] = await ctx.tx.select().from(importCrawlGraphs).where(eq(importCrawlGraphs.graphId, graph.id)).limit(1).for("update");
    const previous = crawlGraphCursorSchema.parse(graph.cursor);
    if (graph.state !== "indexing" || graph.generation !== source.generation || graph.sourceRevision !== revision || !original || original.sourceId !== source.id || original.sourceGeneration !== source.generation || original.sourceRevision !== revision || original.requestOrdinal !== previous.requestOrdinal || original.entryOrdinal !== previous.ordinal || original.bodyBytes !== previous.bodyBytes || original.metadataBytes !== previous.metadataBytes || original.physicalBytes !== previous.physicalBytes) throw new ServiceError("conflict", "The actual HTTP index progress lost its normalized original binding.");
    if (graph.leaseUntil && graph.leaseUntil.getTime() > Date.now()) throw new ServiceError("conflict", "Another original response index phase is still running.");
    const rows = await ctx.tx.select({ request: importCrawlRequests, response: importCrawlResponses }).from(importCrawlRequests)
      .leftJoin(importCrawlResponses, eq(importCrawlRequests.acceptedResponseId, importCrawlResponses.id))
      .where(and(eq(importCrawlRequests.sourceId, source.id), gte(importCrawlRequests.ordinal, previous.requestOrdinal)))
      .orderBy(asc(importCrawlRequests.ordinal)).limit(500);
    let nextRequestOrdinal = previous.requestOrdinal, selected: { request: Request; response: Response } | null = null;
    for (const row of rows) {
      if (row.request.ordinal !== nextRequestOrdinal) throw new ServiceError("conflict", "The accepted original frontier lost a request ordinal.");
      nextRequestOrdinal++;
      if (row.request.state === "blocked" && row.response === null) continue;
      if (row.request.state !== "accepted" || !row.response || row.response.state !== "stored" || row.response.retiredAt || !row.response.discoveryComplete || row.response.requestId !== row.request.id) throw new ServiceError("conflict", "An actual sealed response needs recovery before indexing.");
      const facts = crawlOriginalFactsSchema.parse(row.response.facts);
      if (facts.requestedUrl !== row.request.url || facts.role !== row.request.role) throw new ServiceError("conflict", "The sealed response lost its exact requested URL.");
      if (["html", "rest-pages", "rest-posts"].includes(row.request.role) && facts.status === 200) { selected = { request: row.request, response: row.response }; break; }
    }
    if (!rows.length && previous.requestOrdinal !== source.requestCounter || nextRequestOrdinal > source.requestCounter) throw new ServiceError("conflict", "The actual sealed frontier ended before its recorded request count.");
    const facts = selected ? crawlOriginalFactsSchema.parse(selected.response.facts) : null;
    const body = selected && facts ? crawlBodyDescriptorSchema.parse({ runId: root.id, sourceId: source.id, generation: source.generation, responseId: selected.response.id, digest: facts.digest, bytes: facts.bytes }) : null;
    const leaseToken = randomUUID();
    await ctx.tx.update(importSourceGraphs).set({ leaseToken, leaseActor: await executor(ctx), leaseUntil: new Date(Date.now() + 120_000), updatedAt: new Date() }).where(eq(importSourceGraphs.id, graph.id));
    ctx.setSubject("import_run", root.id);
    return { graphId: graph.id, leaseToken, sourceRevision: revision, previous, nextRequestOrdinal, siteUrl, source: body, request: selected?.request ?? null, response: selected?.response ?? null };
  },
});

export const applyCrawlGraphIndex = defineService({
  name: "imports.applyCrawlGraphIndex", orchestratedBy: "imports.advanceCrawl", external: false,
  summary: "Accept verified response-local ranges under their original graph lease.", kind: "mutation", permission: "scoped",
  auditInputFields: ["id", "graphId"],
  input: rootInput.extend({ graphId: z.uuid(), leaseToken: z.uuid(), sourceRevision: digest, previous: crawlGraphCursorSchema, nextRequestOrdinal: z.number().int().min(0).max(20_010), source: crawlBodyDescriptorSchema.nullable(), entries: indexedEntry.array().max(500), physicalBytes: z.number().int().min(0).max(20 * 1024 * 1024) }),
  output: z.object({ id: z.uuid(), done: z.boolean(), indexed: z.number().int().nonnegative() }),
  handler: async (input, ctx) => {
    const { root, source, revision } = await lockSource(input, ctx);
    const [graph] = await ctx.tx.select().from(importSourceGraphs).where(and(eq(importSourceGraphs.id, input.graphId), eq(importSourceGraphs.runId, root.id))).limit(1).for("update");
    const [binding] = await ctx.tx.select().from(importCrawlGraphs).where(eq(importCrawlGraphs.graphId, input.graphId)).limit(1).for("update");
    if (!graph || !binding || graph.state !== "indexing" || graph.generation !== input.generation || graph.sourceRevision !== revision || input.sourceRevision !== revision || binding.sourceId !== source.id || binding.sourceGeneration !== source.generation || binding.sourceRevision !== revision || graph.leaseToken !== input.leaseToken || graph.leaseActor !== await executor(ctx) || !graph.leaseUntil || graph.leaseUntil.getTime() <= Date.now() || JSON.stringify(crawlGraphCursorSchema.parse(graph.cursor)) !== JSON.stringify(input.previous) || binding.requestOrdinal !== input.previous.requestOrdinal || binding.entryOrdinal !== input.previous.ordinal || binding.bodyBytes !== input.previous.bodyBytes || binding.metadataBytes !== input.previous.metadataBytes || binding.physicalBytes !== input.previous.physicalBytes || input.nextRequestOrdinal <= input.previous.requestOrdinal || input.nextRequestOrdinal > Math.min(source.requestCounter, input.previous.requestOrdinal + 500)) throw new ServiceError("conflict", "This HTTP index lost its current caller, original progress or lease.");
    const requests = await ctx.tx.select({ request: importCrawlRequests, response: importCrawlResponses }).from(importCrawlRequests)
      .leftJoin(importCrawlResponses, eq(importCrawlRequests.acceptedResponseId, importCrawlResponses.id))
      .where(and(eq(importCrawlRequests.sourceId, source.id), gte(importCrawlRequests.ordinal, input.previous.requestOrdinal)))
      .orderBy(asc(importCrawlRequests.ordinal)).limit(input.nextRequestOrdinal - input.previous.requestOrdinal);
    if (requests.length !== input.nextRequestOrdinal - input.previous.requestOrdinal) throw new ServiceError("conflict", "The claimed original frontier changed during its private body read.");
    let indexedResponse: { request: Request; response: Response } | null = null;
    for (const [index, row] of requests.entries()) {
      if (row.request.ordinal !== input.previous.requestOrdinal + index) throw new ServiceError("conflict", "The claimed response frontier is no longer consecutive.");
      if (row.request.state === "blocked" && row.response === null) continue;
      if (row.request.state !== "accepted" || !row.response || row.response.state !== "stored" || row.response.retiredAt || !row.response.discoveryComplete) throw new ServiceError("conflict", "The claimed HTTP original was invalidated during indexing.");
      const facts = crawlOriginalFactsSchema.parse(row.response.facts);
      if (["html", "rest-pages", "rest-posts"].includes(row.request.role) && facts.status === 200) {
        if (indexedResponse || index !== requests.length - 1) throw new ServiceError("conflict", "One index phase must end at its one actual content response.");
        indexedResponse = { request: row.request, response: row.response };
      }
    }
    if (indexedResponse) {
      const facts = crawlOriginalFactsSchema.parse(indexedResponse.response.facts), descriptor = input.source;
      if (!descriptor || descriptor.runId !== root.id || descriptor.sourceId !== source.id || descriptor.generation !== source.generation || descriptor.responseId !== indexedResponse.response.id || descriptor.digest !== facts.digest || descriptor.bytes !== facts.bytes || input.physicalBytes !== facts.bytes) throw new ServiceError("conflict", "The index lost the exact body it actually read.");
    } else if (input.source || input.entries.length || input.physicalBytes !== 0) throw new ServiceError("conflict", "A control-only frontier phase cannot invent indexed response bytes.");
    const seen = new Set(input.entries.map(entry => entry.identity));
    if (seen.size !== input.entries.length || (seen.size && (await ctx.tx.select({ id: importSourceEntries.id }).from(importSourceEntries).where(and(eq(importSourceEntries.graphId, graph.id), inArray(importSourceEntries.sourceIdentity, [...seen]))).limit(1)).length)) throw new ServiceError("validation", "The actual HTTP source repeats an entity identity.");
    const used = new Set((await ctx.tx.select({ slug: importSourceEntries.targetSlug }).from(importSourceEntries).where(eq(importSourceEntries.graphId, graph.id))).flatMap(row => row.slug === null ? [] : [row.slug]));
    let ordinal = input.previous.ordinal, bodyBytes = input.previous.bodyBytes, metadataBytes = input.previous.metadataBytes;
    const rows = input.entries.map(entry => {
      const original = entry.metadata.original;
      if (!indexedResponse || !input.source || entry.ordinal !== ordinal++ || entry.end <= entry.start || entry.end > input.source.bytes || original.runId !== root.id || original.sourceId !== source.id || original.generation !== source.generation || original.requestId !== indexedResponse.request.id || original.requestOrdinal !== indexedResponse.request.ordinal || original.responseId !== indexedResponse.response.id || original.role !== indexedResponse.request.role || original.requestedUrl !== indexedResponse.request.url || original.digest !== input.source.digest || original.bytes !== input.source.bytes || original.start !== entry.start || original.end !== entry.end) throw new ServiceError("conflict", "An indexed entry lost its actual response-local range or generation.");
      let targetSlug = entry.metadata.targetSlug ?? null;
      if (targetSlug !== null) {
        const base = targetSlug;
        for (let suffix = 2; used.has(targetSlug); suffix++) targetSlug = `${base || "home"}-${suffix}`;
        if (targetSlug.length > 2_048) throw new ServiceError("validation", "An original target path exceeds its graph budget.");
        used.add(targetSlug);
      }
      const metadata = crawlGraphMetadataSchema.parse({ ...entry.metadata, ...(targetSlug === null ? {} : { targetSlug }) }), bytes = Buffer.byteLength(JSON.stringify(metadata));
      if (bytes > IMPORT_GRAPH_LIMITS.entryMetadataBytes) throw new ServiceError("validation", "An original entry exceeds its graph metadata budget.");
      bodyBytes += entry.bodyBytes; metadataBytes += bytes;
      return { id: randomUUID(), graphId: graph.id, ordinal: entry.ordinal, sourceIdentity: entry.identity, kind: entry.kind, startByte: entry.start, endByte: entry.end, digest: entry.digest, metadata, bodyBytes: entry.bodyBytes, targetSlug };
    });
    if (bodyBytes - input.previous.bodyBytes > 20 * 1024 * 1024) throw new ServiceError("validation", "The indexed entries exceed one bounded content phase.");
    const cursor = crawlGraphCursorSchema.parse({ format: "http-originals", requestOrdinal: input.nextRequestOrdinal, ordinal, bodyBytes, metadataBytes, physicalBytes: input.previous.physicalBytes + input.physicalBytes });
    if (rows.length) {
      await ctx.tx.insert(importSourceEntries).values(rows);
      await ctx.tx.insert(importCrawlEntryOriginals).values(rows.map(row => ({ entryId: row.id, graphId: graph.id, requestId: indexedResponse!.request.id, responseId: indexedResponse!.response.id })));
    }
    const done = cursor.requestOrdinal === source.requestCounter;
    await ctx.tx.update(importCrawlGraphs).set({ requestOrdinal: cursor.requestOrdinal, entryOrdinal: cursor.ordinal, bodyBytes: cursor.bodyBytes, metadataBytes: cursor.metadataBytes, physicalBytes: cursor.physicalBytes }).where(eq(importCrawlGraphs.graphId, graph.id));
    await ctx.tx.update(importSourceGraphs).set({ cursor, state: done ? "indexed" : "indexing", leaseToken: null, leaseActor: null, leaseUntil: null, updatedAt: new Date() }).where(eq(importSourceGraphs.id, graph.id));
    const counts = await ctx.tx.select({ kind: importSourceEntries.kind, total: sql<number>`count(*)::integer` }).from(importSourceEntries).where(eq(importSourceEntries.graphId, graph.id)).groupBy(importSourceEntries.kind);
    const total = (kind: string) => counts.find(row => row.kind === kind)?.total ?? 0;
    await ctx.tx.update(importRuns).set({ status: done ? "previewed" : "discover", error: null, counts: { indexed: cursor.ordinal, pages: total("page"), posts: total("post"), skipped: total("skipped"), media: 0 }, preview: done ? { sourceFormat: "durable-http", graphId: graph.id, generation: graph.generation, sourceRevision: graph.sourceRevision, planRevision: graph.planRevision, version: 1 } : {} }).where(eq(importRuns.id, root.id));
    ctx.setSubject("import_run", root.id);
    return { id: root.id, done, indexed: cursor.ordinal };
  },
});

export default [claimCrawlGraphIndex, applyCrawlGraphIndex];
