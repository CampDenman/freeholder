// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: a private bounded recovery ledger reuses the ordinary CMS pipeline.
import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { importRuns, importSourceBatches, importSourceEntries, importSourceGraphs } from "@/core/plugins/schema";
import { actorString, defineService, ServiceError, type Actor } from "@/core/service";
import { assertCurrentImportAuthority } from "./authority";
import { markImportGraphWriter } from "./graph-writer";
import { importGraphVersionSchema, type ImportGraphVersion } from "./graph-version";
import { withinImportBatch, type ImportBatchContext } from "./batch-context";
import { assertReaderUploadWindow, bindReaderSources, publicImportRun } from "./privacy";
import { readRetainedSourceChunk, releaseImportSources, retainedImportSourceSchema, retainedSourceFromRun } from "./retained-source";
import { importSourceRanges } from "./source-range";
import { bodyImageRefs, wordpressExportBuilder } from "./wordpress";
import { wxrIndexCursorSchema } from "./wxr-index";
import { commitImport, stageWordpressExport } from "./service";

type Run = typeof importRuns.$inferSelect;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? { ...value as Record<string, unknown> } : {};
const contextSchema = z.object({ rootId: z.uuid(), childId: z.uuid(), graphId: z.uuid(), generation: z.uuid(), planDigest: z.string().regex(/^[a-f0-9]{64}$/), leaseToken: z.uuid(), startOrdinal: z.number().int().nonnegative(), endOrdinal: z.number().int().positive(), operation: z.literal("imports.commit") });
const entrySchema = z.object({ id: z.uuid(), ordinal: z.number().int().nonnegative(), startByte: z.number().int().nonnegative(), endByte: z.number().int().positive(), digest: z.string(), metadata: z.unknown(), targetSlug: z.string().nullable() });
const claimSchema = z.object({ context: contextSchema, source: retainedImportSourceSchema, origin: z.string(), header: z.object({ start: z.literal(0), end: z.number().int().positive(), digest: z.string() }), entries: entrySchema.array().max(500), prepared: z.boolean(), accepted: z.boolean() });

const claimGraphCommit = defineService({
  name: "imports.claimGraphCommit", orchestratedBy: "imports.commit", summary: "Reserve one bounded graph batch before reading original source bytes.",
  kind: "mutation", permission: "scoped", external: false,
  input: z.object({ id: z.uuid(), observed: importGraphVersionSchema }), output: claimSchema,
  handler: async (input, ctx) => {
    await assertCurrentImportAuthority(ctx, "imports.commit");
    await lockContactIdentityForRead(ctx.tx);
    await markImportGraphWriter(ctx.tx);
    const [root] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1).for("update");
    const [graph] = await ctx.tx.select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, input.id)).limit(1).for("update");
    const source = root && retainedSourceFromRun(root), binding = object(object(root?.checkpoint).sourceGraph);
    if (object(root?.checkpoint).sourceGraphRebind) throw new ServiceError("conflict", "Finish restoring the original source file before continuing this import.");
    if (!root || root.status !== "previewed" || !graph || graph.state !== "indexed" || !source || source.revision !== graph.sourceRevision || binding.id !== graph.id || binding.generation !== graph.generation) throw new ServiceError("conflict", "The original indexed source is no longer available for this import.");
    if (input.observed.generation !== graph.generation || input.observed.sourceRevision !== graph.sourceRevision || input.observed.planRevision !== graph.planRevision) throw new ServiceError("conflict", "This source or its reviewed plan changed. Review the current import before continuing.");
    if (graph.leaseUntil && graph.leaseUntil.getTime() > Date.now()) throw new ServiceError("conflict", "Another import phase is still running. Retry after it completes.");
    const cursor = wxrIndexCursorSchema.parse(graph.cursor);
    if (!cursor.header) throw new ServiceError("conflict", "The source graph has no verified original header.");
    let planDigest = graph.planDigest;
    if (!planDigest) {
      const plan = await ctx.tx.select({ ordinal: importSourceEntries.ordinal, identity: importSourceEntries.sourceIdentity, kind: importSourceEntries.kind, digest: importSourceEntries.digest, target: importSourceEntries.targetSlug }).from(importSourceEntries).where(eq(importSourceEntries.graphId, graph.id)).orderBy(asc(importSourceEntries.ordinal));
      planDigest = createHash("sha256").update("freeholder.import.graph.plan.v1\0").update(JSON.stringify({ source: graph.sourceRevision, header: cursor.header.digest, parser: graph.parserVersion, entries: plan })).digest("hex");
      await ctx.tx.update(importSourceGraphs).set({ planDigest }).where(eq(importSourceGraphs.id, graph.id));
    }
    // This guard is temporary while the media/menu graph lane is completed;
    // accepting an incomplete plan would silently lose these entities.
    const [unsupported] = await ctx.tx.select({ id: importSourceEntries.id }).from(importSourceEntries).where(and(eq(importSourceEntries.graphId, graph.id), inArray(importSourceEntries.kind, ["attachment", "menu"]))).limit(1);
    if (unsupported) throw new ServiceError("conflict", "The durable media and menu phases are not complete yet.");
    const rows = await ctx.tx.select().from(importSourceEntries).where(and(eq(importSourceEntries.graphId, graph.id), gte(importSourceEntries.ordinal, graph.commitOrdinal), inArray(importSourceEntries.kind, ["page", "post"]))).orderBy(asc(importSourceEntries.ordinal)).limit(500);
    let bytes = 0;
    const entries: typeof rows = [];
    for (const row of rows) { if (bytes + row.bodyBytes > 20 * 1024 * 1024) break; bytes += row.bodyBytes; entries.push(row); }
    if (!entries.length) throw new ServiceError("validation", "This graph has no next bounded content batch.");
    const endOrdinal = entries.at(-1)!.ordinal + 1, leaseToken = randomUUID();
    let [batch] = await ctx.tx.select().from(importSourceBatches).where(and(eq(importSourceBatches.graphId, graph.id), eq(importSourceBatches.batchIndex, graph.batchCounter))).limit(1);
    let child: Run | undefined;
    if (batch) [child] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, batch.childRunId)).limit(1).for("update");
    if (batch && (!child || batch.startOrdinal !== graph.commitOrdinal || batch.endOrdinal !== endOrdinal)) throw new ServiceError("conflict", "The bounded batch no longer matches its original source range.");
    if (!child) {
      [child] = await ctx.tx.insert(importRuns).values({ source: root.source, origin: root.origin, kind: root.kind, status: "discover", createdBy: actorString(ctx.actor) }).returning();
      if (!child) throw new ServiceError("internal", "The bounded import ledger could not be reserved.");
      [batch] = await ctx.tx.insert(importSourceBatches).values({ graphId: graph.id, batchIndex: graph.batchCounter, childRunId: child.id, startOrdinal: graph.commitOrdinal, endOrdinal }).returning();
    }
    if (!batch) throw new ServiceError("internal", "The bounded import ledger is missing.");
    if (!['discover', 'previewed', 'committed'].includes(child.status)) throw new ServiceError("conflict", "This bounded batch has already changed state.");
    if (child.status !== "committed" && Date.parse(source.expiresAt) <= Date.now()) throw new ServiceError("conflict", "The retained source expired. Rebind the original source before continuing.");
    const context: ImportBatchContext = { rootId: root.id, childId: child.id, graphId: graph.id, generation: graph.generation, planDigest, leaseToken, startOrdinal: batch.startOrdinal, endOrdinal: batch.endOrdinal, operation: "imports.commit" };
    await ctx.tx.update(importRuns).set({ checkpoint: { ...object(child.checkpoint), sourceGraphBatch: context } }).where(eq(importRuns.id, child.id));
    await ctx.tx.update(importSourceGraphs).set({ leaseToken, leaseActor: actorString(ctx.actor), leaseUntil: new Date(Date.now() + 120_000), updatedAt: new Date() }).where(eq(importSourceGraphs.id, graph.id));
    ctx.setSubject("import_run", root.id);
    return { context: contextSchema.parse(context), source, origin: root.origin!, header: cursor.header, entries, prepared: child.status !== "discover", accepted: child.status === "committed" };
  },
});

const stageGraphBatch = defineService({
  name: "imports.stageGraphBatch", orchestratedBy: "imports.commit", summary: "Accept a bounded preview verified against original source entry digests.",
  kind: "mutation", permission: "scoped", external: false, auditInputFields: ["id", "childId"],
  input: z.object({ id: z.uuid(), childId: z.uuid(), context: contextSchema, source: retainedImportSourceSchema, preview: z.record(z.string(), z.unknown()), counts: z.record(z.string(), z.number()) }), output: z.object({ ok: z.literal(true) }),
  handler: async (input, ctx) => {
    await assertCurrentImportAuthority(ctx, "imports.commit");
    await lockContactIdentityForRead(ctx.tx);
    await markImportGraphWriter(ctx.tx);
    const [root] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1).for("update");
    const [graph] = await ctx.tx.select().from(importSourceGraphs).where(eq(importSourceGraphs.id, input.context.graphId)).limit(1).for("update");
    const [child] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.childId)).limit(1).for("update");
    const source = root && retainedSourceFromRun(root);
    if (!root || root.status !== "previewed" || !source || source.uploadId !== input.source.uploadId || source.revision !== input.source.revision || Date.parse(source.expiresAt) <= Date.now() || !graph || graph.state !== "indexed" || graph.runId !== root.id || graph.generation !== input.context.generation || graph.leaseToken !== input.context.leaseToken || graph.leaseActor !== actorString(ctx.actor) || !graph.leaseUntil || graph.leaseUntil.getTime() <= Date.now() || !child || child.status !== "discover" || object(child.checkpoint).sourceGraphBatch === undefined) throw new ServiceError("conflict", "The bounded preview lost its original source or lease.");
    if (graph.planDigest !== input.context.planDigest || JSON.stringify(contextSchema.parse(object(child.checkpoint).sourceGraphBatch)) !== JSON.stringify(input.context)) throw new ServiceError("conflict", "The bounded preview no longer matches its original frozen plan.");
    await assertReaderUploadWindow(ctx.tx, input.preview, graph.sourceStartedAt);
    await ctx.tx.update(importRuns).set({ status: "previewed", preview: await bindReaderSources(ctx.tx, input.preview), counts: input.counts }).where(eq(importRuns.id, child.id));
    ctx.setSubject("import_run", root.id);
    return { ok: true as const };
  },
});

const acceptGraphBatch = defineService({
  name: "imports.acceptGraphBatch", orchestratedBy: "imports.commit", summary: "Acknowledge the accepted CMS receipt and advance the graph exactly once.",
  kind: "mutation", permission: "scoped", external: false, auditInputFields: ["id"],
  input: z.object({ id: z.uuid(), context: contextSchema }), output: z.custom<Run>(),
  handler: async (input, ctx) => {
    await assertCurrentImportAuthority(ctx, "imports.commit");
    await lockContactIdentityForRead(ctx.tx);
    await markImportGraphWriter(ctx.tx);
    const [root] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1).for("update");
    const [graph] = await ctx.tx.select().from(importSourceGraphs).where(eq(importSourceGraphs.id, input.context.graphId)).limit(1).for("update");
    const [child] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.context.childId)).limit(1).for("update");
    if (!root || root.status !== "previewed" || !graph || graph.state !== "indexed" || graph.runId !== root.id || graph.generation !== input.context.generation || graph.planDigest !== input.context.planDigest || graph.leaseToken !== input.context.leaseToken || !graph.leaseUntil || graph.leaseUntil.getTime() <= Date.now() || graph.leaseActor !== actorString(ctx.actor) || !child || child.status !== "committed" || graph.commitOrdinal !== input.context.startOrdinal) throw new ServiceError("conflict", "The accepted bounded batch no longer matches this graph phase.");
    const [remaining] = await ctx.tx.select({ id: importSourceEntries.id }).from(importSourceEntries).where(and(eq(importSourceEntries.graphId, graph.id), gte(importSourceEntries.ordinal, input.context.endOrdinal), inArray(importSourceEntries.kind, ["page", "post"]))).limit(1);
    await ctx.tx.update(importSourceGraphs).set({ commitOrdinal: input.context.endOrdinal, batchCounter: graph.batchCounter + 1, leaseToken: null, leaseActor: null, leaseUntil: null, updatedAt: new Date() }).where(eq(importSourceGraphs.id, graph.id));
    const accepted = await ctx.tx.select({ counts: importRuns.counts }).from(importSourceBatches).innerJoin(importRuns, eq(importSourceBatches.childRunId, importRuns.id)).where(and(eq(importSourceBatches.graphId, graph.id), eq(importRuns.status, "committed")));
    const counts: Record<string, unknown> = { ...object(root.counts), sourcePages: object(root.counts).sourcePages ?? object(root.counts).pages };
    for (const key of ["pages", "posts", "media", "redirects", "mediaFailed"]) counts[key] = accepted.reduce((total, row) => total + Number(object(row.counts)[key] ?? 0), 0);
    const checkpoint = object(root.checkpoint);
    if (!remaining) await releaseImportSources(ctx, root, checkpoint);
    const [row] = await ctx.tx.update(importRuns).set({ status: remaining ? "previewed" : "committed", error: null, counts, checkpoint }).where(eq(importRuns.id, root.id)).returning();
    ctx.setSubject("import_run", root.id);
    return publicImportRun(row!);
  },
});

export async function advanceGraphCommit(id: string, observed: ImportGraphVersion, actor: Actor): Promise<Run> {
  const claim = await claimGraphCommit.call({ id, observed }, actor);
  if (!claim.prepared) {
    const ranges = importSourceRanges(claim.source, index => readRetainedSourceChunk(claim.source, index));
    const header = await ranges.readRange(0, claim.header.end);
    if (createHash("sha256").update(header).digest("hex") !== claim.header.digest) throw new ServiceError("conflict", "The original source header changed.");
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }), builder = wordpressExportBuilder();
    builder.readHead(decoder.decode(header));
    for (const entry of claim.entries) {
      const bytes = await ranges.readRange(entry.startByte, entry.endByte);
      if (createHash("sha256").update(bytes).digest("hex") !== entry.digest) throw new ServiceError("conflict", "The original source entry changed.");
      builder.readItem(decoder.decode(bytes));
    }
    const exported = builder.finish();
    if (exported.items.some(item => bodyImageRefs(item.body).length)) throw new ServiceError("conflict", "The durable media phase is not complete yet.");
    const staged = stageWordpressExport(exported, claim.origin), pages = staged.preview.pages as Array<Record<string, unknown>>;
    const byWpId = new Map(claim.entries.flatMap(entry => typeof object(entry.metadata).wpId === "string" ? [[String(object(entry.metadata).wpId), entry] as const] : []));
    const byUrl = new Map(claim.entries.map(entry => [String(object(entry.metadata).url), entry]));
    for (const page of pages) {
      const entry = typeof page.wpId === "string" ? byWpId.get(page.wpId) : byUrl.get(String(page.url));
      if (!entry || entry.targetSlug === null) throw new ServiceError("conflict", "The bounded preview lost its global source mapping.");
      page.slug = entry.targetSlug;
    }
    await stageGraphBatch.call({ id, childId: claim.context.childId, context: claim.context, source: claim.source, ...staged }, actor);
  }
  if (!claim.accepted) await withinImportBatch(claim.context, () => commitImport.call({ id: claim.context.childId }, actor));
  return acceptGraphBatch.call({ id, context: claim.context }, actor);
}

export default [claimGraphCommit, stageGraphBatch, acceptGraphBatch];
