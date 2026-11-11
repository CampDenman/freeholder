// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: a failed read may release its exact lease; an uncertain PUT may not.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { importRuns, importSourceGraphs } from "@/core/plugins/schema";
import { actorString, defineService } from "@/core/service";
import { assertCurrentImportAuthority } from "./authority";
import { markImportGraphWriter } from "./graph-writer";

function releaseRead(parent: "imports.previewFromUpload" | "imports.commit", name: string) {
  return defineService({
    name, orchestratedBy: parent, summary: "Release only the exact failed original-source read lease.",
    kind: "mutation", permission: "scoped", external: false, auditInputFields: ["id", "graphId"],
    input: z.object({ id: z.uuid(), graphId: z.uuid().optional(), generation: z.uuid(), leaseToken: z.uuid() }),
    output: z.object({ released: z.boolean() }),
    handler: async (input, ctx) => {
      await assertCurrentImportAuthority(ctx, parent);
      await lockContactIdentityForRead(ctx.tx);
      await markImportGraphWriter(ctx.tx);
      const [run] = await ctx.tx.select({ id: importRuns.id, status: importRuns.status }).from(importRuns).where(eq(importRuns.id, input.id)).limit(1).for("update");
      const [graph] = await ctx.tx.select().from(importSourceGraphs).where(and(eq(importSourceGraphs.runId, input.id), input.graphId ? eq(importSourceGraphs.id, input.graphId) : undefined)).limit(1).for("update");
      if (!run || !["discover", "previewed"].includes(run.status) || !graph || graph.state === "invalidated" || graph.generation !== input.generation || graph.leaseToken !== input.leaseToken || graph.leaseActor !== actorString(ctx.actor)) return { released: false };
      await ctx.tx.update(importSourceGraphs).set({ leaseToken: null, leaseActor: null, leaseUntil: null, updatedAt: new Date() }).where(eq(importSourceGraphs.id, graph.id));
      ctx.setSubject("import_run", run.id);
      return { released: true };
    },
  });
}
export const releaseIndexRead = releaseRead("imports.previewFromUpload", "imports.releaseSourceGraphRead");
export const releaseCommitRead = releaseRead("imports.commit", "imports.releaseGraphBatchRead");
