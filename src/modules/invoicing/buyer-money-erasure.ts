// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: schedule stop proof precedes customer and tax-evidence erasure.
import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentity } from "@/core/contacts/identity-lock";
import { defineJob, enqueueJob, registerJob } from "@/core/jobs";
import { jobIdempotencyKeys } from "@/core/jobs/schema";
import { dataRequestArtifacts, dataRequests, privacyRetentionExceptions } from "@/core/privacy/schema";
import { completeErasureJob, erasureArtifactIsIntact, reopenErasureJob } from "@/core/privacy/service";
import { defineService, getService, ServiceError, type ServiceContext, type Tx } from "@/core/service";
import { allowMerchantTaxWrites, merchantTaxDigest } from "./merchant-tax-store";
import { erasePaymentProviderCustomer, originalProviderCustomersForErasure, originalProviderCustomerKey, queueOriginalPaymentProviderCustomers, providerCustomerErasurePayload } from "./provider-erasure";
import { buyerMoneyErasurePayload as payload, originalBuyerMoneyInventory } from "./buyer-money-erasure-proof";
import { routingForPayment } from "./merchant-charge";
import { invoices, paymentMethods, paymentProviderCustomers, payments, refunds, taxExemptions } from "./schema";

const SCOPE = "commerce.money";
export const BUYER_MONEY_ERASURE_JOB = "invoicing.finishBuyerMoneyErasure";
const prepareOutput = z.object({ pendingJobs: z.array(z.uuid()).max(5000), originalAgreementIds: z.array(z.uuid()).max(5000) });
const receiptBody = z.object({ format: z.literal("freeholder.erasure-receipt"), outcomes: z.array(z.object({ scope: z.string(), outcome: z.string(), pendingJobs: z.array(z.uuid()).optional() }).passthrough()) }).passthrough();
const readiness = z.object({ safe: z.boolean(), providerCustomers: z.array(z.object({ provider: z.string(), providerAccountId: z.string(), providerPlatformAccountId: z.string().nullable(), providerCustomerRef: z.string() })).max(5000) });
const result = z.object({ settled: z.boolean(), recoveryRequired: z.boolean() });

/** Real new-mode routes are identified by their immutable common routing;
 * legacy agreements/payments never inherit a platform account from today. */
async function originalBuyerMerchantPayments(ctx: ServiceContext, contactId: string): Promise<string[]> {
  const rows = await ctx.tx.select({ id: payments.id }).from(payments).innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .where(eq(invoices.contactId, contactId)).orderBy(payments.id).limit(5001);
  if (rows.length > 5000) throw new ServiceError("conflict", "The original buyer payment inventory needs bounded privacy recovery.");
  const ids: string[] = [];
  for (const payment of rows) if ((await routingForPayment(ctx, payment.id)).providerPlatformAccountId) ids.push(payment.id);
  return ids;
}
async function originalBuyerPaymentsAreSafe(ctx: ServiceContext, contactId: string, originalIds: string[]): Promise<boolean> {
  const current = await originalBuyerMerchantPayments(ctx, contactId), ids = new Set(current);
  if (originalIds.some(id => !ids.has(id))) return false;
  const debt = getService("invoicing.merchantPaymentRecoveryDebt");
  if (current.length && !debt) return false;
  for (const paymentId of current) if (z.object({ pending: z.boolean() }).passthrough().parse(await ctx.callAsSystem(debt!, { paymentId })).pending) return false;
  return true;
}

export async function minimizeOriginalBuyerMoney(tx: Tx, contactId: string): Promise<number> {
  await allowMerchantTaxWrites(tx);
  const owned = await tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.contactId, contactId));
  const ids = owned.map(row => row.id);
  let affected = 0;
  if (ids.length) {
    affected += (await tx.update(invoices).set({ billingAddress: {}, customerTaxId: null, memo: null, schedule: null })
      .where(inArray(invoices.id, ids)).returning({ id: invoices.id })).length;
    await tx.update(payments).set({ failureMessage: null, metadata: {} }).where(inArray(payments.invoiceId, ids));
    await tx.update(refunds).set({ failureMessage: null, reason: null }).where(inArray(refunds.invoiceId, ids));
  }
  affected += (await tx.update(taxExemptions).set({ certificateRef: null, status: "revoked" }).where(eq(taxExemptions.contactId, contactId)).returning({ id: taxExemptions.id })).length;
  affected += (await tx.delete(paymentMethods).where(eq(paymentMethods.contactId, contactId)).returning({ id: paymentMethods.id })).length;
  affected += (await tx.delete(paymentProviderCustomers).where(eq(paymentProviderCustomers.contactId, contactId)).returning({ id: paymentProviderCustomers.id })).length;
  return affected;
}

/** Actual privacy-source context, never a synthesized system clone. The
 * stable real queue claim is admitted before any local credential deletion. */
export async function eraseBuyerMoneySource(tx: Tx, contactId: string, context: { requestId: string; service?: ServiceContext }): Promise<{ affected: number; pendingJobs: string[] }> {
  if (!context.service) throw new ServiceError("conflict", "Buyer money erasure requires its actual shared privacy context.");
  const ctx = context.service;
  if (ctx.tx !== tx) throw new ServiceError("permission", "The money source must share its actual parent privacy transaction.");
  const [request] = await tx.select().from(dataRequests).where(eq(dataRequests.id, context.requestId)).limit(1);
  if (!request || request.kind !== "erasure" || !request.verifiedAt || request.contactId !== contactId) throw new ServiceError("permission", "This money source does not belong to the original verified buyer erasure.");
  // Re-fulfilment preserves already admitted real customer/finisher tasks;
  // rebuilding a receipt from minimized rows must never invent zero work.
  const [priorArtifact] = await tx.select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, request.id)).limit(1);
  if (priorArtifact && request.status === "in_progress") {
    const parsed = receiptBody.safeParse(priorArtifact.body);
    if (!erasureArtifactIsIntact(priorArtifact) || !parsed.success) throw new ServiceError("conflict", "Restore the original money erasure receipt before repeating fulfilment.");
    const prior = parsed.data.outcomes.find(item => item.scope === SCOPE);
    if (prior?.outcome === "pending" && prior.pendingJobs?.length) return { affected: 0, pendingJobs: prior.pendingJobs };
  }
  const prepare = getService("subscriptions.prepareBuyerAgreementErasure");
  const state = getService("subscriptions.buyerAgreementErasureState");
  if (!prepare || !state) throw new ServiceError("conflict", "Restore the original buyer schedule privacy phases before minimizing money evidence.");
  const prepared = prepareOutput.parse(await ctx.callAsSystem(prepare, { requestId: request.id }));
  const originalPaymentIds = await originalBuyerMerchantPayments(ctx, contactId);
  if (originalPaymentIds.length + prepared.originalAgreementIds.length > 5000) throw new ServiceError("conflict", "The complete original buyer money inventory needs bounded recovery.");
  if (!prepared.pendingJobs.length && !prepared.originalAgreementIds.length && !originalPaymentIds.length) {
    const current = readiness.parse(await ctx.callAsSystem(state, { requestId: request.id, originalAgreementIds: prepared.originalAgreementIds }));
    if (!current.safe) {
      throw new ServiceError("conflict", "Original buyer schedules or cash remain unresolved before money erasure.");
    }
    const targets = new Map((await originalProviderCustomersForErasure(tx, contactId)).map(customer => [originalProviderCustomerKey(customer), customer]));
    for (const customer of current.providerCustomers) targets.set(originalProviderCustomerKey(customer), customer);
    if (targets.size > 5000) throw new ServiceError("conflict", "The original provider customer erasure inventory needs bounded recovery.");
    const external = await queueOriginalPaymentProviderCustomers(tx, [...targets.values()], context);
    return { affected: await minimizeOriginalBuyerMoney(tx, contactId), pendingJobs: external.pendingJobs };
  }
  const key = `buyer-money-erasure:${request.id}`;
  const [original] = await tx.select({ jobId: jobIdempotencyKeys.jobId }).from(jobIdempotencyKeys)
    .where(and(eq(jobIdempotencyKeys.jobName, BUYER_MONEY_ERASURE_JOB), eq(jobIdempotencyKeys.idempotencyKey, key))).limit(1);
  const originalJobId = original?.jobId ?? randomUUID();
  const job = await enqueueJob(tx, BUYER_MONEY_ERASURE_JOB, { requestId: request.id, originalJobId, originalAgreementIds: prepared.originalAgreementIds, originalPaymentIds },
    { id: originalJobId, idempotencyKey: key });
  return { affected: 0, pendingJobs: [job.id] };
}

async function originalMoneyPayload(tx: Tx, requestId: string, jobId: string): Promise<z.infer<typeof payload>> {
  const [claim] = await tx.select({ payloadHash: jobIdempotencyKeys.payloadHash }).from(jobIdempotencyKeys)
    .where(and(eq(jobIdempotencyKeys.jobName, BUYER_MONEY_ERASURE_JOB), eq(jobIdempotencyKeys.jobId, jobId))).limit(1);
  const [job] = await tx.execute<{ data: unknown }>(sql`select data from pgboss.job where id=${jobId}::uuid and name=${BUYER_MONEY_ERASURE_JOB} limit 1`);
  const original = originalBuyerMoneyInventory(job?.data, claim?.payloadHash, { requestId, originalJobId: jobId });
  if (!original) {
    throw new ServiceError("conflict", "Restore the exact original money-finisher enqueue inventory before completion.");
  }
  return original;
}

export const completeBuyerMoneyErasure = defineService({
  name: "invoicing.completeBuyerMoneyErasure", summary: "Atomically minimize original buyer money evidence after actual schedule quiescence, retaining real provider customer tasks.",
  kind: "mutation", permission: "system", external: false, auditInputFields: ["requestId", "originalJobId"],
  input: payload.pick({ requestId: true, originalJobId: true }), output: result,
  handler: async (input, ctx) => {
    await lockContactIdentity(ctx.tx);
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`privacy:${input.requestId}`}))`);
    const original = await originalMoneyPayload(ctx.tx, input.requestId, input.originalJobId);
    const [request] = await ctx.tx.select().from(dataRequests).where(eq(dataRequests.id, input.requestId)).limit(1).for("update");
    if (!request || request.kind !== "erasure" || !request.verifiedAt || !["in_progress", "partially_completed", "completed"].includes(request.status)) {
      throw new ServiceError("permission", "This finisher is not owned by an applied original buyer erasure.");
    }
    const [artifact] = await ctx.tx.select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, request.id)).limit(1).for("update");
    const parsed = receiptBody.safeParse(artifact?.body), outcome = parsed.success ? parsed.data.outcomes.find(item => item.scope === SCOPE) : undefined;
    if (!erasureArtifactIsIntact(artifact) || !outcome) {
      await ctx.callAsSystem(reopenErasureJob, { requestId: request.id, scope: SCOPE, jobName: BUYER_MONEY_ERASURE_JOB,
        jobData: { originalAgreementIds: original.originalAgreementIds, originalPaymentIds: original.originalPaymentIds }, idempotencyKey: `buyer-money-artifact:${input.originalJobId}` });
      return { settled: false, recoveryRequired: true };
    }
    const state = getService("subscriptions.buyerAgreementErasureState");
    if (!state) throw new ServiceError("conflict", "Restore the original buyer schedule recovery proof before erasing money evidence.");
    const current = readiness.parse(await ctx.callAsSystem(state, { requestId: request.id, originalAgreementIds: original.originalAgreementIds }));
    if (!current.safe || !await originalBuyerPaymentsAreSafe(ctx, request.contactId, original.originalPaymentIds)) {
      return { settled: false, recoveryRequired: false };
    }
    if (outcome.outcome === "erased") return { settled: true, recoveryRequired: false };
    if (outcome.outcome !== "pending" || !outcome.pendingJobs?.includes(input.originalJobId)) return { settled: false, recoveryRequired: true };
    const [hold] = await ctx.tx.select({ id: privacyRetentionExceptions.id }).from(privacyRetentionExceptions)
      .innerJoin(dataRequests, eq(dataRequests.id, privacyRetentionExceptions.dataRequestId)).where(and(eq(dataRequests.contactId, request.contactId),
        inArray(privacyRetentionExceptions.scope, [SCOPE, "subscriptions.agreements", "privacy.records"]),
        or(isNull(privacyRetentionExceptions.expiresAt), gt(privacyRetentionExceptions.expiresAt, new Date())))).limit(1);
    if (hold) return { settled: false, recoveryRequired: false };
    const customers = new Map((await originalProviderCustomersForErasure(ctx.tx, request.contactId)).map(customer => [originalProviderCustomerKey(customer), customer]));
    for (const customer of current.providerCustomers) customers.set(originalProviderCustomerKey(customer), customer);
    if (customers.size > 5000) throw new ServiceError("conflict", "The original provider customer erasure inventory needs bounded recovery.");
    for (const customer of customers.values()) {
      const { providerPlatformAccountId, ...target } = customer;
      const queued = await ctx.callAsSystem(reopenErasureJob, { requestId: request.id, scope: SCOPE, jobName: erasePaymentProviderCustomer.name,
        jobData: { ...target, ...(providerPlatformAccountId ? { providerPlatformAccountId } : {}), buyerMoneyFinisherJobId: input.originalJobId },
        idempotencyKey: `buyer-money-customer:${input.originalJobId}:${merchantTaxDigest(customer)}` });
      if (!queued.jobId || queued.recoveryRequired) return { settled: false, recoveryRequired: true };
    }
    await minimizeOriginalBuyerMoney(ctx.tx, request.contactId);
    await ctx.callAsSystem(completeErasureJob, { requestId: request.id, scope: SCOPE, jobId: input.originalJobId });
    ctx.setSubject("dataRequest", request.id);
    return { settled: true, recoveryRequired: false };
  },
});

export const reopenBuyerMoneyErasure = defineService({
  name: "invoicing.reopenBuyerMoneyErasure", summary: "Reopen the retained original money-finisher generation after independently committed buyer schedule evidence.",
  kind: "mutation", permission: "system", external: false, auditInputFields: ["requestId"],
  input: z.object({ requestId: z.uuid(), evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/), sourceKey: z.string().min(1).max(150) }),
  output: z.object({ jobId: z.uuid().nullable(), recoveryRequired: z.boolean() }),
  handler: async (input, ctx) => {
    await lockContactIdentity(ctx.tx);
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`privacy:${input.requestId}`}))`);
    const [artifact] = await ctx.tx.select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, input.requestId)).limit(1);
    const parsed = receiptBody.safeParse(artifact?.body);
    if (erasureArtifactIsIntact(artifact) && parsed.success && parsed.data.outcomes.find(item => item.scope === SCOPE)?.outcome === "retained") {
      return { jobId: null, recoveryRequired: false };
    }
    if (!erasureArtifactIsIntact(artifact) || !parsed.success) {
      // The shared bad-artifact branch commits recovery without enqueueing
      // the intentionally absent replacement payload.
      const recovered = await ctx.callAsSystem(reopenErasureJob, { requestId: input.requestId, scope: SCOPE, jobName: BUYER_MONEY_ERASURE_JOB,
        jobData: {}, idempotencyKey: `buyer-money-recovery:${input.evidenceDigest}` });
      return { jobId: recovered.jobId, recoveryRequired: recovered.recoveryRequired };
    }
    const current = parsed.data.outcomes.find(item => item.scope === SCOPE);
    if (current?.outcome === "pending" && current.pendingJobs?.length) {
      if (current.pendingJobs.length > 5000) throw new ServiceError("conflict", "The original money task inventory needs bounded recovery.");
      const [pending] = await ctx.tx.select({ jobId: jobIdempotencyKeys.jobId }).from(jobIdempotencyKeys).where(and(
        eq(jobIdempotencyKeys.jobName, BUYER_MONEY_ERASURE_JOB), inArray(jobIdempotencyKeys.jobId, current.pendingJobs))).limit(1);
      if (pending) { await originalMoneyPayload(ctx.tx, input.requestId, pending.jobId); return { jobId: pending.jobId, recoveryRequired: false }; }
    }
    const [initial] = await ctx.tx.select({ jobId: jobIdempotencyKeys.jobId }).from(jobIdempotencyKeys).where(and(
      eq(jobIdempotencyKeys.jobName, BUYER_MONEY_ERASURE_JOB), eq(jobIdempotencyKeys.idempotencyKey, `buyer-money-erasure:${input.requestId}`))).limit(1);
    if (!initial) throw new ServiceError("conflict", "Restore the original money-finisher inventory before admitting a late-evidence generation.");
    const original = await originalMoneyPayload(ctx.tx, input.requestId, initial.jobId);
    const reopened = await ctx.callAsSystem(reopenErasureJob, { requestId: input.requestId, scope: SCOPE, jobName: BUYER_MONEY_ERASURE_JOB,
      jobData: { originalAgreementIds: original.originalAgreementIds, originalPaymentIds: original.originalPaymentIds }, idempotencyKey: `buyer-money-evidence:${merchantTaxDigest(input)}` });
    return { jobId: reopened.jobId, recoveryRequired: reopened.recoveryRequired };
  },
});

/** NEW deferred tasks re-check the current original proof before actual
 * customer DELETE. A retained job or old finisher flag alone grants no I/O. */
export const prepareBuyerCustomerErasure = defineService({
  name: "invoicing.prepareBuyerCustomerErasure", summary: "Verify original provider task membership and current buyer privacy dependencies before customer deletion.",
  kind: "mutation", permission: "system", external: false, auditInputFields: ["requestId", "providerJobId", "moneyJobId"],
  input: z.object({ requestId: z.uuid(), providerJobId: z.uuid(), moneyJobId: z.uuid(), payloadDigest: z.string().regex(/^[a-f0-9]{64}$/) }),
  output: z.object({ ready: z.boolean(), recoveryRequired: z.boolean() }),
  handler: async (input, ctx) => {
    await lockContactIdentity(ctx.tx);
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`privacy:${input.requestId}`}))`);
    const original = await originalMoneyPayload(ctx.tx, input.requestId, input.moneyJobId);
    const [providerClaim] = await ctx.tx.select({ payloadHash: jobIdempotencyKeys.payloadHash }).from(jobIdempotencyKeys).where(and(
      eq(jobIdempotencyKeys.jobName, erasePaymentProviderCustomer.name), eq(jobIdempotencyKeys.jobId, input.providerJobId))).limit(1);
    const [providerJob] = await ctx.tx.execute<{ data: unknown }>(sql`select data from pgboss.job where id=${input.providerJobId}::uuid and name=${erasePaymentProviderCustomer.name} limit 1`);
    const target = providerCustomerErasurePayload.safeParse(providerJob?.data);
    // Hash the exact queue payload; optional defaults are not silently added
    // to the original hashed admission material.
    if (!providerClaim || providerClaim.payloadHash !== input.payloadDigest || !target.success || merchantTaxDigest(providerJob?.data) !== providerClaim.payloadHash
      || target.data.requestId !== input.requestId || target.data.originalJobId !== input.providerJobId
      || target.data.buyerMoneyFinisherJobId !== input.moneyJobId) throw new ServiceError("permission", "Restore the exact original provider-customer admission before deletion.");
    const [request] = await ctx.tx.select().from(dataRequests).where(eq(dataRequests.id, input.requestId)).limit(1).for("update");
    if (!request || request.kind !== "erasure" || !request.verifiedAt) throw new ServiceError("permission", "This provider-customer task does not belong to a verified original buyer erasure.");
    const [artifact] = await ctx.tx.select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, request.id)).limit(1).for("update");
    const parsed = receiptBody.safeParse(artifact?.body);
    if (!erasureArtifactIsIntact(artifact) || !parsed.success) {
      await ctx.callAsSystem(reopenErasureJob, { requestId: request.id, scope: SCOPE, jobName: BUYER_MONEY_ERASURE_JOB,
        jobData: { originalAgreementIds: original.originalAgreementIds, originalPaymentIds: original.originalPaymentIds }, idempotencyKey: `buyer-customer-artifact:${input.providerJobId}` });
      return { ready: false, recoveryRequired: true };
    }
    const outcome = parsed.data.outcomes.find(item => item.scope === SCOPE);
    if (request.status !== "in_progress" || outcome?.outcome !== "pending" || !outcome.pendingJobs?.includes(input.providerJobId)) return { ready: false, recoveryRequired: true };
    const [hold] = await ctx.tx.select({ id: privacyRetentionExceptions.id }).from(privacyRetentionExceptions)
      .innerJoin(dataRequests, eq(dataRequests.id, privacyRetentionExceptions.dataRequestId)).where(and(eq(dataRequests.contactId, request.contactId),
        inArray(privacyRetentionExceptions.scope, [SCOPE, "subscriptions.agreements", "privacy.records"]),
        or(isNull(privacyRetentionExceptions.expiresAt), gt(privacyRetentionExceptions.expiresAt, new Date())))).limit(1);
    if (hold) return { ready: false, recoveryRequired: false };
    const state = getService("subscriptions.buyerAgreementErasureState");
    if (!state) throw new ServiceError("conflict", "Restore the original buyer schedule proof before deleting its provider customer.");
    const current = readiness.parse(await ctx.callAsSystem(state, { requestId: request.id, originalAgreementIds: original.originalAgreementIds }));
    return { ready: current.safe && await originalBuyerPaymentsAreSafe(ctx, request.contactId, original.originalPaymentIds), recoveryRequired: false };
  },
});

export const finishBuyerMoneyErasure = defineJob({
  name: BUYER_MONEY_ERASURE_JOB, summary: "Wait for original buyer schedules and cash to converge, then finish the real money privacy task.",
  concurrency: 1, leaseSeconds: 120,
  retry: { limit: 40, delaySeconds: 60, backoff: true, maxDelaySeconds: 3600 },
  handler: async (data, context) => {
    const input = payload.parse(data);
    if (!context || context.id !== input.originalJobId) throw new ServiceError("permission", "The money-finisher caller is not its actual original job.");
    await context.throwIfCancelled();
    const completed = await completeBuyerMoneyErasure.call({ requestId: input.requestId, originalJobId: input.originalJobId }, { kind: "system" });
    // A corrupt-receipt recovery transition must commit before queue retry.
    if (!completed.settled) throw new ServiceError("conflict", completed.recoveryRequired ? "Restore the original buyer money artifact before retrying." : "Original buyer schedules, cash or holds remain unresolved.");
    return completed;
  },
});
registerJob(finishBuyerMoneyErasure);
export default [completeBuyerMoneyErasure, reopenBuyerMoneyErasure, prepareBuyerCustomerErasure];
