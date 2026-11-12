// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: review a bounded metadata window, never private batches or bodies.
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { importRuns, importSourceEntries, importSourceGraphs, importSourceMedia } from "@/core/plugins/schema";
import { defineService, ServiceError } from "@/core/service";
import { importGraphVersionSchema } from "./graph-version";
import { assertCurrentImportAuthority } from "./authority";
import { graphMediaPlanSchema } from "./graph-catalog";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const upload = z.object({ uploadId: z.uuid(), chunks: z.number().int().positive(), received: z.number().int().nonnegative(), expiresAt: z.iso.datetime() });

export const sourceGraphReview = defineService({
  name: "imports.sourceGraph", summary: "Review one bounded window of an import's source identities and destination paths.",
  kind: "query", permission: "scoped",
  input: z.object({ id: z.uuid(), afterOrdinal: z.number().int().min(-1).default(-1), afterMediaKey: z.string().max(4_096).default(""), limit: z.number().int().min(1).max(50).default(50) }),
  output: z.object({
    id: z.uuid(), status: z.string(), origin: z.string(), version: importGraphVersionSchema,
    indexComplete: z.boolean(), indexed: z.number().int().nonnegative(), planFrozen: z.boolean(), planReady: z.boolean(), invalidated: z.boolean(),
    upload: upload.nullable(), counts: z.record(z.string(), z.number()),
    entries: z.array(z.object({ ordinal: z.number().int(), kind: z.string(), sourceUrl: z.string().nullable(), title: z.string().nullable(), destinationPath: z.string().nullable(), sourceStatus: z.string().nullable(), resolution: z.enum(["keep-existing", "replace", "rename"]).nullable(), applied: z.boolean(), reason: z.string().nullable() })).max(50),
    nextOrdinal: z.number().int().nonnegative().nullable(),
    media: z.array(z.object({ key: z.string(), sourceUrl: z.string(), filename: z.string(), assetId: z.uuid().nullable(), bytes: z.number().int().positive().nullable(), error: z.string().nullable() })).max(50),
    nextMediaKey: z.string().nullable(),
  }),
  handler: async (input, ctx) => {
    await assertCurrentImportAuthority(ctx, "imports.sourceGraph", "query");
    const [run] = await ctx.tx.select({ id: importRuns.id, origin: importRuns.origin, status: importRuns.status, checkpoint: importRuns.checkpoint, counts: importRuns.counts }).from(importRuns).where(eq(importRuns.id, input.id)).limit(1);
    const [graph] = await ctx.tx.select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, input.id)).limit(1);
    if (!run || !graph) throw new ServiceError("not_found", "No such source graph.");
    const rows = await ctx.tx.select({ ordinal: importSourceEntries.ordinal, kind: importSourceEntries.kind, metadata: importSourceEntries.metadata, target: importSourceEntries.targetSlug, pageId: importSourceEntries.targetPageId, resolution: importSourceEntries.resolution }).from(importSourceEntries).where(and(eq(importSourceEntries.graphId, graph.id), gt(importSourceEntries.ordinal, input.afterOrdinal))).orderBy(asc(importSourceEntries.ordinal)).limit(input.limit + 1);
    const [total] = await ctx.tx.select({ indexed: sql<number>`count(*)::int` }).from(importSourceEntries).where(eq(importSourceEntries.graphId, graph.id));
    const mediaRows = await ctx.tx.select().from(importSourceMedia).where(and(eq(importSourceMedia.graphId, graph.id), gt(importSourceMedia.key, input.afterMediaKey))).orderBy(asc(importSourceMedia.key)).limit(input.limit + 1);
    const media = mediaRows.slice(0, input.limit).map(row => { const planned = graphMediaPlanSchema.parse(row.planned); return { key: row.key, sourceUrl: planned.sourceUrl, filename: planned.filename, assetId: row.assetId, bytes: row.bytes, error: row.error }; });
    const active = object(object(run.checkpoint).sourceUpload);
    const activeUpload = upload.safeParse({ uploadId: active.uploadId, chunks: active.chunks, received: Array.isArray(active.received) ? active.received.length : 0, expiresAt: active.expiresAt });
    const entries = rows.slice(0, input.limit).map(row => {
      const metadata = object(row.metadata), file = metadata.format === "archive-zip" ? object(metadata.file) : {};
      return { ordinal: row.ordinal, kind: row.kind, sourceUrl: typeof metadata.url === "string" ? metadata.url : typeof file.url === "string" ? file.url : null, title: typeof metadata.title === "string" ? metadata.title : typeof file.path === "string" ? file.path : null, destinationPath: row.target, sourceStatus: typeof metadata.status === "string" ? metadata.status : null, resolution: row.resolution, applied: row.pageId !== null, reason: typeof metadata.reason === "string" ? metadata.reason : null };
    });
    return { id: run.id, status: run.status, origin: run.origin ?? "", version: importGraphVersionSchema.parse(graph), indexComplete: graph.state === "indexed" || ["committed", "reconciled", "published"].includes(run.status), indexed: total?.indexed ?? 0, planFrozen: graph.planDigest !== null, planReady: graph.planMetadata !== null, invalidated: graph.state === "invalidated", upload: activeUpload.success ? activeUpload.data : null, counts: z.record(z.string(), z.number()).parse(run.counts), entries, nextOrdinal: rows.length > input.limit ? entries.at(-1)!.ordinal : null, media, nextMediaKey: mediaRows.length > input.limit ? media.at(-1)!.key : null };
  },
});

export default [sourceGraphReview];
