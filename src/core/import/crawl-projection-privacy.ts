// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: minimize private input projections after actual original retirement.
import { and, eq, inArray, sql } from "drizzle-orm";
import { importRuns, importSourceBatches, importSourceEntries, importSourceGraphs, importSourceMedia } from "@/core/plugins/schema";
import { ServiceError, type Tx } from "@/core/service";
import { auditLog } from "@/core/events/schema";
import { importCrawlEntryOriginals, importCrawlGraphs } from "./crawl-graph-schema";
import { importCrawlRequests, importCrawlResponses, importCrawlSources } from "./crawl-schema";
import { markImportCrawlWriter } from "./crawl-writer";

export const REDACTED_HTTP_ENTRY = Object.freeze({ format: "http-originals", redacted: true });
export const REDACTED_HTTP_PLAN = Object.freeze({ redacted: true });

/** A file URL already admitted into a plan, batch or asset remains business
 * recovery identity. Refuse its erasure ACK rather than silently rekeying it.
 * This check runs before physical deletion and again in the final TX; SQL
 * independently fences the actual projection update and completion.
 */
export async function assertCrawlMediaMinimizable(tx: Tx, responseIds: string[]): Promise<void> {
  if (!responseIds.length) return;
  const [capability] = await tx.execute<{ available: boolean }>(sql`select to_regprocedure('public.freeholder_guard_crawl_media_key_capture()') is not null as available`);
  if (!capability?.available) throw new ServiceError("conflict", "Original HTTP file-key capture needs reviewed schema recovery before cleanup can continue.");
  const [blocked] = await tx.execute<{ blocked: boolean }>(sql`
    select exists(select 1 from import_crawl_responses response
      join import_crawl_requests request on request.id=response.request_id
      join import_crawl_graphs binding on binding.source_id=request.source_id
      join import_source_graphs graph on graph.id=binding.graph_id
      join import_source_media media on media.graph_id=graph.id
      where response.id in (${sql.join(responseIds.map(id => sql`${id}::uuid`), sql`,`)})
        and (media.source_key_digest is null or graph.plan_digest is not null
          or graph.lease_token is not null or media.asset_id is not null
          or media.digest is not null or media.bytes is not null
          or exists(select 1 from import_source_batches batch where batch.graph_id=graph.id))) as blocked
  `);
  if (blocked?.blocked) throw new ServiceError("conflict", "Original HTTP file URLs belong to an accepted or unresolved import receipt. Review its business recovery before erasure can complete.");
}

/** This method never substitutes a metadata flag for physical absence. Both
 * its reads and the SQL update guards recheck original generation holds and
 * actual receipts. Normalized IDs/ranges/digests and ownership mappings remain.
 */
export async function minimizeCrawlInputProjections(tx: Tx, responseIds: string[]): Promise<void> {
  if (!responseIds.length) return;
  await assertCrawlMediaMinimizable(tx, responseIds);
  await markImportCrawlWriter(tx);
  const [available] = await tx.execute<{ available: boolean }>(sql`select to_regprocedure('public.freeholder_crawl_projection_retired(uuid,uuid)') is not null as available`);
  if (!available?.available) throw new ServiceError("conflict", "The known original responses need the current guarded projection-recovery schema before erasure can complete.");
  await tx.execute(sql`select set_config('freeholder.import_crawl_projection_redaction','v1',true)`);
  const originals = await tx.select({ entryId: importCrawlEntryOriginals.entryId, responseId: importCrawlEntryOriginals.responseId, graphId: importCrawlEntryOriginals.graphId, sourceId: importCrawlGraphs.sourceId })
    .from(importCrawlEntryOriginals).innerJoin(importCrawlGraphs, eq(importCrawlGraphs.graphId, importCrawlEntryOriginals.graphId))
    .where(inArray(importCrawlEntryOriginals.responseId, responseIds));
  for (const row of originals) {
    const [eligible] = await tx.execute<{ ready: boolean }>(sql`select freeholder_crawl_projection_retired(${row.sourceId}::uuid,${row.responseId}::uuid) as ready`);
    if (eligible?.ready) await tx.update(importSourceEntries).set({ metadata: REDACTED_HTTP_ENTRY, targetSlug: sql`case when ${importSourceEntries.targetPageId} is null then null else ${importSourceEntries.targetSlug} end` }).where(eq(importSourceEntries.id, row.entryId));
  }
  const sourceRows = await tx.select({ sourceId: importCrawlRequests.sourceId }).from(importCrawlResponses).innerJoin(importCrawlRequests, eq(importCrawlRequests.id, importCrawlResponses.requestId)).where(inArray(importCrawlResponses.id, responseIds));
  for (const sourceId of new Set(sourceRows.map(row => row.sourceId))) await minimizeCrawlRootInput(tx, sourceId);
  const graphs = await tx.select({ graphId: importCrawlGraphs.graphId, sourceId: importCrawlGraphs.sourceId, runId: importSourceGraphs.runId }).from(importCrawlGraphs)
    .innerJoin(importSourceGraphs, eq(importSourceGraphs.id, importCrawlGraphs.graphId))
    .innerJoin(importCrawlRequests, eq(importCrawlRequests.sourceId, importCrawlGraphs.sourceId))
    .innerJoin(importCrawlResponses, eq(importCrawlResponses.requestId, importCrawlRequests.id))
    .where(inArray(importCrawlResponses.id, responseIds));
  const visited = new Set<string>();
  for (const row of graphs) {
    if (visited.has(row.graphId)) continue;
    visited.add(row.graphId);
    const [eligible] = await tx.execute<{ ready: boolean }>(sql`select freeholder_crawl_projection_retired(${row.sourceId}::uuid,null::uuid) as ready`);
    if (!eligible?.ready) continue;
    await tx.update(importSourceGraphs).set({ state: "invalidated", headerMetadata: REDACTED_HTTP_ENTRY, planMetadata: REDACTED_HTTP_PLAN, leaseToken: null, leaseActor: null, leaseUntil: null, updatedAt: new Date() }).where(eq(importSourceGraphs.id, row.graphId));
    await tx.update(importSourceMedia).set({ key: sql`'redacted:' || ${importSourceMedia.id}::text`, planned: REDACTED_HTTP_PLAN, error: null }).where(eq(importSourceMedia.graphId, row.graphId));
    const children = await tx.select({ run: importRuns }).from(importSourceBatches).innerJoin(importRuns, eq(importRuns.id, importSourceBatches.childRunId)).where(and(eq(importSourceBatches.graphId, row.graphId), inArray(importRuns.status, ["discover", "previewed", "mapped", "failed"])));
    for (const { run } of children) {
      const checkpoint = run.checkpoint && typeof run.checkpoint === "object" && !Array.isArray(run.checkpoint) ? { ...run.checkpoint as Record<string, unknown> } : {};
      // Actual accepted media/CMS receipts and original batch binding survive.
      // These fields are unaccepted source-input copies, never ownership proof.
      delete checkpoint.pendingBlogPosts; delete checkpoint.report; delete checkpoint.source; delete checkpoint.origin;
      await tx.update(importRuns).set({ origin: null, preview: { sourceFormat: "redacted-http-input" }, checkpoint, conflicts: [], error: "Original HTTP input was minimized for privacy; review is required." }).where(eq(importRuns.id, run.id));
      await tx.update(auditLog).set({ diff: sql`${auditLog.diff} - 'origin' - 'url' - 'payload' - 'preview' - 'pages' - 'prefix' - 'robotsTxt' - 'report'` }).where(and(eq(auditLog.subjectType, "import_run"), eq(auditLog.subjectId, run.id), sql`${auditLog.action} like 'imports.%'`));
    }
  }
}

/** A stopped frontier may have private selected-address input without ever
 * producing a graph or response. Its actual source generation is still the
 * authority; absence/holds are checked in the same current transaction.
 */
export async function minimizeCrawlRootInput(tx: Tx, sourceId: string): Promise<void> {
  await markImportCrawlWriter(tx);
  const [available] = await tx.execute<{ available: boolean }>(sql`select to_regprocedure('public.freeholder_crawl_projection_retired(uuid,uuid)') is not null as available`);
  if (!available?.available) throw new ServiceError("conflict", "The original import input needs guarded schema recovery before minimization.");
  const [eligible] = await tx.execute<{ ready: boolean }>(sql`select freeholder_crawl_projection_retired(${sourceId}::uuid,null::uuid) as ready`);
  if (!eligible?.ready) return;
  const [source] = await tx.select({ runId: importCrawlSources.runId }).from(importCrawlSources).where(eq(importCrawlSources.id, sourceId));
  if (!source) throw new ServiceError("conflict", "Restore the original source generation before minimizing its input.");
  const [root] = await tx.select().from(importRuns).where(eq(importRuns.id, source.runId));
  if (!root) throw new ServiceError("conflict", "Restore the original import receipt before minimizing its input.");
  const checkpoint = root.checkpoint && typeof root.checkpoint === "object" && !Array.isArray(root.checkpoint) ? { ...root.checkpoint as Record<string, unknown> } : {};
  delete checkpoint.origin; delete checkpoint.report; delete checkpoint.source;
  await tx.update(importRuns).set({ origin: null, checkpoint }).where(eq(importRuns.id, root.id));
  await tx.update(auditLog).set({ diff: sql`${auditLog.diff} - 'origin' - 'url' - 'payload' - 'preview' - 'pages' - 'prefix' - 'robotsTxt' - 'report'` }).where(and(eq(auditLog.subjectType, "import_run"), eq(auditLog.subjectId, root.id), sql`${auditLog.action} like 'imports.%'`));
}
