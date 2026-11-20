// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: actual human recovery is separate from original executor authority.
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { mediaObjectWrites } from "@/core/media/write-schema";
import { importRuns } from "@/core/plugins/schema";
import { actorString, defineOrchestratedService, defineService, ServiceError, type ServiceContext } from "@/core/service";
import { assertCurrentImportAuthority, currentImportAuthority } from "./authority";
import { crawlBodyDescriptorSchema, readCrawlOriginalBody } from "./crawl-body";
import { initializeCrawl } from "./crawl-capture";
import { importCrawlRequests, importCrawlResponses, importCrawlSources } from "./crawl-schema";
import { markImportCrawlWriter } from "./crawl-writer";
import { startImport } from "./service";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
async function currentOwner(ctx: ServiceContext, operation = "imports.recoverCrawlResponse") {
  await assertCurrentImportAuthority(ctx, operation);
  const actor = await currentImportAuthority(ctx);
  if (actor.kind !== "user" || actor.role !== "owner" || actor.keyId || !actor.sessionId) throw new ServiceError("permission", "Sign in as the freshly verified owner to review original-source recovery.");
  return actor;
}
const original = z.object({ id: z.uuid(), generation: z.uuid(), responseId: z.uuid() });
async function locked(input: z.infer<typeof original>, ctx: ServiceContext) {
  await currentOwner(ctx); await lockContactIdentityForRead(ctx.tx); await markImportCrawlWriter(ctx.tx);
  const [root] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1).for("update");
  const [source] = await ctx.tx.select().from(importCrawlSources).where(eq(importCrawlSources.runId, input.id)).limit(1).for("update");
  const [response] = await ctx.tx.select().from(importCrawlResponses).where(eq(importCrawlResponses.id, input.responseId)).limit(1).for("update");
  const [request] = response ? await ctx.tx.select().from(importCrawlRequests).where(eq(importCrawlRequests.id, response.requestId)).limit(1).for("update") : [];
  if (!root || root.status !== "discover" || !source || source.state !== "discovering" || source.generation !== input.generation || source.redactedAt || source.expiresAt.getTime() <= Date.now() || !request || request.sourceId !== source.id || request.state !== "claimed" || !response || response.attempt !== request.attempts || !["fetched", "put_unknown"].includes(response.state) || response.retiredAt || !response.facts || !response.storageKey) throw new ServiceError("conflict", "Keep the original invalidated, expired or missing response separate. A new reviewed source is required.");
  const receipts = await ctx.tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.keyDigest, response.keyDigest));
  const accepted = receipts.find(row => row.operation === "put" && row.state === "accepted" && row.namespace === response.storageNamespace && row.bytes === response.facts!.bytes && row.sha256 === response.facts!.digest && !row.deletedAt);
  if (!accepted || receipts.some(row => ["unverified", "started", "unknown"].includes(row.state)) || (!response.wrapperFinishedAt && !(accepted.reviewedAt && accepted.evidenceDigest))) throw new ServiceError("conflict", "Review the exact original storage outcome and actual stopped-writer evidence before accepting this response. A clock or matching GET is insufficient.");
  return { root, source, request, response, accepted };
}

const claimCrawlRecovery = defineService({
  name: "imports.claimCrawlRecovery", orchestratedBy: "imports.recoverCrawlResponse", external: false,
  summary: "Claim a fresh person's recovery phase after actual original-wrapper settlement.", kind: "mutation", permission: "scoped", agentCallable: false, stepUp: true,
  input: original, output: z.object({ descriptor: crawlBodyDescriptorSchema, token: z.uuid() }), auditInputFields: ["id", "responseId"],
  handler: async (input, ctx) => {
    const row = await locked(input, ctx);
    if (row.source.leaseUntil && row.source.leaseUntil.getTime() > Date.now() && (!row.source.leaseToken || digest(row.source.leaseToken) !== row.response.wrapperTokenDigest)) throw new ServiceError("conflict", "Another actual source phase is still running.");
    const token = randomUUID();
    await ctx.tx.update(importCrawlSources).set({ leaseToken: token, leaseActor: actorString(ctx.actor), leaseUntil: new Date(Date.now() + 120_000), updatedAt: new Date() }).where(eq(importCrawlSources.id, row.source.id));
    ctx.setSubject("import_run", row.root.id);
    return { token, descriptor: { runId: row.root.id, sourceId: row.source.id, generation: row.source.generation, responseId: row.response.id, digest: row.response.facts!.digest, bytes: row.response.facts!.bytes } };
  },
});
const applyCrawlRecovery = defineService({
  name: "imports.applyCrawlRecovery", orchestratedBy: "imports.recoverCrawlResponse", external: false,
  summary: "Accept only the freshly verified exact original bytes without rewriting their executor.", kind: "mutation", permission: "scoped", agentCallable: false, stepUp: true,
  input: original.extend({ token: z.uuid(), descriptor: crawlBodyDescriptorSchema }), output: z.object({ recovered: z.literal(true) }), auditInputFields: ["id", "responseId"],
  handler: async (input, ctx) => {
    const row = await locked(input, ctx);
    if (row.source.leaseToken !== input.token || row.source.leaseActor !== actorString(ctx.actor) || !row.source.leaseUntil || row.source.leaseUntil.getTime() <= Date.now() || input.descriptor.runId !== row.root.id || input.descriptor.sourceId !== row.source.id || input.descriptor.generation !== row.source.generation || input.descriptor.responseId !== row.response.id || input.descriptor.digest !== row.response.facts!.digest || input.descriptor.bytes !== row.response.facts!.bytes) throw new ServiceError("conflict", "The exact original-body recovery lost its fresh owner, source or receipt.");
    await ctx.tx.update(importCrawlResponses).set({ state: "stored", providerAcceptedAt: row.response.providerAcceptedAt ?? row.accepted.observedAcceptedAt }).where(eq(importCrawlResponses.id, row.response.id));
    await ctx.tx.update(importCrawlRequests).set({ state: "accepted", acceptedResponseId: row.response.id }).where(eq(importCrawlRequests.id, row.request.id));
    await ctx.tx.update(importCrawlSources).set({ ...(row.request.role === "robots" ? { robotsResponseId: row.response.id } : {}), leaseToken: null, leaseActor: null, leaseUntil: null, updatedAt: new Date() }).where(eq(importCrawlSources.id, row.source.id));
    await ctx.tx.update(importRuns).set({ error: null }).where(eq(importRuns.id, row.root.id));
    ctx.setSubject("import_run", row.root.id);
    return { recovered: true as const };
  },
});
export const recoverCrawlResponse = defineOrchestratedService({
  name: "imports.recoverCrawlResponse", summary: "Verify an original settled response under a fresh owner's recovery authority.", kind: "mutation", permission: "scoped", agentCallable: false, stepUp: true, writeClass: "write",
  input: original.extend({ confirmation: z.literal("VERIFY ORIGINAL RESPONSE") }), output: z.object({ recovered: z.literal(true) }), auditInputFields: ["id", "responseId"],
  handler: async (input, actor) => {
    const claim = await claimCrawlRecovery.call(input, actor);
    await readCrawlOriginalBody(claim.descriptor);
    return applyCrawlRecovery.call({ ...input, token: claim.token, descriptor: claim.descriptor }, actor);
  },
});

export const restartCrawlReview = defineService({
  name: "imports.restartCrawlReview", summary: "Start a distinct source review while preserving the older generation and its accepted work.", kind: "mutation", permission: "scoped", agentCallable: false, stepUp: true, writeClass: "write",
  input: z.object({ id: z.uuid(), generation: z.uuid(), origin: z.string().url().max(8_192), url: z.string().url().max(8_192), confirmation: z.literal("START NEW SOURCE REVIEW") }),
  output: z.object({ id: z.uuid(), generation: z.uuid() }), auditInputFields: ["id", "generation"],
  handler: async (input, ctx) => {
    await currentOwner(ctx, "imports.restartCrawlReview"); await lockContactIdentityForRead(ctx.tx);
    const [old] = await ctx.tx.select().from(importCrawlSources).where(eq(importCrawlSources.runId, input.id)).limit(1).for("share");
    if (!old || old.generation !== input.generation || old.redactedAt) throw new ServiceError("conflict", "An erased original cannot be recovered or used to reconstruct a new source. Start an unrelated review with its own authority.");
    const run = await ctx.call(startImport, { origin: input.origin, kind: old.kind, approvedMediaOrigins: [] });
    await ctx.call(initializeCrawl, { id: run.id, url: input.url, recoveryOfSourceId: old.id });
    const [created] = await ctx.tx.select({ generation: importCrawlSources.generation }).from(importCrawlSources).where(eq(importCrawlSources.runId, run.id));
    if (!created) throw new ServiceError("internal", "The new original-source review was not saved.");
    ctx.setSubject("import_run", run.id);
    return { id: run.id, generation: created.generation };
  },
});

export const crawlRecoveryServices = [claimCrawlRecovery, applyCrawlRecovery, recoverCrawlResponse, restartCrawlReview];
