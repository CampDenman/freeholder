// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: each original unpaid invoice/PI has one physical stop caller.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { paymentAdapter, type MerchantScheduleCashObservation } from "@/adapters/payments";
import { lockContactIdentity } from "@/core/contacts/identity-lock";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { merchantPhysicalCaller } from "@/modules/invoicing/merchant-physical-caller";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { originalScheduleErasureAction } from "./provider-phase-stop";
import { providerPhaseInventory } from "./provider-phase-contract";
import { originalPhaseResources, closedOriginalPhaseSchedules } from "./provider-phase-resources";
import { scheduleCallerHasStopped } from "./provider-schedule-proof";
import { invoiceActionRequest, invoiceActionAcknowledgment, originalProviderInvoiceInventory, invoiceStopAction } from "./provider-invoice-action-contract";
import { subscriptionChargeScope, subscriptionMerchantScope } from "./merchant-scope-contract";
import { subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "./provider-schedule-schema";
import { enqueueMerchantScheduleErasureRepair } from "./provider-schedule-erasure";
import { retainProviderCharge } from "./provider-charge-receipts";
import { subscriptions, subscriptionProviderChargeObservations, subscriptionProviderChargeReceipts } from "./schema";

const hash = (nonce: string) => createHash("sha256").update(nonce).digest("hex");
const historySchema = z.array(z.record(z.string(), z.unknown())).max(5000);
const task = z.object({ profileId: z.uuid(), requestId: z.uuid(), cohortId: z.uuid(), originalJobId: z.uuid(), subscriptionId: z.uuid() });
const target = task.extend({ providerSubscriptionRef: z.string().regex(/^sub_[A-Za-z0-9]{1,195}$/), providerInvoiceRef: z.string().regex(/^in_[A-Za-z0-9]{1,195}$/) });
const completion = z.object({ operationId: z.uuid(), completionNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const claim = z.discriminatedUnion("mode", [z.object({ mode: z.literal("blocked") }), z.object({ mode: z.literal("done") }), z.object({ mode: z.literal("recover") }),
  z.object({ mode: z.literal("dispatch"), operationId: z.uuid(), completionNonce: z.string(), request: invoiceActionRequest })]);
type Local = { subscriptionId: string; nonce: string; invoked: boolean; outcome: "returned" | "threw" | null; positives: Array<z.infer<typeof invoiceActionAcknowledgment>> };
const slot = Symbol.for("freeholder.subscription.invoice-stop-callers.v1");
const processState = globalThis as typeof globalThis & { [slot]?: Map<string, Local> };
const callers = processState[slot] ??= new Map<string, Local>();

export async function retainOriginalScheduleCash(actual: MerchantScheduleCashObservation): Promise<void> {
  const retained = await retainProviderCharge.call({ provider: "stripe", ...actual }, { kind: "system" });
  if (!retained.receiptId || !retained.observationId) throw new ServiceError("conflict", "Restore the original agreement and cash observation before reading further provider obligations.");
}
export const claimMerchantInvoiceStop = defineService({
  name: "subscriptions.claimMerchantInvoiceStop", summary: "Commit one unpaid original invoice or PaymentIntent stop from complete retained inventory and the current erasure authority.",
  kind: "mutation", permission: "system", external: false, auditInputFields: ["cohortId", "subscriptionId", "providerInvoiceRef"], input: target, output: claim,
  handler: async (input, ctx) => {
    const authority = await originalScheduleErasureAction(ctx, input);
    if (!authority) return { mode: "blocked" as const };
    const { parent, resource, scope, operations } = authority;
    if (operations.length > 5000 || operations.length !== resource.operationRevision || operations.some((operation, index) => operation.operationRevision !== index + 1
      || !["confirmed", "refused"].includes(operation.state) || !scheduleCallerHasStopped(operation))) return { mode: "recover" as const };
    const primary = originalPhaseResources(operations);
    if (!primary || primary.size && !closedOriginalPhaseSchedules(operations)) return { mode: "recover" as const };
    const cancellation = [...operations].reverse().find(operation => operation.kind === "cancel" && operation.originalRequest.method === "DELETE" && operation.originalRequest.providerSubscriptionRef === input.providerSubscriptionRef);
    if (!cancellation || cancellation.state !== "confirmed") return { mode: "recover" as const };
    const history = historySchema.parse(cancellation.providerObservation.history ?? []);
    const retained = [...history].reverse().find(entry => entry.source === "authenticated_invoice_inventory" && entry.providerSubscriptionRef === input.providerSubscriptionRef);
    const inventory = originalProviderInvoiceInventory.safeParse(retained);
    if (!retained || !inventory.success || retained.inventoryDigest !== merchantTaxDigest(inventory.data)) return { mode: "recover" as const };
    const invoice = inventory.data.invoices.find(value => value.providerInvoiceRef === input.providerInvoiceRef), action = invoice ? invoiceStopAction(invoice) : null;
    if (!invoice || !action) return { mode: "done" as const };
    const [cash] = await ctx.tx.select({ id: subscriptionProviderChargeReceipts.id }).from(subscriptionProviderChargeReceipts).where(and(
      eq(subscriptionProviderChargeReceipts.subscriptionId, parent.id), eq(subscriptionProviderChargeReceipts.providerInvoiceRef, input.providerInvoiceRef))).limit(1);
    const [positive] = await ctx.tx.select({ id: subscriptionProviderChargeObservations.id }).from(subscriptionProviderChargeObservations).where(and(
      eq(subscriptionProviderChargeObservations.subscriptionId, parent.id), eq(subscriptionProviderChargeObservations.providerInvoiceRef, input.providerInvoiceRef))).limit(1);
    if (cash || positive) return { mode: "recover" as const }; // Earlier money is never reclassified as unpaid.
    // Neither an identical idempotency key nor a new job permits another physical mutation.
    const previous = operations.filter(operation => operation.originalRequest.resourceKind === "invoice_stop" && operation.originalRequest.providerInvoiceRef === input.providerInvoiceRef
      && operation.originalRequest.action === action.action && operation.originalRequest.providerPaymentIntentRef === (action.action === "cancel_intent" ? action.providerPaymentIntentRef : undefined));
    if (previous.length) return { mode: "recover" as const };
    if (!resource.providerCustomerRef) return { mode: "recover" as const };
    const frozen = subscriptionMerchantScope.parse(scope), operationId = randomUUID(), nonce = randomBytes(32).toString("base64url");
    const origins = [...primary.values()].filter(value => value.providerSubscriptionRefs.has(input.providerSubscriptionRef));
    const creatorIds = new Set(origins.flatMap(value => [...value.creationOperationIds]).filter(id => operations.some(operation => operation.id === id && operation.kind === "create")));
    const admitted = operations.flatMap(operation => {
      const inventory = providerPhaseInventory.safeParse(operation.providerObservation.phaseInventory);
      if (!inventory.success || inventory.data.operationId !== operation.id || inventory.data.requestDigest !== operation.requestDigest
        || !origins.some(origin => origin.providerScheduleRef === inventory.data.providerScheduleRef)) return [];
      return inventory.data.phases.filter(phase => phase.start === invoice.periodStart && phase.totalMinor === invoice.totalMinor && phase.currency === invoice.currency);
    });
    const phaseDigests = new Set(admitted.map(phase => merchantTaxDigest(phase)));
    const admittedPhase = phaseDigests.size === 1 ? admitted[0] : undefined;
    if (action.action === "finalize_draft" && !admittedPhase) return { mode: "recover" as const };
    const providerRequest = invoiceActionRequest.parse({ ...subscriptionChargeScope(frozen), providerPlatformAccountId: frozen.providerPlatformAccountId,
      providerScheduleApiVersion: frozen.providerScheduleApiVersion, subscriptionId: parent.id, providerCustomerRef: resource.providerCustomerRef,
      providerSubscriptionRef: input.providerSubscriptionRef, providerInvoiceRef: input.providerInvoiceRef, ...action, ...(admittedPhase ? { admittedPhase } : {}), providerScheduleRefs: [...primary.keys()].sort(),
      ...(creatorIds.size === 1 ? { providerScheduleOperationId: [...creatorIds][0] } : {}) });
    const physical = { method: "POST", path: action.action === "cancel_intent" ? `/v1/payment_intents/${action.providerPaymentIntentRef}/cancel` : `/v1/invoices/${input.providerInvoiceRef}/${action.action === "finalize_draft" ? "finalize" : "void"}`, body: action.action === "finalize_draft" ? { auto_advance: "false" } : {} };
    const originalRequest = { ...providerRequest, resourceKind: "invoice_stop", physical, inventoryDigest: retained.inventoryDigest, originalCancellationId: cancellation.id,
      originalInvoice: invoice, requestId: input.requestId, cohortId: input.cohortId, caller: merchantPhysicalCaller(), callerCompletionDigest: hash(nonce) };
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
    await ctx.tx.update(subscriptionProviderScheduleResources).set({ operationRevision: resource.operationRevision + 1, state: "quiescing", recoveryPending: true, stoppedProof: null, updatedAt: new Date() }).where(eq(subscriptionProviderScheduleResources.subscriptionId, parent.id));
    await ctx.tx.insert(subscriptionProviderScheduleOperations).values({ id: operationId, subscriptionId: parent.id, operationRevision: resource.operationRevision + 1,
      kind: action.action === "cancel_intent" ? "cancel" : action.action === "finalize_draft" ? "update" : "void_invoice", providerApiVersion: frozen.providerScheduleApiVersion, originalRequest,
      requestDigest: merchantTaxDigest(originalRequest), idempotencyKey: `invoice-stop:${operationId}` });
    callers.set(operationId, { subscriptionId: parent.id, nonce, invoked: false, outcome: null, positives: [] });
    ctx.setSubject("subscription", parent.id); return { mode: "dispatch" as const, operationId, completionNonce: nonce, request: providerRequest };
  },
});
async function owned(ctx: ServiceContext, operationId: string, nonce: string) {
  const local = callers.get(operationId);
  if (!local || local.nonce !== nonce || !local.invoked) throw new ServiceError("permission", "This is not the actual admitted original invoice stop caller.");
  await lockContactIdentity(ctx.tx);
  const [parent] = await ctx.tx.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.id, local.subscriptionId)).limit(1).for("update");
  const [resource] = await ctx.tx.select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, local.subscriptionId)).limit(1).for("update");
  const [operation] = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.id, operationId)).limit(1).for("update");
  if (!parent || !resource || !operation || operation.subscriptionId !== local.subscriptionId || operation.originalRequest.resourceKind !== "invoice_stop"
    || merchantTaxDigest(operation.originalRequest) !== operation.requestDigest || operation.originalRequest.callerCompletionDigest !== hash(nonce)
    || z.object({ id: z.uuid() }).parse(operation.originalRequest.caller).id !== merchantPhysicalCaller().id) throw new ServiceError("permission", "Restore the exact original invoice request and its physical caller.");
  return { local, resource, operation };
}
async function retain(ctx: ServiceContext, current: Awaited<ReturnType<typeof owned>>) {
  const { local, operation, resource } = current, history = historySchema.parse(operation.providerObservation.history ?? []);
  const additions = local.positives.filter(actual => !history.some(entry => entry.source === "invoice_stop_ack" && entry.actualDigest === merchantTaxDigest(actual))).map(actual => ({
    source: "invoice_stop_ack", operationId: operation.id, requestDigest: operation.requestDigest, actualDigest: merchantTaxDigest(actual), actual }));
  if (!additions.length) return;
  await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
  await ctx.tx.update(subscriptionProviderScheduleOperations).set({ positiveObserved: true, state: "unknown", providerObservation: { ...operation.providerObservation, history: [...history, ...additions] } }).where(eq(subscriptionProviderScheduleOperations.id, operation.id));
  await ctx.tx.update(subscriptionProviderScheduleResources).set({ evidenceRevision: resource.evidenceRevision + 1, state: "quiescing", recoveryPending: true, stoppedProof: null, updatedAt: new Date() }).where(eq(subscriptionProviderScheduleResources.subscriptionId, local.subscriptionId));
  await enqueueMerchantScheduleErasureRepair(ctx.tx, { subscriptionId: local.subscriptionId, evidenceDigest: merchantTaxDigest(additions) });
}
export const observeMerchantInvoiceStop = defineService({
  name: "subscriptions.observeMerchantInvoiceStop", summary: "Retain the original actual terminal invoice or PaymentIntent ACK before later checks.",
  kind: "mutation", permission: "system", external: false, input: completion, output: z.object({ recorded: z.literal(true) }), auditInputFields: ["operationId"],
  handler: async ({ operationId, completionNonce }, ctx) => { const current = await owned(ctx, operationId, completionNonce); if (!current.local.positives.length) throw new ServiceError("permission", "No original terminal ACK was actually observed."); await retain(ctx, current); return { recorded: true as const }; },
});
export const finishMerchantInvoiceStop = defineService({
  name: "subscriptions.finishMerchantInvoiceStop", summary: "Finish the real original invoice stop caller without claiming cash, fees or whole-cohort closure.",
  kind: "mutation", permission: "system", external: false, input: completion, output: z.object({ finished: z.literal(true) }), auditInputFields: ["operationId"],
  handler: async ({ operationId, completionNonce }, ctx) => {
    let current = await owned(ctx, operationId, completionNonce);
    if (!current.local.outcome) throw new ServiceError("permission", "The actual original invoice stop promise has not finished.");
    await retain(ctx, current); current = await owned(ctx, operationId, completionNonce);
    const { local, resource, operation } = current, history = historySchema.parse(operation.providerObservation.history ?? []);
    if (!history.some(entry => entry.source === "physical_caller_finished" && entry.operationId === operationId && entry.requestDigest === operation.requestDigest && entry.completionDigest === hash(completionNonce))) {
      const verified = local.outcome === "returned" && local.positives.length === 1;
      await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
      await ctx.tx.update(subscriptionProviderScheduleOperations).set({ state: verified ? "confirmed" : "unknown", finishedAt: new Date(), providerObservation: { ...operation.providerObservation,
        history: [...history, { source: "physical_caller_finished", operationId, requestDigest: operation.requestDigest, completionDigest: hash(completionNonce), outcome: local.outcome }] } }).where(eq(subscriptionProviderScheduleOperations.id, operationId));
      await ctx.tx.update(subscriptionProviderScheduleResources).set({ evidenceRevision: resource.evidenceRevision + 1, state: "quiescing", recoveryPending: true, stoppedProof: null, updatedAt: new Date() }).where(eq(subscriptionProviderScheduleResources.subscriptionId, local.subscriptionId));
    }
    ctx.setSubject("subscription", local.subscriptionId); return { finished: true as const };
  },
});
export async function flushMerchantInvoiceStops(subscriptionId: string) {
  for (const [operationId, local] of callers) if (local.subscriptionId === subscriptionId && local.outcome) {
    await finishMerchantInvoiceStop.call({ operationId, completionNonce: local.nonce }, { kind: "system" }); callers.delete(operationId);
  }
}
export async function stopMerchantInvoice(input: z.infer<typeof target>): Promise<boolean> {
  await flushMerchantInvoiceStops(input.subscriptionId);
  const admitted = await claimMerchantInvoiceStop.call(input, { kind: "system" });
  if (admitted.mode !== "dispatch") return false;
  const local = callers.get(admitted.operationId);
  if (!local || local.nonce !== admitted.completionNonce || local.invoked) throw new ServiceError("permission", "The original invoice stop caller is unavailable in this process.");
  local.invoked = true;
  try {
    const adapter = paymentAdapter("stripe");
    if (!adapter.stopMerchantScheduleInvoice) throw new ServiceError("conflict", "Restore the original invoice stop adapter.");
    await adapter.stopMerchantScheduleInvoice({ ...admitted.request, onPaidIntentObserved: retainOriginalScheduleCash, onAcknowledged: async value => {
      const actual = invoiceActionAcknowledgment.parse(value);
      if (actual.providerInvoiceRef !== admitted.request.providerInvoiceRef || actual.action !== admitted.request.action
        || actual.action === "cancel_intent" && actual.providerPaymentIntentRef !== admitted.request.providerPaymentIntentRef) throw new ServiceError("conflict", "The actual ACK does not identify the admitted original invoice action.");
      if (!local.positives.some(entry => merchantTaxDigest(entry) === merchantTaxDigest(actual))) local.positives.push(actual);
      await observeMerchantInvoiceStop.call({ operationId: admitted.operationId, completionNonce: local.nonce }, { kind: "system" });
    } }); local.outcome = "returned";
  } catch (error) { local.outcome = "threw"; throw error; }
  finally { await finishMerchantInvoiceStop.call({ operationId: admitted.operationId, completionNonce: local.nonce }, { kind: "system" }); callers.delete(admitted.operationId); }
  return true;
}
export default [claimMerchantInvoiceStop, observeMerchantInvoiceStop, finishMerchantInvoiceStop];
