// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: physical callers finish independently of provider outcomes.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentity, lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { dataRequestArtifacts, dataRequests, privacyRetentionExceptions } from "@/core/privacy/schema";
import { erasureArtifactIsIntact } from "@/core/privacy/service";
import { defineService, ServiceError } from "@/core/service";
import { merchantPhysicalCaller } from "@/modules/invoicing/merchant-physical-caller";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptionChargeScope, subscriptionMerchantScope } from "./merchant-scope-contract";
import { scheduleCallerHasStopped, scheduleKnownResources } from "./provider-schedule-proof";
import { subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "./provider-schedule-schema";
import { subscriptionMerchantScopes, subscriptions } from "./schema";
import { enqueueMerchantScheduleErasureRepair } from "./provider-schedule-erasure";
import { originalScheduleCohortAuthority } from "./provider-schedule-cohort-authority";
import { phaseOperationCallerFinished } from "./provider-phase-resources";
import { merchantScheduleCohortInventoryCovers } from "./provider-schedule-cohorts";

const nonceDigest = (nonce: string) => createHash("sha256").update(nonce).digest("hex");
const originalJob = z.object({ profileId: z.uuid(), requestId: z.uuid(), cohortId: z.uuid(), originalJobId: z.uuid() });
const target = originalJob.extend({ subscriptionId: z.uuid(), providerSubscriptionRef: z.string().regex(/^sub_[A-Za-z0-9]{1,195}$/) });
const stopRequest = z.object({ subscriptionId: z.uuid(), providerSubscriptionRef: z.string(), providerCustomerRef: z.string().optional(),
  providerPlatformAccountId: z.string(), providerScheduleApiVersion: z.literal("2026-10-28.endive"), providerAccountId: z.string().optional(),
  destinationAccountId: z.string().optional(), settlementMerchantAccountId: z.string().optional() });
const cancellationClaim = z.discriminatedUnion("mode", [z.object({ mode: z.literal("recover") }), z.object({ mode: z.literal("blocked") }),
  z.object({ mode: z.literal("dispatch"), operationId: z.uuid(), completionNonce: z.string(), request: stopRequest })]);
type LocalCaller = { subscriptionId: string; providerSubscriptionRef: string; nonce: string; invoked: boolean; outcome: "returned" | "threw" | null;
  positive?: { providerSubscriptionRef: string; source: "delete_ack" | "readback" } };
const slot = Symbol.for("freeholder.subscription.physical-callers.v1");
const processState = globalThis as typeof globalThis & { [slot]?: Map<string, LocalCaller> };
const localCallers = processState[slot] ??= new Map<string, LocalCaller>();

export const merchantScheduleCancellationTargets = defineService({
  name: "subscriptions.merchantScheduleCancellationTargets", summary: "Read only the retained original resources owned by this actual merchant erasure task.",
  kind: "query", permission: "system", external: false, input: originalJob,
  output: z.array(z.object({ subscriptionId: z.uuid(), request: stopRequest, providerSubscriptionRefs: z.array(z.string()),
    recoveryOperationIds: z.array(z.uuid()).max(5000), cancellationOperations: z.array(z.object({ providerSubscriptionRef: z.string(), operationId: z.uuid() })) })).max(5000),
  handler: async (input, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    const { cohort } = await originalScheduleCohortAuthority(ctx.tx, input);
    const scopes = await ctx.tx.select().from(subscriptionMerchantScopes).where(cohort.subscriptionId
      ? and(eq(subscriptionMerchantScopes.subscriptionId, cohort.subscriptionId), eq(subscriptionMerchantScopes.taxProfileId, input.profileId))
      : eq(subscriptionMerchantScopes.taxProfileId, input.profileId)).orderBy(subscriptionMerchantScopes.subscriptionId).limit(5001);
    if (!await merchantScheduleCohortInventoryCovers(ctx.tx, cohort, new Set(scopes.map(row => row.subscriptionId)))) {
      throw new ServiceError("conflict", "Restore every originally admitted agreement before recovering this schedule cohort.");
    }
    if (scopes.length > 5000) throw new ServiceError("conflict", "The original merchant agreement inventory needs bounded operator recovery.");
    const targets = [];
    for (const row of scopes) {
      const [resource] = await ctx.tx.select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, row.subscriptionId)).limit(1);
      const operations = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.subscriptionId, row.subscriptionId))
        .orderBy(subscriptionProviderScheduleOperations.operationRevision).limit(5001);
      if (!resource || operations.length > 5000 || operations.length !== resource.operationRevision) throw new ServiceError("conflict", "Restore the complete original subscription resource inventory before recovery.");
      const references = scheduleKnownResources(resource, operations);
      if (!references) throw new ServiceError("conflict", "A positive original create still needs its actual provider resource reference.");
      const original = subscriptionMerchantScope.parse(row);
      const customers = [...new Set(operations.map(operation => operation.originalRequest.providerCustomerRef).filter((value): value is string => typeof value === "string" && /^cus_[A-Za-z0-9]{1,195}$/.test(value)))];
      targets.push({ subscriptionId: row.subscriptionId, request: { ...subscriptionChargeScope(original), providerPlatformAccountId: original.providerPlatformAccountId, subscriptionId: row.subscriptionId,
        providerSubscriptionRef: resource.providerSubscriptionRef ?? [...references][0] ?? "", providerScheduleApiVersion: original.providerScheduleApiVersion,
        ...(customers.length === 1 ? { providerCustomerRef: customers[0] } : {}) }, providerSubscriptionRefs: [...references].sort(),
        recoveryOperationIds: operations.filter(operation => operation.state !== "confirmed" && phaseOperationCallerFinished(operation)
          && (operation.originalRequest.resourceKind === "invoice_stop" || operation.kind === "cancel" && operation.originalRequest.method === "DELETE")).map(operation => operation.id),
        cancellationOperations: operations.filter(operation => operation.kind === "cancel" && operation.originalRequest.method === "DELETE" && typeof operation.originalRequest.providerSubscriptionRef === "string")
          .map(operation => ({ providerSubscriptionRef: operation.originalRequest.providerSubscriptionRef as string, operationId: operation.id })) });
    }
    return targets;
  },
});

/** This phase grants exactly one same-process invocation, before provider I/O.
 * Unknown/unfinished earlier work is recovered through reads, never another DELETE. */
export const claimMerchantScheduleCancellation = defineService({
  name: "subscriptions.claimMerchantScheduleCancellation", summary: "Commit one original erasure cancellation intent after checking its actual cohort and holds.",
  kind: "mutation", permission: "system", external: false, auditInputFields: ["cohortId", "subscriptionId", "providerSubscriptionRef"],
  auditWhen: (output: z.infer<typeof cancellationClaim>) => output.mode === "dispatch",
  input: target, output: cancellationClaim,
  handler: async (input, ctx) => {
    await lockContactIdentity(ctx.tx);
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`privacy:${input.requestId}`}))`);
    const { request, cohort } = await originalScheduleCohortAuthority(ctx.tx, input, true);
    if (cohort.subscriptionId !== null && cohort.subscriptionId !== input.subscriptionId) {
      throw new ServiceError("permission", "This buyer's original task does not authorize another agreement.");
    }
    const originalIds = await ctx.tx.select({ id: subscriptionMerchantScopes.subscriptionId }).from(subscriptionMerchantScopes)
      .where(cohort.subscriptionId ? and(eq(subscriptionMerchantScopes.subscriptionId, cohort.subscriptionId), eq(subscriptionMerchantScopes.taxProfileId, input.profileId))
        : eq(subscriptionMerchantScopes.taxProfileId, input.profileId)).limit(5001);
    if (originalIds.length > 5000 || !await merchantScheduleCohortInventoryCovers(ctx.tx, cohort, new Set(originalIds.map(row => row.id)))) return { mode: "blocked" as const };
    const [artifact] = await ctx.tx.select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, input.requestId)).limit(1).for("update");
    const receipt = z.object({ outcomes: z.array(z.object({ scope: z.string(), outcome: z.string(), pendingJobs: z.array(z.uuid()).optional() }).passthrough()) }).passthrough().safeParse(artifact?.body);
    const outcome = receipt.success ? receipt.data.outcomes.find(value => value.scope === cohort.privacyScope) : undefined;
    // The existing final phase commits artifact recovery. No physical mutation
    // is admitted from a missing/corrupt/stale receipt in this earlier phase.
    if (!erasureArtifactIsIntact(artifact) || outcome?.outcome !== "pending" || !outcome.pendingJobs?.includes(input.originalJobId)) return { mode: "blocked" as const };
    const [parent] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, input.subscriptionId)).limit(1).for("update");
    const [scope] = await ctx.tx.select().from(subscriptionMerchantScopes).where(eq(subscriptionMerchantScopes.subscriptionId, input.subscriptionId)).limit(1).for("update");
    const [resource] = await ctx.tx.select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, input.subscriptionId)).limit(1).for("update");
    if (!parent || !scope || !resource || parent.merchantScopeVersion !== 1 || scope.taxProfileId !== input.profileId) throw new ServiceError("conflict", "Restore this original merchant agreement and resource before stopping it.");
    const [hold] = await ctx.tx.select({ id: privacyRetentionExceptions.id }).from(privacyRetentionExceptions)
      .innerJoin(dataRequests, eq(dataRequests.id, privacyRetentionExceptions.dataRequestId)).where(and(inArray(dataRequests.contactId, [request.contactId, parent.contactId]),
        inArray(privacyRetentionExceptions.scope, ["commerce.merchantTax", "subscriptions.agreements", "privacy.records"]),
        sql`(${privacyRetentionExceptions.expiresAt} is null or ${privacyRetentionExceptions.expiresAt}>clock_timestamp())`)).limit(1);
    if (hold) return { mode: "blocked" as const };
    const operations = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.subscriptionId, input.subscriptionId))
      .orderBy(subscriptionProviderScheduleOperations.operationRevision).limit(5001);
    const known = scheduleKnownResources(resource, operations);
    if (resource.operationRevision < 1 || operations.length > 5000 || operations.length !== resource.operationRevision
      || operations.some((operation, index) => operation.operationRevision !== index + 1)
      || !known?.has(input.providerSubscriptionRef)) throw new ServiceError("conflict", "The requested remote resource is not proved by the complete original operation history.");
    if (operations.some(operation => !["confirmed", "refused"].includes(operation.state) || !scheduleCallerHasStopped(operation)
      || operation.kind === "cancel" && operation.originalRequest.method === "DELETE" && operation.originalRequest.providerSubscriptionRef === input.providerSubscriptionRef)) return { mode: "recover" as const };
    const frozen = subscriptionMerchantScope.parse(scope), operationId = randomUUID(), nonce = randomBytes(32).toString("base64url");
    const providerRequest = { ...subscriptionChargeScope(frozen), providerPlatformAccountId: frozen.providerPlatformAccountId, subscriptionId: parent.id, providerSubscriptionRef: input.providerSubscriptionRef,
      providerScheduleApiVersion: frozen.providerScheduleApiVersion, ...(resource.providerCustomerRef ? { providerCustomerRef: resource.providerCustomerRef } : {}) };
    const originalRequest = { ...providerRequest, method: "DELETE", invoiceNow: false, prorate: false,
      caller: merchantPhysicalCaller(), callerCompletionDigest: nonceDigest(nonce), cohortId: cohort.id, requestId: request.id };
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
    await ctx.tx.update(subscriptionProviderScheduleResources).set({ operationRevision: resource.operationRevision + 1, state: "quiescing", stoppedProof: null, recoveryPending: true, updatedAt: new Date() })
      .where(eq(subscriptionProviderScheduleResources.subscriptionId, parent.id));
    await ctx.tx.insert(subscriptionProviderScheduleOperations).values({ id: operationId, subscriptionId: parent.id, operationRevision: resource.operationRevision + 1, kind: "cancel",
      providerApiVersion: frozen.providerScheduleApiVersion, originalRequest, requestDigest: merchantTaxDigest(originalRequest), idempotencyKey: `schedule-cancel:${operationId}` });
    localCallers.set(operationId, { subscriptionId: parent.id, providerSubscriptionRef: input.providerSubscriptionRef, nonce, invoked: false, outcome: null });
    ctx.setSubject("subscription", parent.id);
    return { mode: "dispatch" as const, operationId, completionNonce: nonce, request: providerRequest };
  },
});

export const finishMerchantScheduleCaller = defineService({
  name: "subscriptions.finishMerchantScheduleCaller", summary: "Retain actual same-process schedule caller completion separately from provider outcome.",
  kind: "mutation", permission: "system", external: false, auditInputFields: ["operationId"],
  input: z.object({ operationId: z.uuid(), completionNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }), output: z.object({ finished: z.literal(true) }),
  handler: async ({ operationId, completionNonce }, ctx) => {
    const local = localCallers.get(operationId);
    if (!local || !local.invoked || local.outcome === null || local.nonce !== completionNonce) throw new ServiceError("permission", "The original caller has not actually finished in this process.");
    await lockContactIdentityForRead(ctx.tx);
    const [parent] = await ctx.tx.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.id, local.subscriptionId)).limit(1).for("update");
    await ctx.tx.select({ id: subscriptionProviderScheduleResources.subscriptionId }).from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, local.subscriptionId)).limit(1).for("update");
    let [operation] = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.id, operationId)).limit(1).for("update");
    const caller = operation?.originalRequest.caller;
    if (!parent || !operation || local.subscriptionId !== operation.subscriptionId
      || operation.originalRequest.callerCompletionDigest !== nonceDigest(completionNonce) || !caller || typeof caller !== "object" || !("id" in caller)
      || caller.id !== merchantPhysicalCaller().id) throw new ServiceError("permission", "Only the actual completed original caller can finish this physical operation.");
    if (local.positive) {
      await ctx.callAsSystem(observeMerchantScheduleCancellation, { operationId, ...local.positive });
      [operation] = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.id, operationId)).limit(1).for("update");
      if (!operation) throw new ServiceError("conflict", "Restore the original operation before retaining its actual caller completion.");
    }
    const history = z.array(z.record(z.string(), z.unknown())).max(5000).parse(operation.providerObservation.history ?? []);
    if (!history.some(entry => entry.source === "physical_caller_finished" && entry.operationId === operationId
      && entry.requestDigest === operation.requestDigest && entry.completionDigest === nonceDigest(completionNonce))) {
      await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
      await ctx.tx.update(subscriptionProviderScheduleOperations).set({ state: operation.state === "running" ? "unknown" : operation.state,
        providerObservation: { ...operation.providerObservation, history: [...history, { source: "physical_caller_finished", operationId, requestDigest: operation.requestDigest,
          completionDigest: nonceDigest(completionNonce), outcome: local.outcome }] }, finishedAt: operation.finishedAt ?? new Date() }).where(eq(subscriptionProviderScheduleOperations.id, operationId));
    }
    ctx.setSubject("subscription", operation.subscriptionId);
    return { finished: true as const };
  },
});

/** This fact phase deliberately does not test current holds, tax policy or
 * request completion: the original physical effect already happened. */
export const observeMerchantScheduleCancellation = defineService({
  name: "subscriptions.observeMerchantScheduleCancellation", summary: "Retain an authenticated original canceled-resource acknowledgment before later recovery checks.",
  kind: "mutation", permission: "system", external: false, auditInputFields: ["operationId", "providerSubscriptionRef"],
  input: z.object({ operationId: z.uuid(), providerSubscriptionRef: z.string().regex(/^sub_[A-Za-z0-9]{1,195}$/), source: z.enum(["delete_ack", "readback"]) }),
  output: z.object({ recorded: z.literal(true) }),
  handler: async (input, ctx) => {
    const actualCaller = localCallers.get(input.operationId);
    if (!actualCaller?.invoked || actualCaller.positive?.providerSubscriptionRef !== input.providerSubscriptionRef || actualCaller.positive.source !== input.source) throw new ServiceError("permission", "Only the actual admitted cancellation callback may retain this ACK; recovery needs a separate GET ticket.");
    await lockContactIdentityForRead(ctx.tx);
    const [reference] = await ctx.tx.select({ subscriptionId: subscriptionProviderScheduleOperations.subscriptionId }).from(subscriptionProviderScheduleOperations)
      .where(eq(subscriptionProviderScheduleOperations.id, input.operationId)).limit(1);
    if (!reference) throw new ServiceError("conflict", "Restore the original physical operation before retaining its provider acknowledgment.");
    const [parent] = await ctx.tx.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.id, reference.subscriptionId)).limit(1).for("update");
    const [resource] = await ctx.tx.select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, reference.subscriptionId)).limit(1).for("update");
    const [operation] = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.id, input.operationId)).limit(1).for("update");
    if (!parent || !resource || !operation || operation.kind !== "cancel" || operation.originalRequest.providerSubscriptionRef !== input.providerSubscriptionRef) throw new ServiceError("conflict", "That acknowledgment is not for the original admitted cancellation resource.");
    const history = z.array(z.record(z.string(), z.unknown())).max(5000).parse(operation.providerObservation.history ?? []);
    const source = input.source === "delete_ack" ? "provider_cancel_ack" : "provider_cancel_readback";
    if (!history.some(entry => entry.source === source && entry.providerSubscriptionRef === input.providerSubscriptionRef && entry.providerState === "cancelled")) {
      const contradiction = operation.state === "refused" || history.some(entry => entry.source === "human_provider_confirmation" && entry.outcome === "not_applied");
      await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
      await ctx.tx.update(subscriptionProviderScheduleOperations).set({ positiveObserved: true, state: contradiction ? "unknown" : "confirmed",
        providerObservation: { ...operation.providerObservation, history: [...history, { source, providerSubscriptionRef: input.providerSubscriptionRef,
          providerState: "cancelled", observedAt: new Date().toISOString() }] }, finishedAt: operation.finishedAt ?? new Date() })
        .where(eq(subscriptionProviderScheduleOperations.id, operation.id));
      await ctx.tx.update(subscriptionProviderScheduleResources).set({ evidenceRevision: resource.evidenceRevision + 1, state: "unknown", stoppedProof: null, recoveryPending: true, updatedAt: new Date() })
        .where(eq(subscriptionProviderScheduleResources.subscriptionId, resource.subscriptionId));
      await enqueueMerchantScheduleErasureRepair(ctx.tx, { subscriptionId: resource.subscriptionId,
        evidenceDigest: merchantTaxDigest({ operationId: operation.id, source, providerSubscriptionRef: input.providerSubscriptionRef, providerState: "cancelled" }) });
    }
    ctx.setSubject("subscription", parent.id);
    return { recorded: true as const };
  },
});

/** Set the actual positive fact synchronously before persistence can fail. */
export function retainMerchantScheduleCancellation(dispatch: { operationId: string; completionNonce: string }, actual: { providerSubscriptionRef: string; source: "delete_ack" | "readback" }): Promise<{ recorded: true }> {
  const local = localCallers.get(dispatch.operationId);
  if (!local || !local.invoked || local.nonce !== dispatch.completionNonce || local.providerSubscriptionRef !== actual.providerSubscriptionRef) throw new ServiceError("permission", "This provider acknowledgment is not from its actual admitted original caller.");
  local.positive = actual;
  return observeMerchantScheduleCancellation.call({ operationId: dispatch.operationId, ...actual }, { kind: "system" });
}

/** No service transaction crosses work(); the cache survives a failed finish
 * commit for exact same-caller retry. It grants no new provider invocation. */
export async function performMerchantScheduleCancellation<T>(dispatch: { operationId: string; completionNonce: string }, subscriptionId: string, work: () => Promise<T>): Promise<T> {
  const local = localCallers.get(dispatch.operationId);
  if (!local || local.nonce !== dispatch.completionNonce || local.subscriptionId !== subscriptionId || local.invoked) throw new ServiceError("conflict", "This original physical schedule caller was already invoked or is not owned by this process.");
  local.invoked = true;
  try { const value = await work(); local.outcome = "returned"; return value; }
  catch (error) { local.outcome = "threw"; throw error; }
  finally {
    await finishMerchantScheduleCaller.call({ operationId: dispatch.operationId, completionNonce: dispatch.completionNonce }, { kind: "system" });
    localCallers.delete(dispatch.operationId);
  }
}

export async function flushMerchantScheduleCallerFinishes(subscriptionId: string): Promise<void> {
  for (const [operationId, local] of localCallers) if (local.subscriptionId === subscriptionId && local.outcome !== null) {
    await finishMerchantScheduleCaller.call({ operationId, completionNonce: local.nonce }, { kind: "system" });
    localCallers.delete(operationId);
  }
}

export default [merchantScheduleCancellationTargets, claimMerchantScheduleCancellation, finishMerchantScheduleCaller, observeMerchantScheduleCancellation];
