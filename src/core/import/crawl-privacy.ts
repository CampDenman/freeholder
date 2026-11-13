// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: opaque original HTTP bodies never imply a reader's CRM ownership.
// Source-only registration is explicit; this module does not register at import.
import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/core/db";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { registerPendingObjectOwner } from "@/core/media/object-ledger";
import { registerStorageObservationReconciler } from "@/core/media/observation-hooks";
import { mediaObjects } from "@/core/media/schema";
import { mediaObjectWrites } from "@/core/media/write-schema";
import { completeErasureJob, registerContactPrivacySource, reopenErasureJob } from "@/core/privacy/service";
import { privacyRetentionExceptions } from "@/core/privacy/schema";
import { completeRetentionSourceSnapshot, retentionSourceSnapshotIsComplete } from "@/core/privacy/retention-snapshots";
import { importRuns, importSourceGraphs } from "@/core/plugins/schema";
import { defineService, ServiceError, type ServiceContext, type Tx } from "@/core/service";
import { deleteWithReceipt, discardUnwrittenObjectReservation } from "@/core/media/write-ledger";
import { boundStorage } from "@/adapters/storage";
import { importCrawlRequests, importCrawlResponseErasures, importCrawlResponses, importCrawlSources } from "./crawl-schema";
import { markImportCrawlWriter } from "./crawl-writer";
import { captureCrawlErasureScope, crawlErasureGuardsAvailable, hasAppliedCrawlRetirementEvidence, hasOriginalCrawlRecoveryEvidence, originalCrawlScopeIsComplete } from "./crawl-erasure-scope";
import { assertCrawlMediaMinimizable, minimizeCrawlInputProjections, minimizeCrawlRootInput } from "./crawl-projection-privacy";
import { registerImportOriginalCollector, type ImportOriginalCaptureContext, type ImportOriginalMember } from "./source-retention";

export const CRAWL_ERASURE_SCOPE = "imports.crawlOriginals";
export const CRAWL_ERASURE_JOB = "core.eraseCrawlOriginals";
export const CRAWL_RECONCILIATION_JOB = "core.reconcileCrawlOriginals";
let privacyRegistered = false;
const erasureInput = z.object({ requestId: z.uuid(), responseIds: z.uuid().array().min(1).max(25) });

async function held(tx: Tx, responseId: string): Promise<boolean> {
  const [row] = await tx.execute<{ held: boolean }>(sql`select freeholder_crawl_response_held(${responseId}::uuid) as held`);
  return Boolean(row?.held);
}

/** Privacy has already locked the shared contact identity. Lock original roots
 * before their source/response rows, just as the ordinary capture phases do. */
async function* originalSources(tx: Tx) {
  let previous: string | undefined;
  while (true) {
    const [candidate] = await tx.select({ id: importCrawlSources.id, runId: importCrawlSources.runId }).from(importCrawlSources).where(previous ? gt(importCrawlSources.id, previous) : undefined).orderBy(asc(importCrawlSources.id)).limit(1);
    if (!candidate) return;
    await tx.select({ id: importRuns.id }).from(importRuns).where(eq(importRuns.id, candidate.runId)).for("update");
    const [source] = await tx.select().from(importCrawlSources).where(eq(importCrawlSources.id, candidate.id)).for("update");
    previous = candidate.id;
    if (source) yield source;
  }
}

async function bindOriginalResponses(tx: Tx, sourceId: string, requestId: string) {
  const responses = await tx.select().from(importCrawlResponses).innerJoin(importCrawlRequests, eq(importCrawlResponses.requestId, importCrawlRequests.id)).where(and(eq(importCrawlRequests.sourceId, sourceId), or(isNull(importCrawlResponses.redactedAt), sql`exists(select 1 from media_object_writes physical where physical.key_digest=${importCrawlResponses.keyDigest} and (physical.state in ('unverified','started','unknown') or physical.operation_kind='put' and physical.deleted_at is null))`))).orderBy(asc(importCrawlResponses.id)).for("update", { of: importCrawlResponses });
  for (let offset = 0; offset < responses.length; offset += 500) {
    const rows = responses.slice(offset, offset + 500);
    await tx.insert(importCrawlResponseErasures).values(rows.map(row => ({ requestId, responseId: row.import_crawl_responses.id }))).onConflictDoNothing();
  }
  return responses.map(row => row.import_crawl_responses);
}

async function captureOriginalGenerations(tx: Tx, context: ImportOriginalCaptureContext): Promise<ImportOriginalMember[]> {
  if (!context.isNew || context.service.tx !== tx) throw new ServiceError("internal", "Original HTTP membership requires its actual first hold transaction.");
  const [deleting] = await tx.select({ id: mediaObjectWrites.id }).from(mediaObjectWrites).where(and(
    eq(mediaObjectWrites.operation, "delete"), sql`${mediaObjectWrites.key} like 'import-crawl/%'`,
    inArray(mediaObjectWrites.state, ["unverified", "started", "unknown"]),
  )).limit(1);
  if (deleting) throw new ServiceError("conflict", "An original HTTP deletion is unresolved. Review its original storage receipt before retaining these sources.");
  await markImportCrawlWriter(tx);
  const members: ImportOriginalMember[] = [];
  for await (const source of originalSources(tx)) {
    members.push({ sourceId: source.id, generation: source.generation });
    if (members.length > 10_000) throw new ServiceError("conflict", "These original HTTP generations need bounded owner review.");
  }
  // A general writer marker can also be set by ordinary imports mutations.
  // Record this actual hold's capture separately, including known empty. The
  // deferred fence checks this digest against canonical members after the
  // joint legacy+HTTP collector has completed its one normalized receipt.
  const sourceScope = await originalHoldFamily(tx, context.exceptionId);
  const capturedDigest = createHash("sha256").update(members.map(member => `${member.sourceId}:${member.generation}`).sort().join("|")).digest("hex");
  await tx.execute(sql`select set_config('freeholder.import_crawl_hold_captures',
    (coalesce(nullif(current_setting('freeholder.import_crawl_hold_captures',true),''),'{}')::jsonb
      || jsonb_build_object(${context.exceptionId}::text,jsonb_build_object('sourceScope',${sourceScope}::text,'count',${members.length}::integer,'digest',${capturedDigest}::text)))::text,true)`);
  return members;
}

async function originalHoldFamily(tx: Tx, exceptionId: string): Promise<string> {
  const [hold] = await tx.select({ scope: privacyRetentionExceptions.scope }).from(privacyRetentionExceptions).where(eq(privacyRetentionExceptions.id, exceptionId)).limit(1);
  if (!hold || ![CRAWL_ERASURE_SCOPE, "cms.readerComments", "imports.readerSources"].includes(hold.scope)) throw new ServiceError("conflict", "The original HTTP hold is no longer available.");
  return hold.scope === CRAWL_ERASURE_SCOPE ? CRAWL_ERASURE_SCOPE : "imports.readerSources";
}

/** Actual current-request cleanup remains separate from per-hold validation.
 * Cohorts include held responses for a later release, but actual pending jobs
 * include only originals excluded from every live canonical hold when the
 * core receipt already has a retained outcome. A full-erasure outcome instead
 * keeps held real response jobs pending, and refuses held zero-response
 * metadata rather than claiming that those facts were erased.
 */
async function eraseUnheldCrawlOriginals(tx: Tx, context: { requestId: string; service: ServiceContext }, retainHeld = true) {
  if (context.service.tx !== tx) throw new ServiceError("internal", "Original HTTP cleanup requires its actual privacy transaction.");
  await markImportCrawlWriter(tx);
  const originalScope = await captureCrawlErasureScope(context.service, context.requestId);
  const sourceMembers = new Set(originalScope.sources.map(row => `${row.sourceId}:${row.generation}`));
  let affected = 0;
  const pendingJobs: string[] = [];
  for await (const source of originalSources(tx)) {
    if (!sourceMembers.has(`${source.id}:${source.generation}`)) continue;
    const responses = await bindOriginalResponses(tx, source.id, context.requestId);
    const [sourceHold] = await tx.execute<{ held: boolean }>(sql`select freeholder_crawl_source_held(${source.id}::uuid,${source.generation}::uuid) as held`);
    if (!retainHeld && sourceHold?.held && !responses.length) throw new ServiceError("conflict", "Original HTTP metadata remains legally held. Review its existing hold before completing this erasure.");
    await tx.update(importCrawlSources).set({ state: "invalidated", leaseToken: null, leaseActor: null, leaseUntil: null, updatedAt: new Date() }).where(eq(importCrawlSources.id, source.id));
    await tx.update(importSourceGraphs).set({ state: "invalidated", leaseToken: null, leaseActor: null, leaseUntil: null, updatedAt: new Date() }).where(eq(importSourceGraphs.runId, source.runId));
    const [run] = await tx.select().from(importRuns).where(eq(importRuns.id, source.runId));
    if (run && !["committed", "reconciled", "published", "rolled_back"].includes(run.status)) {
      await tx.update(importRuns).set({ status: "failed", error: "Original HTTP sources were retired by a reader erasure. Start a reviewed new source." }).where(eq(importRuns.id, run.id));
    }
    const unheld: string[] = [];
    for (const response of responses) {
      await tx.update(importCrawlResponses).set({ state: "retired", retiredAt: response.retiredAt ?? new Date() }).where(eq(importCrawlResponses.id, response.id));
      if (!retainHeld || !await held(tx, response.id)) unheld.push(response.id);
    }
    // No response row exists to protect the original URL of a zero-response
    // generation; its canonical source membership is checked independently.
    if (!responses.length && !sourceHold?.held) {
      await tx.update(importCrawlRequests).set({ url: null, urlDigest: null, entryMetadata: null, redactedAt: sql`coalesce(${importCrawlRequests.redactedAt},now())` }).where(eq(importCrawlRequests.sourceId, source.id));
      await tx.update(importCrawlSources).set({ siteUrl: null, sourceUrl: null, redactedAt: source.redactedAt ?? new Date(), updatedAt: new Date() }).where(eq(importCrawlSources.id, source.id));
      await minimizeCrawlRootInput(tx, source.id);
    }
    for (let offset = 0; offset < unheld.length; offset += 25) {
      const originalJobId = randomUUID();
      const job = await context.service.queueJob(CRAWL_ERASURE_JOB, { requestId: context.requestId, originalJobId, responseIds: unheld.slice(offset, offset + 25) }, { id: originalJobId });
      pendingJobs.push(job.id);
    }
    affected += unheld.length;
  }
  for (let at = 0; at < originalScope.responseIds.length; at += 500) await minimizeCrawlInputProjections(tx, originalScope.responseIds.slice(at, at + 500));
  return { affected, pendingJobs };
}

/** No current mailbox, executor contact or URL establishes who wrote opaque
 * original text. Exports return no opaque body; erasure conservatively retires
 * the actual originals present in its transaction. The IDs are durable scope
 * membership, not retrospective authorship. */
export function registerCrawlPrivacy(): void {
  if (privacyRegistered) return;
  registerImportOriginalCollector("http-originals", captureOriginalGenerations);
  registerContactPrivacySource({
    scope: CRAWL_ERASURE_SCOPE,
    tables: ["import_crawl_sources", "import_crawl_requests", "import_crawl_responses", "import_crawl_response_erasures", "import_crawl_graphs", "import_crawl_entry_originals", "import_crawl_erasure_scopes", "import_crawl_erasure_sources"],
    retentionScopes: ["cms.readerComments", "imports.readerSources"], eraseOrder: 9,
    exportData: async () => [],
    captureRetention: async (tx, _contactId, context) => {
      const family = await originalHoldFamily(tx, context.exceptionId);
      // The real legacy callback collects both source formats and seals this
      // shared family once. Never create its empty receipt in this earlier
      // callback, or adopt a later generation during renewal/fulfillment.
      if (family === "imports.readerSources") return;
      if (!context.isNew) {
        if (!await retentionSourceSnapshotIsComplete(tx, context.exceptionId, family)) throw new ServiceError("conflict", "Review this older hold's original HTTP generations before changing it.");
        return;
      }
      const members = await captureOriginalGenerations(tx, context);
      await completeRetentionSourceSnapshot(context.service, { exceptionId: context.exceptionId, requestId: context.requestId, sourceScope: family, isNew: context.isNew, members });
    },
    retain: async (tx, _contactId, context) => {
      await markImportCrawlWriter(tx);
      if (!await retentionSourceSnapshotIsComplete(tx, context.exceptionId, await originalHoldFamily(tx, context.exceptionId))) throw new ServiceError("conflict", "Review this older hold's original HTTP generations before fulfilling the request.");
    },
    erase: async (tx, _contactId, context) => {
      if (!context.service) throw new ServiceError("internal", "Original HTTP erasure requires the real privacy service context.");
      return eraseUnheldCrawlOriginals(tx, { requestId: context.requestId, service: context.service }, false);
    },
    eraseUnheld: (tx, _contactId, context) => eraseUnheldCrawlOriginals(tx, context),
  });
  registerPendingObjectOwner("import-crawl/", async (key, _now, tx?: Tx) => {
    const [row] = await (tx ?? db()).execute<{ owned: boolean }>(sql`
      select exists(select 1 from import_crawl_responses original
       where original.storage_key=${key} and (original.retired_at is null
         or freeholder_crawl_response_held(original.id)
         or exists(select 1 from media_object_writes physical where physical.key_digest=original.key_digest and physical.state in ('unverified','started','unknown')))) as owned
    `);
    return Boolean(row?.owned);
  });
  registerStorageObservationReconciler("imports.crawlOriginals", async receiptId => {
    await reconcileCrawlOriginalObservation.call({ receiptId }, { kind: "system" });
  });
  privacyRegistered = true;
}

async function originalErasureRows(tx: Tx, input: z.infer<typeof erasureInput>) {
  await lockContactIdentityForRead(tx);
  await markImportCrawlWriter(tx);
  const rows = await tx.select({ response: importCrawlResponses }).from(importCrawlResponseErasures).innerJoin(importCrawlResponses, eq(importCrawlResponseErasures.responseId, importCrawlResponses.id)).where(and(eq(importCrawlResponseErasures.requestId, input.requestId), inArray(importCrawlResponses.id, input.responseIds))).orderBy(asc(importCrawlResponses.id)).for("update", { of: importCrawlResponses });
  if (rows.length !== new Set(input.responseIds).size) throw new ServiceError("conflict", "Restore the exact original HTTP erasure membership before continuing.");
  if (!await originalCrawlScopeIsComplete(tx, input.requestId) && !await hasOriginalCrawlRecoveryEvidence(tx, input.requestId)) throw new ServiceError("conflict", "This original HTTP erasure needs valid original scope or retired-response recovery evidence.");
  for (const { response } of rows) if (!response.retiredAt || await held(tx, response.id)) throw new ServiceError("conflict", "The original HTTP response is active or legally held.");
  return rows.map(row => row.response);
}

export const claimCrawlOriginalErasure = defineService({
  name: "imports.claimCrawlOriginalErasure", summary: "Check original erasure membership and settled facts before private HTTP deletion.",
  kind: "mutation", permission: "system", external: false,
  auditInputFields: ["requestId", "responseIds"], input: erasureInput, output: z.object({ keys: z.string().array().max(25) }),
  handler: async (input, ctx) => {
    const rows = await originalErasureRows(ctx.tx, input), keys: string[] = [];
    await assertCrawlMediaMinimizable(ctx.tx, input.responseIds);
    for (const response of rows) {
      const receipts = await ctx.tx.select({ state: mediaObjectWrites.state }).from(mediaObjectWrites).where(eq(mediaObjectWrites.keyDigest, response.keyDigest));
      if (receipts.some(row => ["unverified", "started", "unknown"].includes(row.state))) throw new ServiceError("conflict", "The original HTTP physical operation is still unresolved.");
      if (response.storageKey) keys.push(response.storageKey);
    }
    ctx.setSubject("dataRequest", input.requestId);
    return { keys };
  },
});

/** Expiry and reader erasure share physical absence checks, never identity.
 * The caller first locks these original rows and establishes retirement.
 */
export async function minimizeRetiredCrawlResponses(tx: Tx, rows: Array<typeof importCrawlResponses.$inferSelect>): Promise<void> {
    for (const response of rows) {
      const receipts = await tx.select().from(mediaObjectWrites).where(eq(mediaObjectWrites.keyDigest, response.keyDigest));
      const [reserved] = response.storageKey ? await tx.select({ key: mediaObjects.key }).from(mediaObjects).where(eq(mediaObjects.key, response.storageKey)).limit(1) : [];
      if (reserved || receipts.some(row => ["unverified", "started", "unknown"].includes(row.state) || row.operation === "put" && !row.deletedAt)) throw new ServiceError("conflict", "Original HTTP bytes or an unresolved physical fact keep erasure pending.");
      // The opaque UUID key/digest/namespace and original executor witness are
      // retained for a later positive receipt. They never disclose old text.
      await tx.update(importCrawlResponses).set({ state: "retired", facts: null, redactedAt: response.redactedAt ?? new Date() }).where(eq(importCrawlResponses.id, response.id));
      const [request] = await tx.select().from(importCrawlRequests).where(eq(importCrawlRequests.id, response.requestId)).limit(1);
      if (!request) throw new ServiceError("conflict", "Restore the original HTTP request before minimizing its response.");
      const [remaining] = await tx.select({ id: importCrawlResponses.id }).from(importCrawlResponses).where(and(eq(importCrawlResponses.requestId, request.id), isNull(importCrawlResponses.redactedAt))).limit(1);
      if (!remaining) await tx.update(importCrawlRequests).set({ url: null, urlDigest: null, entryMetadata: null, redactedAt: sql`coalesce(${importCrawlRequests.redactedAt},now())` }).where(eq(importCrawlRequests.id, request.id));
      const [sourceRemaining] = await tx.select({ id: importCrawlResponses.id }).from(importCrawlRequests).innerJoin(importCrawlResponses, eq(importCrawlRequests.id, importCrawlResponses.requestId)).where(and(eq(importCrawlRequests.sourceId, request.sourceId), isNull(importCrawlResponses.redactedAt))).limit(1);
      if (!sourceRemaining) {
        await tx.update(importCrawlRequests).set({ url: null, urlDigest: null, entryMetadata: null, redactedAt: sql`coalesce(${importCrawlRequests.redactedAt},now())` }).where(eq(importCrawlRequests.sourceId, request.sourceId));
        await tx.update(importCrawlSources).set({ siteUrl: null, sourceUrl: null, redactedAt: sql`coalesce(${importCrawlSources.redactedAt},now())`, updatedAt: new Date() }).where(eq(importCrawlSources.id, request.sourceId));
      }
    }
    await minimizeCrawlInputProjections(tx, rows.map(row => row.id));
}

export const confirmCrawlOriginalErasure = defineService({
  name: "imports.confirmCrawlOriginalErasure", summary: "Minimize HTTP facts only after original private bytes and reservations are actually retired.",
  kind: "mutation", permission: "system", external: false,
  auditInputFields: ["requestId", "responseIds"], input: erasureInput, output: z.object({ erased: z.number().int().nonnegative() }),
  handler: async (input, ctx) => {
    const rows = await originalErasureRows(ctx.tx, input);
    await minimizeRetiredCrawlResponses(ctx.tx, rows);
    ctx.setSubject("dataRequest", input.requestId);
    return { erased: rows.length };
  },
});

/** Called by a durable registered worker, outside any provider-holding TX. */
export async function eraseCrawlOriginals(data: Record<string, unknown>): Promise<{ erased: number }> {
  const input = erasureInput.extend({ originalJobId: z.uuid() }).parse(data);
  if (!await crawlErasureGuardsAvailable(db())) throw new ServiceError("conflict", "The original HTTP erasure needs reviewed guarded-schema recovery before further physical cleanup or acknowledgement.");
  const { keys } = await claimCrawlOriginalErasure.call(input, { kind: "system" });
  const captured = await boundStorage();
  if (captured.store.isPublic) throw new ServiceError("conflict", "Original HTTP erasure needs the exact original private resource.");
  for (const key of keys) if (!await discardUnwrittenObjectReservation(key) && !await deleteWithReceipt(key, captured)) throw new ServiceError("conflict", "The original HTTP physical deletion remains unresolved.");
  const result = await confirmCrawlOriginalErasure.call(input, { kind: "system" });
  const scopeComplete = await originalCrawlScopeIsComplete(db(), input.requestId);
  if (!scopeComplete) throw new ServiceError("conflict", "The known original responses were repaired, but their complete original erasure scope still needs reviewed recovery.");
  await completeErasureJob.call({ requestId: input.requestId, scope: CRAWL_ERASURE_SCOPE, jobId: input.originalJobId }, { kind: "system" });
  return result;
}

/** Both a committed receipt hook and a periodic fallback enter this actual
 * SYSTEM service. Durable queue admission and receipt reopening share its TX;
 * the earlier physical observation cannot be rolled back by a callback error. */
export const reconcileCrawlOriginalObservation = defineService({
  name: "imports.reconcileCrawlOriginalObservation", summary: "Admit original-scope HTTP erasure retry after committed physical evidence.",
  kind: "mutation", permission: "system", external: false,
  auditInputFields: ["receiptId"], input: z.object({ receiptId: z.uuid().optional(), after: z.uuid().optional() }), output: z.object({ next: z.uuid().nullable(), recoveryRequired: z.number().int().nonnegative() }),
  handler: async (input, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    if (input.receiptId) {
      const cleanup = await ctx.tx.execute<{ key: string }>(sql`
        select original.storage_key as key from import_crawl_responses original
        join media_object_writes observed on observed.key_digest=original.key_digest
        where observed.id=${input.receiptId}::uuid and original.retired_at is not null and original.storage_key is not null
         and not freeholder_crawl_response_held(original.id)
         and not exists(select 1 from media_object_writes unresolved where unresolved.key_digest=original.key_digest and unresolved.state in ('unverified','started','unknown'))
      `);
      if (cleanup.length) await ctx.queueJob("core.deleteCaptureObjects", { keys: cleanup.map(row => row.key) });
    }
    const selection = await ctx.tx.execute<{ id: string; request_id: string; response_id: string; evidence: string }>(sql`
      select cohort.id,cohort.request_id,original.id as response_id,
       coalesce(string_agg(physical.id::text||':'||physical.state||':'||coalesce(physical.observed_accepted_at::text,'')||':'||coalesce(physical.deleted_at::text,''),'|' order by physical.id),'unwritten') as evidence
      from import_crawl_response_erasures cohort
      join import_crawl_responses original on original.id=cohort.response_id
      left join media_object_writes physical on physical.key_digest=original.key_digest
      where original.retired_at is not null and not freeholder_crawl_response_held(original.id)
       and (${input.after ?? null}::uuid is null or cohort.id>${input.after ?? null}::uuid)
       and (${input.receiptId ?? null}::uuid is null or exists(select 1 from media_object_writes target where target.id=${input.receiptId ?? null}::uuid and target.key_digest=original.key_digest))
       and (original.redacted_at is null or exists(select 1 from media_object_writes unsettled where unsettled.key_digest=original.key_digest and (unsettled.state in ('unverified','started','unknown') or unsettled.operation_kind='put' and unsettled.deleted_at is null))
         or exists(select 1 from import_crawl_entry_originals witness join import_source_entries entry on entry.id=witness.entry_id
           where witness.response_id=original.id and entry.metadata is distinct from '{"format":"http-originals","redacted":true}'::jsonb)
         or exists(select 1 from import_crawl_requests request join import_crawl_graphs binding on binding.source_id=request.source_id join import_source_graphs graph on graph.id=binding.graph_id
           where request.id=original.request_id and (graph.header_metadata is distinct from '{"format":"http-originals","redacted":true}'::jsonb or graph.plan_metadata is distinct from '{"redacted":true}'::jsonb))
         or exists(select 1 from import_crawl_requests request join import_crawl_graphs binding on binding.source_id=request.source_id join import_source_media media on media.graph_id=binding.graph_id
           where request.id=original.request_id and (to_jsonb(media)->>'source_key_digest' is null or media.key is distinct from 'redacted:'||media.id::text or media.planned is distinct from '{"redacted":true}'::jsonb or media.error is not null)))
      group by cohort.id,cohort.request_id,original.id order by cohort.id limit 500
    `);
    let recoveryRequired = 0;
    const guardsAvailable = await crawlErasureGuardsAvailable(ctx.tx);
    const completeScopes = new Map<string, boolean>();
    for (const row of selection) {
      if (!await hasAppliedCrawlRetirementEvidence(ctx.tx, row.request_id)) { recoveryRequired++; continue; }
      if (!completeScopes.has(row.request_id)) completeScopes.set(row.request_id, await originalCrawlScopeIsComplete(ctx.tx, row.request_id));
      const missingOriginalWitness = !guardsAvailable || !completeScopes.get(row.request_id);
      const evidence = createHash("sha256").update(row.evidence).digest("hex");
      const reopened = await ctx.call(reopenErasureJob, { requestId: row.request_id, scope: CRAWL_ERASURE_SCOPE, jobName: CRAWL_ERASURE_JOB, jobData: { responseIds: [row.response_id] }, idempotencyKey: `crawl-projection-v1:${row.response_id}:${evidence}` });
      if (missingOriginalWitness || reopened.recoveryRequired) recoveryRequired++;
    }
    const next = selection.length === 500 ? selection.at(-1)!.id : null;
    if (next) await ctx.queueJob(CRAWL_RECONCILIATION_JOB, { after: next, ...(input.receiptId ? { receiptId: input.receiptId } : {}) });
    return { next, recoveryRequired };
  },
});

export const crawlPrivacyServices = [claimCrawlOriginalErasure, confirmCrawlOriginalErasure, reconcileCrawlOriginalObservation];
