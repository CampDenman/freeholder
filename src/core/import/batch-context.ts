// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A private graph batch is reachable only through its live parent operation.
import { AsyncLocalStorage } from "node:async_hooks";
import { ServiceError } from "@/core/service";

type ImportBatchContext = { rootId: string; childId: string; graphId: string; generation: string; leaseToken: string };
const scope = new AsyncLocalStorage<ImportBatchContext>();
export function withinImportBatch<T>(context: ImportBatchContext, operation: () => Promise<T>): Promise<T> { return scope.run(context, operation); }
export function isPrivateImportBatch(run: { checkpoint: unknown }): boolean {
  return Boolean(run.checkpoint && typeof run.checkpoint === "object" && "sourceGraphBatch" in run.checkpoint);
}
export function assertImportBatchAccess(run: { id: string; checkpoint: unknown }): void {
  if (!isPrivateImportBatch(run)) return;
  const context = scope.getStore(), raw = (run.checkpoint as Record<string, unknown>).sourceGraphBatch;
  const binding = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  if (!context || context.childId !== run.id || context.rootId !== binding.rootId || context.graphId !== binding.graphId || context.generation !== binding.generation || context.leaseToken !== binding.leaseToken) throw new ServiceError("not_found", "No such import run.");
}
