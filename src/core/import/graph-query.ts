// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: review a bounded metadata window, never private batches or bodies.
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { importRuns, importSourceEntries, importSourceGraphs } from "@/core/plugins/schema";
import { defineService, ServiceError } from "@/core/service";
import { importGraphVersionSchema } from "./graph-version";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const upload = z.object({ uploadId: z.uuid(), chunks: z.number().int().positive(), received: z.number().int().nonnegative(), expiresAt: z.iso.datetime() });

export const sourceGraphReview = defineService({
  name: "imports.sourceGraph", summary: "Review one bounded window of an import's source identities and destination paths.",
  kind: "query", permission: "scoped",
  input: z.object({ id: z.uuid(), afterOrdinal: z.number().int().min(-1).default(-1), limit: z.number().int().min(1).max(50).default(50) }),
  output: z.object({
    id: z.uuid(), status: z.string(), origin: z.string(), version: importGraphVersionSchema,
    indexComplete: z.boolean(), indexed: z.number().int().nonnegative(), planFrozen: z.boolean(),
    upload: upload.nullable(), counts: z.record(z.string(), z.number()),
    entries: z.array(z.object({ ordinal: z.number().int(), kind: z.string(), sourceUrl: z.string().nullable(), title: z.string().nullable(), destinationPath: z.string().nullable(), sourceStatus: z.string().nullable(), applied: z.boolean(), reason: z.string().nullable() })).max(50),
    nextOrdinal: z.number().int().nonnegative().nullable(),
  }),
  handler: async (input, ctx) => {
    const [run] = await ctx.tx.select({ id: importRuns.id, origin: importRuns.origin, status: importRuns.status, checkpoint: importRuns.checkpoint, counts: importRuns.counts }).from(importRuns).where(eq(importRuns.id, input.id)).limit(1);
    const [graph] = await ctx.tx.select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, input.id)).limit(1);
    if (!run || !graph) throw new ServiceError("not_found", "No such source graph.");
    const rows = await ctx.tx.select({ ordinal: importSourceEntries.ordinal, kind: importSourceEntries.kind, metadata: importSourceEntries.metadata, target: importSourceEntries.targetSlug, pageId: importSourceEntries.targetPageId }).from(importSourceEntries).where(and(eq(importSourceEntries.graphId, graph.id), gt(importSourceEntries.ordinal, input.afterOrdinal))).orderBy(asc(importSourceEntries.ordinal)).limit(input.limit + 1);
    const [total] = await ctx.tx.select({ indexed: sql<number>`count(*)::int` }).from(importSourceEntries).where(eq(importSourceEntries.graphId, graph.id));
    const active = object(object(run.checkpoint).sourceUpload);
    const activeUpload = upload.safeParse({ uploadId: active.uploadId, chunks: active.chunks, received: Array.isArray(active.received) ? active.received.length : 0, expiresAt: active.expiresAt });
    const entries = rows.slice(0, input.limit).map(row => {
      const metadata = object(row.metadata);
      return { ordinal: row.ordinal, kind: row.kind, sourceUrl: typeof metadata.url === "string" ? metadata.url : null, title: typeof metadata.title === "string" ? metadata.title : null, destinationPath: row.target, sourceStatus: typeof metadata.status === "string" ? metadata.status : null, applied: row.pageId !== null, reason: typeof metadata.reason === "string" ? metadata.reason : null };
    });
    return { id: run.id, status: run.status, origin: run.origin ?? "", version: importGraphVersionSchema.parse(graph), indexComplete: graph.state === "indexed" || ["committed", "reconciled", "published"].includes(run.status), indexed: total?.indexed ?? 0, planFrozen: graph.planDigest !== null, upload: activeUpload.success ? activeUpload.data : null, counts: z.record(z.string(), z.number()).parse(run.counts), entries, nextOrdinal: rows.length > input.limit ? entries.at(-1)!.ordinal : null };
  },
});

export default [sourceGraphReview];
