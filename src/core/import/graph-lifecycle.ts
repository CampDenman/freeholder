// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: reconcile, publish and reverse one owned bounded batch per mutation.
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { importRuns, importSourceBatches, importSourceGraphs } from "@/core/plugins/schema";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { actorString, ServiceError, type ServiceContext } from "@/core/service";
import { assertCurrentImportAuthority } from "./authority";
import { markImportGraphWriter } from "./graph-writer";
import type { ImportGraphVersion } from "./graph-version";
import { withinImportBatch, type ImportBatchContext } from "./batch-context";
import { publicImportRun } from "./privacy";
import { releaseImportSources } from "./retained-source";
import { publishImport, reconcileImport, rollbackImport } from "./service";

type Run = typeof importRuns.$inferSelect;
type Operation = "imports.reconcile" | "imports.publish" | "imports.rollback";
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? { ...value as Record<string, unknown> } : {};

export async function advanceGraphLifecycle(ctx: ServiceContext, before: Run, operation: Operation, observed?: ImportGraphVersion): Promise<Run> {
  await assertCurrentImportAuthority(ctx, operation);
  await lockContactIdentityForRead(ctx.tx);
  await markImportGraphWriter(ctx.tx);
  const [graph] = await ctx.tx.select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, before.id)).limit(1).for("update");
  const binding = object(object(before.checkpoint).sourceGraph);
  if (!graph || binding.id !== graph.id || binding.generation !== graph.generation) throw new ServiceError("conflict", "The original import graph is no longer available.");
  const target = operation === "imports.rollback" ? "rolled_back" : operation === "imports.publish" ? "published" : "reconciled";
  if (before.status === target) return publicImportRun(before);
  if (!observed || observed.generation !== graph.generation || observed.sourceRevision !== graph.sourceRevision || observed.planRevision !== graph.planRevision) throw new ServiceError("conflict", "This source or its reviewed plan changed. Review the current import in a current client before continuing.");
  if (operation !== "imports.rollback" && (graph.state !== "indexed" || before.status !== (operation === "imports.publish" ? "reconciled" : "committed"))) throw new ServiceError("conflict", "Finish the previous graph phase before continuing.");
  if (operation !== "imports.rollback" && graph.leaseUntil && graph.leaseUntil.getTime() > Date.now()) throw new ServiceError("conflict", "Another graph phase is still running. Retry after it completes.");
  if (operation === "imports.publish" && object(object(before.checkpoint).reconciliation).matches !== true) throw new ServiceError("conflict", "The reconciled graph does not match its accepted records. Review it before publishing.");
  const leaseToken = randomUUID();
  await ctx.tx.update(importSourceGraphs).set({ ...(operation === "imports.rollback" ? { state: "invalidated" as const } : {}), leaseToken, leaseActor: actorString(ctx.actor), leaseUntil: new Date(Date.now() + 120_000), updatedAt: new Date() }).where(eq(importSourceGraphs.id, graph.id));
  const [next] = await ctx.tx.select({ batch: importSourceBatches, run: importRuns }).from(importSourceBatches).innerJoin(importRuns, eq(importRuns.id, importSourceBatches.childRunId)).where(and(eq(importSourceBatches.graphId, graph.id), ne(importRuns.status, target))).orderBy(operation === "imports.rollback" ? desc(importSourceBatches.batchIndex) : asc(importSourceBatches.batchIndex)).limit(1).for("update");
  if (next) {
    if (!graph.planDigest) throw new ServiceError("conflict", "The accepted graph has no frozen plan identity.");
    const context: ImportBatchContext = { rootId: before.id, childId: next.run.id, graphId: graph.id, generation: graph.generation, planDigest: graph.planDigest, leaseToken, startOrdinal: next.batch.startOrdinal, endOrdinal: next.batch.endOrdinal, operation };
    await ctx.tx.update(importRuns).set({ checkpoint: { ...object(next.run.checkpoint), sourceGraphBatch: context } }).where(eq(importRuns.id, next.run.id));
    await withinImportBatch(context, () => operation === "imports.rollback" ? ctx.call(rollbackImport, { id: next.run.id }) : operation === "imports.publish" ? ctx.call(publishImport, { id: next.run.id }) : ctx.call(reconcileImport, { id: next.run.id }));
  }
  const [remaining] = await ctx.tx.select({ id: importSourceBatches.id }).from(importSourceBatches).innerJoin(importRuns, eq(importRuns.id, importSourceBatches.childRunId)).where(and(eq(importSourceBatches.graphId, graph.id), ne(importRuns.status, target))).limit(1);
  const checkpoint = object(before.checkpoint), counts = object(before.counts);
  checkpoint.sourceGraphProgress = { operation, completed: !remaining };
  if (!remaining && operation === "imports.reconcile") {
    const summaries = await ctx.tx.select({ found: sql<unknown>`${importRuns.checkpoint}->'reconciliation'->'found'` }).from(importSourceBatches).innerJoin(importRuns, eq(importRuns.id, importSourceBatches.childRunId)).where(eq(importSourceBatches.graphId, graph.id));
    const expected = { pages: Number(counts.pages ?? 0), media: Number(counts.media ?? 0), redirects: Number(counts.redirects ?? 0) };
    const found = { pages: 0, media: 0, redirects: 0 };
    for (const summary of summaries) {
      for (const key of ["pages", "media", "redirects"] as const) found[key] += Number(object(summary.found)[key] ?? 0);
    }
    checkpoint.reconciliation = { expected, found, matches: Object.entries(expected).every(([key, value]) => found[key as keyof typeof found] === value) };
  }
  if (!remaining && operation === "imports.rollback") {
    await releaseImportSources(ctx, before, checkpoint);
    checkpoint.rolledBack = { fromStatus: before.status, keptMedia: [] };
  }
  await ctx.tx.update(importSourceGraphs).set({ leaseToken: null, leaseActor: null, leaseUntil: null, updatedAt: new Date() }).where(eq(importSourceGraphs.id, graph.id));
  const [row] = await ctx.tx.update(importRuns).set({ status: remaining ? before.status : target, checkpoint, counts, error: null }).where(eq(importRuns.id, before.id)).returning();
  ctx.setSubject("import_run", before.id);
  return publicImportRun(row!);
}
