// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: commit current original-resource facts before bank-state policy.
import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { paymentAdapter, type MerchantRefundObservation } from "@/adapters/payments";
import { defineOrchestratedService, defineService, ServiceError, type ServiceContext, type Actor } from "@/core/service";
import { merchantPhysicalCaller } from "./merchant-physical-caller";
import { merchantRefundRequestRow } from "./merchant-refund-request";
import { lockMerchantRefundCash } from "./merchant-refund-origin";
import { merchantRefundRequests, merchantRefundObservations, merchantRefundResourceBindings } from "./merchant-refund-schema";
import { merchantRefundCurrentReceipts, merchantRefundObservationCaptures, merchantRefundStateReadFinishes, merchantRefundStateReads } from "./merchant-refund-current-schema";
import { originalRefundCurrentReadVerdict } from "./merchant-refund-current-proof";
import { merchantRefundEvidence, recordMerchantRefundObservation } from "./merchant-refund-observations";
import { allowOriginalMerchantRefundWrites } from "./merchant-refund-store";
import { queueOriginalMerchantRefundRepair } from "./merchant-refund-privacy-repair";
import { merchantTaxDigest } from "./merchant-tax-store";
import { applyCurrentMerchantRefundState } from "./invoice-service";
import bankStateServices from "./merchant-refund-bank-state-service";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const captureKey = (readId: string) => digest(`refund-state-read:${readId}`);
const nonce = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const providerStatus = z.enum(["pending", "requires_action", "succeeded", "failed", "canceled"]).nullable();
const system = { kind: "system" } as const;
interface ReadFinish { requestId: string; nonce: string; outcome: "returned" | "threw"; captureId: string | null }
const slot = Symbol.for("freeholder.merchant.refund-current-read-finishes.v1");
const processState = globalThis as typeof globalThis & { [slot]?: Map<string, ReadFinish> };
const finished = processState[slot] ??= new Map<string, ReadFinish>();

async function original(ctx: ServiceContext, requestId: string) {
  const [snapshot] = await ctx.tx.select().from(merchantRefundRequests).where(eq(merchantRefundRequests.id, requestId));
  if (!snapshot) throw new ServiceError("conflict", "Restore the actual original refund request before inspecting its bank state.");
  if (snapshot.refundId) await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`refund:${snapshot.refundId}`}))`);
  await lockMerchantRefundCash(ctx, { ...snapshot, providerRef: snapshot.originalPaymentRef });
  const [saved] = await ctx.tx.select().from(merchantRefundRequests).where(eq(merchantRefundRequests.id, requestId));
  if (!saved || merchantTaxDigest(saved.originalRequest) !== saved.requestDigest) throw new ServiceError("conflict", "Restore the immutable original refund transport before current-state reconciliation.");
  return saved;
}
async function revision(ctx: ServiceContext, requestId: string, observationId: string | null = null, captureId: string | null = null) {
  const [saved] = await ctx.tx.execute<{ revision: string; incomplete: boolean; observation_ids: unknown }>(sql`select * from freeholder_refund_current_revision(${requestId}::uuid,${observationId}::uuid,${captureId}::uuid)`);
  if (!saved || saved.incomplete) throw new ServiceError("conflict", "Restore the complete original cash evidence; a truncated snapshot cannot prove its current state.");
  return { digest: z.string().regex(/^[a-f0-9]{64}$/).parse(saved.revision), observationIds: z.array(z.uuid()).max(5000).parse(saved.observation_ids) };
}
async function creatorsQuiesced(ctx: ServiceContext, requestId: string) {
  const [result] = await ctx.tx.execute<{ safe: boolean }>(sql`select freeholder_refund_current_creators_quiesced(${requestId}::uuid) as safe`);
  return result?.safe === true;
}
async function readForCaller(ctx: ServiceContext, readId: string, completionNonce: string) {
  const [read] = await ctx.tx.select().from(merchantRefundStateReads).where(eq(merchantRefundStateReads.id, readId));
  const caller = merchantPhysicalCaller();
  if (!read || read.caller.id !== caller.id || read.completionNonceHash !== digest(completionNonce)) throw new ServiceError("permission", "Only this exact original current-read caller can retain its private evidence.");
  return read;
}

export const prepareMerchantRefundCurrentRead = defineService({
  name: "invoicing.prepareMerchantRefundCurrentRead", summary: "Freeze a complete original refund evidence revision before one read of its actual provider resource.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", input: z.object({ requestId: z.uuid() }),
  output: z.object({ readId: z.uuid(), completionNonce: nonce, original: merchantRefundRequestRow, originalRefundRef: z.string() }),
  handler: async ({ requestId }, ctx) => {
    const request = await original(ctx, requestId), baseline = await revision(ctx, requestId);
    if (!await creatorsQuiesced(ctx, requestId)) throw new ServiceError("conflict", "Finish or verify the original physical money callers before proving current refund state.");
    const bindings = await ctx.tx.select().from(merchantRefundResourceBindings).where(eq(merchantRefundResourceBindings.requestId, requestId)).limit(5001);
    const refs = new Set(bindings.map(row => row.providerRef));
    if (bindings.length > 5000 || refs.size !== 1) throw new ServiceError("conflict", "Restore one actual original resource ACK or verified request-log binding; metadata cannot choose a refund.");
    const binding = bindings.toSorted((left, right) => left.id.localeCompare(right.id))[0]!;
    const completionNonce = randomBytes(32).toString("base64url");
    await allowOriginalMerchantRefundWrites(ctx.tx);
    const [saved] = await ctx.tx.insert(merchantRefundStateReads).values({ requestId, requestDigest: request.requestDigest,
      resourceBindingId: binding.id, sourceRevision: baseline.digest, sourceObservationIds: baseline.observationIds,
      caller: merchantPhysicalCaller(), completionNonceHash: digest(completionNonce) }).returning();
    ctx.setSubject(request.paymentId ? "payment" : "subscription_provider_charge", request.paymentId ?? request.subscriptionChargeReceiptId!);
    return { readId: saved!.id, completionNonce, original: merchantRefundRequestRow.parse(request), originalRefundRef: binding.providerRef };
  },
});

export const recordMerchantRefundCurrentObservation = defineService({
  name: "invoicing.recordMerchantRefundCurrentObservation", summary: "Commit the exact current-read fact and occurrence before deciding whether its bank state can resolve debt.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", auditInputFields: ["readId"],
  input: z.object({ readId: z.uuid(), completionNonce: nonce, evidence: merchantRefundEvidence }),
  output: z.object({ captureId: z.uuid(), observationId: z.uuid(), bindingVerified: z.boolean() }),
  handler: async ({ readId, completionNonce, evidence }, ctx) => {
    const read = await readForCaller(ctx, readId, completionNonce);
    const [request] = await ctx.tx.select().from(merchantRefundRequests).where(eq(merchantRefundRequests.id, read.requestId));
    if (!request) throw new ServiceError("conflict", "Restore the original current-read request before retaining this provider fact.");
    return ctx.callAsSystem(recordMerchantRefundObservation, { requestId: request.id, captureKey: captureKey(read.id), evidence,
      source: request.paymentId ? { kind: "payment", paymentId: request.paymentId } : { kind: "subscription", receiptId: request.subscriptionChargeReceiptId! } });
  },
});

export const finishMerchantRefundCurrentRead = defineService({
  name: "invoicing.finishMerchantRefundCurrentRead", summary: "Retain actual original current-read promise completion independently of its nullable bank state.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", auditInputFields: ["readId"],
  input: z.object({ readId: z.uuid(), completionNonce: nonce }), output: z.object({ finished: z.literal(true) }),
  handler: async ({ readId, completionNonce }, ctx) => {
    const read = await readForCaller(ctx, readId, completionNonce), local = finished.get(readId);
    if (!local || local.nonce !== completionNonce || local.requestId !== read.requestId) throw new ServiceError("permission", "Only this actual completed read can supply its private finish receipt.");
    await allowOriginalMerchantRefundWrites(ctx.tx);
    await ctx.tx.insert(merchantRefundStateReadFinishes).values({ readId, callerInstanceId: read.caller.id, outcome: local.outcome, captureId: local.captureId }).onConflictDoNothing();
    const [saved] = await ctx.tx.select().from(merchantRefundStateReadFinishes).where(eq(merchantRefundStateReadFinishes.readId, readId));
    if (!saved || saved.callerInstanceId !== read.caller.id || saved.outcome !== local.outcome || saved.captureId !== local.captureId) throw new ServiceError("conflict", "The original current-read completion differs; preserve its first receipt and restore the actual proof.");
    return { finished: true as const };
  },
});

export const completeMerchantRefundCurrentRead = defineService({
  name: "invoicing.completeMerchantRefundCurrentRead", summary: "Admit current original-resource state only against a complete unchanged evidence revision and actual finished caller.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", input: z.object({ readId: z.uuid() }),
  output: z.object({ receiptId: z.uuid(), status: providerStatus, terminal: z.boolean() }),
  handler: async ({ readId }, ctx) => {
    const [read] = await ctx.tx.select().from(merchantRefundStateReads).where(eq(merchantRefundStateReads.id, readId));
    if (!read) throw new ServiceError("conflict", "Restore the original current-read receipt before resolving bank state.");
    const request = await original(ctx, read.requestId);
    const [finish] = await ctx.tx.select().from(merchantRefundStateReadFinishes).where(eq(merchantRefundStateReadFinishes.readId, readId));
    const [capture] = finish?.captureId ? await ctx.tx.select().from(merchantRefundObservationCaptures).where(eq(merchantRefundObservationCaptures.id, finish.captureId)) : [];
    const [fact] = capture ? await ctx.tx.select().from(merchantRefundObservations).where(eq(merchantRefundObservations.id, capture.observationId)) : [];
    const [binding] = await ctx.tx.select().from(merchantRefundResourceBindings).where(eq(merchantRefundResourceBindings.id, read.resourceBindingId));
    if (!finish || !capture || !fact || !binding || binding.requestId !== request.id || capture.captureKey !== captureKey(readId)) throw new ServiceError("conflict", "Restore the exact finished current-read capture and original resource binding.");
    const prior = await revision(ctx, request.id, read.sourceObservationIds.includes(fact.id) ? null : fact.id, capture.id);
    const verdict = originalRefundCurrentReadVerdict({ original: { providerPlatformAccountId: request.providerPlatformAccountId, chargeAccountId: request.chargeAccountId,
      providerApiVersion: request.providerApiVersion, providerRef: binding.providerRef, paymentProviderRef: request.originalPaymentRef, amountMinor: request.amountMinor, currency: request.currency },
      actual: fact, preparedRevision: read.sourceRevision, currentPriorRevision: prior.digest, incomplete: false,
      creatorsQuiesced: await creatorsQuiesced(ctx, request.id), readReturned: finish.outcome === "returned", exactCallerFinished: finish.callerInstanceId === read.caller.id });
    if (verdict.state !== "verified") throw new ServiceError("conflict", "The complete original bank state is stale, unfinished or unbound; retain all facts and inspect it again.");
    const resolved = await revision(ctx, request.id);
    await allowOriginalMerchantRefundWrites(ctx.tx);
    await ctx.tx.insert(merchantRefundCurrentReceipts).values({ readId, requestId: request.id, captureId: capture.id, resolvedRevision: resolved.digest }).onConflictDoNothing();
    const [saved] = await ctx.tx.select().from(merchantRefundCurrentReceipts).where(eq(merchantRefundCurrentReceipts.readId, readId));
    if (!saved || saved.captureId !== capture.id || saved.requestId !== request.id || saved.resolvedRevision !== resolved.digest) throw new ServiceError("conflict", "The original read's earlier receipt differs; keep it and restore the complete evidence.");
    queueOriginalMerchantRefundRepair(ctx, { kind: "refund_current", id: saved.id });
    ctx.setSubject(request.paymentId ? "payment" : "subscription_provider_charge", request.paymentId ?? request.subscriptionChargeReceiptId!);
    return { receiptId: saved.id, status: verdict.status, terminal: verdict.terminal };
  },
});

/** Only completed server-held promises can retry their finish persistence. */
export async function flushLocalMerchantRefundCurrentReadFinishes(requestId: string): Promise<void> {
  for (const [readId, local] of finished) {
    if (local.requestId !== requestId) continue;
    await finishMerchantRefundCurrentRead.call({ readId, completionNonce: local.nonce }, system);
    finished.delete(readId);
  }
}

/** Used only after an existing authorized orchestrator or original recovery job
 * has established this immutable request, never as a new public bypass. */
export async function reconcileOriginalMerchantRefundCurrentState(requestId: string, caller: Actor) {

    await flushLocalMerchantRefundCurrentReadFinishes(requestId);
    const actor = { kind: "system", request: caller.request } as const;
    const adapter = paymentAdapter("stripe");
    if (!adapter.recoverMerchantRefund) throw new ServiceError("conflict", "The original provider cannot perform this exact-resource current read.");
    const read = await prepareMerchantRefundCurrentRead.call({ requestId }, actor);
    let captureId: string | null = null, outcome: "returned" | "threw" = "threw";
    try {
      const observe = async (evidence: MerchantRefundObservation) => {
        const captured = await recordMerchantRefundCurrentObservation.call({ readId: read.readId, completionNonce: read.completionNonce,
          evidence: { ...evidence, providerApiVersion: evidence.providerApiVersion ?? null,
            status: Object.hasOwn(evidence, "providerStatus") ? evidence.providerStatus ?? null : null } }, actor);
        captureId = captured.captureId;
      };
      const result = await adapter.recoverMerchantRefund({ ...read.original.originalRequest, refundAttemptId: read.original.id,
        providerPlatformAccountId: read.original.providerPlatformAccountId, paymentProviderRef: read.original.originalPaymentRef,
        originalRefundRef: read.originalRefundRef, onRefundObserved: observe });
      outcome = "returned";
      if (result.state !== "observed" || !captureId) throw new ServiceError("conflict", "No exact original-resource state was returned; no absence or new request is inferred.");
    } finally {
      finished.set(read.readId, { requestId, nonce: read.completionNonce, outcome, captureId });
      await finishMerchantRefundCurrentRead.call({ readId: read.readId, completionNonce: read.completionNonce }, system);
      finished.delete(read.readId);
    }
    const receipt = await completeMerchantRefundCurrentRead.call({ readId: read.readId }, actor);
    const projected = await applyCurrentMerchantRefundState.call({ receiptId: receipt.receiptId }, actor);
    return { ...receipt, applied: projected.applied, requiresReview: projected.requiresReview };
}

export const reconcileMerchantRefundCurrentState = defineOrchestratedService({
  name: "invoicing.reconcileMerchantRefundCurrentState", summary: "Read the exact original refund's current bank state without creating or replacing any money effect.",
  kind: "mutation", permission: "scoped", stepUp: true, writeClass: "money", input: z.object({ requestId: z.uuid() }).strict(),
  output: z.object({ receiptId: z.uuid(), status: providerStatus, terminal: z.boolean(), applied: z.boolean(), requiresReview: z.boolean() }),
  handler: async ({ requestId }, caller) => reconcileOriginalMerchantRefundCurrentState(requestId, caller),
});

export default [prepareMerchantRefundCurrentRead, recordMerchantRefundCurrentObservation, finishMerchantRefundCurrentRead, completeMerchantRefundCurrentRead, reconcileMerchantRefundCurrentState, ...bankStateServices];
