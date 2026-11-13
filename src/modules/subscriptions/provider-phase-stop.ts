// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: stop actual primary schedules before their linked subscriptions.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { paymentAdapter, type MerchantPhaseScheduleStopped } from "@/adapters/payments";
import { lockContactIdentity, lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import type { JobExecutionContext } from "@/core/jobs";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { merchantPhysicalCaller } from "@/modules/invoicing/merchant-physical-caller";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { originalPhaseResources, closedOriginalPhaseSchedules, phaseOperationCallerFinished } from "./provider-phase-resources";
import { flushMerchantProviderPhaseFinishes } from "./provider-phase-dispatch";
import { flushMerchantPhaseProductFinishes } from "./provider-phase-products";
import { flushMerchantPhaseProductReads } from "./provider-phase-product-recovery";
import { flushMerchantScheduleReads, recoverMerchantSchedule } from "./provider-schedule-recovery";
import { scheduleCallerHasStopped } from "./provider-schedule-proof";
import { subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "./provider-schedule-schema";
import { enqueueMerchantScheduleErasureRepair } from "./provider-schedule-erasure";
import { subscriptionChargeScope, subscriptionMerchantScope } from "./merchant-scope-contract";
import { subscriptions } from "./schema";
import { originalScheduleTask, originalQuiescenceMembers, originalQuiescenceAction } from "./provider-quiescence-authority";

const hash = (nonce: string) => createHash("sha256").update(nonce).digest("hex");
const reference = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]{1,195}$`));
const task = originalScheduleTask;
const target = z.intersection(task, z.object({ subscriptionId: z.uuid(), providerScheduleRef: reference("sub_sched") }));
export const phaseScheduleStopRequest = z.object({ subscriptionId: z.uuid(), providerScheduleRef: reference("sub_sched"), providerPlatformAccountId: reference("acct"),
  providerAccountId: reference("acct").optional(), destinationAccountId: reference("acct").optional(), settlementMerchantAccountId: reference("acct").optional(),
  providerCustomerRef: reference("cus"), providerScheduleApiVersion: z.literal("2026-10-28.endive"), originalFirstPhaseStart: z.iso.datetime().optional() });
export const phaseScheduleStopped = z.object({ providerScheduleRef: reference("sub_sched"), providerSubscriptionRefs: z.array(reference("sub")).max(5000), linkedInventoryComplete: z.boolean(),
  state: z.enum(["canceled", "completed", "released"]), source: z.enum(["cancel_ack", "readback"]),
  neverStartedProof: z.object({ originalFirstPhaseStart: z.iso.datetime(), providerCreatedAt: z.iso.datetime(), providerCanceledAt: z.iso.datetime() }).nullable() });
const claim = z.discriminatedUnion("mode", [z.object({ mode: z.literal("blocked") }), z.object({ mode: z.literal("recover") }), z.object({ mode: z.literal("done") }),
  z.object({ mode: z.literal("dispatch"), operationId: z.uuid(), completionNonce: z.string(), request: phaseScheduleStopRequest })]);
const completion = z.object({ operationId: z.uuid(), completionNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const historySchema = z.array(z.record(z.string(), z.unknown())).max(5000);
type Local = { subscriptionId: string; providerScheduleRef: string; nonce: string; invoked: boolean; outcome: "returned" | "threw" | null; positives: MerchantPhaseScheduleStopped[] };
const slot = Symbol.for("freeholder.subscription.phase-stop-callers.v1");
const state = globalThis as typeof globalThis & { [slot]?: Map<string, Local> };
const callers = state[slot] ??= new Map<string, Local>();
export const merchantPhaseScheduleTargets = defineService({
  name: "subscriptions.merchantPhaseScheduleTargets", summary: "Read the actual primary schedule IDs retained by this exact original erasure task.",
  kind: "query", permission: "system", external: false, input: task,
  output: z.array(z.object({ subscriptionId: z.uuid(), providerScheduleRefs: z.array(reference("sub_sched")).max(5000), recoveryRequired: z.boolean(),
    recoveryOperationIds: z.array(z.uuid()).max(5000), resources: z.array(z.object({ providerScheduleRef: reference("sub_sched"), providerSubscriptionRefs: z.array(reference("sub")).max(5000), providerScheduleOperationId: z.uuid().nullable() })).max(5000) })).max(5000),
  handler: async (input, ctx) => {
    await lockContactIdentityForRead(ctx.tx); const { scopes } = await originalQuiescenceMembers(ctx, input);
    const result = [];
    for (const scope of scopes) {
      const operations = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.subscriptionId, scope.subscriptionId)).orderBy(subscriptionProviderScheduleOperations.operationRevision).limit(5001);
      if (operations.length > 5000) throw new ServiceError("conflict", "The original phase operation inventory needs bounded recovery.");
      const known = originalPhaseResources(operations);
      result.push({ subscriptionId: scope.subscriptionId, recoveryOperationIds: operations.filter(operation => operation.originalRequest.resourceKind === "phase_schedule_stop" && operation.state !== "confirmed" && phaseOperationCallerFinished(operation)).map(operation => operation.id), providerScheduleRefs: known ? [...known.keys()].sort() : [], recoveryRequired: !known,
        resources: known ? [...known.values()].map(resource => {
          const creators = operations.filter(operation => operation.kind === "create" && resource.creationOperationIds.has(operation.id));
          return { providerScheduleRef: resource.providerScheduleRef, providerSubscriptionRefs: [...resource.providerSubscriptionRefs].sort(), providerScheduleOperationId: creators.length === 1 ? creators[0]!.id : null };
        }) : [] });
    }
    return result;
  },
});
export async function originalScheduleErasureAction(ctx: ServiceContext, input: z.infer<typeof target>) {
  return originalQuiescenceAction(ctx, input, input.subscriptionId);
}
export const claimMerchantPhaseScheduleStop = defineService({
  name: "subscriptions.claimMerchantPhaseScheduleStop", summary: "Commit one original primary-schedule cancellation under the actual pending erasure and current holds.",
  kind: "mutation", permission: "system", external: false, input: target, output: claim, auditInputFields: ["subscriptionId", "providerScheduleRef"],
  handler: async (input, ctx) => {
    const authority = await originalScheduleErasureAction(ctx, input);
    if (!authority) return { mode: "blocked" as const };
    const { parent, resource, scope, operations, taskReceipt } = authority;
    const known = originalPhaseResources(operations), phase = known?.get(input.providerScheduleRef);
    if (!known || !phase || !phase.creationOperationIds.size || operations.length > 5000 || operations.length !== resource.operationRevision || operations.some((operation, index) => operation.operationRevision !== index + 1 || !scheduleCallerHasStopped(operation))) return { mode: "recover" as const };
    const previous = operations.filter(operation => operation.kind === "cancel" && operation.originalRequest.resourceKind === "phase_schedule_stop" && operation.originalRequest.providerScheduleRef === input.providerScheduleRef);
    if (previous.length) {
      const last = previous.at(-1)!;
      return { mode: last.state === "confirmed" && scheduleCallerHasStopped(last) ? "done" as const : "recover" as const };
    }
    if (!resource.providerCustomerRef) return { mode: "recover" as const };
    const frozen = subscriptionMerchantScope.parse(scope), operationId = randomUUID(), nonce = randomBytes(32).toString("base64url");
    const providerRequest = phaseScheduleStopRequest.parse({ ...subscriptionChargeScope(frozen), providerPlatformAccountId: frozen.providerPlatformAccountId, subscriptionId: parent.id,
      providerScheduleRef: input.providerScheduleRef, providerCustomerRef: resource.providerCustomerRef, providerScheduleApiVersion: frozen.providerScheduleApiVersion,
      ...(phase.firstPhaseStart ? { originalFirstPhaseStart: phase.firstPhaseStart } : {}) });
    const originalRequest = { ...providerRequest, resourceKind: "phase_schedule_stop", method: "POST", path: `/v1/subscription_schedules/${input.providerScheduleRef}/cancel`,
      body: { invoice_now: "false", prorate: "false" }, ...taskReceipt, caller: merchantPhysicalCaller(), callerCompletionDigest: hash(nonce) };
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
    await ctx.tx.update(subscriptionProviderScheduleResources).set({ operationRevision: resource.operationRevision + 1, state: "quiescing", recoveryPending: true, stoppedProof: null, updatedAt: new Date() }).where(eq(subscriptionProviderScheduleResources.subscriptionId, parent.id));
    await ctx.tx.insert(subscriptionProviderScheduleOperations).values({ id: operationId, subscriptionId: parent.id, operationRevision: resource.operationRevision + 1, kind: "cancel",
      providerApiVersion: frozen.providerScheduleApiVersion, originalRequest, requestDigest: merchantTaxDigest(originalRequest), idempotencyKey: `phase-stop:${operationId}` });
    callers.set(operationId, { subscriptionId: parent.id, providerScheduleRef: input.providerScheduleRef, nonce, invoked: false, outcome: null, positives: [] });
    ctx.setSubject("subscription", parent.id); return { mode: "dispatch" as const, operationId, completionNonce: nonce, request: providerRequest };
  },
});
async function owned(ctx: ServiceContext, operationId: string, nonce: string) {
  const local = callers.get(operationId);
  if (!local || !local.invoked || local.nonce !== nonce) throw new ServiceError("permission", "This is not the actual admitted original schedule cancellation caller.");
  await lockContactIdentity(ctx.tx);
  const [parent] = await ctx.tx.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.id, local.subscriptionId)).limit(1).for("update");
  const [resource] = await ctx.tx.select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, local.subscriptionId)).limit(1).for("update");
  const [operation] = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.id, operationId)).limit(1).for("update");
  if (!parent || !resource || !operation || operation.kind !== "cancel" || operation.originalRequest.resourceKind !== "phase_schedule_stop" || operation.subscriptionId !== local.subscriptionId
    || operation.originalRequest.providerScheduleRef !== local.providerScheduleRef || merchantTaxDigest(operation.originalRequest) !== operation.requestDigest
    || operation.originalRequest.callerCompletionDigest !== hash(nonce) || z.object({ id: z.uuid() }).parse(operation.originalRequest.caller).id !== merchantPhysicalCaller().id) throw new ServiceError("permission", "Restore the exact original cancellation and its actual caller before retaining its outcome.");
  return { local, resource, operation };
}
async function retainStops(ctx: ServiceContext, current: Awaited<ReturnType<typeof owned>>) {
  const { local, operation } = current; let { resource } = current;
  let history = historySchema.parse(operation.providerObservation.history ?? []);
  for (const actual of local.positives) {
    const actualDigest = merchantTaxDigest(actual);
    if (history.some(entry => entry.source === "phase_schedule_stop_ack" && entry.actualDigest === actualDigest)) continue;
    history = [...history, { source: "phase_schedule_stop_ack", operationId: operation.id, requestDigest: operation.requestDigest, providerScheduleRef: local.providerScheduleRef, actualDigest, actual }];
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
    await ctx.tx.update(subscriptionProviderScheduleOperations).set({ positiveObserved: true, state: "unknown", providerObservation: { ...operation.providerObservation, history } }).where(eq(subscriptionProviderScheduleOperations.id, operation.id));
    resource = { ...resource, evidenceRevision: resource.evidenceRevision + 1 };
    await ctx.tx.update(subscriptionProviderScheduleResources).set({ evidenceRevision: resource.evidenceRevision, state: "quiescing", recoveryPending: true, stoppedProof: null, updatedAt: new Date() }).where(eq(subscriptionProviderScheduleResources.subscriptionId, local.subscriptionId));
    await enqueueMerchantScheduleErasureRepair(ctx.tx, { subscriptionId: local.subscriptionId, evidenceDigest: actualDigest });
  }
}
export const observeMerchantPhaseScheduleStop = defineService({
  name: "subscriptions.observeMerchantPhaseScheduleStop", summary: "Retain an actual primary schedule stop ACK and every observed linked subscription before later checks.",
  kind: "mutation", permission: "system", external: false, input: completion, output: z.object({ recorded: z.literal(true) }), auditInputFields: ["operationId"],
  handler: async ({ operationId, completionNonce }, ctx) => { const current = await owned(ctx, operationId, completionNonce); if (!current.local.positives.length) throw new ServiceError("permission", "The actual cancellation caller has no stop ACK."); await retainStops(ctx, current); return { recorded: true as const }; },
});
export const finishMerchantPhaseScheduleStop = defineService({
  name: "subscriptions.finishMerchantPhaseScheduleStop", summary: "Retain actual original schedule cancellation completion separately from linked-subscription and money closure.",
  kind: "mutation", permission: "system", external: false, input: completion, output: z.object({ finished: z.literal(true) }), auditInputFields: ["operationId"],
  handler: async ({ operationId, completionNonce }, ctx) => {
    let current = await owned(ctx, operationId, completionNonce); if (!current.local.outcome) throw new ServiceError("permission", "The actual cancellation promise has not finished.");
    await retainStops(ctx, current); current = await owned(ctx, operationId, completionNonce);
    const { local, operation } = current, history = historySchema.parse(operation.providerObservation.history ?? []);
    let changed = false;
    if (!history.some(entry => entry.source === "physical_caller_finished" && entry.operationId === operationId && entry.requestDigest === operation.requestDigest && entry.completionDigest === hash(completionNonce))) {
      changed = true;
      const verified = local.outcome === "returned" && local.positives.length > 0 && local.positives.every(value => value.providerScheduleRef === local.providerScheduleRef && value.linkedInventoryComplete);
      await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
      await ctx.tx.update(subscriptionProviderScheduleOperations).set({ state: verified ? "confirmed" : "unknown", finishedAt: new Date(), providerObservation: { ...operation.providerObservation,
        history: [...history, { source: "physical_caller_finished", operationId, requestDigest: operation.requestDigest, completionDigest: hash(completionNonce), outcome: local.outcome }] } }).where(eq(subscriptionProviderScheduleOperations.id, operationId));
    }
    // A malformed commercial read may leave a positive creation unknown.
    // Its actual existence can be closed by stopping every original primary
    // resource after the real creator ends; this grants no future billing.
    const all = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.subscriptionId, local.subscriptionId)).orderBy(subscriptionProviderScheduleOperations.operationRevision).limit(5001);
    const closed = all.length <= 5000 ? closedOriginalPhaseSchedules(all) : null;
    if (closed) for (const creator of all) if (creator.originalRequest.resourceKind === "phase_schedule" && creator.state === "unknown" && phaseOperationCallerFinished(creator)) {
      changed = true;
      const originalHistory = historySchema.parse(creator.providerObservation.history);
      await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
      await ctx.tx.update(subscriptionProviderScheduleOperations).set({ state: "confirmed", providerObservation: { ...creator.providerObservation,
        history: [...originalHistory, { source: "phase_schedule_closed_by_stop", operationId: creator.id, requestDigest: creator.requestDigest,
          stoppedPrimaryDigest: merchantTaxDigest(closed) }] } }).where(eq(subscriptionProviderScheduleOperations.id, creator.id));
    }
    if (changed) {
      await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
      await ctx.tx.update(subscriptionProviderScheduleResources).set({ evidenceRevision: current.resource.evidenceRevision + 1, state: "quiescing", recoveryPending: true, stoppedProof: null, updatedAt: new Date() }).where(eq(subscriptionProviderScheduleResources.subscriptionId, local.subscriptionId));
    }
    ctx.setSubject("subscription", local.subscriptionId); return { finished: true as const };
  },
});
export async function stopMerchantPhaseSchedules(value: z.input<typeof task>, context?: JobExecutionContext): Promise<void> {
  const input = task.parse(value);
  for (const [operationId, local] of callers) if (local.outcome) { await finishMerchantPhaseScheduleStop.call({ operationId, completionNonce: local.nonce }, { kind: "system" }); callers.delete(operationId); }
  const pending = await merchantPhaseScheduleTargets.call(input, { kind: "system" });
  for (const target of pending) { await flushMerchantProviderPhaseFinishes(target.subscriptionId); await flushMerchantPhaseProductFinishes(target.subscriptionId); await flushMerchantPhaseProductReads(target.subscriptionId); await flushMerchantScheduleReads(target.subscriptionId); }
  for (const target of await merchantPhaseScheduleTargets.call(input, { kind: "system" })) for (const operationId of target.recoveryOperationIds) {
    await context?.throwIfCancelled(); await recoverMerchantSchedule.call({ operationId }, { kind: "system" });
  }
  const targets = await merchantPhaseScheduleTargets.call(input, { kind: "system" }), adapter = paymentAdapter("stripe");
  if (targets.some(target => target.recoveryRequired)) throw new ServiceError("conflict", "Restore the original primary schedule ACK before stopping its remote resources.");
  for (const target of targets) for (const providerScheduleRef of target.providerScheduleRefs) {
    await context?.throwIfCancelled();
    const admitted = await claimMerchantPhaseScheduleStop.call({ ...input, subscriptionId: target.subscriptionId, providerScheduleRef }, { kind: "system" });
    if (admitted.mode !== "dispatch") continue;
    const local = callers.get(admitted.operationId);
    if (!local || local.nonce !== admitted.completionNonce || local.invoked) throw new ServiceError("permission", "The original cancellation caller is unavailable in this process.");
    local.invoked = true;
    try {
      if (!adapter.cancelMerchantPhaseSchedule) throw new ServiceError("conflict", "Restore the original primary schedule cancellation adapter.");
      await adapter.cancelMerchantPhaseSchedule({ ...admitted.request, onStopped: async value => {
        const actual = phaseScheduleStopped.parse(value); if (!local.positives.some(entry => merchantTaxDigest(entry) === merchantTaxDigest(actual))) local.positives.push(actual);
        await observeMerchantPhaseScheduleStop.call({ operationId: admitted.operationId, completionNonce: local.nonce }, { kind: "system" });
      } }); local.outcome = "returned";
    } catch (error) { local.outcome = "threw"; throw error; }
    finally { await finishMerchantPhaseScheduleStop.call({ operationId: admitted.operationId, completionNonce: local.nonce }, { kind: "system" }); callers.delete(admitted.operationId); }
  }
}
export default [merchantPhaseScheduleTargets, claimMerchantPhaseScheduleStop, observeMerchantPhaseScheduleStop, finishMerchantPhaseScheduleStop];
