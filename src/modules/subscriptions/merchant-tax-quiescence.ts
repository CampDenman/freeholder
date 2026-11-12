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
import { subscriptionProviderScheduleErasures, subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "./provider-schedule-schema";
import { scheduleQuiescenceCovers } from "./provider-schedule-proof";
import { subscriptionMerchantScopes, subscriptionProviderChargeObservations, subscriptionProviderChargeReceipts, subscriptions } from "./schema";

const JOB = "subscriptions.quiesceMerchantSchedules";
const jobInput = z.object({ profileId: z.uuid(), requestId: z.uuid(), originalJobId: z.uuid(), cohortId: z.uuid() });
const application = z.object({ invoiceId: z.uuid(), paymentId: z.uuid() }).nullable();

/** No provider I/O; all positive money and current original receipts are checked. */
export async function merchantTaxScheduleState(ctx: ServiceContext, profileId: string): Promise<{ safe: boolean; external: boolean }> {
  const agreements = await ctx.tx.select({ subscription: subscriptions, scope: subscriptionMerchantScopes, resource: subscriptionProviderScheduleResources })
    .from(subscriptionMerchantScopes).innerJoin(subscriptions, eq(subscriptions.id, subscriptionMerchantScopes.subscriptionId))
    .leftJoin(subscriptionProviderScheduleResources, eq(subscriptionProviderScheduleResources.subscriptionId, subscriptions.id))
    .where(eq(subscriptionMerchantScopes.taxProfileId, profileId)).orderBy(subscriptions.id).limit(5001);
  if (agreements.length > 5000) return { safe: false, external: true };
  let external = false;
  for (const agreement of agreements) {
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
        || receipt.providerChargeRef !== observation.providerChargeRef || receipt.amountMinor !== observation.amountMinor || receipt.currency !== observation.currency) return { safe: false, external };
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
  if (!external) {
    const [originalCohort] = await ctx.tx.select({ id: subscriptionProviderScheduleErasures.id }).from(subscriptionProviderScheduleErasures)
      .where(eq(subscriptionProviderScheduleErasures.profileId, profileId)).limit(1);
    // A retained cohort proves there was original external history. A partial
    // restore cannot turn its missing children into a no-schedules proof.
    if (originalCohort) return { safe: false, external: true };
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
    const job = await enqueueJob(ctx.tx, JOB, { profileId, requestId, originalJobId, cohortId: id }, { id: originalJobId, idempotencyKey: jobKey });
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
    await ctx.tx.insert(subscriptionProviderScheduleErasures).values({ id, profileId, requestId, privacyScope: "commerce.merchantTax", originalJobId: job.id, jobId: job.id, jobKey, jobIds: [job.id] });
    ctx.setSubject("dataRequest", requestId);
    return { pendingJobs: [job.id] };
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
    const result = await settleMerchantTaxSchedules.call(input, { kind: "system" });
    // Recovery must commit before the queue records an unsuccessful attempt.
    if (!result.settled) throw new ServiceError("conflict", result.recoveryRequired ? "Restore the original merchant erasure artifact before retrying." : "Original provider schedules or financial recovery work remain unresolved.");
    return result;
  },
});
registerJob(quiesceMerchantSchedules);
export default [prepareMerchantTaxErasure, settleMerchantTaxSchedules];
