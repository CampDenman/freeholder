// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Keep prior import mutations owned by their recovery ledger (C3.22/C3.23).
import { ServiceError } from "@/core/service";
import { assertImportBatchAccess, isPrivateImportBatch } from "./batch-context";

export const STAGEABLE = new Set(["discover", "mapped", "previewed", "failed"]);
const OWNED_LISTS = ["media", "mediaClaims", "createdPageIds", "replacedPages", "pageIds", "redirectIds", "displacedRedirects", "postSnapshots", "pendingBlogPosts"];

function checkpointOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function assertBatch(run: { id?: string; checkpoint: unknown }): void {
  if (!isPrivateImportBatch(run)) return;
  if (!run.id) throw new ServiceError("not_found", "No such import run.");
  assertImportBatchAccess({ ...run, id: run.id });
}

export function assertSourceStageable(run: { id?: string; status: string; checkpoint: unknown }, allowUpload = false): void {
  // Private batches are prepared only by their source-verified parent phase,
  // even while a listener inherits that parent's asynchronous scope.
  if (isPrivateImportBatch(run)) throw new ServiceError("not_found", "No such import run.");
  if (!STAGEABLE.has(run.status)) throw new ServiceError("conflict", "This import has already been committed. Start a new run to read another source.");
  const checkpoint = checkpointOf(run.checkpoint);
  if (checkpoint.sourceCrawl) throw new ServiceError("conflict", "Resume this import through its saved public-source crawl, or start a new import.");
  if (OWNED_LISTS.some(key => checkpoint[key] !== undefined && (!Array.isArray(checkpoint[key]) || checkpoint[key].length > 0)) || checkpoint.navApplied || checkpoint.blogIndexPageId) {
    throw new ServiceError("conflict", "This import already owns fetched files or committed records. Resume it or roll it back before reading another source.");
  }
  if (!allowUpload) assertNoPendingSourceUpload(run);
}

export function assertNoPendingSourceUpload(run: { id?: string; checkpoint: unknown }): void {
  assertBatch(run);
  if (checkpointOf(run.checkpoint).sourceCrawl) throw new ServiceError("conflict", "Resume this import through its saved public-source crawl, or start a new import.");
  if (checkpointOf(run.checkpoint).sourceGraph) throw new ServiceError("conflict", "Resume this import through its bounded source graph.");
  if (checkpointOf(run.checkpoint).sourceUpload) throw new ServiceError("conflict", "Finish or replace the current source upload before reading or committing another source.");
}
