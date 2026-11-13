// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: recover only the retained original resource, through one actual GET.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { paymentAdapter, type MerchantPhaseScheduleAcknowledgment } from "@/adapters/payments";
import { lockContactIdentity } from "@/core/contacts/identity-lock";
import { defineOrchestratedService, defineService, ServiceError, type ServiceContext } from "@/core/service";
import { merchantPhysicalCaller } from "@/modules/invoicing/merchant-physical-caller";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { assertOriginalPhaseFinancials, phaseScheduleReadRequest } from "./provider-phase-dispatch";
import { phaseScheduleStopRequest, phaseScheduleStopped } from "./provider-phase-stop";
import { providerPhaseInventory, originalPhaseCustomerMatches } from "./provider-phase-contract";
import { closedOriginalPhaseSchedules, originalPhaseResources, phaseOperationCallerFinished } from "./provider-phase-resources";
import { subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "./provider-schedule-schema";
import { enqueueMerchantScheduleErasureRepair } from "./provider-schedule-erasure";
import { invoiceActionRequest, invoiceActionAcknowledgment } from "./provider-invoice-action-contract";
import { retainOriginalScheduleCash } from "./provider-invoice-actions";
import { subscriptions } from "./schema";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const ref = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]{1,195}$`));
const linkedRequest = z.object({ subscriptionId: z.uuid(), providerSubscriptionRef: ref("sub"), providerCustomerRef: ref("cus").optional(),
  providerPlatformAccountId: ref("acct"), providerAccountId: ref("acct").optional(), destinationAccountId: ref("acct").optional(), settlementMerchantAccountId: ref("acct").optional(), providerScheduleApiVersion: z.literal("2026-10-28.endive") });
const acknowledgement = z.object({ providerScheduleRef: ref("sub_sched"), providerSubscriptionRef: ref("sub").nullable().optional(), providerCustomerRef: ref("cus").nullable().optional() });
const cancellation = z.object({ providerSubscriptionRef: ref("sub"), state: z.literal("cancelled"), source: z.literal("readback") });
const completion = z.object({ readId: z.uuid(), completionNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const historySchema = z.array(z.record(z.string(), z.unknown())).max(5000);
type Operation = typeof subscriptionProviderScheduleOperations.$inferSelect;
type Resource = typeof subscriptionProviderScheduleResources.$inferSelect;
type Kind = "phase" | "phase_stop" | "subscription_cancel" | "invoice_action";
type Read = { operationId: string; subscriptionId: string; nonce: string; kind: Kind; expected: string; invoked: boolean; outcome: "returned" | "threw" | null; stale: boolean;
  positives: Array<Record<string, unknown>>; result?: z.infer<typeof providerPhaseInventory> };
const slot = Symbol.for("freeholder.subscription.schedule-recovery-reads.v1");
const state = globalThis as typeof globalThis & { [slot]?: Map<string, Read> };
const reads = state[slot] ??= new Map<string, Read>();
const revision = (operation: Operation, resource: Resource, journal: readonly Operation[]) => merchantTaxDigest([operation.id, operation.requestDigest, operation.state, operation.positiveObserved,
  operation.providerObservation, resource.operationRevision, resource.evidenceRevision, resource.providerSubscriptionRef, resource.providerCustomerRef, resource.state, resource.recoveryPending, resource.stoppedProof, journal.map(entry => [entry.id, entry.requestDigest, entry.state, entry.positiveObserved, entry.providerObservation])]);
async function locked(ctx: ServiceContext, operationId: string) {
  await lockContactIdentity(ctx.tx);
  const [reference] = await ctx.tx.select({ subscriptionId: subscriptionProviderScheduleOperations.subscriptionId }).from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.id, operationId)).limit(1);
  if (!reference) throw new ServiceError("conflict", "Restore the original operation before reading its resource.");
  const [parent] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, reference.subscriptionId)).limit(1).for("update");
  const [resource] = await ctx.tx.select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, reference.subscriptionId)).limit(1).for("update");
  const [operation] = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.id, operationId)).limit(1).for("update");
  if (!parent || !resource || !operation || merchantTaxDigest(operation.originalRequest) !== operation.requestDigest) throw new ServiceError("conflict", "Restore the unchanged original agreement, request and resource.");
  const journal = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.subscriptionId, operation.subscriptionId)).orderBy(subscriptionProviderScheduleOperations.operationRevision).limit(5001);
  if (journal.length > 5000 || journal.length !== resource.operationRevision || journal.some((entry, index) => entry.operationRevision !== index + 1)) throw new ServiceError("conflict", "Restore the complete original operation journal before a read.");
  return { parent, resource, operation, journal };
}
function plan(operation: Operation): { kind: Kind; request: Record<string, unknown> } {
  if (!phaseOperationCallerFinished(operation)) throw new ServiceError("conflict", "A GET cannot prove that the original physical mutation caller finished.");
  if (operation.originalRequest.resourceKind === "phase_schedule") {
    const original = originalPhaseResources([operation]);
    if (!original || original.size !== 1) throw new ServiceError("conflict", "Restore the one actual original schedule ACK before reading; no new POST is admitted.");
    return { kind: "phase", request: phaseScheduleReadRequest.parse({ ...operation.originalRequest, requestDigest: operation.requestDigest, providerScheduleRef: [...original.keys()][0] }) };
  }
  if (operation.kind === "cancel" && operation.originalRequest.resourceKind === "phase_schedule_stop") return { kind: "phase_stop", request: phaseScheduleStopRequest.parse(operation.originalRequest) };
  if (operation.originalRequest.resourceKind === "invoice_stop") return { kind: "invoice_action", request: invoiceActionRequest.parse(operation.originalRequest) };
  if (operation.kind === "cancel" && operation.originalRequest.method === "DELETE") return { kind: "subscription_cancel", request: linkedRequest.parse(operation.originalRequest) };
  throw new ServiceError("conflict", "This is not an original phase or cancellation operation.");
}
export const prepareMerchantScheduleRead = defineService({
  name: "subscriptions.prepareMerchantScheduleRead", summary: "Bind a separate GET to an original acknowledged schedule or admitted cancellation after its real caller finished.",
  kind: "mutation", permission: "system", external: false, auditInputFields: ["operationId"], input: z.object({ operationId: z.uuid() }),
  output: z.object({ readId: z.uuid(), completionNonce: z.string(), kind: z.enum(["phase", "phase_stop", "subscription_cancel", "invoice_action"]), request: z.record(z.string(), z.unknown()) }),
  handler: async ({ operationId }, ctx) => {
    const { operation, resource, journal } = await locked(ctx, operationId), original = plan(operation);
    if ([...reads.values()].some(read => read.operationId === operationId && read.invoked && !read.outcome)) throw new ServiceError("conflict", "The original verification read is still running in this process.");
    const readId = randomUUID(), nonce = randomBytes(32).toString("base64url");
    const observation = { ...operation.providerObservation, history: [...historySchema.parse(operation.providerObservation.history ?? []), {
      source: "schedule_read_admitted", operationId, requestDigest: operation.requestDigest, readId, kind: original.kind, request: original.request,
      callerId: merchantPhysicalCaller().id, completionDigest: hash(nonce) }] };
    const next = { ...resource, evidenceRevision: resource.evidenceRevision + 1, recoveryPending: true, stoppedProof: null };
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
    await ctx.tx.update(subscriptionProviderScheduleOperations).set({ state: "unknown", providerObservation: observation }).where(eq(subscriptionProviderScheduleOperations.id, operationId));
    await ctx.tx.update(subscriptionProviderScheduleResources).set({ evidenceRevision: next.evidenceRevision, recoveryPending: true, stoppedProof: null, updatedAt: new Date() }).where(eq(subscriptionProviderScheduleResources.subscriptionId, resource.subscriptionId));
    reads.set(readId, { operationId, subscriptionId: operation.subscriptionId, nonce, kind: original.kind, expected: revision({ ...operation, state: "unknown", providerObservation: observation }, next, journal.map(entry => entry.id === operation.id ? { ...operation, state: "unknown" as const, providerObservation: observation } : entry)), invoked: false, outcome: null, stale: false, positives: [] });
    ctx.setSubject("subscription", operation.subscriptionId); return { readId, completionNonce: nonce, ...original };
  },
});
async function owned(ctx: ServiceContext, readId: string, nonce: string) {
  const local = reads.get(readId);
  if (!local || !local.invoked || local.nonce !== nonce) throw new ServiceError("permission", "This is not the actual admitted verification caller.");
  const current = await locked(ctx, local.operationId), history = historySchema.parse(current.operation.providerObservation.history ?? []);
  if (!history.some(entry => entry.source === "schedule_read_admitted" && entry.readId === readId && entry.operationId === local.operationId
    && entry.requestDigest === current.operation.requestDigest && entry.callerId === merchantPhysicalCaller().id && entry.completionDigest === hash(nonce))) throw new ServiceError("permission", "Restore the original nonce-owned read admission.");
  return { ...current, local, history };
}
export const observeMerchantScheduleRead = defineService({
  name: "subscriptions.observeMerchantScheduleRead", summary: "Retain actual schedule linkage or a terminal GET before any later price, scope or persistence failure.",
  kind: "mutation", permission: "system", external: false, auditInputFields: ["readId"], input: completion, output: z.object({ revision: z.string() }),
  handler: async ({ readId, completionNonce }, ctx) => {
    const { operation, resource, local, history, journal } = await owned(ctx, readId, completionNonce);
    const fresh = revision(operation, resource, journal) === local.expected;
    const additions = local.positives.filter(actual => !history.some(entry => entry.source === "schedule_read_positive" && entry.readId === readId && entry.actualDigest === merchantTaxDigest(actual)))
      .flatMap(actual => [{ source: "schedule_read_positive", operationId: operation.id, requestDigest: operation.requestDigest, readId, actualDigest: merchantTaxDigest(actual), actual },
        ...(local.kind === "phase" ? [{ source: "phase_schedule_ack", operationId: operation.id, requestDigest: operation.requestDigest, readId, ...actual }] : []),
        ...(local.kind === "phase_stop" ? [{ source: "phase_schedule_stop_ack", operationId: operation.id, requestDigest: operation.requestDigest, readId,
          providerScheduleRef: actual.providerScheduleRef, actualDigest: merchantTaxDigest(actual), actual }] : [])]);
    if (!additions.length) return { revision: fresh ? revision(operation, resource, journal) : "stale" };
    const observation = { ...operation.providerObservation, history: [...history, ...additions] }, next = { ...resource, evidenceRevision: resource.evidenceRevision + 1, recoveryPending: true, stoppedProof: null };
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
    await ctx.tx.update(subscriptionProviderScheduleOperations).set({ positiveObserved: true, providerObservation: observation }).where(eq(subscriptionProviderScheduleOperations.id, operation.id));
    await ctx.tx.update(subscriptionProviderScheduleResources).set({ evidenceRevision: next.evidenceRevision, recoveryPending: true, stoppedProof: null, updatedAt: new Date() }).where(eq(subscriptionProviderScheduleResources.subscriptionId, resource.subscriptionId));
    await enqueueMerchantScheduleErasureRepair(ctx.tx, { subscriptionId: operation.subscriptionId, evidenceDigest: merchantTaxDigest(additions) });
    return { revision: fresh ? revision({ ...operation, positiveObserved: true, providerObservation: observation }, next, journal.map(entry => entry.id === operation.id ? { ...operation, positiveObserved: true, providerObservation: observation } : entry)) : "stale" };
  },
});
export const applyMerchantScheduleRead = defineService({
  name: "subscriptions.applyMerchantScheduleRead", summary: "Finish this actual GET and retain stale evidence without granting original caller or cash closure.",
  kind: "mutation", permission: "system", external: false, auditInputFields: ["readId"], input: completion, output: z.object({ verified: z.boolean() }),
  handler: async ({ readId, completionNonce }, ctx) => {
    const { operation, resource, local, history, parent, journal } = await owned(ctx, readId, completionNonce);
    if (!local.outcome) throw new ServiceError("permission", "The actual verification promise has not finished.");
    const previous = history.find(entry => entry.source === "schedule_read_finished" && entry.readId === readId && entry.completionDigest === hash(completionNonce));
    if (previous) return { verified: previous.verified === true };
    const actual: Record<string, unknown> | undefined = local.kind === "phase" ? local.result : local.positives.at(-1);
    const actualDigest = actual ? merchantTaxDigest(actual) : null;
    const original = plan(operation).request;
    const matches = local.kind === "phase" ? !!local.result && local.result.operationId === operation.id && local.result.requestDigest === operation.requestDigest
      && local.result.providerScheduleRef === original.providerScheduleRef && originalPhaseCustomerMatches(local.result, operation.originalRequest.providerCustomerRef)
      && (!resource.providerSubscriptionRef || local.result.providerSubscriptionRef === resource.providerSubscriptionRef)
      : local.kind === "phase_stop" ? actual?.providerScheduleRef === original.providerScheduleRef && actual?.linkedInventoryComplete === true
      : local.kind === "subscription_cancel" ? actual?.providerSubscriptionRef === original.providerSubscriptionRef
      : actual?.providerInvoiceRef === original.providerInvoiceRef && actual?.action === original.action
        && (original.action !== "cancel_intent" || actual?.providerPaymentIntentRef === original.providerPaymentIntentRef);
    const verified = !local.stale && local.expected === revision(operation, resource, journal) && local.outcome === "returned" && !!actual && matches && phaseOperationCallerFinished(operation);
    const additions: Array<Record<string, unknown>> = [];
    if (local.kind === "phase" && local.result) additions.push({ source: verified ? "phase_schedule_read_verified" : "phase_schedule_read_stale", operationId: operation.id, requestDigest: operation.requestDigest,
      readId, providerScheduleRef: local.result.providerScheduleRef, providerSubscriptionRef: local.result.providerSubscriptionRef, inventoryDigest: actualDigest, inventory: local.result });
    if (local.kind === "phase_stop" && actual && !history.some(entry => entry.source === "phase_schedule_stop_ack" && entry.readId === readId && entry.actualDigest === actualDigest)) additions.push({ source: "phase_schedule_stop_ack", operationId: operation.id, requestDigest: operation.requestDigest, readId,
      providerScheduleRef: actual.providerScheduleRef, actualDigest, actual });
    if (local.kind === "invoice_action" && actual) additions.push({ source: "invoice_stop_ack", operationId: operation.id, requestDigest: operation.requestDigest, readId, actualDigest, actual });
    if (local.kind === "subscription_cancel" && verified) additions.push({ source: "provider_cancel_readback", operationId: operation.id, requestDigest: operation.requestDigest, readId,
      providerSubscriptionRef: actual?.providerSubscriptionRef, providerState: "cancelled" });
    additions.push({ source: "schedule_read_finished", operationId: operation.id, requestDigest: operation.requestDigest, readId, completionDigest: hash(completionNonce), outcome: local.outcome, verified, actualDigest });
    const observation = { ...operation.providerObservation, ...(verified && local.result ? { phaseInventory: local.result } : {}), history: [...history, ...additions] };
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
    await ctx.tx.update(subscriptionProviderScheduleOperations).set({ state: verified ? "confirmed" : "unknown", providerObservation: observation }).where(eq(subscriptionProviderScheduleOperations.id, operation.id));
    if (verified && local.kind === "phase_stop") {
      const nextJournal = journal.map(entry => entry.id === operation.id ? { ...operation, state: "confirmed" as const, providerObservation: observation } : entry);
      const closed = closedOriginalPhaseSchedules(nextJournal);
      if (closed) for (const creator of nextJournal) if (creator.originalRequest.resourceKind === "phase_schedule" && creator.state === "unknown" && phaseOperationCallerFinished(creator)) {
        await ctx.tx.update(subscriptionProviderScheduleOperations).set({ state: "confirmed", providerObservation: { ...creator.providerObservation,
          history: [...historySchema.parse(creator.providerObservation.history ?? []), { source: "phase_schedule_closed_by_stop", operationId: creator.id, requestDigest: creator.requestDigest,
            stoppedPrimaryDigest: merchantTaxDigest(closed) }] } }).where(eq(subscriptionProviderScheduleOperations.id, creator.id));
      }
    }
    // Only the latest unchanged commercial phase may clear its own read debt;
    // actual old money still uses the shared applied-or-returned authority.
    let clearDebt = verified && local.kind === "phase" && !!local.result && ["active", "not_started"].includes(local.result.status)
      && journal.filter(entry => entry.originalRequest.resourceKind === "phase_schedule").at(-1)?.id === operation.id
      && journal.every(entry => (entry.id === operation.id || ["confirmed", "refused"].includes(entry.state)) && phaseOperationCallerFinished(entry))
      && !journal.some(entry => ["cancel", "pause", "resume", "void_invoice", "delete_draft"].includes(entry.kind));
    if (clearDebt) try { await assertOriginalPhaseFinancials(ctx, operation.subscriptionId); }
    catch (error) { if (error instanceof ServiceError && error.code === "conflict") clearDebt = false; else throw error; }
    // Primary stop reads never discharge linked-subscription, invoice or privacy
    // work. The final original inventory service owns whole-cohort quiescence.
    const linked = resource.providerSubscriptionRef ?? (verified && local.result ? local.result.providerSubscriptionRef : null);
    await ctx.tx.update(subscriptionProviderScheduleResources).set({ providerSubscriptionRef: linked, state: clearDebt ? "active" : "quiescing", recoveryPending: !clearDebt,
      stoppedProof: null, evidenceRevision: resource.evidenceRevision + 1, updatedAt: new Date() }).where(eq(subscriptionProviderScheduleResources.subscriptionId, resource.subscriptionId));
    if (verified && linked && !parent.providerRef && parent.merchantScopeVersion === 1 && parent.provider === "stripe") await ctx.tx.update(subscriptions).set({ providerRef: linked }).where(eq(subscriptions.id, parent.id));
    await enqueueMerchantScheduleErasureRepair(ctx.tx, { subscriptionId: operation.subscriptionId, evidenceDigest: merchantTaxDigest(additions) });
    ctx.setSubject("subscription", operation.subscriptionId); return { verified };
  },
});
export async function flushMerchantScheduleReads(subscriptionId: string) {
  for (const [readId, local] of reads) if (local.subscriptionId === subscriptionId && local.outcome) {
    const retained = await observeMerchantScheduleRead.call({ readId, completionNonce: local.nonce }, { kind: "system" });
    if (retained.revision === "stale") local.stale = true; else local.expected = retained.revision;
    await applyMerchantScheduleRead.call({ readId, completionNonce: local.nonce }, { kind: "system" }); reads.delete(readId);
  }
}
export const recoverMerchantSchedule = defineOrchestratedService({
  name: "subscriptions.recoverMerchantSchedule", summary: "Recover an original schedule or cancellation using only GETs after its own physical caller finished.",
  kind: "mutation", permission: "system", external: false, input: z.object({ operationId: z.uuid() }), output: z.object({ verified: z.boolean() }),
  handler: async ({ operationId }) => {
    // A failed fact commit is retried from the returned actual wrapper, with no GET replay.
    for (const [readId, local] of reads) if (local.operationId === operationId && local.outcome) {
      const retained = await observeMerchantScheduleRead.call({ readId, completionNonce: local.nonce }, { kind: "system" });
      if (retained.revision === "stale") local.stale = true; else local.expected = retained.revision;
      const applied = await applyMerchantScheduleRead.call({ readId, completionNonce: local.nonce }, { kind: "system" }); reads.delete(readId); return applied;
    }
    const claimed = await prepareMerchantScheduleRead.call({ operationId }, { kind: "system" }), local = reads.get(claimed.readId);
    if (!local || local.nonce !== claimed.completionNonce || local.invoked) throw new ServiceError("permission", "The original read is unavailable in this process.");
    const adapter = paymentAdapter("stripe"); local.invoked = true;
    const observed = async (actual: Record<string, unknown>) => {
      if (!local.positives.some(value => merchantTaxDigest(value) === merchantTaxDigest(actual))) local.positives.push(actual);
      const retained = await observeMerchantScheduleRead.call({ readId: claimed.readId, completionNonce: local.nonce }, { kind: "system" });
      if (retained.revision === "stale") local.stale = true; else local.expected = retained.revision;
    };
    try {
      if (claimed.kind === "phase") {
        if (!adapter.inspectMerchantPhaseSchedule) throw new ServiceError("conflict", "Restore the original phase GET adapter.");
        const actual = await adapter.inspectMerchantPhaseSchedule({ ...phaseScheduleReadRequest.parse(claimed.request), onResourceAcknowledged: async (value: MerchantPhaseScheduleAcknowledgment) => observed(acknowledgement.parse(value)) });
        local.result = providerPhaseInventory.parse({ version: 1, ...actual });
      } else if (claimed.kind === "phase_stop") {
        if (!adapter.inspectMerchantPhaseScheduleStop) throw new ServiceError("conflict", "Restore the GET-only primary stop adapter.");
        await adapter.inspectMerchantPhaseScheduleStop({ ...phaseScheduleStopRequest.parse(claimed.request), onStopped: async value => observed(phaseScheduleStopped.parse(value)) });
      } else if (claimed.kind === "invoice_action") {
        if (!adapter.inspectMerchantScheduleInvoiceStop) throw new ServiceError("conflict", "Restore the GET-only original invoice action adapter.");
        await adapter.inspectMerchantScheduleInvoiceStop({ ...invoiceActionRequest.parse(claimed.request), onPaidIntentObserved: retainOriginalScheduleCash,
          onAcknowledged: async value => observed(invoiceActionAcknowledgment.parse(value)) });
      } else {
        if (!adapter.inspectMerchantScheduleCancellation) throw new ServiceError("conflict", "Restore the GET-only original subscription cancellation adapter.");
        await adapter.inspectMerchantScheduleCancellation({ ...linkedRequest.parse(claimed.request), onCancelled: async value => observed(cancellation.parse(value)) });
      }
      local.outcome = "returned";
    } catch (error) { local.outcome = "threw"; await flushMerchantScheduleReads(local.subscriptionId); throw error; }
    const applied = await applyMerchantScheduleRead.call({ readId: claimed.readId, completionNonce: local.nonce }, { kind: "system" }); reads.delete(claimed.readId); return applied;
  },
});
export default [prepareMerchantScheduleRead, observeMerchantScheduleRead, applyMerchantScheduleRead, recoverMerchantSchedule];
