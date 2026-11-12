// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: original schedule debt survives module disable and merchant erasure.
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentity } from "@/core/contacts/identity-lock";
import { defineJob, enqueueJob, registerJob } from "@/core/jobs";
import { completeErasureJob } from "@/core/privacy/service";
import { dataRequests } from "@/core/privacy/schema";
import { defineService, getService, ServiceError, type ServiceContext } from "@/core/service";
import { invoiceMerchantTaxQuoteLines, invoiceMerchantTaxQuotes, merchantTaxProfiles } from "@/modules/invoicing/merchant-tax-schema";
import { invoiceLines, invoices } from "@/modules/invoicing/schema";
import { merchantAgreementPaymentRoutes } from "@/modules/invoicing/merchant-agreement-schema";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { paymentAdapter } from "@/adapters/payments";
import { subscriptionProviderScheduleErasures, subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "./provider-schedule-schema";
import { scheduleCallerHasStopped, scheduleKnownResources, scheduleOperationDigest, scheduleQuiescenceCovers } from "./provider-schedule-proof";
import { subscriptionMerchantScopes, subscriptionProviderChargeObservations, subscriptionProviderChargeReceipts, subscriptions } from "./schema";
import scheduleCallerServices from "./provider-schedule-callers";
import scheduleErasureServices from "./provider-schedule-erasure";
import { claimMerchantScheduleCancellation, flushMerchantScheduleCallerFinishes, merchantScheduleCancellationTargets, observeMerchantScheduleCancellation, performMerchantScheduleCancellation, retainMerchantScheduleCancellation } from "./provider-schedule-callers";
import { merchantScheduleCohortInventoryCovers } from "./provider-schedule-cohorts";

const JOB = "subscriptions.quiesceMerchantSchedules";
const jobInput = z.object({ profileId: z.uuid(), requestId: z.uuid(), originalJobId: z.uuid(), cohortId: z.uuid() });
const application = z.object({ invoiceId: z.uuid(), paymentId: z.uuid() }).nullable();

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
    const routes = await ctx.tx.select().from(merchantAgreementPaymentRoutes).where(eq(merchantAgreementPaymentRoutes.subscriptionId, agreement.subscription.id)).limit(5001);
    if (routes.length > 5000) return { safe: false, external: true };
    if (routes.length) external = true;
    for (const route of routes) {
      if (route.providerPlatformAccountId !== agreement.scope.providerPlatformAccountId || route.chargeAccountId !== agreement.scope.chargeAccountId
        || route.recipientAccountId !== agreement.scope.recipientAccountId || route.settlementMerchantAccountId !== agreement.scope.settlementMerchantAccountId) return { safe: false, external: true };
      const debt = getService("invoicing.merchantPaymentRecoveryDebt");
      if (!debt || z.object({ pending: z.boolean() }).passthrough().parse(await ctx.callAsSystem(debt, { paymentId: route.paymentId })).pending) return { safe: false, external: true };
    }
    const operations = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.subscriptionId, agreement.subscription.id)).orderBy(subscriptionProviderScheduleOperations.operationRevision).limit(5001);
    const receipts = await ctx.tx.select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId, agreement.subscription.id)).orderBy(subscriptionProviderChargeReceipts.id).limit(5001);
    const observations = await ctx.tx.select().from(subscriptionProviderChargeObservations).where(eq(subscriptionProviderChargeObservations.subscriptionId, agreement.subscription.id)).orderBy(subscriptionProviderChargeObservations.id).limit(5001);
    if (!agreement.resource || operations.length > 5000 || receipts.length > 5000 || observations.length > 5000) return { safe: false, external: true };
    const neverAdmitted = agreement.resource.state === "uncreated" && agreement.resource.operationRevision === 0
      && !agreement.resource.providerSubscriptionRef && !agreement.resource.providerCustomerRef && !agreement.subscription.providerRef
      && !operations.length && !receipts.length && !observations.length;
    if (neverAdmitted) continue;
    external = true;
    if (!scheduleQuiescenceCovers(agreement.resource, operations)) return { safe: false, external };
    for (const resource of agreement.resource.stoppedProof!.resources) for (const invoice of resource.invoices) {
      if (!invoice.zeroTotalInvoiceId) continue;
      const [zero] = await ctx.tx.select().from(invoices).where(eq(invoices.id, invoice.zeroTotalInvoiceId)).limit(1);
      if (!zero || zero.sourceType !== "subscription" || zero.sourceId?.split(":")[0] !== agreement.subscription.id
        || zero.currency !== agreement.subscription.currency || zero.totalMinor !== 0 || zero.paidMinor !== 0 || zero.status !== "paid") return { safe: false, external };
      const [quote] = await ctx.tx.select().from(invoiceMerchantTaxQuotes).where(and(eq(invoiceMerchantTaxQuotes.invoiceId, zero.id),
        eq(invoiceMerchantTaxQuotes.profileId, agreement.scope.taxProfileId), eq(invoiceMerchantTaxQuotes.profileVersion, agreement.scope.taxProfileVersion))).limit(1);
      const lines = await ctx.tx.select({ quoteId: invoiceMerchantTaxQuoteLines.quoteId }).from(invoiceLines)
        .leftJoin(invoiceMerchantTaxQuoteLines, eq(invoiceMerchantTaxQuoteLines.invoiceLineId, invoiceLines.id)).where(eq(invoiceLines.invoiceId, zero.id));
      if (!quote || !quote.evidenceDigest || !lines.length || lines.some(line => line.quoteId !== quote.id)) return { safe: false, external };
    }
    const coverage = agreement.resource.stoppedProof!.resources.flatMap(resource => resource.invoices.flatMap(invoice => invoice.paid.map(paid => ({ ...paid, providerSubscriptionRef: resource.providerSubscriptionRef, providerInvoiceRef: invoice.providerInvoiceRef }))));
    if (coverage.length !== receipts.length) return { safe: false, external };
    for (const observation of observations) {
      const receipt = receipts.find(row => row.providerPaymentIntentRef === observation.providerPaymentIntentRef);
      if (!receipt || receipt.providerPlatformAccountId !== observation.providerPlatformAccountId || receipt.chargeAccountId !== observation.chargeAccountId
        || receipt.providerSubscriptionRef !== observation.providerSubscriptionRef || receipt.providerInvoiceRef !== observation.providerInvoiceRef
        || (observation.providerChargeRef !== null && receipt.providerChargeRef !== observation.providerChargeRef) || receipt.amountMinor !== observation.amountMinor || receipt.currency !== observation.currency) return { safe: false, external };
    }
    for (const receipt of receipts) {
      if (!observations.some(observation => observation.providerPaymentIntentRef === receipt.providerPaymentIntentRef && observation.customerChargeVerified)) return { safe: false, external };
      const covered = coverage.find(row => row.receiptId === receipt.id);
      if (!covered || covered.providerSubscriptionRef !== receipt.providerSubscriptionRef || covered.providerInvoiceRef !== receipt.providerInvoiceRef || covered.providerPaymentIntentRef !== receipt.providerPaymentIntentRef) return { safe: false, external };
      const prove = getService("invoicing.subscriptionChargeApplication"), debt = getService("invoicing.merchantPaymentRecoveryDebt");
      if (!prove || !debt) return { safe: false, external };
      const applied = application.parse(await ctx.callAsSystem(prove, { receiptId: receipt.id }));
      if (!applied || applied.invoiceId !== covered.invoiceId || applied.paymentId !== covered.paymentId) return { safe: false, external };
      const financial = z.object({ pending: z.boolean() }).passthrough().parse(await ctx.callAsSystem(debt, { paymentId: applied.paymentId }));
      if (financial.pending) return { safe: false, external };
    }
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

const stoppedInventory = z.object({ subscriptionId: z.uuid(), resources: z.array(z.object({ providerSubscriptionRef: z.string(),
  state: z.enum(["paused", "cancelled"]), invoices: z.array(z.object({ providerInvoiceRef: z.string(), state: z.enum(["paid", "void", "draft", "open", "uncollectible"]) })).max(2000) })).max(5000) });
export const retainMerchantScheduleInventory = defineService({
  name: "subscriptions.retainMerchantScheduleInventory", summary: "Retain authenticated original stopped-resource inventory without inventing resolution of earlier invoices.",
  kind: "mutation", permission: "system", external: false, auditInputFields: ["cohortId", "subscriptionId"],
  input: jobInput.merge(stoppedInventory), output: z.object({ quiesced: z.boolean() }),
  handler: async (input, ctx) => {
    await lockContactIdentity(ctx.tx);
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`privacy:${input.requestId}`}))`);
    const [cohort] = await ctx.tx.select().from(subscriptionProviderScheduleErasures).where(eq(subscriptionProviderScheduleErasures.id, input.cohortId)).limit(1).for("update");
    if (!cohort || cohort.profileId !== input.profileId || cohort.requestId !== input.requestId || cohort.jobId !== input.originalJobId
      || !cohort.jobIds.includes(input.originalJobId)) throw new ServiceError("permission", "This original inventory does not belong to the current merchant erasure task.");
    const [parent] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, input.subscriptionId)).limit(1).for("update");
    const [scope] = await ctx.tx.select().from(subscriptionMerchantScopes).where(eq(subscriptionMerchantScopes.subscriptionId, input.subscriptionId)).limit(1);
    const [resource] = await ctx.tx.select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, input.subscriptionId)).limit(1).for("update");
    const operations = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.subscriptionId, input.subscriptionId))
      .orderBy(subscriptionProviderScheduleOperations.operationRevision).limit(5001);
    if (!parent || !scope || scope.taxProfileId !== input.profileId || !resource || operations.length > 5000) throw new ServiceError("conflict", "Restore the original agreement before retaining its stopped inventory.");
    const known = scheduleKnownResources(resource, operations);
    if (!known || known.size !== input.resources.length || new Set(input.resources.map(value => value.providerSubscriptionRef)).size !== known.size
      || input.resources.some(value => !known.has(value.providerSubscriptionRef))) return { quiesced: false };
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
    let updatedOperations = operations;
    for (const actual of input.resources) {
      const original = [...updatedOperations].reverse().find(operation => operation.kind === "cancel" && operation.originalRequest.providerSubscriptionRef === actual.providerSubscriptionRef);
      if (!original) return { quiesced: false };
      const history = z.array(z.record(z.string(), z.unknown())).max(5000).parse(original.providerObservation.history ?? []), inventoryDigest = merchantTaxDigest(actual);
      if (!history.some(entry => entry.source === "authenticated_invoice_inventory" && entry.inventoryDigest === inventoryDigest)) {
        const observation = { ...original.providerObservation, history: [...history, { source: "authenticated_invoice_inventory", inventoryDigest, ...actual }] };
        await ctx.tx.update(subscriptionProviderScheduleOperations).set({ providerObservation: observation }).where(eq(subscriptionProviderScheduleOperations.id, original.id));
        updatedOperations = updatedOperations.map(operation => operation.id === original.id ? { ...operation, providerObservation: observation } : operation);
      }
    }
    // Earlier invoices require their own actual PI/cash/application/financial
    // evidence. This first boundary can settle only a genuinely empty inventory.
    if (input.resources.some(value => value.invoices.length) || operations.length !== resource.operationRevision
      || updatedOperations.some((operation, index) => operation.operationRevision !== index + 1 || !["confirmed", "refused"].includes(operation.state) || !scheduleCallerHasStopped(operation))) return { quiesced: false };
    const proof = { operationRevision: resource.operationRevision, evidenceRevision: resource.evidenceRevision,
      journalDigest: scheduleOperationDigest(updatedOperations), resources: input.resources.map(actual => ({ providerSubscriptionRef: actual.providerSubscriptionRef,
        providerState: actual.state, invoiceEnumerationDigest: merchantTaxDigest(actual.invoices), invoices: [] })) };
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
    if (!cohort || cohort.profileId !== input.profileId || cohort.requestId !== input.requestId || cohort.privacyScope !== "commerce.merchantTax"
      || !cohort.jobIds.includes(input.originalJobId)) throw new ServiceError("conflict", "This actual task is not a member of the original merchant erasure cohort.");
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

export const quiesceMerchantSchedules = defineJob({
  name: JOB, summary: "Verify original provider and financial quiescence before completing merchant tax erasure.", concurrency: 1, leaseSeconds: 120,
  handler: async (data, context) => {
    const input = jobInput.parse(data);
    if (context && context.id !== input.originalJobId) throw new ServiceError("conflict", "The running job does not match its durable original task payload.");
    await context?.throwIfCancelled();
    const targets = await merchantScheduleCancellationTargets.call(input, { kind: "system" });
    const adapter = paymentAdapter("stripe");
    for (const target of targets) {
      await flushMerchantScheduleCallerFinishes(target.subscriptionId);
      if (target.providerSubscriptionRefs.length && !adapter.cancelMerchantSchedule) throw new ServiceError("conflict", "Restore the original provider cancellation adapter before admitting this task.");
      for (const providerSubscriptionRef of target.providerSubscriptionRefs) {
        await context?.throwIfCancelled();
        const claim = await claimMerchantScheduleCancellation.call({ ...input, subscriptionId: target.subscriptionId, providerSubscriptionRef }, { kind: "system" });
        if (claim.mode === "dispatch") {
          await performMerchantScheduleCancellation(claim, target.subscriptionId, () => adapter.cancelMerchantSchedule!({ ...claim.request,
            onCancelled: actual => retainMerchantScheduleCancellation(claim, actual).then(() => undefined) }));
        }
      }
      if (!target.providerSubscriptionRefs.length) continue;
      const current = (await merchantScheduleCancellationTargets.call(input, { kind: "system" })).find(value => value.subscriptionId === target.subscriptionId);
      if (!current?.request.providerCustomerRef || !adapter.inspectMerchantScheduleInvoices) continue;
      const resources = [];
      for (const providerSubscriptionRef of current.providerSubscriptionRefs) {
        await context?.throwIfCancelled();
        const actual = await adapter.inspectMerchantScheduleInvoices({ ...current.request, providerCustomerRef: current.request.providerCustomerRef, providerSubscriptionRef });
        const cancellation = [...current.cancellationOperations].reverse().find(value => value.providerSubscriptionRef === providerSubscriptionRef);
        if (cancellation && actual.state === "cancelled") await observeMerchantScheduleCancellation.call({ operationId: cancellation.operationId, providerSubscriptionRef, source: "readback" }, { kind: "system" });
        resources.push({ providerSubscriptionRef, state: actual.state, invoices: actual.invoices });
      }
      await retainMerchantScheduleInventory.call({ ...input, subscriptionId: target.subscriptionId, resources }, { kind: "system" });
    }
    const result = await settleMerchantTaxSchedules.call(input, { kind: "system" });
    // Recovery must commit before the queue records an unsuccessful attempt.
    if (!result.settled) throw new ServiceError("conflict", result.recoveryRequired ? "Restore the original merchant erasure artifact before retrying." : "Original provider schedules or financial recovery work remain unresolved.");
    return result;
  },
});
registerJob(quiesceMerchantSchedules);
export default [prepareMerchantTaxErasure, settleMerchantTaxSchedules, retainMerchantScheduleInventory, ...scheduleCallerServices, ...scheduleErasureServices];
