// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: actual HTTP originals feed the ordinary bounded CMS recovery ledger.
// Actual private phases run under the registered public import operations.
import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { importRuns, importSourceBatches, importSourceEntries, importSourceGraphs, importSourceMedia } from "@/core/plugins/schema";
import { actorString, defineService, ServiceError, type Actor, type ServiceContext } from "@/core/service";
import { assertCurrentImportAuthority, importLeaseOwner } from "./authority";
import { withinImportBatch, type ImportBatchContext } from "./batch-context";
import { acceptGraphBatch } from "./graph-batches";
import { graphCatalogSchema, graphMediaPlans } from "./graph-catalog";
import { importGraphVersionSchema, type ImportGraphVersion } from "./graph-version";
import { archivePreviewDigest } from "./archive-plan";
import { crawlBodyDescriptorSchema } from "./crawl-body";
import { prepareCrawlGraphBatch, type CrawlBatchReadClaim, type CrawlBatchOriginal } from "./crawl-graph-batch-read";
import { importCrawlEntryOriginals, importCrawlGraphs } from "./crawl-graph-schema";
import { importCrawlRequests, importCrawlResponses, importCrawlSources } from "./crawl-schema";
import { crawlGraphMetadataSchema } from "./crawl-index";
import { crawlOriginalFactsSchema } from "./crawl-original";
import { markImportCrawlWriter } from "./crawl-writer";
import { assertReaderUploadWindow, bindReaderSources } from "./privacy";
import { commitImport } from "./service";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? { ...value as Record<string, unknown> } : {};
const contextSchema = z.object({ rootId: z.uuid(), childId: z.uuid(), graphId: z.uuid(), generation: z.uuid(), planDigest: z.string().regex(/^[a-f0-9]{64}$/), leaseToken: z.uuid(), startOrdinal: z.number().int().nonnegative(), endOrdinal: z.number().int().positive(), kind: z.enum(["content", "media", "navigation"]), operation: z.literal("imports.commit") });
type Claim = CrawlBatchReadClaim & { context: ImportBatchContext; prepared: boolean; accepted: boolean };
async function locked(id: string, ctx: ServiceContext) {
  await assertCurrentImportAuthority(ctx, "imports.commit");
  await lockContactIdentityForRead(ctx.tx); await markImportCrawlWriter(ctx.tx);
  const [root] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, id)).limit(1).for("update");
  const [source] = await ctx.tx.select().from(importCrawlSources).where(eq(importCrawlSources.runId, id)).limit(1).for("update");
  const [graph] = await ctx.tx.select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, id)).limit(1).for("update");
  const checkpoint = object(root?.checkpoint), pointer = object(checkpoint.sourceCrawl), graphPointer = object(checkpoint.sourceGraph);
  if (!root || root.status !== "previewed" || !source || source.state !== "sealed" || !source.sourceRevision || !source.siteUrl || source.expiresAt.getTime() <= Date.now() || !graph || graph.state !== "indexed" || graph.generation !== source.generation || graph.sourceRevision !== source.sourceRevision || pointer.id !== source.id || pointer.generation !== source.generation || pointer.revision !== source.sourceRevision || graphPointer.id !== graph.id || graphPointer.generation !== graph.generation) throw new ServiceError("conflict", "The bounded commit lost its actual original HTTP source.");
  const [binding] = await ctx.tx.select().from(importCrawlGraphs).where(eq(importCrawlGraphs.graphId, graph.id)).limit(1).for("update");
  if (!binding || binding.sourceId !== source.id || binding.sourceGeneration !== source.generation || binding.sourceRevision !== source.sourceRevision || binding.requestOrdinal !== source.requestCounter) throw new ServiceError("conflict", "The bounded commit needs its complete normalized HTTP frontier.");
  return { root, source, graph };
}

export const claimCrawlGraphCommit = defineService({
  name: "imports.claimCrawlGraphCommit", orchestratedBy: "imports.commit", external: false,
  summary: "Claim one actual response-bounded content or shared-file batch.", kind: "mutation", permission: "scoped",
  auditInputFields: ["id", "observed"], input: z.object({ id: z.uuid(), observed: importGraphVersionSchema }), output: z.custom<Claim>(),
  handler: async (input, ctx) => {
    const { root, source, graph } = await locked(input.id, ctx);
    if (input.observed.generation !== graph.generation || input.observed.sourceRevision !== graph.sourceRevision || input.observed.planRevision !== graph.planRevision || !graph.planMetadata) throw new ServiceError("conflict", "Review the current complete HTTP source and file plan before continuing.");
    if (graph.leaseUntil && graph.leaseUntil.getTime() > Date.now()) throw new ServiceError("conflict", "Another original HTTP commit phase is still running.");
    const catalog = graphCatalogSchema.parse(graph.planMetadata), allMedia = await graphMediaPlans(ctx.tx, graph.id);
    let planDigest = graph.planDigest;
    if (!planDigest) {
      const plan = await ctx.tx.select({ ordinal: importSourceEntries.ordinal, identity: importSourceEntries.sourceIdentity, kind: importSourceEntries.kind, digest: importSourceEntries.digest, target: importSourceEntries.targetSlug, resolution: importSourceEntries.resolution }).from(importSourceEntries).where(eq(importSourceEntries.graphId, graph.id)).orderBy(asc(importSourceEntries.ordinal));
      planDigest = archivePreviewDigest({ source: graph.sourceRevision, header: graph.headerMetadata, parser: graph.parserVersion, entries: plan, catalog, media: allMedia });
      await ctx.tx.update(importSourceGraphs).set({ planDigest }).where(eq(importSourceGraphs.id, graph.id));
    }
    let [batch] = await ctx.tx.select().from(importSourceBatches).where(and(eq(importSourceBatches.graphId, graph.id), eq(importSourceBatches.batchIndex, graph.batchCounter))).limit(1);
    const [pendingMedia] = await ctx.tx.select({ key: importSourceMedia.key }).from(importSourceMedia).where(and(eq(importSourceMedia.graphId, graph.id), isNull(importSourceMedia.assetId))).orderBy(asc(importSourceMedia.key)).limit(1);
    const rows = await ctx.tx.select({ entry: importSourceEntries, original: importCrawlEntryOriginals, request: importCrawlRequests, response: importCrawlResponses }).from(importSourceEntries)
      .innerJoin(importCrawlEntryOriginals, eq(importCrawlEntryOriginals.entryId, importSourceEntries.id))
      .innerJoin(importCrawlRequests, eq(importCrawlEntryOriginals.requestId, importCrawlRequests.id))
      .innerJoin(importCrawlResponses, eq(importCrawlEntryOriginals.responseId, importCrawlResponses.id))
      .where(and(eq(importSourceEntries.graphId, graph.id), gte(importSourceEntries.ordinal, graph.commitOrdinal), inArray(importSourceEntries.kind, ["page", "post"])))
      .orderBy(asc(importSourceEntries.ordinal)).limit(500);
    const kind = batch?.kind ?? (pendingMedia ? "media" : "content"), mediaKey = batch?.mediaKey ?? pendingMedia?.key ?? null;
    if (kind === "navigation") throw new ServiceError("conflict", "This HTTP source has no captured navigation batch.");
    const entries: CrawlBatchReadClaim["entries"] = [], originals = new Map<string, CrawlBatchOriginal>();
    let physicalBytes = 0, contentBytes = 0;
    if (kind === "content") for (const row of rows) {
      const metadata = crawlGraphMetadataSchema.parse(row.entry.metadata), facts = crawlOriginalFactsSchema.parse(row.response.facts);
      if (row.original.graphId !== graph.id || row.request.sourceId !== source.id || row.request.acceptedResponseId !== row.response.id || row.response.requestId !== row.request.id || row.response.state !== "stored" || row.response.retiredAt || row.request.state !== "accepted" || !["html", "rest-pages", "rest-posts"].includes(row.request.role) || !row.request.url || metadata.original.responseId !== row.response.id || metadata.original.requestId !== row.request.id || metadata.original.sourceId !== source.id || metadata.original.generation !== source.generation || metadata.original.digest !== facts.digest || metadata.original.bytes !== facts.bytes) throw new ServiceError("conflict", "A content batch lost its actual accepted response witness.");
      const cost = originals.has(row.response.id) ? 0 : facts.bytes;
      if (physicalBytes + cost > 20 * 1024 * 1024 || contentBytes + row.entry.bodyBytes > 20 * 1024 * 1024) break;
      physicalBytes += cost; contentBytes += row.entry.bodyBytes; entries.push(row.entry);
      if (!originals.has(row.response.id)) originals.set(row.response.id, { descriptor: crawlBodyDescriptorSchema.parse({ runId: root.id, sourceId: source.id, generation: source.generation, responseId: row.response.id, digest: facts.digest, bytes: facts.bytes }), requestId: row.request.id, requestOrdinal: row.request.ordinal, role: row.request.role as CrawlBatchOriginal["role"], requestedUrl: row.request.url, entryMetadata: row.request.entryMetadata });
    }
    if (kind === "content" && rows.length && !entries.length) throw new ServiceError("validation", "The next actual HTTP response exceeds one bounded content phase.");
    // An entirely skipped source still has a real empty child receipt. It
    // uses a positive ledger interval without inventing an original entry.
    const startOrdinal = kind === "content" ? graph.commitOrdinal : 0, endOrdinal = kind === "content" ? entries.at(-1)?.ordinal !== undefined ? entries.at(-1)!.ordinal + 1 : graph.commitOrdinal + 1 : 1;
    let child: typeof importRuns.$inferSelect | undefined;
    if (batch) [child] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, batch.childRunId)).limit(1).for("update");
    if (batch && (!child || batch.startOrdinal !== startOrdinal || batch.endOrdinal !== endOrdinal || batch.kind !== kind || batch.mediaKey !== mediaKey)) throw new ServiceError("conflict", "The original bounded HTTP receipt no longer matches its claimed range.");
    if (!child) {
      [child] = await ctx.tx.insert(importRuns).values({ source: root.source, origin: root.origin, kind: root.kind, status: "discover", createdBy: actorString(ctx.actor) }).returning();
      if (!child) throw new ServiceError("internal", "The actual bounded child receipt could not be reserved.");
      [batch] = await ctx.tx.insert(importSourceBatches).values({ graphId: graph.id, batchIndex: graph.batchCounter, childRunId: child.id, startOrdinal, endOrdinal, kind, mediaKey }).returning();
    }
    if (!batch || !child || !["discover", "previewed", "committed"].includes(child.status)) throw new ServiceError("conflict", "The original bounded HTTP receipt needs recovery.");
    const leaseToken = randomUUID();
    const context: ImportBatchContext = { rootId: root.id, childId: child.id, graphId: graph.id, generation: graph.generation, planDigest, leaseToken, startOrdinal: batch.startOrdinal, endOrdinal: batch.endOrdinal, kind, operation: "imports.commit" };
    const conflicts = entries.flatMap(entry => {
      const row = rows.find(row => row.entry.id === entry.id)?.entry;
      return row?.resolution && row.resolution !== "rename" ? [{ slug: row.targetSlug!, resolution: row.resolution }] : [];
    });
    await ctx.tx.update(importRuns).set({ checkpoint: { ...object(child.checkpoint), sourceGraphBatch: context }, ...(child.status === "discover" ? { conflicts } : {}) }).where(eq(importRuns.id, child.id));
    await ctx.tx.update(importSourceGraphs).set({ leaseToken, leaseActor: await importLeaseOwner(ctx), leaseUntil: new Date(Date.now() + 120_000), updatedAt: new Date() }).where(eq(importSourceGraphs.id, graph.id));
    ctx.setSubject("import_run", root.id);
    return { context, kind, sourceKind: source.kind, origin: source.siteUrl!, catalog, media: kind === "media" ? allMedia.filter(item => item.key === mediaKey) : allMedia, entries, originals: [...originals.values()], prepared: child.status !== "discover", accepted: child.status === "committed" };
  },
});

export const stageCrawlGraphBatch = defineService({
  name: "imports.stageCrawlGraphBatch", orchestratedBy: "imports.commit", external: false,
  summary: "Stage only the actual response-verified bounded HTTP child preview.", kind: "mutation", permission: "scoped",
  auditInputFields: ["id", "childId"], input: z.object({ id: z.uuid(), childId: z.uuid(), context: contextSchema, preview: z.record(z.string(), z.unknown()), counts: z.record(z.string(), z.number()) }), output: z.object({ ok: z.literal(true) }),
  handler: async (input, ctx) => {
    const { root, graph } = await locked(input.id, ctx);
    const [child] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.childId)).limit(1).for("update");
    if (!child || child.status !== "discover" || graph.id !== input.context.graphId || graph.generation !== input.context.generation || graph.planDigest !== input.context.planDigest || graph.leaseToken !== input.context.leaseToken || graph.leaseActor !== await importLeaseOwner(ctx) || !graph.leaseUntil || graph.leaseUntil.getTime() <= Date.now() || input.context.childId !== child.id || input.context.rootId !== root.id || JSON.stringify(contextSchema.parse(object(child.checkpoint).sourceGraphBatch)) !== JSON.stringify(input.context)) throw new ServiceError("conflict", "The verified HTTP child lost its exact caller, frozen plan or lease.");
    await assertReaderUploadWindow(ctx.tx, input.preview, graph.sourceStartedAt);
    const preview = await bindReaderSources(ctx.tx, input.preview, root, ctx.actor);
    await ctx.tx.update(importRuns).set({ status: "previewed", preview, counts: input.counts }).where(eq(importRuns.id, child.id));
    ctx.setSubject("import_run", root.id);
    return { ok: true as const };
  },
});

export async function advanceCrawlGraphCommit(id: string, observed: ImportGraphVersion, actor: Actor) {
  const claim = await claimCrawlGraphCommit.call({ id, observed }, actor);
  if (!claim.prepared) {
    const staged = await prepareCrawlGraphBatch(claim);
    await stageCrawlGraphBatch.call({ id, childId: claim.context.childId, context: claim.context, ...staged }, actor);
  }
  if (!claim.accepted) await withinImportBatch(claim.context, () => commitImport.call({ id: claim.context.childId }, actor));
  return acceptGraphBatch.call({ id, context: contextSchema.parse(claim.context) }, actor);
}

export default [claimCrawlGraphCommit, stageCrawlGraphBatch];
