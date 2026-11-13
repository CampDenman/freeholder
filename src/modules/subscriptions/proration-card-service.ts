// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C12.38: exact original changed-price charge, never renewal or old-plan dunning.
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { paymentAdapter, type OffSessionChargeResult } from "@/adapters/payments";
import { AdapterError } from "@/adapters/types";
import { actorString, defineOrchestratedService, defineService, ServiceError, type Actor } from "@/core/service";
import { lockContactIdentity } from "@/core/contacts/identity-lock";
import { moduleSettings } from "@/core/settings/schema";
import { jobIdempotencyKeys } from "@/core/jobs/schema";
import { createPayment, startPayment } from "@/modules/invoicing/invoice-service";
import { invoiceOutstanding } from "@/modules/invoicing/invoice-balance";
import { providerPaymentSource, recordProviderPaymentResult } from "@/modules/invoicing/payment-provider-service";
import { assertChargeEvidence, routingForPayment } from "@/modules/invoicing/merchant-charge";
import { claimMerchantPaymentDispatch, flushLocalMerchantPaymentDispatchFinishes, merchantCreationRefusalCode, performMerchantPaymentDispatch, retainMerchantCreationRefusal, assertMerchantPaymentTerminal } from "@/modules/invoicing/merchant-payment-request";
import { recordMerchantPaymentObservation, merchantObservationRef } from "@/modules/invoicing/merchant-payment-observations";
import { merchantPaymentDispatches } from "@/modules/invoicing/merchant-payment-recovery-schema";
import { inspectMerchantCheckoutForRetry } from "@/modules/invoicing/merchant-payment-recovery";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { invoices, payments } from "@/modules/invoicing/schema";
import { subscriptions } from "./schema";
import { subscriptionProrations } from "./proration-schema";
import { subscriptionProrationCardAttempts, subscriptionProrationCardJobs } from "./proration-card-schema";
import { currentProrationCardMandate, requireProrationCardSchema } from "./proration-card-mandate";
import { PRORATION_CARD_API_VERSION, PRORATION_CARD_JOB, prorationCardTask } from "./proration-card-contract";
import { ownGrossProration } from "./proration-quote";
import { completePaidGrossProration, grossProrationCollectionAuthority } from "./proration-service";
const account = z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200), minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const providerRequest = z.object({ providerApiVersion: z.literal(PRORATION_CARD_API_VERSION), providerPlatformAccountId: account, providerAccountId: account.optional(),
  destinationAccountId: account.optional(), settlementMerchantAccountId: account.optional(), applicationFeeMinor: minor,
  agreementSubscriptionId: z.uuid(), paymentAttemptId: z.uuid(), invoiceId: z.uuid(), contactId: z.uuid(), currency: z.string().regex(/^[A-Z]{3}$/), amountMinor: minor.positive(),
  methodRef: z.string().regex(/^pm_[A-Za-z0-9_]+$/).max(200), customerRef: z.string().regex(/^cus_[A-Za-z0-9_]+$/).max(200), description: z.string().min(1).max(1000), idempotencyKey: z.string().min(1).max(200) }).strict();
const claimResult = z.object({ mode: z.enum(["skip", "create", "inspect", "closed"]), invoiceId: z.uuid().nullable(), paymentId: z.uuid().nullable(), request: providerRequest.nullable() });
export const claimProrationCardCharge = defineService({ name: "subscriptions.claimProrationCardCharge", summary: "Claim one exact accepted original stored-method attempt before I/O; old/expired jobs cannot charge successors or rewrite paid access.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", input: z.object({ prorationId: z.uuid() }), output: claimResult,
  handler: async ({ prorationId }, ctx) => {
    await lockContactIdentity(ctx.tx); await requireProrationCardSchema(ctx);
    const [accepted] = await ctx.tx.select().from(subscriptionProrations).where(eq(subscriptionProrations.id, prorationId)).limit(1).for("update");
    if (!accepted) throw new ServiceError("not_found", "There is no such original accepted proration.");
    const [existing] = await ctx.tx.select({ attempt: subscriptionProrationCardAttempts, payment: payments }).from(subscriptionProrationCardAttempts)
      .innerJoin(payments, eq(payments.id, subscriptionProrationCardAttempts.paymentId)).where(eq(subscriptionProrationCardAttempts.prorationId, accepted.id)).limit(1);
    if (existing) {
      const request = providerRequest.parse(existing.attempt.providerRequest);
      if (merchantTaxDigest(request) !== existing.attempt.requestDigest || existing.payment.invoiceId !== existing.attempt.invoiceId || existing.payment.amountMinor !== request.amountMinor || existing.payment.currency !== request.currency)
        throw new ServiceError("conflict", "Restore the actual original payment request; do not reconstruct or reprice a dispatched attempt.");
      if (["failed", "cancelled"].includes(existing.payment.status)) { await assertMerchantPaymentTerminal(ctx, existing.payment.id); return { mode: "closed" as const, invoiceId: existing.attempt.invoiceId, paymentId: existing.payment.id, request: null }; }
      const [sent] = await ctx.tx.select({ id: merchantPaymentDispatches.id }).from(merchantPaymentDispatches).where(eq(merchantPaymentDispatches.paymentId, existing.payment.id)).limit(1);
      // A real first admitted POST is never repeated. Its returned/cached finish
      // or genuine hosting stop must precede the independently admitted GET.
      return { mode: sent || existing.payment.status !== "created" ? "inspect" as const : "create" as const, invoiceId: existing.attempt.invoiceId, paymentId: existing.payment.id, request };
    }
    const [parent] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, accepted.subscriptionId)).limit(1).for("update");
    const [enabled] = await ctx.tx.select().from(moduleSettings).where(eq(moduleSettings.module, "subscriptions")).limit(1);
    const [invoice] = accepted.debitInvoiceId ? await ctx.tx.select().from(invoices).where(eq(invoices.id, accepted.debitInvoiceId)).limit(1) : [];
    if (!enabled?.enabled || !parent || !invoice || accepted.snapshot.billingMode !== "platform" || accepted.originalTrialEndsAt || accepted.state !== "awaiting_payment"
      || accepted.effectiveAt <= new Date() || parent.pendingPlanId !== accepted.planId || parent.cancelledAt || parent.cancelAtPeriodEnd || parent.status !== "active"
      || invoice.status === "paid" || invoice.status === "void" || invoice.contactId !== parent.contactId || invoice.currency !== parent.currency || invoiceOutstanding(invoice) <= 0)
      return { mode: "skip" as const, invoiceId: accepted.debitInvoiceId, paymentId: null, request: null };
    const authority = await ctx.callAsSystem(grossProrationCollectionAuthority, { invoiceId: invoice.id });
    if (!authority.allowed) return { mode: "skip" as const, invoiceId: invoice.id, paymentId: null, request: null };
    const mandate = await currentProrationCardMandate(ctx, accepted.id, parent.contactId);
    const payment = await ctx.callAsSystem(createPayment, { invoiceId: invoice.id, provider: mandate.method.provider, method: "saved_method", amountMinor: invoiceOutstanding(invoice),
      idempotencyKey: `subscription-proration-card:${accepted.id}:initial` });
    const original = await ctx.callAsSystem(providerPaymentSource, { paymentId: payment.id }), routing = await routingForPayment(ctx, payment.id);
    const request = providerRequest.parse(JSON.parse(JSON.stringify({ ...routing, providerApiVersion: mandate.method.providerApiVersion, agreementSubscriptionId: parent.id,
      paymentAttemptId: payment.id, invoiceId: original.providerRequestInvoiceRef, contactId: original.providerRequestContactRef, currency: payment.currency, amountMinor: payment.amountMinor,
      methodRef: mandate.method.providerMethodRef, customerRef: mandate.method.providerCustomerRef, description: accepted.snapshot.name, idempotencyKey: payment.idempotencyKey })));
    await ctx.tx.execute(sql`select set_config('freeholder.proration_card_v1','1',true)`);
    await ctx.tx.insert(subscriptionProrationCardAttempts).values({ paymentId: payment.id, prorationId: accepted.id, invoiceId: invoice.id, providerRequest: request, requestDigest: merchantTaxDigest(request) });
    return { mode: "create" as const, invoiceId: invoice.id, paymentId: payment.id, request };
  },
});
const publicResult = z.object({ prorationId: z.uuid(), invoiceId: z.uuid().nullable(), paymentId: z.uuid().nullable(), collectionState: z.enum(["skipped", "pending", "paid", "needs_review"]), applied: z.boolean() });
async function collect(prorationId: string, caller: Actor) {
  const system = { kind: "system", request: caller.request } as const;
  const claimed = await claimProrationCardCharge.call({ prorationId }, system);
  if (claimed.mode === "skip" || !claimed.paymentId || !claimed.invoiceId) return { prorationId, invoiceId: claimed.invoiceId, paymentId: claimed.paymentId, collectionState: "skipped" as const, applied: false };
  const base = { prorationId, invoiceId: claimed.invoiceId, paymentId: claimed.paymentId };
  if (claimed.mode === "closed") return { ...base, collectionState: "needs_review" as const, applied: false };
  if (claimed.mode === "inspect") {
    const actual = await inspectMerchantCheckoutForRetry(claimed.paymentId, caller);
    const decision = await completePaidGrossProration.call({ invoiceId: claimed.invoiceId }, system);
    return { ...base, collectionState: actual.state === "paid" ? "paid" as const : actual.state === "pending" ? "pending" as const : "needs_review" as const, applied: decision.applied };
  }
  const request = providerRequest.parse(claimed.request), dispatch = await claimMerchantPaymentDispatch.call({ paymentId: claimed.paymentId, requestDigest: merchantTaxDigest(request) }, system);
  let actual: OffSessionChargeResult | undefined;
  try {
    await performMerchantPaymentDispatch(dispatch, claimed.paymentId, async () => {
      actual = await paymentAdapter("stripe").chargeSavedMethod(request);
      // Real positive principal is committed before the caller-finish write or
      // any later domain/access/fee failure. No synthetic settlement is added.
      await recordMerchantPaymentObservation.call({ paymentId: claimed.paymentId!, providerEventRef: merchantObservationRef(actual), evidence: actual }, system);
      return actual;
    });
  } catch (error) {
    // A real cached finish may recover its failed commit. A replacement runtime
    // has no nonce/cache and needs the original actual stop before a GET.
    await flushLocalMerchantPaymentDispatchFinishes(claimed.paymentId);
    if (!actual) {
      const code = merchantCreationRefusalCode.safeParse(error instanceof AdapterError ? error.providerCode : undefined);
      if (code.success) {
        const refused = await retainMerchantCreationRefusal.call({ paymentId: claimed.paymentId, dispatchId: dispatch.dispatchId, providerCode: code.data }, system);
        if (refused.mayFail) await recordProviderPaymentResult.call({ paymentId: claimed.paymentId, initiatedBy: actorString(caller), outcome: { kind: "fail", code: "provider_refused", message: "The original stored-method request was definitively refused without creating a resource." } }, system);
      }
      throw new ServiceError("conflict", "The original changed-price payment needs its actual bank result. Reconcile this same attempt; a new charge key cannot clear it.");
    }
  }
  if (!actual) throw new ServiceError("conflict", "Restore the actual original payment result before changing any invoice or access.");
  await recordMerchantPaymentObservation.call({ paymentId: claimed.paymentId, providerEventRef: merchantObservationRef(actual), evidence: actual }, system);
  assertChargeEvidence(request, actual);
  if (!/^pi_[A-Za-z0-9_]+$/.test(actual.providerRef) || actual.providerRef.length > 200 || actual.status === "succeeded" && (actual.amountMinor !== request.amountMinor || actual.currency?.toUpperCase() !== request.currency))
    throw new ServiceError("conflict", "The original actual charge reference, amount or currency needs review; preserve its observation without fabricating a canonical payment.");
  if (actual.status === "succeeded") await recordProviderPaymentResult.call({ paymentId: claimed.paymentId, initiatedBy: actorString(caller),
    outcome: { kind: "settle", providerRef: actual.providerRef } }, system);
  else await startPayment.call({ id: claimed.paymentId, providerRef: actual.providerRef }, system);
  const decision = await completePaidGrossProration.call({ invoiceId: claimed.invoiceId }, system);
  return { ...base, collectionState: actual.status === "succeeded" ? "paid" as const : "pending" as const, applied: decision.applied };
}
export const collectProrationCard = defineOrchestratedService({ name: "subscriptions.collectProrationCard", summary: "Collect or recover the exact explicitly accepted original stored-method change without advancing or dunning the old paid subscription.",
  kind: "mutation", permission: "scoped", writeClass: "money", input: z.object({ prorationId: z.uuid() }), output: publicResult,
  handler: async (input, caller) => collect(input.prorationId, caller) });
const authorizeOwn = defineService({ name: "subscriptions.authorizeOwnProrationCard", summary: "Authorize only the current contact's actual accepted target before an own-customer card orchestration.",
  kind: "query", permission: "authenticated", external: false, input: z.object({ prorationId: z.uuid() }), output: z.object({ authorized: z.literal(true) }),
  handler: async ({ prorationId }, ctx) => { const [accepted] = await ctx.tx.select().from(subscriptionProrations).where(eq(subscriptionProrations.id, prorationId)).limit(1);
    if (!accepted) throw new ServiceError("not_found", "There is no such original accepted change."); await ownGrossProration(ctx, accepted.subscriptionId); return { authorized: true as const }; } });
export const collectMyProrationCard = defineOrchestratedService({ name: "subscriptions.collectMyProrationCard", summary: "Collect or recover only your own reviewed stored-method change while original paid access/calendar remain protected.",
  kind: "mutation", permission: "authenticated", writeClass: "money", input: z.object({ prorationId: z.uuid() }), output: publicResult,
  handler: async (input, caller) => { await authorizeOwn.call(input, caller); return collect(input.prorationId, caller); } });
export const collectProrationCardTask = defineService({ name: "subscriptions.verifyProrationCardTask", summary: "Verify the actual original retained collection job body before an automatic saved-method caller can be claimed.",
  kind: "query", permission: "system", external: false, input: prorationCardTask, output: z.object({ verified: z.literal(true) }),
  handler: async (input, ctx) => {
    const [receipt] = await ctx.tx.select().from(subscriptionProrationCardJobs).where(eq(subscriptionProrationCardJobs.prorationId, input.prorationId)).limit(1);
    const [claim] = await ctx.tx.select().from(jobIdempotencyKeys).where(and(eq(jobIdempotencyKeys.jobName, PRORATION_CARD_JOB), eq(jobIdempotencyKeys.jobId, input.originalJobId))).limit(1);
    const [queued] = await ctx.tx.execute<{ data: unknown }>(sql`select data from pgboss.job where id=${input.originalJobId}::uuid and name=${PRORATION_CARD_JOB} limit 1`);
    if (!receipt || receipt.jobId !== input.originalJobId || !claim || claim.payloadHash !== receipt.claimDigest || merchantTaxDigest(receipt.originalTask) !== claim.payloadHash
      || merchantTaxDigest(queued?.data) !== claim.payloadHash || merchantTaxDigest(input) !== claim.payloadHash) throw new ServiceError("permission", "Restore this exact original collection task/claim/body; a reconstructed or stale job cannot start another charge.");
    return { verified: true as const };
  },
});
export default [claimProrationCardCharge, collectProrationCard, authorizeOwn, collectMyProrationCard, collectProrationCardTask];
