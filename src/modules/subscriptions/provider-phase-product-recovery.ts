// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: an original product GET recovers evidence, never caller-stop authority.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { paymentAdapter } from "@/adapters/payments";
import { lockContactIdentity } from "@/core/contacts/identity-lock";
import { defineOrchestratedService, defineService, ServiceError, type ServiceContext } from "@/core/service";
import { merchantPhysicalCaller } from "@/modules/invoicing/merchant-physical-caller";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptions } from "./schema";
import { subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "./provider-schedule-schema";
import { recoverableOriginalPhaseProduct } from "./provider-phase-product-proof";
import { originalProviderReadsFinished } from "./provider-schedule-read-proof";
import { assertProviderReadNotStopped, captureProviderReadAdmission, captureProviderReadFinish } from "./provider-read-ownership";
import { enqueueMerchantScheduleErasureRepair } from "./provider-schedule-erasure";

const digest = (nonce: string) => createHash("sha256").update(nonce).digest("hex");
const account = z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200);
const productRef = z.string().regex(/^prod_[A-Za-z0-9]{1,195}$/);
const originalRequest = z.object({ subscriptionId: z.uuid(), operationId: z.uuid(), name: z.string().min(1).max(500),
  providerPlatformAccountId: account, providerAccountId: account.optional(), destinationAccountId: account.optional(), settlementMerchantAccountId: account.optional(),
  providerScheduleApiVersion: z.literal("2026-10-28.endive") });
const readRequest = originalRequest.extend({ providerProductRef: productRef });
const claim = z.object({ readId: z.uuid(), completionNonce: z.string(), request: readRequest });
const completion = z.object({ readId: z.uuid(), completionNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const historySchema = z.array(z.record(z.string(), z.unknown())).max(5000);
type Operation = typeof subscriptionProviderScheduleOperations.$inferSelect;
type Resource = typeof subscriptionProviderScheduleResources.$inferSelect;
type LocalRead = { subscriptionId: string; operationId: string; nonce: string; requestDigest: string; providerProductRef: string;
  operationDigest: string; resourceDigest: string; invoked: boolean; outcome: "returned" | "threw" | null; result?: string };
const slot = Symbol.for("freeholder.subscription.phase-product-reads.v1");
const processState = globalThis as typeof globalThis & { [slot]?: Map<string, LocalRead> };
const reads = processState[slot] ??= new Map<string, LocalRead>();
const operationDigest = (operation: Operation) => merchantTaxDigest([operation.id, operation.requestDigest, operation.state, operation.positiveObserved, operation.providerObservation, operation.finishedAt]);
const resourceDigest = (resource: Resource) => merchantTaxDigest([resource.subscriptionId, resource.providerSubscriptionRef, resource.providerCustomerRef,
  resource.operationRevision, resource.evidenceRevision, resource.state, resource.recoveryPending, resource.stoppedProof]);
async function lockedOriginal(ctx: ServiceContext, operationId: string) {
  await lockContactIdentity(ctx.tx);
  const [reference] = await ctx.tx.select({ subscriptionId: subscriptionProviderScheduleOperations.subscriptionId }).from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.id, operationId)).limit(1);
  if (!reference) throw new ServiceError("conflict", "Restore the original auxiliary-product operation before reading it.");
  const [parent] = await ctx.tx.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.id, reference.subscriptionId)).limit(1).for("update");
  const [resource] = await ctx.tx.select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, reference.subscriptionId)).limit(1).for("update");
  const [operation] = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.id, operationId)).limit(1).for("update");
  if (!parent || !resource || !operation || operation.subscriptionId !== reference.subscriptionId) throw new ServiceError("conflict", "Restore the original agreement, operation and resource before retaining the read.");
  return { operation, resource };
}
export const prepareMerchantPhaseProductRead = defineService({
  name: "subscriptions.prepareMerchantPhaseProductRead", summary: "Bind one read to the original acknowledged product and already-finished creating caller.",
  kind: "mutation", permission: "system", external: false, auditInputFields: ["operationId"], input: z.object({ operationId: z.uuid() }), output: claim,
  handler: async ({ operationId }, ctx) => {
    const { operation, resource } = await lockedOriginal(ctx, operationId);
    const providerProductRef = recoverableOriginalPhaseProduct(operation);
    if (!providerProductRef) throw new ServiceError("conflict", "Recover the original product ACK and real creating-caller finish before a verification read; another POST is not admitted.");
    const frozen = originalRequest.parse(operation.originalRequest);
    if (frozen.operationId !== operation.id || frozen.subscriptionId !== operation.subscriptionId || frozen.providerScheduleApiVersion !== operation.providerApiVersion) throw new ServiceError("conflict", "Restore the exact original product read namespace.");
    const readId = randomUUID(), nonce = randomBytes(32).toString("base64url");
    const admission = await captureProviderReadAdmission(ctx, operation, resource, {
      source: "phase_product_read_admitted", operationId, requestDigest: operation.requestDigest, readId, providerProductRef,
      callerId: merchantPhysicalCaller().id, completionDigest: digest(nonce) });
    const observation = { ...operation.providerObservation, history: [...historySchema.parse(operation.providerObservation.history), admission] };
    const nextResource = { ...resource, evidenceRevision: resource.evidenceRevision + 1, recoveryPending: true, stoppedProof: null };
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
    await ctx.tx.update(subscriptionProviderScheduleOperations).set({ providerObservation: observation }).where(eq(subscriptionProviderScheduleOperations.id, operationId));
    await ctx.tx.update(subscriptionProviderScheduleResources).set({ evidenceRevision: nextResource.evidenceRevision, recoveryPending: true, stoppedProof: null, updatedAt: new Date() }).where(eq(subscriptionProviderScheduleResources.subscriptionId, resource.subscriptionId));
    reads.set(readId, { subscriptionId: operation.subscriptionId, operationId, nonce, requestDigest: operation.requestDigest, providerProductRef,
      operationDigest: operationDigest({ ...operation, providerObservation: observation }), resourceDigest: resourceDigest(nextResource), invoked: false, outcome: null });
    ctx.setSubject("subscription", operation.subscriptionId);
    return { readId, completionNonce: nonce, request: { ...frozen, providerProductRef } };
  },
});
export const applyMerchantPhaseProductRead = defineService({
  name: "subscriptions.applyMerchantPhaseProductRead", summary: "Retain the actual returned product GET and converge only its unchanged original journal.",
  kind: "mutation", permission: "system", external: false, auditInputFields: ["readId"], input: completion, output: z.object({ verified: z.boolean() }),
  handler: async ({ readId, completionNonce }, ctx) => {
    const local = reads.get(readId);
    if (!local || !local.invoked || local.nonce !== completionNonce || !local.outcome) throw new ServiceError("permission", "This original verification GET has not actually finished in this process.");
    const { operation, resource } = await lockedOriginal(ctx, local.operationId);
    await assertProviderReadNotStopped(ctx, readId);
    const history = historySchema.parse(operation.providerObservation.history);
    if (operation.subscriptionId !== local.subscriptionId || operation.requestDigest !== local.requestDigest || merchantTaxDigest(operation.originalRequest) !== operation.requestDigest
      || !history.some(entry => entry.source === "phase_product_read_admitted" && entry.readId === readId && entry.operationId === operation.id
        && entry.requestDigest === local.requestDigest && entry.providerProductRef === local.providerProductRef && entry.callerId === merchantPhysicalCaller().id
        && entry.completionDigest === digest(completionNonce))) throw new ServiceError("permission", "Restore the exact original product read admission before retaining its result.");
    if (history.some(entry => entry.source === "phase_product_read_finished" && entry.readId === readId && entry.completionDigest === digest(completionNonce))) {
      return { verified: operation.state === "confirmed" && !resource.recoveryPending && recoverableOriginalPhaseProduct(operation) === local.providerProductRef };
    }
    const current = operationDigest(operation) === local.operationDigest && resourceDigest(resource) === local.resourceDigest;
    const verified = current && local.outcome === "returned" && local.result === local.providerProductRef && recoverableOriginalPhaseProduct(operation) === local.providerProductRef;
    const finish = await captureProviderReadFinish(ctx, operation, { source: "phase_product_read_finished", operationId: operation.id, requestDigest: operation.requestDigest,
      readId, completionDigest: digest(completionNonce), outcome: local.outcome }, { history, providerProductRef: local.result ?? null, verified });
    const observation = { ...operation.providerObservation, ...(verified ? { productProof: { version: 1, operationId: operation.id, requestDigest: operation.requestDigest, providerProductRef: local.result } } : {}),
      history: [...history, ...(local.outcome === "returned" ? [{ source: verified ? "phase_product_read_verified" : "phase_product_read_stale", version: 1,
        operationId: operation.id, requestDigest: operation.requestDigest, providerProductRef: local.result, readId }] : []), finish] };
    // Verification of a product cannot settle later admitted billing work.
    const clearDebt = verified && resource.operationRevision === 1 && operation.operationRevision === 1 && resource.state === "uncreated"
      && !resource.providerSubscriptionRef && !resource.providerCustomerRef && originalProviderReadsFinished({ ...operation, providerObservation: observation });
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
    await ctx.tx.update(subscriptionProviderScheduleOperations).set({ state: verified ? "confirmed" : "unknown", providerObservation: observation }).where(eq(subscriptionProviderScheduleOperations.id, operation.id));
    await ctx.tx.update(subscriptionProviderScheduleResources).set({ recoveryPending: !clearDebt, stoppedProof: null, evidenceRevision: resource.evidenceRevision + 1, updatedAt: new Date() }).where(eq(subscriptionProviderScheduleResources.subscriptionId, resource.subscriptionId));
    await enqueueMerchantScheduleErasureRepair(ctx.tx, { subscriptionId: operation.subscriptionId, evidenceDigest: merchantTaxDigest({ readId, verified, clearDebt }) });
    ctx.setSubject("subscription", operation.subscriptionId);
    return { verified };
  },
});
export async function flushMerchantPhaseProductReads(subscriptionId: string) {
  for (const [readId, local] of reads) if (local.subscriptionId === subscriptionId && local.outcome) {
    await applyMerchantPhaseProductRead.call({ readId, completionNonce: local.nonce }, { kind: "system" }); reads.delete(readId);
  }
}
export const recoverMerchantPhaseProduct = defineOrchestratedService({
  name: "subscriptions.recoverMerchantPhaseProduct", summary: "Recover one retained original product through a separately admitted GET without any POST.",
  kind: "mutation", permission: "system", external: false, input: z.object({ operationId: z.uuid() }), output: z.object({ verified: z.boolean() }),
  handler: async ({ operationId }) => {
    // A failed fact commit is flushed from its actual returned caller cache,
    // without another GET and without inventing creation-caller evidence.
    for (const [readId, finished] of reads) if (finished.operationId === operationId && finished.outcome) {
      const applied = await applyMerchantPhaseProductRead.call({ readId, completionNonce: finished.nonce }, { kind: "system" }); reads.delete(readId); return applied;
    }
    const claimed = await prepareMerchantPhaseProductRead.call({ operationId }, { kind: "system" });
    const local = reads.get(claimed.readId);
    if (!local || local.nonce !== claimed.completionNonce || local.invoked) throw new ServiceError("permission", "The original product read is not available in this process.");
    const adapter = paymentAdapter("stripe");
    local.invoked = true;
    try {
      if (!adapter.inspectMerchantPhaseProduct) throw new ServiceError("conflict", "Restore the original product read adapter; no replacement creation is admitted.");
      const actual = await adapter.inspectMerchantPhaseProduct(claimed.request);
      local.result = productRef.parse(actual.providerProductRef); local.outcome = "returned";
    } catch (error) {
      local.outcome = "threw";
      await applyMerchantPhaseProductRead.call({ readId: claimed.readId, completionNonce: local.nonce }, { kind: "system" }); reads.delete(claimed.readId);
      throw error;
    }
    const applied = await applyMerchantPhaseProductRead.call({ readId: claimed.readId, completionNonce: local.nonce }, { kind: "system" }); reads.delete(claimed.readId);
    return applied;
  },
});
export default [prepareMerchantPhaseProductRead, applyMerchantPhaseProductRead, recoverMerchantPhaseProduct];
