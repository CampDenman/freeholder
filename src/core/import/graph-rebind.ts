// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: restore identical source bytes without restarting accepted batches.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { importRuns, importSourceGraphs } from "@/core/plugins/schema";
import { actorString, defineService, ServiceError, type ServiceContext } from "@/core/service";
import { assertCurrentImportAuthority } from "./authority";
import { importGraphVersionSchema, type ImportGraphVersion } from "./graph-version";
import { markImportGraphWriter } from "./graph-writer";
import { makeRetainedImportSource, retainedImportSourceSchema, retainedSourceChunkKey, retainedSourceFromRun } from "./retained-source";

type Run = typeof importRuns.$inferSelect;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? { ...value as Record<string, unknown> } : {};
const bindingSchema = z.object({ generation: z.uuid(), sourceRevision: z.string().regex(/^[a-f0-9]{64}$/), nextChunk: z.number().int().min(0).max(24) });
const uploadSchema = z.object({ uploadId: z.uuid(), filename: z.string(), bytes: z.number().int().positive(), chunkBytes: z.number().int().positive(), digests: z.record(z.string(), z.string()), received: z.array(z.number().int().nonnegative()), expiresAt: z.iso.datetime() });

/** The caller already holds the root row, before acquiring its graph row. */
export async function beginGraphSourceRebind(ctx: ServiceContext, run: Run, observed: ImportGraphVersion | undefined, bytes: number) {
  await assertCurrentImportAuthority(ctx, "imports.beginSourceUpload");
  const [graph] = await ctx.tx.select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, run.id)).limit(1).for("update");
  const retained = retainedSourceFromRun(run);
  if (!graph || !retained || !["discover", "previewed"].includes(run.status) || !["indexing", "indexed"].includes(graph.state) || retained.revision !== graph.sourceRevision) throw new ServiceError("conflict", "This source graph is no longer resumable.");
  if (!observed || observed.generation !== graph.generation || observed.sourceRevision !== graph.sourceRevision || observed.planRevision !== graph.planRevision) throw new ServiceError("conflict", "Review the current source graph before restoring its source file.");
  if (graph.leaseUntil && graph.leaseUntil.getTime() > Date.now()) throw new ServiceError("conflict", "Another source phase is still running. Retry after it completes.");
  if (bytes !== retained.bytes) throw new ServiceError("conflict", "Use the original source file to resume this import. A changed source needs a new run.");
  return bindingSchema.parse({ generation: graph.generation, sourceRevision: graph.sourceRevision, nextChunk: 0 });
}

const claim = defineService({
  name: "imports.claimSourceRebind", orchestratedBy: "imports.previewFromUpload",
  summary: "Reserve verification of one chunk of the original source replacement.",
  kind: "mutation", permission: "scoped", external: false, auditInputFields: ["id", "uploadId"],
  input: z.object({ id: z.uuid(), uploadId: z.uuid() }),
  output: z.object({ source: retainedImportSourceSchema, generation: z.uuid(), leaseToken: z.uuid(), index: z.number().int().nonnegative().max(24) }),
  handler: async (input, ctx) => {
    await assertCurrentImportAuthority(ctx, "imports.previewFromUpload");
    await lockContactIdentityForRead(ctx.tx);
    await markImportGraphWriter(ctx.tx);
    const [run] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1).for("update");
    const [graph] = await ctx.tx.select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, input.id)).limit(1).for("update");
    const checkpoint = object(run?.checkpoint), binding = bindingSchema.safeParse(checkpoint.sourceGraphRebind), upload = uploadSchema.safeParse(checkpoint.sourceUpload);
    const retained = run && retainedSourceFromRun(run);
    if (!run || !["discover", "previewed"].includes(run.status) || !graph || !["indexing", "indexed"].includes(graph.state) || !retained || retained.revision !== graph.sourceRevision || !binding.success || binding.data.generation !== graph.generation || binding.data.sourceRevision !== graph.sourceRevision || !upload.success || upload.data.uploadId !== input.uploadId || Date.parse(upload.data.expiresAt) <= Date.now() || upload.data.received.length !== Math.ceil(upload.data.bytes / upload.data.chunkBytes) || upload.data.received.some((index, at) => index !== at)) throw new ServiceError("conflict", "The original source replacement is no longer available.");
    const source = makeRetainedImportSource(run.id, upload.data);
    if (source.revision !== graph.sourceRevision) throw new ServiceError("conflict", "Use the original source file to resume this import. A changed source needs a new run.");
    if (binding.data.nextChunk >= source.chunkDigests.length) throw new ServiceError("conflict", "This source replacement was already verified.");
    if (graph.leaseUntil && graph.leaseUntil.getTime() > Date.now()) throw new ServiceError("conflict", "Another source phase is still running. Retry after it completes.");
    const leaseToken = randomUUID();
    await ctx.tx.update(importSourceGraphs).set({ leaseToken, leaseActor: actorString(ctx.actor), leaseUntil: new Date(Date.now() + 120_000), updatedAt: new Date() }).where(eq(importSourceGraphs.id, graph.id));
    ctx.setSubject("import_run", run.id);
    return { source, generation: graph.generation, leaseToken, index: binding.data.nextChunk };
  },
});

const accept = defineService({
  name: "imports.acceptSourceRebindChunk", orchestratedBy: "imports.previewFromUpload",
  summary: "Accept one verified source chunk, retaining the original graph and plan.",
  kind: "mutation", permission: "scoped", external: false, auditInputFields: ["id", "index"],
  input: z.object({ id: z.uuid(), source: retainedImportSourceSchema, generation: z.uuid(), leaseToken: z.uuid(), index: z.number().int().nonnegative().max(24) }),
  output: z.object({ id: z.uuid(), status: z.string(), error: z.null(), counts: z.unknown(), graph: importGraphVersionSchema, sourceRestored: z.boolean() }),
  handler: async (input, ctx) => {
    await assertCurrentImportAuthority(ctx, "imports.previewFromUpload");
    await lockContactIdentityForRead(ctx.tx);
    await markImportGraphWriter(ctx.tx);
    const [run] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1).for("update");
    const [graph] = await ctx.tx.select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, input.id)).limit(1).for("update");
    const checkpoint = object(run?.checkpoint), binding = bindingSchema.safeParse(checkpoint.sourceGraphRebind), upload = uploadSchema.safeParse(checkpoint.sourceUpload);
    const previous = run && retainedSourceFromRun(run);
    if (!run || !["discover", "previewed"].includes(run.status) || !graph || !["indexing", "indexed"].includes(graph.state) || !previous || !binding.success || binding.data.nextChunk !== input.index || binding.data.generation !== input.generation || graph.generation !== input.generation || graph.sourceRevision !== input.source.revision || graph.leaseToken !== input.leaseToken || graph.leaseActor !== actorString(ctx.actor) || !graph.leaseUntil || graph.leaseUntil.getTime() <= Date.now() || !upload.success || upload.data.uploadId !== input.source.uploadId || Date.parse(upload.data.expiresAt) <= Date.now() || JSON.stringify(makeRetainedImportSource(run.id, upload.data)) !== JSON.stringify(input.source)) throw new ServiceError("conflict", "This source verification lost its original upload or lease.");
    const sourceRestored = input.index + 1 === input.source.chunkDigests.length;
    if (sourceRestored) {
      checkpoint.retainedSource = input.source;
      delete checkpoint.sourceGraphRebind;
      if (graph.state === "indexed") delete checkpoint.sourceUpload;
      if (previous.uploadId !== input.source.uploadId) await ctx.queueJob("core.deleteCaptureObjects", { keys: previous.chunkDigests.map((_, index) => retainedSourceChunkKey(previous, index)) });
    } else checkpoint.sourceGraphRebind = { ...binding.data, nextChunk: input.index + 1 };
    await ctx.tx.update(importRuns).set({ checkpoint, error: null }).where(eq(importRuns.id, run.id));
    await ctx.tx.update(importSourceGraphs).set({ leaseToken: null, leaseActor: null, leaseUntil: null, updatedAt: new Date() }).where(eq(importSourceGraphs.id, graph.id));
    ctx.setSubject("import_run", run.id);
    return { id: run.id, status: run.status, error: null, counts: run.counts, graph: importGraphVersionSchema.parse(graph), sourceRestored };
  },
});

export { claim as claimSourceRebind, accept as acceptSourceRebindChunk };
export default [claim, accept];
