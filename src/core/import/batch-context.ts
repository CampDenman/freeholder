// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A private graph batch is reachable only through its live parent operation.
import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { z } from "zod";
import { importRuns, importSourceEntries, importSourceGraphs, importSourceMedia } from "@/core/plugins/schema";
import { actorString, ServiceError, type Service, type ServiceContext } from "@/core/service";
import { assertCurrentImportAuthority } from "./authority";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { markImportGraphWriter } from "./graph-writer";
import { markReaderOwnershipWriter } from "./reader-ownership-key";
import { IMPORT_GRAPH_MEDIA_TOTAL_BYTES } from "./graph-catalog";

export type ImportBatchContext = { rootId: string; childId: string; graphId: string; generation: string; planDigest: string; leaseToken: string; startOrdinal: number; endOrdinal: number; kind: "content" | "media" | "navigation"; operation: "imports.commit" | "imports.reconcile" | "imports.publish" | "imports.rollback" };
const scope = new AsyncLocalStorage<ImportBatchContext>();
// Outbox listeners can inherit AsyncLocalStorage. A different handler's
// context must not inherit this child's permissions, media or target mapping.
const guardedContexts = new WeakSet<ServiceContext>();
export function withinImportBatch<T>(context: ImportBatchContext, operation: () => Promise<T>): Promise<T> { return scope.run(context, operation); }
export function currentImportBatch(runId?: string): ImportBatchContext | undefined {
  const context = scope.getStore();
  return context && (runId === undefined || context.childId === runId) ? context : undefined;
}
const batchForContext = (ctx: ServiceContext) => guardedContexts.has(ctx) ? scope.getStore() : undefined;
export function isPrivateImportBatch(run: { checkpoint: unknown }): boolean {
  return Boolean(run.checkpoint && typeof run.checkpoint === "object" && "sourceGraphBatch" in run.checkpoint);
}
export function assertImportBatchAccess(run: { id: string; checkpoint: unknown }): void {
  if (!isPrivateImportBatch(run)) return;
  const context = scope.getStore(), raw = (run.checkpoint as Record<string, unknown>).sourceGraphBatch;
  const binding = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  if (!context || context.childId !== run.id || context.rootId !== binding.rootId || context.graphId !== binding.graphId || context.generation !== binding.generation || context.planDigest !== binding.planDigest || context.leaseToken !== binding.leaseToken || context.kind !== binding.kind || context.operation !== binding.operation || context.startOrdinal !== binding.startOrdinal || context.endOrdinal !== binding.endOrdinal) throw new ServiceError("not_found", "No such import run.");
}

/** Root before child before media/CMS; never reopen a transaction or actor. */
export async function lockImportBatchParent(ctx: ServiceContext, childId: string): Promise<void> {
  await markReaderOwnershipWriter(ctx.tx);
  const context = scope.getStore();
  if (!context || childId !== context.childId) return;
  await assertCurrentImportAuthority(ctx, context.operation);
  await lockContactIdentityForRead(ctx.tx);
  await markImportGraphWriter(ctx.tx);
  const [root] = await ctx.tx.select({ id: importRuns.id, status: importRuns.status }).from(importRuns).where(eq(importRuns.id, context.rootId)).limit(1).for("update");
  const [graph] = await ctx.tx.select({ leaseToken: importSourceGraphs.leaseToken, leaseActor: importSourceGraphs.leaseActor, leaseUntil: importSourceGraphs.leaseUntil, state: importSourceGraphs.state, planDigest: importSourceGraphs.planDigest }).from(importSourceGraphs).where(and(eq(importSourceGraphs.id, context.graphId), eq(importSourceGraphs.runId, context.rootId), eq(importSourceGraphs.generation, context.generation))).limit(1).for("update");
  if (!root || root.status === "rolled_back" || !graph || graph.planDigest !== context.planDigest || (graph.state === "invalidated" && context.operation !== "imports.rollback") || graph.leaseToken !== context.leaseToken || graph.leaseActor !== actorString(ctx.actor) || !graph.leaseUntil || graph.leaseUntil.getTime() <= Date.now()) throw new ServiceError("conflict", "The original import batch was cancelled, replaced or lost its lease.");
  guardedContexts.add(ctx);
}

/** Existing service permission and audit still run, with a fresh extra fence. */
export async function callImportService<I extends z.ZodType, O>(ctx: ServiceContext, service: Service<I, O>, input: z.input<I>): Promise<O> {
  if (batchForContext(ctx)) await assertCurrentImportAuthority(ctx, service.def.name, service.def.kind, service.def.permission);
  return ctx.call(service, input);
}

export async function importBatchTargets(ctx: ServiceContext): Promise<Array<{ wpId?: string; sourcePath?: string; targetSlug: string; pageId: string | null }>> {
  const context = batchForContext(ctx);
  if (!context) return [];
  const rows = await ctx.tx.select({ metadata: importSourceEntries.metadata, slug: importSourceEntries.targetSlug, pageId: importSourceEntries.targetPageId }).from(importSourceEntries).where(eq(importSourceEntries.graphId, context.graphId));
  return rows.flatMap(row => {
    if (row.slug === null) return [];
    const metadata = row.metadata as Record<string, unknown>;
    // Static metadata retains the literal URL pathname. The shared content
    // link resolver uses its source path without the leading slash.
    const sourcePath = typeof metadata.sourcePath === "string" ? metadata.format === "archive-zip" ? metadata.sourcePath.replace(/^\//, "") : metadata.sourcePath : undefined;
    return [{ targetSlug: row.slug, pageId: row.pageId, ...(typeof metadata.wpId === "string" ? { wpId: metadata.wpId } : {}), ...(sourcePath !== undefined ? { sourcePath } : {}) }];
  });
}

/** The source identity mapping commits atomically with its actual CMS write. */
export async function recordImportBatchTarget(ctx: ServiceContext, slug: string, pageId: string): Promise<void> {
  const context = batchForContext(ctx);
  if (!context || context.kind !== "content") return;
  await ctx.tx.update(importSourceEntries).set({ targetPageId: pageId }).where(and(eq(importSourceEntries.graphId, context.graphId), eq(importSourceEntries.targetSlug, slug), gte(importSourceEntries.ordinal, context.startOrdinal), lt(importSourceEntries.ordinal, context.endOrdinal)));
}

/** Shared accepted mappings are read, never copied into another child's ownership. */
export async function importBatchSharedMedia(ctx: ServiceContext): Promise<Array<{ key: string; sourceUrl: string; assetId?: string; error?: string }>> {
  const context = batchForContext(ctx);
  if (!context || context.kind !== "content") return [];
  const rows = await ctx.tx.select({ key: importSourceMedia.key, planned: importSourceMedia.planned, assetId: importSourceMedia.assetId, error: importSourceMedia.error }).from(importSourceMedia).where(eq(importSourceMedia.graphId, context.graphId));
  return rows.map(row => ({ key: row.key, sourceUrl: (row.planned as { sourceUrl: string }).sourceUrl, ...(row.assetId ? { assetId: row.assetId } : {}), ...(row.error ? { error: row.error } : {}) }));
}

/** The root/graph locks acquired by lockedRun serialize all media reservations. */
export async function bindImportBatchMedia(ctx: ServiceContext, key: string, digest: string, bytes: number): Promise<void> {
  const context = batchForContext(ctx);
  if (!context || context.kind !== "media") return;
  const [row] = await ctx.tx.select().from(importSourceMedia).where(and(eq(importSourceMedia.graphId, context.graphId), eq(importSourceMedia.key, key))).limit(1).for("update");
  if (!row || (row.digest && row.digest !== digest) || (row.bytes !== null && row.bytes !== bytes)) throw new ServiceError("conflict", "The shared source file no longer matches its original verified bytes.");
  const [total] = await ctx.tx.select({ bytes: sql<number>`coalesce(sum(${importSourceMedia.bytes}),0)::bigint` }).from(importSourceMedia).where(eq(importSourceMedia.graphId, context.graphId));
  if (Number(total?.bytes ?? 0) + (row.bytes === null ? bytes : 0) > IMPORT_GRAPH_MEDIA_TOTAL_BYTES) throw new ServiceError("validation", "This source exceeds its complete one-gigabyte media budget.");
  await ctx.tx.update(importSourceMedia).set({ digest, bytes }).where(eq(importSourceMedia.id, row.id));
}

export async function recordImportBatchMedia(ctx: ServiceContext, key: string, result: { assetId?: string; error?: string }): Promise<void> {
  const context = batchForContext(ctx);
  if (!context || context.kind !== "media") return;
  const [row] = await ctx.tx.update(importSourceMedia).set({ assetId: result.assetId ?? null, error: result.assetId ? null : result.error ?? "The file could not be fetched." }).where(and(eq(importSourceMedia.graphId, context.graphId), eq(importSourceMedia.key, key))).returning({ id: importSourceMedia.id });
  if (!row) throw new ServiceError("conflict", "The shared source file is no longer in this graph.");
}
