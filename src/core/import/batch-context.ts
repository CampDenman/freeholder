// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A private graph batch is reachable only through its live parent operation.
import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, gte, lt } from "drizzle-orm";
import type { z } from "zod";
import { importRuns, importSourceEntries, importSourceGraphs } from "@/core/plugins/schema";
import { ServiceError, type Service, type ServiceContext } from "@/core/service";
import { assertCurrentImportAuthority } from "./authority";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";

export type ImportBatchContext = { rootId: string; childId: string; graphId: string; generation: string; leaseToken: string; startOrdinal: number; endOrdinal: number; operation: "imports.commit" | "imports.reconcile" | "imports.publish" | "imports.rollback" };
const scope = new AsyncLocalStorage<ImportBatchContext>();
export function withinImportBatch<T>(context: ImportBatchContext, operation: () => Promise<T>): Promise<T> { return scope.run(context, operation); }
export function currentImportBatch(): ImportBatchContext | undefined { return scope.getStore(); }
export function isPrivateImportBatch(run: { checkpoint: unknown }): boolean {
  return Boolean(run.checkpoint && typeof run.checkpoint === "object" && "sourceGraphBatch" in run.checkpoint);
}
export function assertImportBatchAccess(run: { id: string; checkpoint: unknown }): void {
  if (!isPrivateImportBatch(run)) return;
  const context = scope.getStore(), raw = (run.checkpoint as Record<string, unknown>).sourceGraphBatch;
  const binding = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  if (!context || context.childId !== run.id || context.rootId !== binding.rootId || context.graphId !== binding.graphId || context.generation !== binding.generation || context.leaseToken !== binding.leaseToken) throw new ServiceError("not_found", "No such import run.");
}

/** Root before child before media/CMS; never reopen a transaction or actor. */
export async function lockImportBatchParent(ctx: ServiceContext, childId: string): Promise<void> {
  const context = scope.getStore();
  if (!context || childId !== context.childId) return;
  await assertCurrentImportAuthority(ctx, context.operation);
  await lockContactIdentityForRead(ctx.tx);
  const [root] = await ctx.tx.select({ id: importRuns.id, status: importRuns.status }).from(importRuns).where(eq(importRuns.id, context.rootId)).limit(1).for("update");
  const [graph] = await ctx.tx.select({ leaseToken: importSourceGraphs.leaseToken, leaseUntil: importSourceGraphs.leaseUntil, state: importSourceGraphs.state }).from(importSourceGraphs).where(and(eq(importSourceGraphs.id, context.graphId), eq(importSourceGraphs.runId, context.rootId), eq(importSourceGraphs.generation, context.generation))).limit(1).for("update");
  if (!root || root.status === "rolled_back" || !graph || (graph.state === "invalidated" && context.operation !== "imports.rollback") || graph.leaseToken !== context.leaseToken || !graph.leaseUntil || graph.leaseUntil.getTime() <= Date.now()) throw new ServiceError("conflict", "The original import batch was cancelled, replaced or lost its lease.");
}

/** Existing service permission and audit still run, with a fresh extra fence. */
export async function callImportService<I extends z.ZodType, O>(ctx: ServiceContext, service: Service<I, O>, input: z.input<I>): Promise<O> {
  if (scope.getStore()) await assertCurrentImportAuthority(ctx, service.def.name, service.def.kind, service.def.permission);
  return ctx.call(service, input);
}

export async function importBatchTargets(ctx: ServiceContext): Promise<Array<{ wpId?: string; sourcePath?: string; targetSlug: string; pageId: string | null }>> {
  const context = scope.getStore();
  if (!context) return [];
  const rows = await ctx.tx.select({ metadata: importSourceEntries.metadata, slug: importSourceEntries.targetSlug, pageId: importSourceEntries.targetPageId }).from(importSourceEntries).where(eq(importSourceEntries.graphId, context.graphId));
  return rows.flatMap(row => {
    if (row.slug === null) return [];
    const metadata = row.metadata as Record<string, unknown>;
    return [{ targetSlug: row.slug, pageId: row.pageId, ...(typeof metadata.wpId === "string" ? { wpId: metadata.wpId } : {}), ...(typeof metadata.sourcePath === "string" ? { sourcePath: metadata.sourcePath } : {}) }];
  });
}

/** The source identity mapping commits atomically with its actual CMS write. */
export async function recordImportBatchTarget(ctx: ServiceContext, slug: string, pageId: string): Promise<void> {
  const context = scope.getStore();
  if (!context) return;
  await ctx.tx.update(importSourceEntries).set({ targetPageId: pageId }).where(and(eq(importSourceEntries.graphId, context.graphId), eq(importSourceEntries.targetSlug, slug), gte(importSourceEntries.ordinal, context.startOrdinal), lt(importSourceEntries.ordinal, context.endOrdinal)));
}
