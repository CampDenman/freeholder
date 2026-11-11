// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: owner choices update the global source mapping before it is frozen.
import { eq } from "drizzle-orm";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { importRuns, importSourceEntries, importSourceGraphs } from "@/core/plugins/schema";
import { ServiceError, type ServiceContext } from "@/core/service";
import { assertCurrentImportAuthority } from "./authority";
import type { ImportGraphVersion } from "./graph-version";
import { markImportGraphWriter } from "./graph-writer";
import { publicImportRun } from "./privacy";
import { toCmsSlug } from "./wordpress";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? { ...value as Record<string, unknown> } : {};
type Choice = { slug: string; resolution: "keep-existing" | "replace" | "rename"; renamedSlug?: string };

export async function reviewGraphConflicts(ctx: ServiceContext, run: typeof importRuns.$inferSelect, observed: ImportGraphVersion | undefined, choices: Choice[]) {
  await assertCurrentImportAuthority(ctx, "imports.reviewConflicts");
  await lockContactIdentityForRead(ctx.tx);
  await markImportGraphWriter(ctx.tx);
  const [graph] = await ctx.tx.select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, run.id)).limit(1).for("update");
  if (run.status !== "previewed" || !graph || graph.state !== "indexed" || graph.planDigest || graph.batchCounter || (graph.leaseUntil && graph.leaseUntil.getTime() > Date.now())) throw new ServiceError("conflict", "Review source destinations before starting any import batch.");
  if (!observed || observed.generation !== graph.generation || observed.sourceRevision !== graph.sourceRevision || observed.planRevision !== graph.planRevision) throw new ServiceError("conflict", "This source plan changed. Review its current version before saving choices.");
  if (!choices.length || choices.length > 50) throw new ServiceError("validation", "Review between one and fifty source destinations at a time.");
  const entries = await ctx.tx.select({ id: importSourceEntries.id, target: importSourceEntries.targetSlug }).from(importSourceEntries).where(eq(importSourceEntries.graphId, graph.id));
  const byTarget = new Map(entries.flatMap(entry => entry.target !== null ? [[entry.target, entry] as const] : []));
  const seen = new Set<string>(), proposed = new Set(byTarget.keys());
  for (const choice of choices) {
    const slug = toCmsSlug(choice.slug), entry = byTarget.get(slug);
    if (!entry || seen.has(slug)) throw new ServiceError("validation", "Each choice must identify a distinct current source destination.");
    seen.add(slug);
    const target = choice.resolution === "rename" ? toCmsSlug(choice.renamedSlug?.trim() || `${slug || "home"}-imported`) : slug;
    if (target.length > 2_048 || (target !== slug && proposed.has(target))) throw new ServiceError("conflict", "Another source entry already owns that destination. Choose a distinct path.");
    proposed.add(target);
    await ctx.tx.update(importSourceEntries).set({ targetSlug: target, resolution: choice.resolution }).where(eq(importSourceEntries.id, entry.id));
  }
  const planRevision = graph.planRevision + 1;
  await ctx.tx.update(importSourceGraphs).set({ planRevision, updatedAt: new Date() }).where(eq(importSourceGraphs.id, graph.id));
  const checkpoint = object(run.checkpoint);
  checkpoint.sourceGraph = { ...object(checkpoint.sourceGraph), planRevision };
  const [updated] = await ctx.tx.update(importRuns).set({ checkpoint, preview: { ...object(run.preview), planRevision } }).where(eq(importRuns.id, run.id)).returning();
  ctx.setSubject("import_run", run.id);
  return publicImportRun(updated!);
}
