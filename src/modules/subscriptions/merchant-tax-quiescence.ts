// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: original schedule debt survives module disable and merchant erasure.
import amendmentActivationServices from "./commercial-amendment-jobs";
import { originalScheduleTask, originalQuiescenceAction } from "./provider-quiescence-authority";
import { originalProviderInvoiceInventory } from "./provider-invoice-action-contract";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentity } from "@/core/contacts/identity-lock";
import { defineJob, enqueueJob, registerJob, type JobExecutionContext } from "@/core/jobs";
import { completeErasureJob, erasureArtifactIsIntact } from "@/core/privacy/service";
import { dataRequests, dataRequestArtifacts } from "@/core/privacy/schema";
import { defineService, getService, ServiceError, type ServiceContext } from "@/core/service";
import { merchantTaxProfiles } from "@/modules/invoicing/merchant-tax-schema";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { paymentAdapter } from "@/adapters/payments";
import { type ScheduleStopProof, subscriptionProviderScheduleErasures, subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "./provider-schedule-schema";
import { scheduleCallerHasStopped, scheduleKnownResources, scheduleOperationDigest } from "./provider-schedule-proof";
import { subscriptionMerchantScopes, subscriptions, subscriptionProviderChargeReceipts } from "./schema";
import scheduleCallerServices from "./provider-schedule-callers";
import scheduleErasureServices from "./provider-schedule-erasure";
import { claimMerchantScheduleCancellation, flushMerchantScheduleCallerFinishes, merchantScheduleCancellationTargets, performMerchantScheduleCancellation, retainMerchantScheduleCancellation } from "./provider-schedule-callers";
import { merchantScheduleCohortInventoryCovers } from "./provider-schedule-cohorts";
import buyerErasureServices, { completeBuyerAgreementErasure } from "./buyer-agreement-erasure";
import { originalScheduleCohortAuthority } from "./provider-schedule-cohort-authority";
import phaseProductServices from "./provider-phase-products";
import phaseDispatchServices, { assertOriginalPhaseFinancials } from "./provider-phase-dispatch";
import phaseStopServices, { stopMerchantPhaseSchedules, merchantPhaseScheduleTargets } from "./provider-phase-stop";
import { closedOriginalPhaseSchedules, originalPhaseResources } from "./provider-phase-resources";
import invoiceStopServices, { flushMerchantInvoiceStops, stopMerchantInvoice, retainOriginalScheduleCash } from "./provider-invoice-actions";
import scheduleReadServices, { recoverMerchantSchedule, flushMerchantScheduleReads } from "./provider-schedule-recovery";
import { invoices } from "@/modules/invoicing/schema";

const JOB = "subscriptions.quiesceMerchantSchedules";
const jobInput = z.object({ profileId: z.uuid(), requestId: z.uuid(), originalJobId: z.uuid(), cohortId: z.uuid() });
import { merchantAgreementScheduleState } from "./merchant-agreement-schedule-state";
export { merchantAgreementScheduleState } from "./merchant-agreement-schedule-state";

/** No provider I/O; all positive money and current original receipts are checked. */
export async function merchantTaxScheduleState(ctx: ServiceContext, profileId: string): Promise<{ safe: boolean; external: boolean }> {
  // Original order and booking payment callers can still charge even when this
  // merchant has never owned a provider subscription. Missing recovery source
  // is unknown debt, not a zero-schedules proof.
  const paymentDebtService = getService("invoicing.merchantTaxPaymentDebt");
  if (!paymentDebtService) return { safe: false, external: true };
  const paymentDebt = z.object({ pending: z.boolean(), hasHistory: z.boolean(), paymentIds: z.array(z.uuid()).max(5000), incomplete: z.boolean() })
    .parse(await ctx.callAsSystem(paymentDebtService, { profileId }));
  if (paymentDebt.pending || paymentDebt.incomplete) return { safe: false, external: true };
  const agreements = await ctx.tx.select({ subscription: subscriptions, scope: subscriptionMerchantScopes, resource: subscriptionProviderScheduleResources })
    .from(subscriptionMerchantScopes).innerJoin(subscriptions, eq(subscriptions.id, subscriptionMerchantScopes.subscriptionId))
    .leftJoin(subscriptionProviderScheduleResources, eq(subscriptionProviderScheduleResources.subscriptionId, subscriptions.id))
    .where(eq(subscriptionMerchantScopes.taxProfileId, profileId)).orderBy(subscriptions.id).limit(5001);
  if (agreements.length > 5000) return { safe: false, external: true };
  const cohorts = await ctx.tx.select().from(subscriptionProviderScheduleErasures).where(eq(subscriptionProviderScheduleErasures.profileId, profileId)).limit(5001);
  if (cohorts.length > 5000) return { safe: false, external: true };
  const currentAgreementIds = new Set(agreements.map(agreement => agreement.subscription.id));
  for (const cohort of cohorts) if (!await merchantScheduleCohortInventoryCovers(ctx.tx, cohort, currentAgreementIds)) return { safe: false, external: true };
  let external = paymentDebt.hasHistory || cohorts.length > 0;
  for (const agreement of agreements) {
    const state=await merchantAgreementScheduleState(ctx,agreement);
    external=external||state.external;
    if(!state.safe)return {safe:false,external};
  }
  return { safe: true, external };
}

export const prepareMerchantTaxErasure = defineService({
  name: "subscriptions.prepareMerchantTaxErasure", summary: "Keep actual original schedule verification jobs pending before merchant tax minimization.",
  kind: "mutation", permission: "system", external: false, auditInputFields: ["profileId", "requestId"],
  input: z.object({ profileId: z.uuid(), requestId: z.uuid() }), output: z.object({ pendingJobs: z.array(z.uuid()) }),
  handler: async ({ profileId, requestId }, ctx) => {
    await lockContactIdentity(ctx.tx);
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`privacy:${requestId}`}))`);
    const [request] = await ctx.tx.select().from(dataRequests).where(eq(dataRequests.id, requestId)).limit(1).for("update");
    const [profile] = await ctx.tx.select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id, profileId)).limit(1).for("update");
    if (!request || request.kind !== "erasure" || !request.verifiedAt || !profile
      || (profile.state !== "erased" && profile.contactId !== request.contactId)) throw new ServiceError("permission", "This merchant schedule request is not its original verified erasure.");
    const state = await merchantTaxScheduleState(ctx, profileId);
    // A durable uncreated resource with zero admitted operations is different
    // from an expired attempt, missing row, local cancellation or empty API list.
    if (!state.external && state.safe) return { pendingJobs: [] };
    const [cohort] = await ctx.tx.select().from(subscriptionProviderScheduleErasures).where(and(
      eq(subscriptionProviderScheduleErasures.profileId, profileId), eq(subscriptionProviderScheduleErasures.requestId, requestId),
      sql`${subscriptionProviderScheduleErasures.subscriptionId} is null`)).limit(1).for("update");
    if (cohort) {
      if (state.safe && (cohort.state === "verified" || cohort.state === "completed")) return { pendingJobs: [] };
      return { pendingJobs: [cohort.jobId] };
    }
    const id = randomUUID(), originalJobId = randomUUID(), jobKey = `merchant-tax-quiescence:${profileId}:${requestId}`;
    const originalAgreements = await ctx.tx.select({ id: subscriptionMerchantScopes.subscriptionId }).from(subscriptionMerchantScopes)
      .where(eq(subscriptionMerchantScopes.taxProfileId, profileId)).orderBy(subscriptionMerchantScopes.subscriptionId).limit(5001);
    if (originalAgreements.length > 5000) throw new ServiceError("conflict", "The original agreement inventory needs bounded recovery before admitting its erasure task.");
    const job = await enqueueJob(ctx.tx, JOB, { profileId, requestId, originalJobId, cohortId: id, originalAgreementIds: originalAgreements.map(row => row.id) }, { id: originalJobId, idempotencyKey: jobKey });
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
    await ctx.tx.insert(subscriptionProviderScheduleErasures).values({ id, profileId, requestId, privacyScope: "commerce.merchantTax", originalJobId: job.id, jobId: job.id, jobKey, jobIds: [job.id] });
    ctx.setSubject("dataRequest", requestId);
    return { pendingJobs: [job.id] };
  },
});

const stoppedInventory = z.object({ subscriptionId: z.uuid(), resources: z.array(originalProviderInvoiceInventory).max(5000) });
export const retainMerchantScheduleInventory = defineService({
  name: "subscriptions.retainMerchantScheduleInventory", summary: "Retain authenticated original stopped-resource inventory without inventing resolution of earlier invoices.",
  kind: "mutation", permission: "system", external: false, auditInputFields: ["subscriptionId"],
  input: z.intersection(originalScheduleTask, stoppedInventory), output: z.object({ quiesced: z.boolean() }),
  handler: async (input, ctx) => {
    const authority = await originalQuiescenceAction(ctx, input, input.subscriptionId, true);
    if (!authority) return { quiesced: false };
    const { parent, scope, resource, operations } = authority;
    if (operations.length > 5000) throw new ServiceError("conflict", "Restore the bounded original agreement history before retaining its stopped inventory.");
    const known = scheduleKnownResources(resource, operations);
    if (!known || known.size !== input.resources.length || new Set(input.resources.map(value => value.providerSubscriptionRef)).size !== known.size
      || input.resources.some(value => !known.has(value.providerSubscriptionRef))) return { quiesced: false };
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
    let updatedOperations = operations;
    for (const actual of input.resources) {
      const original = [...updatedOperations].reverse().find(operation => operation.kind === "cancel" && operation.originalRequest.method === "DELETE" && operation.originalRequest.providerSubscriptionRef === actual.providerSubscriptionRef);
      if (!original) return { quiesced: false };
      const history = z.array(z.record(z.string(), z.unknown())).max(5000).parse(original.providerObservation.history ?? []), inventoryDigest = merchantTaxDigest(actual);
      if (!history.some(entry => entry.source === "authenticated_invoice_inventory" && entry.inventoryDigest === inventoryDigest)) {
        const observation = { ...original.providerObservation, history: [...history, { source: "authenticated_invoice_inventory", inventoryDigest, ...actual }] };
        await ctx.tx.update(subscriptionProviderScheduleOperations).set({ providerObservation: observation }).where(eq(subscriptionProviderScheduleOperations.id, original.id));
        updatedOperations = updatedOperations.map(operation => operation.id === original.id ? { ...operation, providerObservation: observation } : operation);
      }
    }
    if (authority.held || operations.length !== resource.operationRevision || updatedOperations.some((operation, index) => operation.operationRevision !== index + 1
      || !["confirmed", "refused"].includes(operation.state) || !scheduleCallerHasStopped(operation))) return { quiesced: false };
    const phaseResources = originalPhaseResources(updatedOperations), phaseSchedules = closedOriginalPhaseSchedules(updatedOperations);
    if (!phaseResources || !known.size && !phaseResources.size || phaseResources.size && (!phaseSchedules || phaseSchedules.length !== phaseResources.size)) return { quiesced: false };
    const actualReceipts = await ctx.tx.select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId, parent.id)).orderBy(subscriptionProviderChargeReceipts.id).limit(5001);
    if (actualReceipts.length > 5000) return { quiesced: false };
    const dispositionService = getService("invoicing.subscriptionChargeDisposition");
    const disposition = z.discriminatedUnion("kind", [z.object({ kind: z.literal("applied"), invoiceId: z.uuid(), paymentId: z.uuid() }),
      z.object({ kind: z.literal("returned_unapplied"), returnReceiptId: z.uuid() })]).nullable();
    const covered = new Set<string>();
    const resources: ScheduleStopProof["resources"] = [];
    for (const actual of input.resources) {
      const frozenInvoices: ScheduleStopProof["resources"][number]["invoices"] = [];
      for (const invoice of actual.invoices) {
        if (!invoice.complete || !["paid", "void"].includes(invoice.state) || invoice.currency !== parent.currency || invoice.remainingMinor !== 0
          || invoice.state === "paid" && invoice.paidMinor !== invoice.totalMinor) return { quiesced: false };
        const paid: ScheduleStopProof["resources"][number]["invoices"][number]["paid"] = [];
        const returnedUnapplied: Array<{ providerPaymentIntentRef: string; receiptId: string; returnReceiptId: string }> = [];
        const cancelledIntentRefs: string[] = [], seen = new Set<string>();
        for (const intent of invoice.paymentIntents) {
          if (seen.has(intent.providerPaymentIntentRef) || intent.currency !== parent.currency) return { quiesced: false }; seen.add(intent.providerPaymentIntentRef);
          if (intent.state === "canceled" && intent.receivedMinor === 0) { cancelledIntentRefs.push(intent.providerPaymentIntentRef); continue; }
          if (intent.state !== "succeeded" || intent.receivedMinor <= 0 || intent.amountMinor !== intent.receivedMinor || !dispositionService) return { quiesced: false };
          const receipt = actualReceipts.find(row => row.providerPaymentIntentRef === intent.providerPaymentIntentRef && row.providerSubscriptionRef === actual.providerSubscriptionRef
            && row.providerInvoiceRef === invoice.providerInvoiceRef && row.providerPlatformAccountId === scope.providerPlatformAccountId && row.chargeAccountId === scope.chargeAccountId
            && row.amountMinor === intent.receivedMinor && row.currency === intent.currency);
          if (!receipt || covered.has(receipt.id)) return { quiesced: false };
          const resolved = disposition.parse(await ctx.callAsSystem(dispositionService, { receiptId: receipt.id })); if (!resolved) return { quiesced: false };
          covered.add(receipt.id);
          if (resolved.kind === "applied") paid.push({ providerPaymentIntentRef: intent.providerPaymentIntentRef, receiptId: receipt.id, paymentId: resolved.paymentId, invoiceId: resolved.invoiceId });
          else returnedUnapplied.push({ providerPaymentIntentRef: intent.providerPaymentIntentRef, receiptId: receipt.id, returnReceiptId: resolved.returnReceiptId });
        }
        let zeroTotalInvoiceId: string | undefined;
        if (invoice.state === "paid" && invoice.totalMinor === 0 && invoice.paidMinor === 0 && invoice.paymentIntents.every(intent => intent.state === "canceled" && intent.receivedMinor === 0)) {
          if (phaseResources.size && !updatedOperations.some(operation => {
            const phases = z.array(z.object({ start: z.iso.datetime(), totalMinor: z.number().int().nonnegative() }).passthrough()).safeParse(operation.originalRequest.phases);
            return operation.originalRequest.resourceKind === "phase_schedule" && phases.success && phases.data.some(phase => phase.start === invoice.periodStart && phase.totalMinor === 0);
          })) return { quiesced: false };
          const [zero] = await ctx.tx.select().from(invoices).where(and(eq(invoices.sourceType, "subscription"), eq(invoices.sourceId, `${parent.id}:${invoice.periodStart}`))).limit(1);
          if (!zero || zero.currency !== parent.currency || zero.totalMinor !== 0 || zero.paidMinor !== 0 || zero.status !== "paid") return { quiesced: false };
          zeroTotalInvoiceId = zero.id;
        }
        if (invoice.state === "paid" && !paid.length && !returnedUnapplied.length && !zeroTotalInvoiceId) return { quiesced: false };
        frozenInvoices.push({ providerInvoiceRef: invoice.providerInvoiceRef, state: invoice.state as "paid" | "void", cancelledIntentRefs, paid,
          ...(returnedUnapplied.length ? { returnedUnapplied } : {}), ...(zeroTotalInvoiceId ? { zeroTotalInvoiceId } : {}) });
      }
      resources.push({ providerSubscriptionRef: actual.providerSubscriptionRef, providerState: actual.state, invoiceEnumerationDigest: merchantTaxDigest(actual.invoices), invoices: frozenInvoices });
    }
    if (covered.size !== actualReceipts.length) return { quiesced: false };
    try { await assertOriginalPhaseFinancials(ctx, parent.id); }
    catch (error) { if (error instanceof ServiceError && error.code === "conflict") return { quiesced: false }; throw error; }
    const proof = { operationRevision: resource.operationRevision, evidenceRevision: resource.evidenceRevision,
      journalDigest: scheduleOperationDigest(updatedOperations), resources, ...(phaseSchedules?.length ? { phaseSchedules } : {}) };
    await ctx.tx.update(subscriptionProviderScheduleResources).set({ state: "quiesced", stoppedProof: proof, recoveryPending: false, updatedAt: new Date() })
      .where(eq(subscriptionProviderScheduleResources.subscriptionId, resource.subscriptionId));
    ctx.setSubject("subscription", parent.id);
    return { quiesced: true };
  },
});

export const settleMerchantTaxSchedules = defineService({
  name: "subscriptions.settleMerchantTaxSchedules", summary: "Verify exact original cohort and financial quiescence before atomic merchant tax erasure.",
  kind: "mutation", permission: "system", external: false, auditInputFields: ["profileId", "requestId", "originalJobId"],
  input: jobInput, output: z.object({ settled: z.boolean(), recoveryRequired: z.boolean() }),
  handler: async (input, ctx) => {
    await lockContactIdentity(ctx.tx);
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`privacy:${input.requestId}`}))`);
    const [cohort] = await ctx.tx.select().from(subscriptionProviderScheduleErasures).where(eq(subscriptionProviderScheduleErasures.id, input.cohortId)).limit(1).for("update");
    if (!cohort || cohort.profileId !== input.profileId || cohort.requestId !== input.requestId
      || !cohort.jobIds.includes(input.originalJobId)) throw new ServiceError("conflict", "This actual task is not a member of the original merchant erasure cohort.");
    if (cohort.privacyScope === "subscriptions.agreements") return ctx.callAsSystem(completeBuyerAgreementErasure, input);
    if (cohort.privacyScope !== "commerce.merchantTax" || cohort.subscriptionId !== null) throw new ServiceError("permission", "Restore the original schedule privacy scope before completing its task.");
    const state = await merchantTaxScheduleState(ctx, input.profileId);
    if (!state.safe) return { settled: false, recoveryRequired: false };
    const complete = getService("invoicing.completeMerchantTaxErasure");
    if (!complete) throw new ServiceError("conflict", "Restore the original atomic merchant tax erasure service before completing this task.");
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
    await ctx.tx.update(subscriptionProviderScheduleErasures).set({ state: "verified" }).where(eq(subscriptionProviderScheduleErasures.id, cohort.id));
    const result = z.object({ settled: z.boolean(), recoveryRequired: z.boolean() }).passthrough().parse(await ctx.callAsSystem(complete, { profileId: input.profileId, requestId: input.requestId, jobId: input.originalJobId }));
    if (!result.settled) {
      await ctx.tx.update(subscriptionProviderScheduleErasures).set({ state: "pending" }).where(eq(subscriptionProviderScheduleErasures.id, cohort.id));
      return result;
    }
    for (const jobId of new Set(cohort.jobIds)) if (jobId !== input.originalJobId) await ctx.callAsSystem(completeErasureJob, { requestId: input.requestId, scope: "commerce.merchantTax", jobId });
    await ctx.tx.update(subscriptionProviderScheduleErasures).set({ state: "completed", completedAt: cohort.completedAt ?? new Date() }).where(eq(subscriptionProviderScheduleErasures.id, cohort.id));
    ctx.setSubject("dataRequest", input.requestId);
    return { settled: true, recoveryRequired: false };
  },
});

export async function quiesceOriginalScheduleTask(value: z.input<typeof originalScheduleTask>, context?: JobExecutionContext): Promise<void> {
  const input = originalScheduleTask.parse(value);
    await stopMerchantPhaseSchedules(input, context);
    const phaseTargets = await merchantPhaseScheduleTargets.call(input, { kind: "system" });
    const targets = await merchantScheduleCancellationTargets.call(input, { kind: "system" });
    const adapter = paymentAdapter("stripe");
    for (const target of targets) {
      await flushMerchantScheduleCallerFinishes(target.subscriptionId);
      await flushMerchantInvoiceStops(target.subscriptionId); await flushMerchantScheduleReads(target.subscriptionId);
      const recovery = (await merchantScheduleCancellationTargets.call(input, { kind: "system" })).find(value => value.subscriptionId === target.subscriptionId);
      for (const operationId of recovery?.recoveryOperationIds ?? []) { await context?.throwIfCancelled(); await recoverMerchantSchedule.call({ operationId }, { kind: "system" }); }
      if (target.providerSubscriptionRefs.length && !adapter.cancelMerchantSchedule) throw new ServiceError("conflict", "Restore the original provider cancellation adapter before admitting this task.");
      for (const providerSubscriptionRef of target.providerSubscriptionRefs) {
        await context?.throwIfCancelled();
        const claim = await claimMerchantScheduleCancellation.call({ ...input, subscriptionId: target.subscriptionId, providerSubscriptionRef }, { kind: "system" });
        if (claim.mode === "dispatch") {
          await performMerchantScheduleCancellation(claim, target.subscriptionId, () => adapter.cancelMerchantSchedule!({ ...claim.request,
            onCancelled: actual => retainMerchantScheduleCancellation(claim, actual).then(() => undefined) }));
        }
      }
      if (!target.providerSubscriptionRefs.length) {
        await retainMerchantScheduleInventory.call({ ...input, subscriptionId: target.subscriptionId, resources: [] }, { kind: "system" });
        continue;
      }
      const current = (await merchantScheduleCancellationTargets.call(input, { kind: "system" })).find(value => value.subscriptionId === target.subscriptionId);
      if (!current?.request.providerCustomerRef || !adapter.inspectMerchantScheduleInvoices) continue;
      const inspect = async () => {
        const resources = [];
        for (const providerSubscriptionRef of current.providerSubscriptionRefs) {
          await context?.throwIfCancelled();
          const actual = await adapter.inspectMerchantScheduleInvoices!({ ...current.request, providerCustomerRef: current.request.providerCustomerRef!, providerSubscriptionRef,
            providerScheduleRefs: phaseTargets.find(target => target.subscriptionId === current.subscriptionId)?.providerScheduleRefs,
            providerScheduleOperationId: phaseTargets.find(target => target.subscriptionId === current.subscriptionId)?.resources.find(resource => resource.providerSubscriptionRefs.includes(providerSubscriptionRef))?.providerScheduleOperationId ?? undefined,
            onPaidIntentObserved: retainOriginalScheduleCash });
          resources.push({ providerSubscriptionRef, state: actual.state, invoices: actual.invoices });
        }
        return resources;
      };
      let resources = await inspect();
      // Commit complete actual inventory before any original action claim. A
      // bounded pass leaves remaining work pending for the durable queue.
      for (let round = 0; round < 32; round++) {
        await retainMerchantScheduleInventory.call({ ...input, subscriptionId: target.subscriptionId, resources }, { kind: "system" });
        let changed = false;
        for (const resource of resources) for (const invoice of resource.invoices) {
          await context?.throwIfCancelled();
          if (await stopMerchantInvoice({ ...input, subscriptionId: target.subscriptionId, providerSubscriptionRef: resource.providerSubscriptionRef, providerInvoiceRef: invoice.providerInvoiceRef })) changed = true;
        }
        if (!changed) break;
        resources = await inspect();
      }
      await retainMerchantScheduleInventory.call({ ...input, subscriptionId: target.subscriptionId, resources }, { kind: "system" });
    }
}

export const quiesceMerchantSchedules = defineJob({
  name: JOB, summary: "Verify original provider and financial quiescence before completing merchant tax erasure.", concurrency: 1, leaseSeconds: 120,
  handler: async (data, context) => {
    const input = jobInput.parse(data);
    if (context && context.id !== input.originalJobId) throw new ServiceError("conflict", "The running job does not match its durable original task payload.");
    await context?.throwIfCancelled();
    await quiesceOriginalScheduleTask(input, context);
    const result = await settleMerchantTaxSchedules.call(input, { kind: "system" });
    // Recovery must commit before the queue records an unsuccessful attempt.
    if (!result.settled) throw new ServiceError("conflict", result.recoveryRequired ? "Restore the original merchant erasure artifact before retrying." : "Original provider schedules or financial recovery work remain unresolved.");
    return result;
  },
});
registerJob(quiesceMerchantSchedules);
export default [prepareMerchantTaxErasure, settleMerchantTaxSchedules, retainMerchantScheduleInventory, ...scheduleCallerServices, ...scheduleErasureServices, ...buyerErasureServices, ...phaseProductServices, ...phaseDispatchServices, ...phaseStopServices, ...scheduleReadServices, ...invoiceStopServices, ...amendmentActivationServices];
