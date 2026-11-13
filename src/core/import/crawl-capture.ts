// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: one fresh caller claims actual HTTP work before network/storage I/O.
import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { actorString, defineService, ServiceError, type Actor, type ServiceContext } from "@/core/service";
import { importRuns } from "@/core/plugins/schema";
import { reservePendingMediaObject } from "@/core/media/object-ledger";
import { mediaObjectWrites } from "@/core/media/write-schema";
import { objectKeyDigest } from "@/core/media/write-ledger";
import { assertCurrentImportAuthority, currentImportAuthority } from "./authority";
import { assertSourceStageable } from "./source-lifecycle";
import { assertPublicHttpUrl } from "./contract";
import { crawlTargetSchema } from "./crawl-discovery";
import { sealCrawlManifest } from "./crawl-manifest";
import type { CrawlBodyDescriptor } from "./crawl-body";
import { crawlOriginalFactsSchema, crawlRestCollectionUrl } from "./crawl-original";
import { importCrawlRequests, importCrawlResponses, importCrawlSources } from "./crawl-schema";
import { markImportCrawlWriter } from "./crawl-writer";
import { publicImportRun } from "./privacy";

type Run = typeof importRuns.$inferSelect;
type Source = typeof importCrawlSources.$inferSelect;
type Request = typeof importCrawlRequests.$inferSelect;
type Response = typeof importCrawlResponses.$inferSelect;
type Identity = { kind: "key" | "user"; id: string };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? { ...value as Record<string, unknown> } : {};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function identity(actor: Actor): Identity {
  if ((actor.kind === "user" || actor.kind === "agent") && actor.keyId) return { kind: "key", id: actor.keyId };
  if (actor.kind === "user") return { kind: "user", id: actor.userId };
  throw new ServiceError("permission", "A saved crawl needs the current authenticated caller.");
}
const sameIdentity = (left: Identity, right: Identity) => left.kind === right.kind && left.id === right.id;
function sourceUrl(value: string) {
  const url = assertPublicHttpUrl(value); url.hash = ""; return url;
}

export const initializeCrawl = defineService({
  name: "imports.initializeCrawl", orchestratedBy: "imports.previewFromUrl", external: false,
  summary: "Reserve the actual selected public source and its first robots request.", kind: "mutation", permission: "scoped",
  auditInputFields: ["id"], input: z.object({ id: z.uuid(), url: z.string().url().max(8_192) }), output: z.custom<Run>(),
  handler: async (input, ctx) => {
    await assertCurrentImportAuthority(ctx, "imports.previewFromUrl");
    await lockContactIdentityForRead(ctx.tx); await markImportCrawlWriter(ctx.tx);
    const [run] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1).for("update");
    if (!run) throw new ServiceError("not_found", "No such source import.");
    const [existing] = await ctx.tx.select().from(importCrawlSources).where(eq(importCrawlSources.runId, run.id)).limit(1).for("update");
    const selected = sourceUrl(input.url);
    if (existing) {
      if (existing.sourceUrl !== selected.href || existing.state !== "discovering") throw new ServiceError("conflict", "Resume the unchanged source or start a new import.");
      return publicImportRun(run);
    }
    assertSourceStageable(run);
    if (!run.origin || !["wordpress-rest", "html", "sitemap", "rss", "atom"].includes(run.kind ?? "")) throw new ServiceError("validation", "Use an original export file for this source kind.");
    const site = sourceUrl(run.origin);
    if (site.origin !== selected.origin || run.kind === "wordpress-rest" && crawlRestCollectionUrl(site.href, "pages", 1) !== crawlRestCollectionUrl(selected.href, "pages", 1)) throw new ServiceError("validation", "The URL must belong to the selected original source instance.");
    const generation = randomUUID(), started = new Date(), robots = new URL("/robots.txt", selected).href;
    const [source] = await ctx.tx.insert(importCrawlSources).values({ runId: run.id, generation, kind: run.kind as Source["kind"], siteUrl: site.href, sourceUrl: selected.href, createdBy: actorString(ctx.actor), executorIdentity: identity(await currentImportAuthority(ctx)), sourceStartedAt: started, expiresAt: new Date(started.getTime() + 86_400_000), nextRequestAt: started, requestCounter: 1, metadataBytes: Buffer.byteLength(robots) }).returning();
    if (!source) throw new ServiceError("internal", "The original public source could not be reserved.");
    await ctx.tx.insert(importCrawlRequests).values({ sourceId: source.id, ordinal: 0, url: robots, urlDigest: hash(robots), role: "robots", depth: 0 });
    const [saved] = await ctx.tx.update(importRuns).set({ status: "discover", error: null, preview: {}, counts: { requests: 0, capturedBytes: 0, pages: 0 }, checkpoint: { ...object(run.checkpoint), sourceCrawl: { id: source.id, generation } } }).where(eq(importRuns.id, run.id)).returning();
    ctx.setSubject("import_run", run.id);
    return publicImportRun(saved!);
  },
});

type CaptureClaim = { kind: "claimed" | "discover"; source: Source; request: Request; response: Response; leaseToken: string; policy: CrawlBodyDescriptor | null; policyStatus: 200 | 404 | null } | { kind: "idle" | "recovery" | "index" | "catalog"; source: Source };
export const claimCrawlCapture = defineService({
  name: "imports.claimCrawlCapture", orchestratedBy: "imports.advanceCrawl", external: false,
  summary: "Claim one exact frontier response under current source authority.", kind: "mutation", permission: "scoped",
  auditInputFields: ["id", "generation"], input: z.object({ id: z.uuid(), generation: z.uuid(), storageNamespace: z.string().regex(/^[a-f0-9]{64}$/) }), output: z.custom<CaptureClaim>(),
  handler: async (input, ctx) => {
    await assertCurrentImportAuthority(ctx, "imports.advanceCrawl"); await lockContactIdentityForRead(ctx.tx); await markImportCrawlWriter(ctx.tx);
    const [root] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1).for("update");
    const [source] = await ctx.tx.select().from(importCrawlSources).where(eq(importCrawlSources.runId, input.id)).limit(1).for("update");
    if (!root || !["discover", "previewed"].includes(root.status) || !source || source.generation !== input.generation || !["discovering", "sealed"].includes(source.state) || source.expiresAt.getTime() <= Date.now()) throw new ServiceError("conflict", "This original crawl was replaced, expired or invalidated.");
    if (root.status === "previewed") {
      if (source.state !== "sealed") throw new ServiceError("conflict", "The complete HTTP review lost its original sealed source.");
      return { kind: "catalog" as const, source };
    }
    if (source.state === "sealed") return { kind: "index" as const, source };
    if (source.leaseUntil && source.leaseUntil.getTime() > Date.now()) throw new ServiceError("conflict", "Another source response is still running.");
    // A body or provider outcome already admitted by a prior attempt is a
    // recovery operation, never permission to refetch/overwrite it by time.
    const [pending] = await ctx.tx.select({ id: importCrawlRequests.id }).from(importCrawlRequests).where(and(eq(importCrawlRequests.sourceId, source.id), eq(importCrawlRequests.state, "claimed"))).limit(1);
    if (pending) return { kind: "recovery" as const, source };
    const [discovery] = await ctx.tx.select({ request: importCrawlRequests, response: importCrawlResponses }).from(importCrawlRequests).innerJoin(importCrawlResponses, eq(importCrawlRequests.acceptedResponseId, importCrawlResponses.id)).where(and(eq(importCrawlRequests.sourceId, source.id), eq(importCrawlResponses.state, "stored"), eq(importCrawlResponses.discoveryComplete, false), isNull(importCrawlResponses.retiredAt))).orderBy(asc(importCrawlRequests.ordinal)).limit(1).for("update");
    if (discovery) {
      const leaseToken = randomUUID();
      await ctx.tx.update(importCrawlSources).set({ leaseToken, leaseActor: actorString(ctx.actor), leaseUntil: new Date(Date.now() + 120_000), updatedAt: new Date() }).where(eq(importCrawlSources.id, source.id));
      ctx.setSubject("import_run", root.id);
      return { kind: "discover" as const, source, ...discovery, leaseToken, policy: null, policyStatus: null };
    }
    const [request] = await ctx.tx.select().from(importCrawlRequests).where(and(eq(importCrawlRequests.sourceId, source.id), eq(importCrawlRequests.state, "pending"))).orderBy(asc(importCrawlRequests.ordinal)).limit(1).for("update");
    if (!request) return { kind: "idle" as const, source };
    if (!request.url || !source.siteUrl || !source.sourceUrl || source.networkRequests >= 20010) throw new ServiceError("validation", "The original crawl no longer has a bounded request available.");
    let policy: CrawlBodyDescriptor | null = null, policyStatus: 200 | 404 | null = null;
    if (request.role !== "robots") {
      const [originalPolicy] = source.robotsResponseId ? await ctx.tx.select().from(importCrawlResponses).where(eq(importCrawlResponses.id, source.robotsResponseId)).limit(1) : [];
      if (!originalPolicy || originalPolicy.state !== "stored" || originalPolicy.retiredAt || !originalPolicy.facts || originalPolicy.facts.role !== "robots" || originalPolicy.facts.bytes > 512 * 1024) throw new ServiceError("conflict", "The exact original robots response needs verified recovery.");
      policyStatus = originalPolicy.facts.status;
      policy = { runId: root.id, sourceId: source.id, generation: source.generation, responseId: originalPolicy.id, digest: originalPolicy.facts.digest, bytes: originalPolicy.facts.bytes };
    }
    const remaining = 104_857_600 - source.capturedBytes - source.reservedBytes;
    // The policy is an actual private-object read in this phase too. Charge
    // its entire physical body before admitting the following network body.
    const maximum = Math.min(remaining, request.role === "robots" ? 512 * 1024 : 20 * 1024 * 1024 - policy!.bytes);
    if (maximum <= 0) throw new ServiceError("validation", "This complete source exhausted its original byte budget.");
    const responseId = randomUUID(), leaseToken = randomUUID(), key = `import-crawl/${root.id}/${source.generation}/${responseId}.http`, started = new Date();
    const [response] = await ctx.tx.insert(importCrawlResponses).values({ id: responseId, requestId: request.id, attempt: request.attempts + 1, claimedBy: actorString(ctx.actor), executorIdentity: identity(await currentImportAuthority(ctx)), storageKey: key, keyDigest: objectKeyDigest(key), storageNamespace: input.storageNamespace, reservedBytes: maximum, startedAt: started }).returning();
    if (!response) throw new ServiceError("internal", "The actual response capture could not be reserved.");
    await reservePendingMediaObject(ctx, { key, role: "staged", bytes: maximum, contentType: "application/octet-stream" });
    await ctx.tx.update(importCrawlRequests).set({ state: "claimed", attempts: response.attempt }).where(eq(importCrawlRequests.id, request.id));
    await ctx.tx.update(importCrawlSources).set({ leaseToken, leaseActor: actorString(ctx.actor), leaseUntil: new Date(Date.now() + 120_000), updatedAt: new Date() }).where(eq(importCrawlSources.id, source.id));
    ctx.setSubject("import_run", root.id);
    return { kind: "claimed" as const, source, request, response, leaseToken, policy, policyStatus };
  },
});

const phaseInput = z.object({ id: z.uuid(), generation: z.uuid(), requestId: z.uuid(), responseId: z.uuid(), leaseToken: z.uuid() });
async function lockedPhase(input: z.infer<typeof phaseInput>, ctx: ServiceContext, operation: "capture" | "discovery" = "capture") {
  await assertCurrentImportAuthority(ctx, "imports.advanceCrawl"); await lockContactIdentityForRead(ctx.tx); await markImportCrawlWriter(ctx.tx);
  const [root] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1).for("update");
  const [source] = await ctx.tx.select().from(importCrawlSources).where(eq(importCrawlSources.runId, input.id)).limit(1).for("update");
  const [request] = await ctx.tx.select().from(importCrawlRequests).where(eq(importCrawlRequests.id, input.requestId)).limit(1).for("update");
  const [response] = await ctx.tx.select().from(importCrawlResponses).where(eq(importCrawlResponses.id, input.responseId)).limit(1).for("update");
  if (!root || root.status !== "discover" || !source || source.state !== "discovering" || source.generation !== input.generation || source.expiresAt.getTime() <= Date.now() || source.leaseToken !== input.leaseToken || source.leaseActor !== actorString(ctx.actor) || !source.leaseUntil || source.leaseUntil.getTime() <= Date.now() || !request || request.sourceId !== source.id || (operation === "capture" ? request.state !== "claimed" : request.state !== "accepted") || !response || response.requestId !== request.id || response.attempt !== request.attempts || operation === "capture" && !sameIdentity(response.executorIdentity, identity(await currentImportAuthority(ctx)))) throw new ServiceError("conflict", "This response lost its original source, caller or lease.");
  return { root, source, request, response };
}

export const admitCrawlFetch = defineService({
  name: "imports.admitCrawlFetch", orchestratedBy: "imports.advanceCrawl", external: false,
  summary: "Admit a bounded original GET only after its exact robots decision.", kind: "mutation", permission: "scoped",
  auditInputFields: ["id", "requestId", "responseId"],
  input: phaseInput.extend({ allowed: z.boolean(), robotsResponseId: z.uuid().nullable(), robotsDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable() }), output: z.object({ admitted: z.boolean(), waitMs: z.number().int().nonnegative() }),
  handler: async (input, ctx) => {
    const { source, request, response } = await lockedPhase(input, ctx);
    if (response.state !== "reserved") throw new ServiceError("conflict", "This original GET was already admitted.");
    if (request.role !== "robots") {
      const [policy] = source.robotsResponseId ? await ctx.tx.select().from(importCrawlResponses).where(eq(importCrawlResponses.id, source.robotsResponseId)).limit(1) : [];
      if (!policy || policy.state !== "stored" || input.robotsResponseId !== policy.id || input.robotsDigest !== policy.facts?.digest) throw new ServiceError("conflict", "Read the captured original robots response before admitting this URL.");
    } else if (!input.allowed || input.robotsResponseId !== null || input.robotsDigest !== null) throw new ServiceError("conflict", "The original robots request cannot inherit another policy.");
    if (!input.allowed) {
      await ctx.tx.update(importCrawlResponses).set({ state: "retired", retiredAt: new Date() }).where(eq(importCrawlResponses.id, response.id));
      await ctx.tx.update(importCrawlRequests).set({ state: "blocked" }).where(eq(importCrawlRequests.id, request.id));
      await ctx.tx.update(importCrawlSources).set({ leaseToken: null, leaseActor: null, leaseUntil: null, updatedAt: new Date() }).where(eq(importCrawlSources.id, source.id));
      await ctx.queueJob("core.deleteCaptureObjects", { keys: [response.storageKey!] });
      ctx.setSubject("import_run", input.id);
      return { admitted: false, waitMs: 0 };
    }
    if (source.reservedBytes + source.capturedBytes + response.reservedBytes > 104_857_600 || source.networkRequests >= 20010) throw new ServiceError("validation", "This source exceeded its complete capture budget.");
    const waitMs = Math.max(0, source.nextRequestAt.getTime() - Date.now());
    await ctx.tx.update(importCrawlResponses).set({ state: "admitted" }).where(eq(importCrawlResponses.id, response.id));
    await ctx.tx.update(importCrawlSources).set({ reservedBytes: source.reservedBytes + response.reservedBytes, networkRequests: source.networkRequests + 1, nextRequestAt: new Date(Date.now() + waitMs + 500), updatedAt: new Date() }).where(eq(importCrawlSources.id, source.id));
    ctx.setSubject("import_run", input.id);
    return { admitted: true, waitMs };
  },
});

export const authorizeCrawlFetch = defineService({
  name: "imports.authorizeCrawlFetch", orchestratedBy: "imports.advanceCrawl", external: false,
  summary: "Recheck the actual caller after rate pacing and immediately before the original GET.", kind: "query", permission: "scoped",
  input: phaseInput, output: z.object({ admitted: z.literal(true) }),
  handler: async (input, ctx) => {
    const { response } = await lockedPhase(input, ctx);
    if (response.state !== "admitted") throw new ServiceError("conflict", "The original network read is no longer admitted.");
    return { admitted: true as const };
  },
});

export const recordCrawlResponse = defineService({
  name: "imports.recordCrawlResponse", orchestratedBy: "imports.advanceCrawl", external: false,
  summary: "Bind actual HTTP response facts before private physical storage admission.", kind: "mutation", permission: "scoped",
  auditInputFields: ["id", "requestId", "responseId"], input: phaseInput.extend({ facts: crawlOriginalFactsSchema }), output: z.object({ key: z.string(), namespace: z.string() }),
  handler: async (input, ctx) => {
    const { source, request, response } = await lockedPhase(input, ctx);
    if (response.state !== "admitted" || input.facts.requestedUrl !== request.url || input.facts.role !== request.role || input.facts.bytes > response.reservedBytes || !response.storageKey) throw new ServiceError("conflict", "These bytes do not belong to the admitted original HTTP request.");
    if (request.role === "rest-pages" || request.role === "rest-posts") {
      const prior = await ctx.tx.select({ facts: importCrawlResponses.facts }).from(importCrawlRequests).innerJoin(importCrawlResponses, eq(importCrawlRequests.acceptedResponseId, importCrawlResponses.id)).where(and(eq(importCrawlRequests.sourceId, source.id), eq(importCrawlRequests.role, request.role), ne(importCrawlResponses.id, response.id)));
      if (prior.some(row => row.facts?.totalRecords !== input.facts.totalRecords || row.facts?.totalPages !== input.facts.totalPages)) throw new ServiceError("conflict", "The original WordPress collection totals changed during capture.");
    }
    const metadataBytes = Buffer.byteLength(JSON.stringify(input.facts));
    if (source.metadataBytes + metadataBytes > 16 * 1024 * 1024) throw new ServiceError("validation", "The complete HTTP source exceeds its metadata budget.");
    await ctx.tx.update(importCrawlResponses).set({ state: "fetched", facts: input.facts, receivedAt: new Date() }).where(eq(importCrawlResponses.id, response.id));
    await ctx.tx.update(importCrawlSources).set({ capturedBytes: source.capturedBytes + input.facts.bytes, reservedBytes: source.reservedBytes - response.reservedBytes, metadataBytes: source.metadataBytes + metadataBytes, updatedAt: new Date() }).where(eq(importCrawlSources.id, source.id));
    ctx.setSubject("import_run", input.id);
    return { key: response.storageKey, namespace: response.storageNamespace };
  },
});

export const acceptCrawlObject = defineService({
  name: "imports.acceptCrawlObject", orchestratedBy: "imports.advanceCrawl", external: false,
  summary: "Accept only the actual original private PUT receipt for this HTTP response.", kind: "mutation", permission: "scoped",
  auditInputFields: ["id", "requestId", "responseId"], input: phaseInput, output: z.object({ accepted: z.literal(true) }),
  handler: async (input, ctx) => {
    const { source, request, response } = await lockedPhase(input, ctx);
    const receipts = await ctx.tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.keyDigest, response.keyDigest));
    const accepted = receipts.find(receipt => receipt.operation === "put" && receipt.state === "accepted" && receipt.namespace === response.storageNamespace && receipt.sha256 === response.facts?.digest && receipt.bytes === response.facts?.bytes && !receipt.deletedAt);
    if (!["fetched", "put_unknown"].includes(response.state) || !response.facts || !accepted || receipts.some(receipt => ["unverified", "started", "unknown"].includes(receipt.state))) throw new ServiceError("conflict", "The actual original private response receipt is not settled.");
    await ctx.tx.update(importCrawlResponses).set({ state: "stored", providerAcceptedAt: accepted.observedAcceptedAt }).where(eq(importCrawlResponses.id, response.id));
    await ctx.tx.update(importCrawlRequests).set({ state: "accepted", acceptedResponseId: response.id }).where(eq(importCrawlRequests.id, request.id));
    await ctx.tx.update(importCrawlSources).set({ ...(request.role === "robots" ? { robotsResponseId: response.id } : {}), leaseToken: null, leaseActor: null, leaseUntil: null, updatedAt: new Date() }).where(eq(importCrawlSources.id, source.id));
    ctx.setSubject("import_run", input.id);
    return { accepted: true as const };
  },
});

export const rememberCrawlCaptureFailure = defineService({
  name: "imports.rememberCrawlCaptureFailure", orchestratedBy: "imports.advanceCrawl", external: false,
  summary: "Retain unresolved original I/O without treating a clock or exception as cancellation.", kind: "mutation", permission: "scoped",
  auditInputFields: ["id", "responseId"], input: phaseInput, output: z.object({ pending: z.literal(true) }),
  handler: async (input, ctx) => {
    const { source, response } = await lockedPhase(input, ctx);
    // A failed PUT may already be physically accepted. Its immutable facts
    // and key stay available to the physical receipt reconciler and holds.
    if (response.state === "fetched") await ctx.tx.update(importCrawlResponses).set({ state: "put_unknown" }).where(eq(importCrawlResponses.id, response.id));
    await ctx.tx.update(importCrawlSources).set({ leaseToken: null, leaseActor: null, leaseUntil: null, updatedAt: new Date() }).where(eq(importCrawlSources.id, source.id));
    await ctx.tx.update(importRuns).set({ error: "The original response needs recovery before this crawl can continue." }).where(eq(importRuns.id, input.id));
    ctx.setSubject("import_run", input.id);
    return { pending: true as const };
  },
});

export const applyCrawlDiscovery = defineService({
  name: "imports.applyCrawlDiscovery", orchestratedBy: "imports.advanceCrawl", external: false,
  summary: "Accept one bounded original-response frontier window exactly once.", kind: "mutation", permission: "scoped",
  auditInputFields: ["id", "responseId", "previous", "next"],
  input: phaseInput.extend({ digest: z.string().regex(/^[a-f0-9]{64}$/), previous: z.number().int().min(0).max(20010), next: z.number().int().min(0).max(20010), done: z.boolean(), targets: crawlTargetSchema.array().max(500), pageRecords: z.number().int().min(0).max(100) }), output: z.custom<Run>(),
  handler: async (input, ctx) => {
    const { root, source, request, response } = await lockedPhase(input, ctx, "discovery");
    if (response.state !== "stored" || response.discoveryComplete || response.discoveryOrdinal !== input.previous || response.facts?.digest !== input.digest || input.next - input.previous !== input.targets.length || (!input.done && input.next === input.previous) || (input.previous > 0 && input.pageRecords !== 0) || !source.siteUrl) throw new ServiceError("conflict", "The original response discovery cursor changed.");
    if (source.pageCount + input.pageRecords > 10000) throw new ServiceError("validation", "This complete source exceeds its 10,000-record budget.");
    let count = source.requestCounter, metadataBytes = source.metadataBytes;
    for (const target of input.targets) {
      const url = assertPublicHttpUrl(target.url);
      if (url.origin !== new URL(source.siteUrl).origin || url.hash || url.href !== target.url || target.entryMetadata && (target.entryMetadata.url !== target.url || !["rss", "atom"].includes(request.role))) throw new ServiceError("conflict", "The frontier target lost its original source or feed binding.");
      if ((target.role === "rest-pages" || target.role === "rest-posts") && (source.kind !== "wordpress-rest" || target.url !== crawlRestCollectionUrl(source.siteUrl, target.role === "rest-pages" ? "pages" : "posts", target.restPage ?? 1))) throw new ServiceError("conflict", "The frontier target belongs to another WordPress instance.");
      const digest = hash(url.href), [existing] = await ctx.tx.select({ url: importCrawlRequests.url }).from(importCrawlRequests).where(and(eq(importCrawlRequests.sourceId, source.id), eq(importCrawlRequests.role, target.role), eq(importCrawlRequests.urlDigest, digest))).limit(1);
      if (existing) { if (existing.url !== target.url) throw new ServiceError("conflict", "The original URL identity no longer matches its frontier."); continue; }
      metadataBytes += Buffer.byteLength(JSON.stringify(target));
      if (count >= 20010 || metadataBytes > 16 * 1024 * 1024) throw new ServiceError("validation", "The complete source exceeds its frontier or metadata budget.");
      await ctx.tx.insert(importCrawlRequests).values({ sourceId: source.id, ordinal: count++, url: target.url, urlDigest: digest, role: target.role, depth: target.depth, restPage: target.restPage ?? null, discoveredByResponseId: response.id, entryMetadata: target.entryMetadata ?? null });
    }
    await ctx.tx.update(importCrawlResponses).set({ discoveryOrdinal: input.next, discoveryComplete: input.done }).where(eq(importCrawlResponses.id, response.id));
    await ctx.tx.update(importCrawlSources).set({ requestCounter: count, metadataBytes, pageCount: source.pageCount + input.pageRecords, leaseToken: null, leaseActor: null, leaseUntil: null, updatedAt: new Date() }).where(eq(importCrawlSources.id, source.id));
    const [saved] = await ctx.tx.update(importRuns).set({ counts: { ...object(root.counts), requests: source.networkRequests, capturedBytes: source.capturedBytes, pages: source.pageCount + input.pageRecords }, error: null }).where(eq(importRuns.id, root.id)).returning();
    ctx.setSubject("import_run", input.id);
    return publicImportRun(saved!);
  },
});

export const sealOriginalCrawl = defineService({
  name: "imports.sealOriginalCrawl", orchestratedBy: "imports.advanceCrawl", external: false,
  summary: "Seal the exact completed original response membership without inventing an uploaded export.", kind: "mutation", permission: "scoped",
  auditInputFields: ["id", "generation"], input: z.object({ id: z.uuid(), generation: z.uuid() }), output: z.object({ sourceRevision: z.string().regex(/^[a-f0-9]{64}$/) }),
  handler: async (input, ctx) => {
    await assertCurrentImportAuthority(ctx, "imports.advanceCrawl");
    await lockContactIdentityForRead(ctx.tx); await markImportCrawlWriter(ctx.tx);
    const [root] = await ctx.tx.select().from(importRuns).where(eq(importRuns.id, input.id)).limit(1).for("update");
    const [source] = await ctx.tx.select().from(importCrawlSources).where(eq(importCrawlSources.runId, input.id)).limit(1).for("update");
    if (!root || root.status !== "discover" || !source || source.generation !== input.generation || source.state !== "discovering" || source.expiresAt.getTime() <= Date.now() || source.leaseUntil && source.leaseUntil.getTime() > Date.now() || !source.siteUrl || !source.sourceUrl || !source.robotsResponseId) throw new ServiceError("conflict", "The actual original crawl is not available for sealing.");
    const rows = await ctx.tx.select({ request: importCrawlRequests, response: importCrawlResponses }).from(importCrawlRequests).leftJoin(importCrawlResponses, eq(importCrawlRequests.acceptedResponseId, importCrawlResponses.id)).where(eq(importCrawlRequests.sourceId, source.id)).orderBy(asc(importCrawlRequests.ordinal));
    const requests = rows.map(({ request, response }) => {
      if (!request.url || !request.urlDigest) throw new ServiceError("conflict", "An original frontier URL was retired before source acceptance.");
      return { ...request, url: request.url, urlDigest: request.urlDigest, original: response };
    });
    let revision: string;
    try { revision = sealCrawlManifest({ ...source, siteUrl: source.siteUrl, sourceUrl: source.sourceUrl, robotsResponseId: source.robotsResponseId }, requests).revision; }
    catch { throw new ServiceError("conflict", "The complete original response frontier still needs verified recovery before source acceptance."); }
    await ctx.tx.update(importCrawlSources).set({ state: "sealed", sourceRevision: revision, leaseToken: null, leaseActor: null, leaseUntil: null, updatedAt: new Date() }).where(eq(importCrawlSources.id, source.id));
    await ctx.tx.update(importRuns).set({ checkpoint: { ...object(root.checkpoint), sourceCrawl: { id: source.id, generation: source.generation, revision } }, error: null }).where(eq(importRuns.id, root.id));
    ctx.setSubject("import_run", input.id);
    return { sourceRevision: revision };
  },
});

export default [sealOriginalCrawl, initializeCrawl, claimCrawlCapture, admitCrawlFetch, authorizeCrawlFetch, recordCrawlResponse, acceptCrawlObject, rememberCrawlCaptureFailure, applyCrawlDiscovery];
