// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Keep prior import mutations owned by their recovery ledger (C3.22/C3.23).
import { ServiceError } from "@/core/service";

export const STAGEABLE = new Set(["discover", "mapped", "previewed", "failed"]);
const OWNED_LISTS = ["media", "createdPageIds", "replacedPages", "pageIds", "redirectIds", "displacedRedirects", "postSnapshots", "pendingBlogPosts"];

function checkpointOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function assertSourceStageable(run: { status: string; checkpoint: unknown }, allowUpload = false): void {
  if (!STAGEABLE.has(run.status)) throw new ServiceError("conflict", "This import has already been committed. Start a new run to read another source.");
  const checkpoint = checkpointOf(run.checkpoint);
  if (OWNED_LISTS.some(key => checkpoint[key] !== undefined && (!Array.isArray(checkpoint[key]) || checkpoint[key].length > 0)) || checkpoint.navApplied || checkpoint.blogIndexPageId) {
    throw new ServiceError("conflict", "This import already owns fetched files or committed records. Resume it or roll it back before reading another source.");
  }
  if (!allowUpload) assertNoPendingSourceUpload(run);
}

export function assertNoPendingSourceUpload(run: { checkpoint: unknown }): void {
  if (checkpointOf(run.checkpoint).sourceUpload) throw new ServiceError("conflict", "Finish or replace the current source upload before reading or committing another source.");
}
