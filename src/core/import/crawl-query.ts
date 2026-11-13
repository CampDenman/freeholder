// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: bounded progress exposes no original body, storage key or executor grant.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { importRuns, importSourceGraphs } from "@/core/plugins/schema";
import { defineService, ServiceError } from "@/core/service";
import { assertCurrentImportAuthority } from "./authority";
import { assertImportBatchAccess } from "./batch-context";
import { importCrawlRequests, importCrawlResponses, importCrawlSources } from "./crawl-schema";

export const crawlProgress = defineService({
  name: "imports.crawlProgress", summary: "Review saved public-source progress and whether original-capture recovery is required.",
  kind: "query", permission: "scoped",
  input: z.object({ id: z.uuid() }),
  output: z.object({
    id: z.uuid(), generation: z.uuid(), status: z.string(), state: z.enum(["discovering", "sealed", "invalidated", "rolled_back"]),
    sourceUrl: z.string().nullable(), sourceOrigin: z.string().nullable(), recoveryResponseId: z.uuid().nullable(), expiresAt: z.iso.datetime(), expired: z.boolean(), busy: z.boolean(), recoveryRequired: z.boolean(),
    requests: z.number().int().nonnegative(), capturedBytes: z.number().int().nonnegative(), pages: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(), indexed: z.number().int().nonnegative(), planReady: z.boolean(), invalidated: z.boolean(), cleanupPending: z.boolean(),
  }),
  handler: async (input, ctx) => {
    await assertCurrentImportAuthority(ctx, "imports.crawlProgress", "query");
    await lockContactIdentityForRead(ctx.tx);
    const [run] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1);
    if (!run) throw new ServiceError("not_found", "No such import.");
    assertImportBatchAccess(run);
    const [source] = await ctx.tx.select().from(importCrawlSources).where(eq(importCrawlSources.runId, run.id)).limit(1);
    if (!source) throw new ServiceError("not_found", "No saved public source exists for this import.");
    const [graph] = await ctx.tx.select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, run.id)).limit(1);
    const [frontier] = await ctx.tx.select({ pending: sql<number>`count(*) filter(where ${importCrawlRequests.state}='pending')::int`, claimed: sql<number>`count(*) filter(where ${importCrawlRequests.state}='claimed')::int` }).from(importCrawlRequests).where(eq(importCrawlRequests.sourceId, source.id));
    const [recovery] = await ctx.tx.select({ id: importCrawlResponses.id }).from(importCrawlResponses).innerJoin(importCrawlRequests, eq(importCrawlRequests.id, importCrawlResponses.requestId)).where(and(eq(importCrawlRequests.sourceId, source.id), eq(importCrawlRequests.state, "claimed"), eq(importCrawlRequests.attempts, importCrawlResponses.attempt), inArray(importCrawlResponses.state, ["fetched", "put_unknown"]))).orderBy(asc(importCrawlResponses.id)).limit(1);
    const [cleanup] = await ctx.tx.select({ pending: sql<boolean>`coalesce(bool_or(${importCrawlResponses.retiredAt} is not null and (
      exists(select 1 from media_objects reservation where reservation.key=${importCrawlResponses.storageKey})
      or exists(select 1 from media_object_writes physical where physical.key_digest=${importCrawlResponses.keyDigest}
        and (physical.state in ('unverified','started','unknown') or physical.operation_kind='put' and physical.deleted_at is null))
    )),false)` }).from(importCrawlResponses).innerJoin(importCrawlRequests, eq(importCrawlRequests.id, importCrawlResponses.requestId)).where(and(eq(importCrawlRequests.sourceId, source.id)));
    const now = Date.now(), expired = source.expiresAt.getTime() <= now;
    const busy = source.leaseUntil !== null && source.leaseUntil.getTime() > now;
    return {
      id: run.id, generation: source.generation, status: run.status, state: source.state, sourceUrl: source.sourceUrl, sourceOrigin: source.siteUrl, recoveryResponseId: recovery?.id ?? null,
      expiresAt: source.expiresAt.toISOString(), expired, busy,
      recoveryRequired: !busy && Number(frontier?.claimed ?? 0) > 0,
      requests: source.networkRequests, capturedBytes: source.capturedBytes, pages: source.pageCount,
      pending: Number(frontier?.pending ?? 0), indexed: Number(graph?.cursor && typeof graph.cursor === "object" && "ordinal" in graph.cursor ? graph.cursor.ordinal : 0),
      planReady: graph?.planMetadata !== null && graph?.planMetadata !== undefined,
      invalidated: ["invalidated", "rolled_back"].includes(source.state) || graph?.state === "invalidated",
      cleanupPending: Boolean(cleanup?.pending),
    };
  },
});

export default [crawlProgress];
