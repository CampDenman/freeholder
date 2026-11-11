// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: source indexing commits one bounded, parent-authorized phase at a time.
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { importRuns, importSourceEntries, importSourceGraphs } from "@/core/plugins/schema";
import { actorString, defineService, ServiceError } from "@/core/service";
import { makeRetainedImportSource, retainedImportSourceSchema, retainedSourceFromRun } from "./retained-source";
import { assertSourceStageable } from "./source-lifecycle";
import { wxrIndexCursorSchema, wxrIndexedEntrySchema } from "./wxr-index";
import { assertCurrentImportAuthority } from "./authority";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? { ...value as Record<string, unknown> } : {};
const uploadSchema = z.object({ uploadId: z.uuid(), filename: z.string(), bytes: z.number().int().positive(), chunkBytes: z.number().int().positive(), digests: z.record(z.string(), z.string()), received: z.array(z.number().int().nonnegative()), expiresAt: z.iso.datetime() });
const bindingSchema = z.object({ id: z.uuid(), generation: z.uuid(), sourceRevision: z.string().regex(/^[a-f0-9]{64}$/) });
const reply = z.object({ id: z.uuid(), status: z.string(), error: z.string().nullable(), counts: z.unknown() });

export const claimWxrGraph = defineService({
  name: "imports.claimSourceGraph", orchestratedBy: "imports.previewFromUpload",
  summary: "Claim one bounded source-index phase under the current import caller.",
  kind: "mutation", permission: "scoped", external: false,
  auditInputFields: ["id", "uploadId", "initialize"],
  input: z.object({ id: z.uuid(), uploadId: z.uuid(), initialize: z.boolean().default(false) }),
  output: z.object({ graphId: z.uuid(), generation: z.uuid(), leaseToken: z.uuid().nullable(), cursor: wxrIndexCursorSchema, source: retainedImportSourceSchema, initialized: z.boolean() }),
  handler: async (input, ctx) => {
    await assertCurrentImportAuthority(ctx, "imports.previewFromUpload");
    await lockContactIdentityForRead(ctx.tx);
    const [run] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1).for("update");
    if (!run || run.kind !== "wordpress-wxr") throw new ServiceError("not_found", "No such WordPress import.");
    const checkpoint = object(run.checkpoint), upload = uploadSchema.safeParse(checkpoint.sourceUpload);
    if (!upload.success || upload.data.uploadId !== input.uploadId || upload.data.received.length !== Math.ceil(upload.data.bytes / upload.data.chunkBytes) || upload.data.received.some((index, at) => index !== at) || Date.parse(upload.data.expiresAt) <= Date.now()) throw new ServiceError("conflict", "The complete immutable source upload is no longer available.");
    const source = makeRetainedImportSource(run.id, upload.data);
    const binding = bindingSchema.safeParse(checkpoint.sourceGraph);
    let [graph] = await ctx.tx.select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, run.id)).limit(1).for("update");
    if (!graph) {
      if (!input.initialize) throw new ServiceError("conflict", "This import has no resumable source graph.");
      assertSourceStageable(run, true);
      const generation = randomUUID(), cursor = wxrIndexCursorSchema.parse({ nextByte: 0, ordinal: 0, bodyBytes: 0, metadataBytes: 0, header: null });
      [graph] = await ctx.tx.insert(importSourceGraphs).values({ runId: run.id, generation, sourceRevision: source.revision, cursor }).returning();
      if (!graph) throw new ServiceError("internal", "The import source graph could not be reserved.");
      checkpoint.retainedSource = source;
      checkpoint.sourceGraph = { id: graph.id, generation, sourceRevision: source.revision };
      await ctx.tx.update(importRuns).set({ status: "discover", error: null, preview: {}, checkpoint, counts: { indexed: 0 } }).where(eq(importRuns.id, run.id));
      ctx.setSubject("import_run", run.id);
      return { graphId: graph.id, generation, leaseToken: null, cursor, source, initialized: true };
    }
    const retained = retainedSourceFromRun(run);
    if (run.status !== "discover" || graph.state !== "indexing" || !binding.success || binding.data.id !== graph.id || binding.data.generation !== graph.generation || binding.data.sourceRevision !== graph.sourceRevision || retained?.uploadId !== source.uploadId || retained.revision !== source.revision || graph.sourceRevision !== source.revision) throw new ServiceError("conflict", "This import source graph was completed, replaced or invalidated.");
    if (graph.leaseUntil && graph.leaseUntil.getTime() > Date.now()) throw new ServiceError("conflict", "Another source phase is still running. Retry after it completes.");
    const leaseToken = randomUUID();
    await ctx.tx.update(importSourceGraphs).set({ leaseToken, leaseActor: actorString(ctx.actor), leaseUntil: new Date(Date.now() + 120_000), updatedAt: new Date() }).where(eq(importSourceGraphs.id, graph.id));
    ctx.setSubject("import_run", run.id);
    return { graphId: graph.id, generation: graph.generation, leaseToken, cursor: wxrIndexCursorSchema.parse(graph.cursor), source, initialized: false };
  },
});

export const applyWxrIndex = defineService({
  name: "imports.applySourceGraphIndex", orchestratedBy: "imports.previewFromUpload",
  summary: "Atomically accept a verified source-index phase and release its exact lease.",
  kind: "mutation", permission: "scoped", external: false, auditInputFields: ["id", "graphId", "done"],
  input: z.object({ id: z.uuid(), graphId: z.uuid(), generation: z.uuid(), leaseToken: z.uuid(), source: retainedImportSourceSchema, previous: wxrIndexCursorSchema, cursor: wxrIndexCursorSchema, entries: wxrIndexedEntrySchema.array().max(500), done: z.boolean() }),
  output: reply,
  handler: async (input, ctx) => {
    await assertCurrentImportAuthority(ctx, "imports.previewFromUpload");
    await lockContactIdentityForRead(ctx.tx);
    const [run] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1).for("update");
    const [graph] = await ctx.tx.select().from(importSourceGraphs).where(and(eq(importSourceGraphs.id, input.graphId), eq(importSourceGraphs.runId, input.id))).limit(1).for("update");
    const retained = run && retainedSourceFromRun(run), binding = bindingSchema.safeParse(object(run?.checkpoint).sourceGraph);
    if (!run || run.status !== "discover" || !graph || graph.state !== "indexing" || graph.generation !== input.generation || graph.leaseToken !== input.leaseToken || graph.leaseActor !== actorString(ctx.actor) || !graph.leaseUntil || graph.leaseUntil.getTime() <= Date.now() || !binding.success || binding.data.id !== graph.id || binding.data.generation !== graph.generation || retained?.uploadId !== input.source.uploadId || retained.revision !== input.source.revision || retained.expiresAt !== input.source.expiresAt || Date.parse(retained.expiresAt) <= Date.now() || graph.sourceRevision !== input.source.revision || JSON.stringify(wxrIndexCursorSchema.parse(graph.cursor)) !== JSON.stringify(input.previous)) throw new ServiceError("conflict", "This source phase lost its original source, caller or lease. Reload before retrying.");
    let next = input.previous.ordinal, end = input.previous.nextByte;
    let bodyBytes = input.previous.bodyBytes, metadataBytes = input.previous.metadataBytes;
    for (const entry of input.entries) {
      if (entry.ordinal !== next || entry.start < end || entry.end <= entry.start || entry.end > input.source.bytes) throw new ServiceError("conflict", "The indexed source ranges are not consecutive original entries.");
      next++; end = entry.end; bodyBytes += entry.bodyBytes; metadataBytes += Buffer.byteLength(JSON.stringify(entry.metadata));
    }
    if (input.cursor.ordinal !== next || input.cursor.bodyBytes !== bodyBytes || input.cursor.metadataBytes !== metadataBytes || input.cursor.nextByte !== (input.done ? input.source.bytes : end) || (!input.done && !input.entries.length) || (input.previous.header && JSON.stringify(input.previous.header) !== JSON.stringify(input.cursor.header))) throw new ServiceError("conflict", "The indexed source cursor does not match the bounded phase.");
    const seen = new Set(input.entries.map(entry => entry.identity));
    if (seen.size !== input.entries.length || (seen.size && (await ctx.tx.select({ id: importSourceEntries.id }).from(importSourceEntries).where(and(eq(importSourceEntries.graphId, graph.id), inArray(importSourceEntries.sourceIdentity, [...seen]))).limit(1)).length)) throw new ServiceError("validation", "The source repeats an entity identity. Review the export before importing it.");
    const usedTargets = new Set((await ctx.tx.select({ slug: importSourceEntries.targetSlug }).from(importSourceEntries).where(eq(importSourceEntries.graphId, graph.id))).flatMap(row => row.slug === null ? [] : [row.slug]));
    const rows = input.entries.map(entry => {
      let targetSlug = entry.metadata.targetSlug ?? null;
      if (targetSlug !== null) {
        const original = targetSlug;
        for (let suffix = 2; usedTargets.has(targetSlug); suffix++) targetSlug = `${original || "home"}-${suffix}`;
        if (targetSlug.length > 2_048) throw new ServiceError("validation", "The source target path exceeds the graph budget.");
        usedTargets.add(targetSlug);
      }
      return { graphId: graph.id, ordinal: entry.ordinal, sourceIdentity: entry.identity, kind: entry.kind, startByte: entry.start, endByte: entry.end, digest: entry.digest, metadata: entry.metadata, bodyBytes: entry.bodyBytes, targetSlug };
    });
    if (rows.length) await ctx.tx.insert(importSourceEntries).values(rows);
    await ctx.tx.update(importSourceGraphs).set({ cursor: input.cursor, state: input.done ? "indexed" : "indexing", leaseToken: null, leaseActor: null, leaseUntil: null, updatedAt: new Date() }).where(eq(importSourceGraphs.id, graph.id));
    const counts = await ctx.tx.select({ kind: importSourceEntries.kind, total: sql<number>`count(*)::int` }).from(importSourceEntries).where(eq(importSourceEntries.graphId, graph.id)).groupBy(importSourceEntries.kind);
    const total = (kind: string) => counts.find(row => row.kind === kind)?.total ?? 0;
    const summary = { indexed: input.cursor.ordinal, pages: total("page"), posts: total("post"), media: total("attachment"), menus: total("menu"), skipped: total("skipped") };
    const checkpoint = object(run.checkpoint);
    // The upload reservation remains until the whole graph is accepted. The
    // retained descriptor keeps the same original objects available later.
    if (input.done) delete checkpoint.sourceUpload;
    await ctx.tx.update(importRuns).set({ status: input.done ? "previewed" : "discover", error: null, counts: summary, checkpoint, preview: input.done ? { sourceFormat: "durable-wxr", graphId: graph.id, generation: graph.generation, sourceRevision: graph.sourceRevision, version: 1 } : {} }).where(eq(importRuns.id, run.id));
    ctx.setSubject("import_run", run.id);
    return { id: run.id, status: input.done ? "previewed" : "discover", error: null, counts: summary };
  },
});

export default [claimWxrGraph, applyWxrIndex];
