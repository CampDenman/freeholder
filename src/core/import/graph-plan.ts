// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: expose the complete shared-file plan before any provider or CMS write.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { importRuns, importSourceGraphs, importSourceMedia } from "@/core/plugins/schema";
import { defineService, ServiceError } from "@/core/service";
import { assertCurrentImportAuthority } from "./authority";
import { buildGraphCatalog } from "./graph-catalog";
import { importGraphVersionSchema } from "./graph-version";
import { markImportGraphWriter } from "./graph-writer";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? { ...value as Record<string, unknown> } : {};
export const prepareSourceGraphPlan = defineService({
  name: "imports.prepareSourceGraphPlan", orchestratedBy: "imports.previewFromUpload",
  summary: "Prepare the bounded complete file/menu review without importing anything.",
  kind: "mutation", permission: "scoped", external: false, auditInputFields: ["id", "version"],
  input: z.object({ id: z.uuid(), version: importGraphVersionSchema }),
  output: z.object({ id: z.uuid(), status: z.string(), error: z.string().nullable(), counts: z.unknown(), graph: importGraphVersionSchema }),
  handler: async (input, ctx) => {
    await assertCurrentImportAuthority(ctx, "imports.previewFromUpload");
    await lockContactIdentityForRead(ctx.tx);
    await markImportGraphWriter(ctx.tx);
    const [run] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1).for("update");
    const [graph] = await ctx.tx.select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, input.id)).limit(1).for("update");
    if (!run || run.status !== "previewed" || !graph || graph.state !== "indexed" || graph.generation !== input.version.generation || graph.sourceRevision !== input.version.sourceRevision || graph.planRevision !== input.version.planRevision || (graph.leaseUntil && graph.leaseUntil.getTime() > Date.now())) throw new ServiceError("conflict", "This source review lost its original indexed version.");
    if (graph.planMetadata) return { id: run.id, status: run.status, error: run.error, counts: run.counts, graph: input.version };
    let planned: Awaited<ReturnType<typeof buildGraphCatalog>>;
    try { planned = await buildGraphCatalog(ctx.tx, graph.id, graph.headerMetadata, run.origin!); }
    catch (error) {
      if (!(error instanceof z.ZodError) && !(error instanceof ServiceError && error.code === "validation")) throw error;
      const message = error instanceof ServiceError ? error.message : "This source's file or menu metadata exceeds the bounded review budget.";
      await ctx.tx.update(importRuns).set({ error: message }).where(eq(importRuns.id, run.id));
      ctx.setSubject("import_run", run.id);
      return { id: run.id, status: run.status, error: message, counts: run.counts, graph: input.version };
    }
    if (planned.media.length) await ctx.tx.insert(importSourceMedia).values(planned.media.map(item => ({ graphId: graph.id, key: item.key, planned: item })));
    await ctx.tx.update(importSourceGraphs).set({ planMetadata: planned.catalog }).where(eq(importSourceGraphs.id, graph.id));
    const counts = { ...object(run.counts), media: planned.media.length, menus: planned.catalog.menus.length };
    await ctx.tx.update(importRuns).set({ counts, error: null }).where(eq(importRuns.id, run.id));
    ctx.setSubject("import_run", run.id);
    return { id: run.id, status: run.status, error: null, counts, graph: input.version };
  },
});
