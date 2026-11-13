// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: a quoted horizon has one original physical creator and durable ACK.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { paymentAdapter, type MerchantPhaseScheduleAcknowledgment, type MerchantPhaseScheduleInventory } from "@/adapters/payments";
import { stripeMerchantPhaseBody } from "@/adapters/payments/stripe-subscription-phases";
import { lockContactIdentity } from "@/core/contacts/identity-lock";
import { defineOrchestratedService, defineService, getService, ServiceError, type ServiceContext } from "@/core/service";
import { merchantPhysicalCaller } from "@/modules/invoicing/merchant-physical-caller";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { originalProductAdmission } from "./provider-phase-products";
import { verifiedOriginalPhaseProduct } from "./provider-phase-product-proof";
import { flushMerchantPhaseProductFinishes } from "./provider-phase-products";
import { flushMerchantPhaseProductReads } from "./provider-phase-product-recovery";
import { providerPhase, providerPhaseInventory, originalPhaseCustomerMatches } from "./provider-phase-contract";
import { subscriptionChargeScope } from "./merchant-scope-contract";
import { subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "./provider-schedule-schema";
import { enqueueMerchantScheduleErasureRepair } from "./provider-schedule-erasure";
import { subscriptions, subscriptionProviderChargeObservations, subscriptionProviderChargeReceipts } from "./schema";
import { merchantAgreementPaymentRoutes } from "@/modules/invoicing/merchant-agreement-schema";

const hash = (nonce: string) => createHash("sha256").update(nonce).digest("hex");
const reference = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]{1,195}$`));
const account = reference("acct"), sha = z.string().regex(/^[a-f0-9]{64}$/);
const request = z.object({ subscriptionId: z.uuid(), operationId: z.uuid(), requestDigest: sha, idempotencyKey: z.string().min(1).max(200),
  providerPlatformAccountId: account, providerAccountId: account.optional(), destinationAccountId: account.optional(), settlementMerchantAccountId: account.optional(),
  providerScheduleApiVersion: z.literal("2026-10-28.endive"), providerCustomerRef: reference("cus"), providerMethodRef: reference("pm"), providerProductRef: reference("prod"),
  phases: z.array(providerPhase).min(1).max(10) });
const previous = request.omit({ idempotencyKey: true }).extend({ providerScheduleRef: reference("sub_sched") });
const dispatchRequest = request.extend({ providerScheduleRef: reference("sub_sched").optional(), previous: previous.optional() });
const claimInput = z.object({ subscriptionId: z.uuid(), additionalPeriods: z.number().int().positive().max(10), expectedHorizonDigest: sha });
const claimOutput = z.object({ operationId: z.uuid(), completionNonce: z.string(), request: dispatchRequest });
const callerInput = z.object({ operationId: z.uuid(), completionNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const ack = z.object({ providerScheduleRef: reference("sub_sched"), providerSubscriptionRef: reference("sub").nullable().optional(), providerCustomerRef: reference("cus").nullable().optional() });
type Local = { subscriptionId: string; nonce: string; invoked: boolean; outcome: "returned" | "threw" | null;
  positives: MerchantPhaseScheduleAcknowledgment[]; result?: MerchantPhaseScheduleInventory; readRevision?: string };
const slot = Symbol.for("freeholder.subscription.phase-schedule-callers.v1");
const state = globalThis as typeof globalThis & { [slot]?: Map<string, Local> };
const callers = state[slot] ??= new Map<string, Local>();
const historySchema = z.array(z.record(z.string(), z.unknown())).max(5000);
const readRevision = (owned: { resource: typeof subscriptionProviderScheduleResources.$inferSelect; operation: typeof subscriptionProviderScheduleOperations.$inferSelect }) =>
  merchantTaxDigest([owned.resource.subscriptionId, owned.resource.operationRevision, owned.resource.evidenceRevision, owned.resource.state,
    owned.resource.providerSubscriptionRef, owned.resource.providerCustomerRef, owned.resource.recoveryPending, owned.resource.stoppedProof,
    owned.operation.requestDigest, owned.operation.state, owned.operation.positiveObserved, owned.operation.providerObservation]);

/** Every old positive cash fact is applied with current financial closure or
 * actually returned through the shared original-cash proof. Neither an empty
 * current invoice list nor a local schedule flag discharges money history. */
export async function assertOriginalPhaseFinancials(ctx: ServiceContext, subscriptionId: string) {
  const receipts = await ctx.tx.select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId, subscriptionId)).orderBy(subscriptionProviderChargeReceipts.id).limit(5001);
  const observations = await ctx.tx.select().from(subscriptionProviderChargeObservations).where(eq(subscriptionProviderChargeObservations.subscriptionId, subscriptionId)).orderBy(subscriptionProviderChargeObservations.id).limit(5001);
  const routes = await ctx.tx.select().from(merchantAgreementPaymentRoutes).where(eq(merchantAgreementPaymentRoutes.subscriptionId, subscriptionId)).orderBy(merchantAgreementPaymentRoutes.paymentId).limit(5001);
  if ([receipts, observations, routes].some(rows => rows.length > 5000)) throw new ServiceError("conflict", "Restore the bounded complete original cash inventory before extending billing.");
  for (const observed of observations) {
    if (!receipts.some(receipt => receipt.providerPlatformAccountId === observed.providerPlatformAccountId && receipt.chargeAccountId === observed.chargeAccountId
      && receipt.providerSubscriptionRef === observed.providerSubscriptionRef && receipt.providerInvoiceRef === observed.providerInvoiceRef
      && receipt.providerPaymentIntentRef === observed.providerPaymentIntentRef && receipt.amountMinor === observed.amountMinor && receipt.currency === observed.currency
      && (!observed.providerChargeRef || receipt.providerChargeRef === observed.providerChargeRef))) throw new ServiceError("conflict", "Retain and reconcile every original positive cash observation before extending billing.");
  }
  const disposition = getService("invoicing.subscriptionChargeDisposition"), debt = getService("invoicing.merchantPaymentRecoveryDebt");
  const applied = z.object({ kind: z.literal("applied"), invoiceId: z.uuid(), paymentId: z.uuid() });
  const returned = z.object({ kind: z.literal("returned_unapplied"), returnReceiptId: z.uuid() });
  for (const receipt of receipts) {
    if (!disposition) throw new ServiceError("conflict", "Restore the original shared applied-or-returned cash proof before admitting more billing.");
    const result = z.union([applied, returned]).nullable().parse(await ctx.callAsSystem(disposition, { receiptId: receipt.id }));
    if (!result) throw new ServiceError("conflict", "Apply or actually return the original cash and settle its fees and recipient before extending billing.");
    if (result.kind === "applied" && !routes.some(route => route.paymentId === result.paymentId && route.originalChargeReceiptId === receipt.id)) throw new ServiceError("conflict", "Restore the exact original payment application route before extending billing.");
  }
  for (const route of routes) {
    if (!debt || z.object({ pending: z.boolean() }).passthrough().parse(await ctx.callAsSystem(debt, { paymentId: route.paymentId })).pending) throw new ServiceError("conflict", "Original payment callers, bank returns, commission or recipient recovery still prevent more billing.");
    if (route.originKind === "provider_schedule" && !receipts.some(receipt => receipt.id === route.originalChargeReceiptId)) throw new ServiceError("conflict", "Restore the original scheduled cash receipt before extending billing.");
  }
}

export const claimMerchantProviderPhases = defineService({
  name: "subscriptions.claimMerchantProviderPhases", summary: "Commit one exact quoted original schedule horizon before its physical POST.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", input: claimInput, output: claimOutput,
  auditInputFields: ["subscriptionId", "additionalPeriods", "expectedHorizonDigest"],
  handler: async (input, ctx) => {
    const { parent, horizon } = await originalProductAdmission(ctx, input.subscriptionId, input.additionalPeriods);
    await assertOriginalPhaseFinancials(ctx, parent.id);
    if (horizon.horizonDigest !== input.expectedHorizonDigest) throw new ServiceError("conflict", "The actual original period quotes or provider inventory changed. Review the complete horizon again.");
    if (horizon.mode === "initial" && Date.parse(horizon.phases[0]!.start) <= Date.now()) throw new ServiceError("conflict", "The original trial or paid period already ended. Reconcile its actual due invoice before admitting a future provider resource.");
    const [resource] = await ctx.tx.select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, parent.id)).limit(1).for("update");
    const operations = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.subscriptionId, parent.id)).orderBy(subscriptionProviderScheduleOperations.operationRevision).limit(5001);
    if (!resource || resource.operationRevision !== horizon.resourceRevision || resource.evidenceRevision !== horizon.evidenceRevision || operations.length !== resource.operationRevision || operations.length > 5000) throw new ServiceError("conflict", "Restore the unchanged original operation inventory before admitting this horizon.");
    const products = operations.filter(operation => operation.kind === "create_product").map(verifiedOriginalPhaseProduct);
    if (products.length !== 1 || !products[0]) throw new ServiceError("conflict", "Prepare and independently verify the one original auxiliary product before admitting billing work.");
    const operationId = randomUUID(), nonce = randomBytes(32).toString("base64url");
    const base = { ...subscriptionChargeScope(horizon.originalScope), providerPlatformAccountId: horizon.originalScope.providerPlatformAccountId,
      providerScheduleApiVersion: horizon.originalScope.providerScheduleApiVersion, subscriptionId: parent.id, operationId, idempotencyKey: `phase-schedule:${operationId}`,
      providerCustomerRef: horizon.providerCustomerRef, providerMethodRef: horizon.providerMethodRef, providerProductRef: products[0], phases: horizon.phases };
    let prior: z.infer<typeof previous> | undefined;
    if (horizon.mode === "extension") {
      const original = operations.find(operation => operation.id === horizon.anchor.sourceOperationId);
      if (!original || !horizon.providerScheduleRef) throw new ServiceError("conflict", "Restore the actual original phase operation and schedule before extension.");
      prior = previous.parse({ ...original.originalRequest, requestDigest: original.requestDigest, providerScheduleRef: horizon.providerScheduleRef });
    }
    // The provider metadata uses the operation UUID; it never embeds the
    // self-referential digest of a request that includes its own POST body.
    const preliminary = dispatchRequest.parse({ ...base, requestDigest: merchantTaxDigest(base), ...(prior ? { providerScheduleRef: prior.providerScheduleRef, previous: prior } : {}) });
    const physical = { method: "POST", path: prior ? `/v1/subscription_schedules/${prior.providerScheduleRef}` : "/v1/subscription_schedules",
      body: Object.fromEntries(stripeMerchantPhaseBody(preliminary, !!prior)) };
    const originalRequest = { ...base, ...(prior ? { providerScheduleRef: prior.providerScheduleRef, previous: prior } : {}), resourceKind: "phase_schedule", physical,
      horizonDigest: horizon.horizonDigest, exemptionFingerprint: horizon.exemptionFingerprint, anchor: horizon.anchor,
      caller: merchantPhysicalCaller(), callerCompletionDigest: hash(nonce) };
    const requestDigest = merchantTaxDigest(originalRequest), providerRequest = dispatchRequest.parse({ ...preliminary, requestDigest });
    if (merchantTaxDigest(Object.fromEntries(stripeMerchantPhaseBody(providerRequest, !!prior))) !== merchantTaxDigest(physical.body)) throw new ServiceError("internal", "The original physical schedule body changed during admission.");
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
    await ctx.tx.update(subscriptionProviderScheduleResources).set({ operationRevision: resource.operationRevision + 1, recoveryPending: true, stoppedProof: null,
      providerCustomerRef: resource.providerCustomerRef ?? horizon.providerCustomerRef, state: "unknown", updatedAt: new Date() }).where(eq(subscriptionProviderScheduleResources.subscriptionId, parent.id));
    await ctx.tx.insert(subscriptionProviderScheduleOperations).values({ id: operationId, subscriptionId: parent.id, operationRevision: resource.operationRevision + 1,
      kind: prior ? "update" : "create", providerApiVersion: horizon.originalScope.providerScheduleApiVersion, originalRequest, requestDigest, idempotencyKey: base.idempotencyKey });
    callers.set(operationId, { subscriptionId: parent.id, nonce, invoked: false, outcome: null, positives: [] });
    ctx.setSubject("subscription", parent.id);
    return { operationId, completionNonce: nonce, request: providerRequest };
  },
});
async function ownedCaller(ctx: ServiceContext, operationId: string, nonce: string) {
  const local = callers.get(operationId);
  if (!local || !local.invoked || local.nonce !== nonce) throw new ServiceError("permission", "This is not the actual original schedule caller.");
  await lockContactIdentity(ctx.tx);
  const [parent] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, local.subscriptionId)).limit(1).for("update");
  const [resource] = await ctx.tx.select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, local.subscriptionId)).limit(1).for("update");
  const [operation] = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.id, operationId)).limit(1).for("update");
  if (!parent || !resource || !operation || operation.subscriptionId !== local.subscriptionId || !["create", "update"].includes(operation.kind)
    || operation.originalRequest.resourceKind !== "phase_schedule" || merchantTaxDigest(operation.originalRequest) !== operation.requestDigest
    || operation.originalRequest.callerCompletionDigest !== hash(nonce) || z.object({ id: z.uuid() }).parse(operation.originalRequest.caller).id !== merchantPhysicalCaller().id) throw new ServiceError("permission", "Restore the exact original schedule intent and actual caller before retaining its outcome.");
  return { local, parent, resource, operation };
}
async function retainAcknowledgments(ctx: ServiceContext, owned: Awaited<ReturnType<typeof ownedCaller>>) {
  const { local, operation } = owned; let { resource } = owned;
  let history = historySchema.parse(operation.providerObservation.history ?? []);
  for (const actual of local.positives) {
    if (history.some(entry => entry.source === "phase_schedule_ack" && entry.operationId === operation.id && entry.requestDigest === operation.requestDigest && merchantTaxDigest(entry.actual) === merchantTaxDigest(actual))) continue;
    // Keep each actual primary schedule and nullable/unknown linked identity.
    // A positive late alternative can never overwrite its first resource.
    history = [...history, { source: "phase_schedule_ack", operationId: operation.id, requestDigest: operation.requestDigest,
      providerScheduleRef: actual.providerScheduleRef, ...(actual.providerSubscriptionRef ? { providerSubscriptionRef: actual.providerSubscriptionRef } : {}), actual }];
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
    await ctx.tx.update(subscriptionProviderScheduleOperations).set({ positiveObserved: true, state: "unknown", providerObservation: { ...operation.providerObservation, history } }).where(eq(subscriptionProviderScheduleOperations.id, operation.id));
    resource = { ...resource, providerSubscriptionRef: resource.providerSubscriptionRef ?? actual.providerSubscriptionRef ?? null, evidenceRevision: resource.evidenceRevision + 1 };
    await ctx.tx.update(subscriptionProviderScheduleResources).set({ providerSubscriptionRef: resource.providerSubscriptionRef, state: "unknown", stoppedProof: null,
      recoveryPending: true, evidenceRevision: resource.evidenceRevision, updatedAt: new Date() }).where(eq(subscriptionProviderScheduleResources.subscriptionId, resource.subscriptionId));
    await enqueueMerchantScheduleErasureRepair(ctx.tx, { subscriptionId: operation.subscriptionId, evidenceDigest: merchantTaxDigest({ operationId: operation.id, actual }) });
  }
}
export const observeMerchantProviderPhase = defineService({
  name: "subscriptions.observeMerchantProviderPhase", summary: "Retain actual original schedule ACKs before auxiliary price reads and policy checks.",
  kind: "mutation", permission: "system", external: false, input: callerInput, output: z.object({ recorded: z.literal(true), readRevision: sha }), auditInputFields: ["operationId"],
  handler: async ({ operationId, completionNonce }, ctx) => {
    const owned = await ownedCaller(ctx, operationId, completionNonce);
    if (!owned.local.positives.length) throw new ServiceError("permission", "The original caller has no schedule ACK yet.");
    await retainAcknowledgments(ctx, owned);
    return { recorded: true as const, readRevision: readRevision(await ownedCaller(ctx, operationId, completionNonce)) };
  },
});
export const finishMerchantProviderPhase = defineService({
  name: "subscriptions.finishMerchantProviderPhase", summary: "Retain actual caller completion and verified original phase inventory without inventing a linked subscription.",
  kind: "mutation", permission: "system", external: false, input: callerInput, output: z.object({ finished: z.literal(true), verified: z.boolean() }), auditInputFields: ["operationId"],
  handler: async ({ operationId, completionNonce }, ctx) => {
    let owned = await ownedCaller(ctx, operationId, completionNonce);
    if (!owned.local.outcome) throw new ServiceError("permission", "The actual original schedule promise has not finished.");
    await retainAcknowledgments(ctx, owned); owned = await ownedCaller(ctx, operationId, completionNonce);
    const { local, operation, resource, parent } = owned, history = historySchema.parse(operation.providerObservation.history ?? []);
    if (history.some(entry => entry.source === "physical_caller_finished" && entry.operationId === operationId && entry.requestDigest === operation.requestDigest && entry.completionDigest === hash(completionNonce))) return { finished: true as const, verified: operation.state === "confirmed" };
    const actual = providerPhaseInventory.safeParse(local.result ? { version: 1, ...local.result } : undefined);
    const schedules = new Set(local.positives.map(value => value.providerScheduleRef));
    const linked = new Set(local.positives.map(value => value.providerSubscriptionRef).filter((value): value is string => !!value));
    const verified = local.readRevision === readRevision(owned) && local.outcome === "returned" && actual.success && schedules.size === 1 && schedules.has(actual.data.providerScheduleRef)
      && actual.data.operationId === operation.id && actual.data.requestDigest === operation.requestDigest
      && linked.size <= 1 && (!linked.size || linked.has(actual.data.providerSubscriptionRef ?? ""))
      && (!resource.providerSubscriptionRef || actual.data.providerSubscriptionRef === resource.providerSubscriptionRef)
      && originalPhaseCustomerMatches(actual.data, operation.originalRequest.providerCustomerRef);
    const observation = { ...operation.providerObservation, ...(verified && actual.success ? { phaseInventory: actual.data } : {}),
      history: [...history, ...(local.outcome === "returned" && actual.success ? [{ source: verified ? "phase_schedule_read_verified" : "phase_schedule_read_stale", operationId, requestDigest: operation.requestDigest,
        providerScheduleRef: actual.data.providerScheduleRef, providerSubscriptionRef: actual.data.providerSubscriptionRef, inventoryDigest: merchantTaxDigest(actual.data), inventory: actual.data }] : []), {
        source: "physical_caller_finished", operationId, requestDigest: operation.requestDigest, completionDigest: hash(completionNonce), outcome: local.outcome }] };
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
    await ctx.tx.update(subscriptionProviderScheduleOperations).set({ state: verified ? "confirmed" : "unknown", finishedAt: new Date(), providerObservation: observation }).where(eq(subscriptionProviderScheduleOperations.id, operationId));
    const linkedRef = resource.providerSubscriptionRef ?? (verified && actual.success ? actual.data.providerSubscriptionRef : null);
    await ctx.tx.update(subscriptionProviderScheduleResources).set({ providerSubscriptionRef: linkedRef, state: verified ? "active" : "unknown", recoveryPending: !verified,
      stoppedProof: null, evidenceRevision: resource.evidenceRevision + 1, updatedAt: new Date() }).where(eq(subscriptionProviderScheduleResources.subscriptionId, resource.subscriptionId));
    if (verified && linkedRef && !parent.providerRef && parent.merchantScopeVersion === 1 && parent.provider === "stripe") await ctx.tx.update(subscriptions).set({ providerRef: linkedRef }).where(eq(subscriptions.id, parent.id));
    await enqueueMerchantScheduleErasureRepair(ctx.tx, { subscriptionId: operation.subscriptionId, evidenceDigest: merchantTaxDigest({ operationId, finished: true, verified }) });
    ctx.setSubject("subscription", operation.subscriptionId);
    return { finished: true as const, verified };
  },
});
export async function flushMerchantProviderPhaseFinishes(subscriptionId: string) {
  for (const [operationId, local] of callers) if (local.subscriptionId === subscriptionId && local.outcome) {
    await finishMerchantProviderPhase.call({ operationId, completionNonce: local.nonce }, { kind: "system" }); callers.delete(operationId);
  }
}
export const admitMerchantProviderPhases = defineOrchestratedService({
  name: "subscriptions.admitMerchantProviderPhases", summary: "Create or extend one exactly quoted original provider schedule through its actual committed caller.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", input: claimInput, output: z.object({ verified: z.boolean() }),
  handler: async input => {
    await flushMerchantProviderPhaseFinishes(input.subscriptionId); await flushMerchantPhaseProductFinishes(input.subscriptionId); await flushMerchantPhaseProductReads(input.subscriptionId);
    const claimed = await claimMerchantProviderPhases.call(input, { kind: "system" }), local = callers.get(claimed.operationId);
    if (!local || local.invoked || local.nonce !== claimed.completionNonce) throw new ServiceError("permission", "The original phase caller is unavailable in this process.");
    const adapter = paymentAdapter("stripe"); local.invoked = true;
    let finished: { verified: boolean } | undefined;
    try {
      const onResourceAcknowledged = async (value: MerchantPhaseScheduleAcknowledgment) => {
        const actual = ack.parse(value); if (!local.positives.some(entry => merchantTaxDigest(entry) === merchantTaxDigest(actual))) local.positives.push(actual);
        const retained = await observeMerchantProviderPhase.call({ operationId: claimed.operationId, completionNonce: local.nonce }, { kind: "system" });
        local.readRevision = retained.readRevision; // only after the actual ACK transaction commits, before its GET
      };
      if (claimed.request.providerScheduleRef) {
        if (!adapter.updateMerchantPhaseSchedule || !claimed.request.previous) throw new ServiceError("conflict", "Restore the original phase update adapter and retained previous inventory.");
        local.result = await adapter.updateMerchantPhaseSchedule({ ...claimed.request, providerScheduleRef: claimed.request.providerScheduleRef, previous: claimed.request.previous, onResourceAcknowledged });
      } else {
        if (!adapter.createMerchantPhaseSchedule) throw new ServiceError("conflict", "Restore the original phase creation adapter.");
        local.result = await adapter.createMerchantPhaseSchedule({ ...claimed.request, onResourceAcknowledged });
      }
      local.outcome = "returned";
    } catch (error) { local.outcome = "threw"; throw error; }
    finally { finished = await finishMerchantProviderPhase.call({ operationId: claimed.operationId, completionNonce: local.nonce }, { kind: "system" }); callers.delete(claimed.operationId); }
    return { verified: finished?.verified === true };
  },
});
export default [claimMerchantProviderPhases, observeMerchantProviderPhase, finishMerchantProviderPhase, admitMerchantProviderPhases];
