// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.46/C3.47: bounded URL acceptance windows, with no private body copies.
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { importRuns, importSourceBatches, importSourceEntries, importSourceGraphs } from "@/core/plugins/schema";
import { ServiceError, type ServiceContext } from "@/core/service";
import { assertCurrentImportAuthority } from "./authority";
import { graphCatalogSchema } from "./graph-catalog";

const metadataSchema = z.object({ sourceUrl: z.string(), path: z.string(), status: z.string(), seo: z.record(z.string(), z.unknown()) });
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export async function graphVerificationWindow(ctx: ServiceContext, run: typeof importRuns.$inferSelect, afterOrdinal: number, limit: number) {
  await assertCurrentImportAuthority(ctx, "imports.wordpressVerificationPlan", "query");
  const [graph] = await ctx.tx.select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, run.id)).limit(1);
  if (!graph?.planDigest || !["committed", "reconciled", "published"].includes(run.status)) throw new ServiceError("conflict", "Complete the accepted source graph before requesting URL verification.");
  const catalog = graphCatalogSchema.parse(graph.planMetadata);
  const rows = await ctx.tx.select({ ordinal: importSourceEntries.ordinal, metadata: importSourceEntries.metadata, resolution: importSourceEntries.resolution,
    landing: sql<unknown>`(select landed.entry from jsonb_array_elements(coalesce(${importRuns.checkpoint}->'landedPaths','[]'::jsonb)) as landed(entry) where landed.entry->>'sourceUrl'=${importSourceEntries.metadata}->>'url' limit 1)`,
    skipped: sql<unknown>`coalesce(${importRuns.checkpoint}->'report'->'skippedRedirects','[]'::jsonb) || coalesce(${importRuns.checkpoint}->'skippedAliases','[]'::jsonb)`,
  })
    .from(importSourceEntries)
    .innerJoin(importSourceBatches, and(eq(importSourceBatches.graphId, importSourceEntries.graphId), eq(importSourceBatches.kind, "content"), sql`${importSourceEntries.ordinal} >= ${importSourceBatches.startOrdinal}`, sql`${importSourceEntries.ordinal} < ${importSourceBatches.endOrdinal}`))
    .innerJoin(importRuns, eq(importRuns.id, importSourceBatches.childRunId))
    .where(and(eq(importSourceEntries.graphId, graph.id), gt(importSourceEntries.ordinal, afterOrdinal), inArray(importSourceEntries.kind, ["page", "post"]))).orderBy(asc(importSourceEntries.ordinal)).limit(limit + 1);
  const checks: Array<{ sourceUrl: string; requestPath: string; destinationPath: string; redirect: boolean; expected: Record<string, unknown> }> = [];
  const warnings = new Set<string>(["WordPress /feed is Freeholder's member feed; WordPress feed aliases use /feeds/blog.xml."]);
  if (run.status !== "published") warnings.add("The import has not been published; draft privacy is expected and cutover acceptance cannot pass yet.");
  for (const row of rows.slice(0, limit)) {
    if (row.resolution === "keep-existing") { warnings.add("Existing owner pages were kept; source content and metadata were not applied to those pages."); continue; }
    const parsed = metadataSchema.safeParse(row.landing);
    if (!parsed.success) throw new ServiceError("conflict", "An accepted source entry lost its actual destination acceptance record.");
    const page = parsed.data;
    if (page.status === "draft") { warnings.add("Unpublished source pages remain private and are excluded from public URL checks."); continue; }
    const path = `/${page.path}`;
    const skipped = new Set(z.array(z.object({ fromPath: z.string() })).parse(row.skipped).map(item => `/${item.fromPath.replace(/^\//, "")}`));
    const alias = (requestPath: string) => {
      if (skipped.has(requestPath)) { warnings.add("Some original addresses were preserved for existing owner content or redirects; review those explicit conflicts before cutover."); return; }
      checks.push({ sourceUrl: page.sourceUrl, requestPath, destinationPath: path, redirect: true, expected: {} });
    };
    checks.push({ sourceUrl: page.sourceUrl, requestPath: path, destinationPath: path, redirect: false, expected: page.seo });
    try {
      const original = new URL(page.sourceUrl);
      if (`${original.pathname}${original.search}` !== path) alias(`${original.pathname}${original.search}`);
    } catch { warnings.add("A source URL is invalid; review its original record before cutover."); }
    const wpId = object(row.metadata).wpId;
    if (typeof wpId === "string") {
      for (const key of ["p", "page_id"]) for (const root of ["", "index.php"]) alias(`/${root}?${key}=${encodeURIComponent(wpId)}`);
      for (const attachment of catalog.attachments.filter(item => item.parentWpId === wpId)) {
        if (attachment.path) alias(`/${attachment.path}`);
        if (attachment.wpId) for (const root of ["", "index.php"]) alias(`/${root}?attachment_id=${encodeURIComponent(attachment.wpId)}`);
      }
    }
  }
  if (afterOrdinal < 0) for (const feed of ["rss2", "atom", "rss"]) checks.push({ sourceUrl: run.origin ?? "", requestPath: `/?feed=${feed}`, destinationPath: "/feeds/blog.xml", redirect: true, expected: {} });
  if (checks.length > 2_000 || Buffer.byteLength(JSON.stringify(checks)) > 8 * 1024 * 1024) throw new ServiceError("validation", "Reduce the URL verification window to fit its response budget.");
  return { sourceOrigin: run.origin ?? "", status: run.status, checks, warnings: [...warnings], nextOrdinal: rows.length > limit ? rows[limit - 1]!.ordinal : null };
}
