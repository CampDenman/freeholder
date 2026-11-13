// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: missing original completion is recovery debt, never inferred empty.
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { auditLog } from "@/core/events/schema";
import { dataRequestArtifacts, dataRequests } from "@/core/privacy/schema";
import { ServiceError, type ServiceContext, type Tx } from "@/core/service";
import { erasureArtifactIsIntact } from "@/core/privacy/service";
import { importCrawlErasureScopes, importCrawlErasureSources } from "./crawl-erasure-schema";
import { importCrawlRequests, importCrawlResponseErasures, importCrawlResponses, importCrawlSources } from "./crawl-schema";
import { markImportCrawlWriter } from "./crawl-writer";

const originalReceipt = z.object({ format: z.literal("freeholder.erasure-receipt"), outcomes: z.array(z.object({ scope: z.string(), outcome: z.string() }).passthrough()) }).passthrough();
export type CrawlErasureScope = { requestId: string; sources: Array<{ sourceId: string; generation: string }>; responseIds: string[] };
type ScopeReader = Pick<Tx, "select" | "execute">;
const recovery = () => new ServiceError("conflict", "The original HTTP erasure capture needs reviewed recovery. No empty or later source membership was assumed.");

export async function crawlErasureScopeAvailable(tx: ScopeReader): Promise<boolean> {
  const [row] = await tx.execute<{ available: boolean }>(sql`select to_regclass('public.import_crawl_erasure_scopes') is not null and to_regclass('public.import_crawl_erasure_sources') is not null and to_regprocedure('public.freeholder_crawl_erasure_scope_complete(uuid)') is not null as available`);
  return Boolean(row?.available);
}

/** Capability is checked before a worker can admit physical cleanup. A
 * missing historical guard is recovery debt, never permission to emulate it.
 */
export async function crawlErasureGuardsAvailable(tx: ScopeReader): Promise<boolean> {
  const [row] = await tx.execute<{ available: boolean }>(sql`
    select count(*)=4
      and to_regprocedure('public.freeholder_crawl_erasure_scope_complete(uuid)') is not null
      and to_regprocedure('public.freeholder_crawl_projection_retired(uuid,uuid)') is not null as available
    from (values
      ('public.import_crawl_erasure_scopes','import_crawl_erasure_scopes_capture','public.freeholder_guard_crawl_erasure_capture()'),
      ('public.import_crawl_erasure_sources','import_crawl_erasure_sources_capture','public.freeholder_guard_crawl_erasure_capture()'),
      ('public.import_crawl_erasure_scopes','import_crawl_erasure_scopes_complete','public.freeholder_require_crawl_erasure_scope_complete()'),
      ('public.data_requests','data_requests_crawl_erasure_completion','public.freeholder_require_crawl_erasure_completion()')
    ) required(table_name,trigger_name,function_name)
    join pg_trigger guard on guard.tgrelid=to_regclass(required.table_name)
      and guard.tgname=required.trigger_name and guard.tgfoid=to_regprocedure(required.function_name)
    where not guard.tgisinternal and guard.tgenabled in ('O','A')
  `);
  return Boolean(row?.available);
}

async function existingScope(tx: ScopeReader, requestId: string): Promise<CrawlErasureScope | null> {
  const [header] = await tx.select().from(importCrawlErasureScopes).where(eq(importCrawlErasureScopes.requestId, requestId)).limit(1);
  if (!header) return null;
  const sources = await tx.select({ sourceId: importCrawlErasureSources.sourceId, generation: importCrawlErasureSources.generation }).from(importCrawlErasureSources).where(eq(importCrawlErasureSources.requestId, requestId)).orderBy(asc(importCrawlErasureSources.sourceId));
  const responses = await tx.select({ id: importCrawlResponseErasures.responseId }).from(importCrawlResponseErasures).where(eq(importCrawlResponseErasures.requestId, requestId)).orderBy(asc(importCrawlResponseErasures.responseId));
  const [complete] = await tx.execute<{ complete: boolean }>(sql`select freeholder_crawl_erasure_scope_complete(${requestId}::uuid) as complete`);
  if (header.captureVersion !== 1 || header.sourceCount !== sources.length || header.responseCount !== responses.length || !complete?.complete) throw recovery();
  return { requestId, sources, responseIds: responses.map(row => row.id) };
}

/** This initial snapshot is admissible only in the real first fulfillment TX.
 * A completed receipt, including a genuinely empty one, is never reconstructed
 * by inspecting whichever source generations happen to exist later.
 */
export async function captureCrawlErasureScope(service: ServiceContext, requestId: string): Promise<CrawlErasureScope> {
  const tx = service.tx;
  if (!await crawlErasureScopeAvailable(tx)) throw recovery();
  const captured = await existingScope(tx, requestId);
  if (captured) return captured;
  const [request] = await tx.select().from(dataRequests).where(eq(dataRequests.id, requestId)).limit(1);
  const [artifact] = await tx.select({ id: dataRequestArtifacts.id }).from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, requestId)).limit(1);
  const [applied] = await tx.select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.action, "contacts.fulfillDataRequest"), eq(auditLog.subjectType, "dataRequest"), eq(auditLog.subjectId, requestId))).limit(1);
  const [priorCohort] = await tx.select({ id: importCrawlResponseErasures.id }).from(importCrawlResponseErasures).where(eq(importCrawlResponseErasures.requestId, requestId)).limit(1);
  if (!request || request.kind !== "erasure" || request.status !== "verified" || artifact || applied || priorCohort) throw recovery();
  await markImportCrawlWriter(tx);
  const sources = await tx.select({ sourceId: importCrawlSources.id, generation: importCrawlSources.generation }).from(importCrawlSources).orderBy(asc(importCrawlSources.id)).limit(10_001);
  const responses = await tx.select({ id: importCrawlResponses.id }).from(importCrawlResponses).innerJoin(importCrawlRequests, eq(importCrawlRequests.id, importCrawlResponses.requestId)).orderBy(asc(importCrawlResponses.id)).limit(100_001);
  if (sources.length > 10_000 || responses.length > 100_000) throw new ServiceError("conflict", "These original HTTP generations need bounded recovery before completing erasure.");
  await tx.execute(sql`select set_config('freeholder.import_crawl_erasure_request',${requestId},true)`);
  await tx.insert(importCrawlErasureScopes).values({ requestId, sourceCount: sources.length, responseCount: responses.length });
  for (let at = 0; at < sources.length; at += 500) await tx.insert(importCrawlErasureSources).values(sources.slice(at, at + 500).map(row => ({ requestId, ...row })));
  for (let at = 0; at < responses.length; at += 500) await tx.insert(importCrawlResponseErasures).values(responses.slice(at, at + 500).map(row => ({ requestId, responseId: row.id }))).onConflictDoNothing();
  return { requestId, sources, responseIds: responses.map(row => row.id) };
}

/** Old false-completed work can reopen only its actual retired response
 * cohorts and valid original artifact. This does NOT seal a missing original
 * scope, guess empty membership or adopt a later generation.
 */
export async function hasAppliedCrawlRetirementEvidence(tx: ScopeReader, requestId: string): Promise<boolean> {
  const [request] = await tx.select({ kind: dataRequests.kind }).from(dataRequests).where(eq(dataRequests.id, requestId)).limit(1);
  if (request?.kind !== "erasure") return false;
  const [applied] = await tx.select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.action, "contacts.fulfillDataRequest"), eq(auditLog.subjectType, "dataRequest"), eq(auditLog.subjectId, requestId))).limit(1);
  const [cohort] = await tx.select({ id: importCrawlResponseErasures.id }).from(importCrawlResponseErasures).innerJoin(importCrawlResponses, eq(importCrawlResponses.id, importCrawlResponseErasures.responseId)).where(and(eq(importCrawlResponseErasures.requestId, requestId), sql`${importCrawlResponses.retiredAt} is not null`)).limit(1);
  return Boolean(applied && cohort);
}

export async function hasOriginalCrawlRecoveryEvidence(tx: ScopeReader, requestId: string): Promise<boolean> {
  const [artifact] = await tx.select({ body: dataRequestArtifacts.body, sha256: dataRequestArtifacts.sha256 }).from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, requestId)).limit(1);
  const receipt = originalReceipt.safeParse(artifact?.body);
  if (!erasureArtifactIsIntact(artifact) || !receipt.success || !receipt.data.outcomes.some(row => row.scope === "imports.crawlOriginals" && ["pending", "retained", "erased"].includes(row.outcome))) return false;
  return hasAppliedCrawlRetirementEvidence(tx, requestId);
}

export async function originalCrawlScopeIsComplete(tx: ScopeReader, requestId: string): Promise<boolean> {
  if (!await crawlErasureScopeAvailable(tx)) return false;
  const [row] = await tx.execute<{ complete: boolean }>(sql`select freeholder_crawl_erasure_scope_complete(${requestId}::uuid) as complete`);
  return Boolean(row?.complete);
}
