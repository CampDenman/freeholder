// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Source-only: no public/runtime registration before full qualification.
// C3.47: save the complete file review in its own original-policy read phase.
import { createHash, randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { importRuns, importSourceEntries, importSourceGraphs, importSourceMedia } from "@/core/plugins/schema";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { assertCurrentImportAuthority, currentImportAuthority } from "./authority";
import { crawlBodyDescriptorSchema, type CrawlBodyDescriptor } from "./crawl-body";
import { buildCrawlGraphCatalog } from "./crawl-graph-catalog";
import { importCrawlGraphs } from "./crawl-graph-schema";
import { importCrawlResponses, importCrawlSources } from "./crawl-schema";
import { markImportCrawlWriter } from "./crawl-writer";

const rootInput = z.object({ id: z.uuid(), generation: z.uuid() });
async function executor(ctx: ServiceContext) {
  const actor = await currentImportAuthority(ctx);
  if ((actor.kind === "user" || actor.kind === "agent") && actor.keyId) return `key:${actor.keyId}`;
  if (actor.kind === "user") return `user:${actor.userId}`;
  throw new ServiceError("permission", "The original source needs its current authenticated caller.");
}
async function locked(input: z.infer<typeof rootInput>, ctx: ServiceContext) {
  await assertCurrentImportAuthority(ctx, "imports.advanceCrawl");
  await lockContactIdentityForRead(ctx.tx); await markImportCrawlWriter(ctx.tx);
  const [root] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1).for("update");
  const [source] = await ctx.tx.select().from(importCrawlSources).where(eq(importCrawlSources.runId, input.id)).limit(1).for("update");
  const [graph] = await ctx.tx.select().from(importSourceGraphs).where(eq(importSourceGraphs.runId, input.id)).limit(1).for("update");
  if (!root || root.status !== "previewed" || !source || source.state !== "sealed" || source.generation !== input.generation || source.expiresAt.getTime() <= Date.now() || !source.sourceRevision || !source.robotsResponseId || !graph || graph.generation !== source.generation || graph.sourceRevision !== source.sourceRevision || graph.state !== "indexed") throw new ServiceError("conflict", "The complete HTTP review lost its actual original source.");
  const [binding] = await ctx.tx.select().from(importCrawlGraphs).where(eq(importCrawlGraphs.graphId, graph.id)).limit(1).for("update");
  const [policy] = await ctx.tx.select().from(importCrawlResponses).where(eq(importCrawlResponses.id, source.robotsResponseId)).limit(1);
  if (!binding || binding.sourceId !== source.id || binding.sourceGeneration !== source.generation || binding.sourceRevision !== graph.sourceRevision || binding.requestOrdinal !== source.requestCounter || !policy || policy.state !== "stored" || policy.retiredAt || policy.facts?.role !== "robots" || policy.facts.bytes > 512 * 1024) throw new ServiceError("conflict", "The indexed HTTP source needs its exact complete frontier and saved robots policy.");
  const descriptor = crawlBodyDescriptorSchema.parse({ runId: root.id, sourceId: source.id, generation: source.generation, responseId: policy.id, digest: policy.facts.digest, bytes: policy.facts.bytes });
  return { root, source, graph, policy, descriptor };
}
type Claim = { planned: boolean; graphId: string; leaseToken: string | null; policy: CrawlBodyDescriptor };
export const claimCrawlGraphCatalog = defineService({
  name: "imports.claimCrawlGraphCatalog", orchestratedBy: "imports.advanceCrawl", external: false,
  summary: "Claim the saved original robots policy before preparing a complete HTTP file review.",
  kind: "mutation", permission: "scoped", auditInputFields: ["id", "generation"],
  input: rootInput, output: z.custom<Claim>(),
  handler: async (input, ctx) => {
    const { root, graph, descriptor } = await locked(input, ctx);
    if (graph.planMetadata) return { planned: true, graphId: graph.id, leaseToken: null, policy: descriptor };
    if (graph.leaseUntil && graph.leaseUntil.getTime() > Date.now()) throw new ServiceError("conflict", "Another complete file-review phase is still running.");
    const leaseToken = randomUUID();
    await ctx.tx.update(importSourceGraphs).set({ leaseToken, leaseActor: await executor(ctx), leaseUntil: new Date(Date.now() + 120_000), updatedAt: new Date() }).where(eq(importSourceGraphs.id, graph.id));
    ctx.setSubject("import_run", root.id);
    return { planned: false, graphId: graph.id, leaseToken, policy: descriptor };
  },
});
export const applyCrawlGraphCatalog = defineService({
  name: "imports.applyCrawlGraphCatalog", orchestratedBy: "imports.advanceCrawl", external: false,
  summary: "Freeze one complete global file plan using the verified actual saved robots response.",
  kind: "mutation", permission: "scoped", auditInputFields: ["id", "graphId"],
  input: rootInput.extend({ graphId: z.uuid(), leaseToken: z.uuid(), policy: crawlBodyDescriptorSchema, policyBody: z.instanceof(Uint8Array).refine(body => body.byteLength <= 512 * 1024, "The original policy exceeds its physical-byte budget.") }),
  output: z.object({ id: z.uuid(), files: z.number().int().min(0).max(500) }),
  handler: async (input, ctx) => {
    const { root, graph, descriptor, policy } = await locked(input, ctx);
    if (graph.id !== input.graphId || graph.planMetadata || graph.leaseToken !== input.leaseToken || graph.leaseActor !== await executor(ctx) || !graph.leaseUntil || graph.leaseUntil.getTime() <= Date.now() || JSON.stringify(descriptor) !== JSON.stringify(input.policy) || input.policyBody.byteLength !== descriptor.bytes || createHash("sha256").update(input.policyBody).digest("hex") !== descriptor.digest) throw new ServiceError("conflict", "The complete HTTP file review lost its caller, original policy or lease.");
    const entries = await ctx.tx.select({ metadata: importSourceEntries.metadata }).from(importSourceEntries).where(eq(importSourceEntries.graphId, graph.id)).orderBy(asc(importSourceEntries.ordinal));
    let policyText = "";
    if (policy.facts!.status !== 404) {
      try { policyText = new TextDecoder("utf-8", { fatal: true }).decode(input.policyBody); }
      catch { throw new ServiceError("conflict", "The saved robots policy is not valid UTF-8."); }
    }
    const plan = buildCrawlGraphCatalog(graph.headerMetadata, entries.map(row => row.metadata), policyText);
    if (plan.media.length) await ctx.tx.insert(importSourceMedia).values(plan.media.map(item => ({ graphId: graph.id, key: item.key, sourceKeyDigest: createHash("sha256").update(item.key).digest("hex"), planned: item })));
    await ctx.tx.update(importSourceGraphs).set({ planMetadata: plan.catalog, leaseToken: null, leaseActor: null, leaseUntil: null, updatedAt: new Date() }).where(eq(importSourceGraphs.id, graph.id));
    const counts = root.counts && typeof root.counts === "object" ? root.counts : {};
    await ctx.tx.update(importRuns).set({ counts: { ...counts, media: plan.media.length }, error: null }).where(eq(importRuns.id, root.id));
    ctx.setSubject("import_run", root.id);
    return { id: root.id, files: plan.media.length };
  },
});

// The orchestrator reads the saved policy outside this transaction. Its512KiB
// physical budget is a distinct phase, never added to a20MiB content read.
export default [claimCrawlGraphCatalog, applyCrawlGraphCatalog];
