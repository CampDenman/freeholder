// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: cancellation/expiry revoke reuse without inventing physical absence.
import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { importRuns, importSourceGraphs } from "@/core/plugins/schema";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { assertCurrentImportAuthority } from "./authority";
import { importCrawlRequests, importCrawlResponses, importCrawlSources } from "./crawl-schema";
import { markImportCrawlWriter } from "./crawl-writer";
import { minimizeRetiredCrawlResponses } from "./crawl-privacy";
import { minimizeCrawlRootInput } from "./crawl-projection-privacy";

/** Called only from the actual authorized parent service transaction. */
export async function retireCrawlOriginals(ctx: ServiceContext, runId: string, reason: "cancelled" | "expired" | "rolled_back"): Promise<number> {
  await markImportCrawlWriter(ctx.tx);
  const [run] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, runId)).limit(1).for("update");
  const [source] = await ctx.tx.select().from(importCrawlSources).where(eq(importCrawlSources.runId, runId)).limit(1).for("update");
  if (!source) return 0;
  if (!run) throw new ServiceError("conflict", "The original HTTP recovery root is unavailable.");
  if (reason === "expired" && source.expiresAt.getTime() > Date.now()) throw new ServiceError("conflict", "The original HTTP retention window has not expired.");
  await ctx.tx.update(importCrawlSources).set({ state: reason === "rolled_back" ? "rolled_back" : "invalidated", leaseToken: null, leaseActor: null, leaseUntil: null, updatedAt: new Date() }).where(eq(importCrawlSources.id, source.id));
  await ctx.tx.update(importSourceGraphs).set({ state: "invalidated", leaseToken: null, leaseActor: null, leaseUntil: null, updatedAt: new Date() }).where(eq(importSourceGraphs.runId, runId));
  const responses = await ctx.tx.select({ response: importCrawlResponses }).from(importCrawlResponses).innerJoin(importCrawlRequests, eq(importCrawlResponses.requestId, importCrawlRequests.id)).where(eq(importCrawlRequests.sourceId, source.id)).orderBy(asc(importCrawlResponses.id)).for("update", { of: importCrawlResponses });
  const keys: string[] = [];
  for (const { response } of responses) {
    await ctx.tx.update(importCrawlResponses).set({ state: "retired", retiredAt: response.retiredAt ?? new Date() }).where(eq(importCrawlResponses.id, response.id));
    // This queue is only a request. Current domain holds and actual physical
    // settlement are checked again by both the owner registry and SQL fence.
    if (response.storageKey) keys.push(response.storageKey);
  }
  for (let offset = 0; offset < keys.length; offset += 25) await ctx.queueJob("core.deleteCaptureObjects", { keys: keys.slice(offset, offset + 25) });
  if (!["committed", "reconciled", "published", "rolled_back"].includes(run.status)) await ctx.tx.update(importRuns).set({ status: "failed", error: reason === "expired" ? "The original public-source window expired. Start a new import." : "The original public-source crawl was stopped." }).where(eq(importRuns.id, runId));
  ctx.setSubject("import_run", runId);
  return keys.length;
}

export const cancelCrawl = defineService({
  name: "imports.cancelCrawl", summary: "Stop the original crawl and request safe private cleanup. Named holds and unresolved writes remain protected.",
  kind: "mutation", permission: "scoped", input: z.object({ id: z.uuid() }), output: z.object({ stopped: z.literal(true) }),
  handler: async (input, ctx) => {
    await assertCurrentImportAuthority(ctx, "imports.cancelCrawl");
    await lockContactIdentityForRead(ctx.tx);
    const [source] = await ctx.tx.select({ id: importCrawlSources.id }).from(importCrawlSources).where(eq(importCrawlSources.runId, input.id)).limit(1);
    if (!source) throw new ServiceError("not_found", "No saved original crawl exists for this import.");
    await retireCrawlOriginals(ctx, input.id, "cancelled");
    return { stopped: true as const };
  },
});

export const retireExpiredCrawls = defineService({
  name: "imports.retireExpiredCrawls", summary: "Retire a bounded original expiry window and retry unresolved retired-object cleanup.",
  kind: "mutation", permission: "system", external: false,
  input: z.object({ limit: z.number().int().min(1).max(25).default(25) }), output: z.object({ retired: z.number().int().nonnegative() }),
  handler: async (input, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    await markImportCrawlWriter(ctx.tx);
    const candidates = await ctx.tx.select({ runId: importCrawlSources.runId }).from(importCrawlSources).where(and(lte(importCrawlSources.expiresAt, new Date()), isNull(importCrawlSources.redactedAt), inArray(importCrawlSources.state, ["discovering", "sealed"]))).orderBy(asc(importCrawlSources.expiresAt), asc(importCrawlSources.id)).limit(input.limit);
    let retired = 0;
    for (const row of candidates) retired += await retireCrawlOriginals(ctx, row.runId, "expired");
    // A missed callback or restarted old image cannot turn a later accepted
    // write into absence. The ordinary periodic cleanup retries retired rows;
    // the exact erasure-cohort reconciler separately reopens original receipts.
    const remaining = await ctx.tx.execute<{ key: string }>(sql`
      select original.storage_key as key from import_crawl_responses original
      where original.retired_at is not null and original.storage_key is not null
       and original.redacted_at is null and not freeholder_crawl_response_held(original.id)
       and not exists(select 1 from media_object_writes unsettled where unsettled.key_digest=original.key_digest and unsettled.state in ('unverified','started','unknown'))
       and (exists(select 1 from media_objects reserved where reserved.key=original.storage_key)
         or exists(select 1 from media_object_writes live where live.key_digest=original.key_digest and live.operation_kind='put' and live.deleted_at is null))
      order by original.id limit 25
    `);
    if (remaining.length) await ctx.queueJob("core.deleteCaptureObjects", { keys: remaining.map(row => row.key) });
    const completed = await ctx.tx.execute<{ id: string }>(sql`
      select original.id from import_crawl_responses original
      where original.retired_at is not null and original.redacted_at is null and not freeholder_crawl_response_held(original.id)
       and not exists(select 1 from media_objects reserved where reserved.key=original.storage_key)
       and not exists(select 1 from media_object_writes unsettled where unsettled.key_digest=original.key_digest and (unsettled.state in ('unverified','started','unknown') or unsettled.operation_kind='put' and unsettled.deleted_at is null))
      order by original.id limit 25
    `);
    if (completed.length) {
      const rows = await ctx.tx.select().from(importCrawlResponses).where(inArray(importCrawlResponses.id, completed.map(row => row.id))).orderBy(asc(importCrawlResponses.id)).for("update");
      for (const row of rows) {
        const [current] = await ctx.tx.execute<{ held: boolean }>(sql`select freeholder_crawl_response_held(${row.id}::uuid) as held`);
        if (current?.held) throw new ServiceError("conflict", "A named original-source hold now prevents metadata retirement.");
      }
      await minimizeRetiredCrawlResponses(ctx.tx, rows);
    }
    // A held zero-response generation has no response cohort to lead cleanup.
    // After actual release/expiry, periodically minimize its original URL facts
    // under the same identity→root→source locks, without inventing a job.
    const empty = await ctx.tx.execute<{ id: string; run_id: string }>(sql`
      select source.id,source.run_id from import_crawl_sources source
      where source.state in ('invalidated','rolled_back') and source.redacted_at is null
       and not freeholder_crawl_source_held(source.id,source.generation)
       and not exists(select 1 from import_crawl_requests request join import_crawl_responses response on response.request_id=request.id where request.source_id=source.id)
      order by source.id limit 25
    `);
    for (const row of empty) {
      await ctx.tx.select({ id: importRuns.id }).from(importRuns).where(eq(importRuns.id, row.run_id)).for("update");
      const [source] = await ctx.tx.select().from(importCrawlSources).where(eq(importCrawlSources.id, row.id)).for("update");
      if (!source || source.redactedAt) continue;
      const [current] = await ctx.tx.execute<{ held: boolean }>(sql`select freeholder_crawl_source_held(${source.id}::uuid,${source.generation}::uuid) as held`);
      if (current?.held) continue;
      await ctx.tx.update(importCrawlRequests).set({ url: null, urlDigest: null, entryMetadata: null, redactedAt: sql`coalesce(${importCrawlRequests.redactedAt},now())` }).where(eq(importCrawlRequests.sourceId, source.id));
      await ctx.tx.update(importCrawlSources).set({ siteUrl: null, sourceUrl: null, redactedAt: new Date(), updatedAt: new Date() }).where(eq(importCrawlSources.id, source.id));
      await minimizeCrawlRootInput(ctx.tx, source.id);
    }
    return { retired };
  },
});

export const crawlRetirementServices = [cancelCrawl, retireExpiredCrawls];
