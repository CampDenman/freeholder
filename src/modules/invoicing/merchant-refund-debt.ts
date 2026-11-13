// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: logical refund status never hides unfinished original evidence.
import { eq, inArray, sql } from "drizzle-orm";
import { getService, type ServiceContext } from "@/core/service";
import { merchantReturnFeeSourceResult } from "@/modules/catalog/merchant-return-fee-contract";
import { merchantRefundDispatches, merchantRefundObservations, merchantRefundRequests, merchantRefundResourceBindings, merchantRefundReservationRetirements } from "./merchant-refund-schema";
import { originalMerchantRefundCurrentStates, refundObservationHasCurrentBinding } from "./merchant-refund-current-state";
import { payments, refunds } from "./schema";
import { bankReplacementFinancialState, bankReplacementPromiseState, readBankReplacementChain } from "./merchant-bank-replacement-store";

/** A returned bank payment does not cancel the accepted refund promise. Only
 * the original frozen source can prove a replacement discharged that promise;
 * coincidentally equal manual credits/refunds never supply this association. */
async function returnedPromiseDischarged(ctx: ServiceContext, request: { refundId: string | null; paymentId: string | null;
  idempotencyKey: string; amountMinor: number; currency: string; providerPlatformAccountId: string;
  chargeAccountId: string | null; originalPaymentRef: string }): Promise<boolean> {
  if (!request.paymentId || !request.refundId) return false;
  const [payment] = await ctx.tx.select({ invoiceId: payments.invoiceId }).from(payments).where(eq(payments.id, request.paymentId));
  const sourceService = getService("catalog.originalMerchantReturnFeeSource");
  if (!payment || !sourceService) return false;
  const source = merchantReturnFeeSourceResult.parse(await ctx.callAsSystem(sourceService, { invoiceId: payment.invoiceId }));
  if (!source.hasOrder || source.incomplete) return false;
  const matches = source.returns.flatMap(returned => returned.parts.filter(part => part.paymentId === request.paymentId
    && (request.idempotencyKey.startsWith(`return:${returned.returnId}:allocation:${part.id}:`)
      || request.idempotencyKey === `return:${returned.returnId}:refund:${part.paymentId}`
      || request.idempotencyKey.startsWith(`return:${returned.returnId}:provider:`) && request.idempotencyKey.endsWith(`:${part.paymentId}`)))
    .map(part => ({ returned, part })));
  if (matches.length !== 1 || !matches[0]!.returned.completed) return false;
  const { part } = matches[0]!;
  if (!part.refundIds.length || new Set(part.refundIds).size !== part.refundIds.length || part.refundIds.length > 5000) return false;
  const actual = await ctx.tx.select({ refund: refunds, original: merchantRefundRequests,
    resolved: sql<boolean>`freeholder_original_refund_resolved(${merchantRefundRequests.id},'succeeded',${refunds.providerRef})` })
    .from(refunds).innerJoin(merchantRefundRequests, eq(merchantRefundRequests.refundId, refunds.id))
    .where(inArray(refunds.id, part.refundIds)).limit(5001);
  return actual.length === part.refundIds.length && actual.every(({ refund, original, resolved }) => resolved === true
    && refund.status === "succeeded" && refund.paymentId === request.paymentId && refund.currency === request.currency
    && original.paymentId === request.paymentId && original.originalPaymentRef === request.originalPaymentRef
    && original.providerPlatformAccountId === request.providerPlatformAccountId && original.chargeAccountId === request.chargeAccountId)
    && actual.reduce((sum, row) => sum + BigInt(row.refund.amountMinor), 0n) === BigInt(part.amountMinor);
}

/** Shared by financial debt and authorized masked customer/owner projections.
 * A failed resource never waives its promise. Only exact source-part lineage
 * or an authenticated replacement chain can discharge another request. */
export async function originalRefundPromiseState(ctx: ServiceContext, requestId: string) {
  const [request] = await ctx.tx.select().from(merchantRefundRequests).where(eq(merchantRefundRequests.id, requestId));
  if (!request?.refundId || !request.paymentId) return { owed: true, review: true, replaced: false, canReplace: false };
  const [refund] = await ctx.tx.select().from(refunds).where(eq(refunds.id, request.refundId));
  if (!refund) return { owed: true, review: true, replaced: false, canReplace: false };
  const [proof] = await ctx.tx.execute<{ success: boolean }>(sql`select freeholder_original_refund_resolved(${request.id}::uuid,'succeeded',${refund.providerRef}) as success`);
  const chain = await bankReplacementPromiseState(ctx, request);
  if (chain.hasChain) return { owed: !chain.fulfilled && proof?.success !== true, review: chain.review,
    replaced: chain.fulfilled && chain.fulfilledRequestId !== request.id, canReplace: chain.canReplace && chain.rootRequestId === request.id };
  if (proof?.success === true && refund.status === "succeeded") return { owed: false, review: false, replaced: false, canReplace: false };
  const [retired] = await ctx.tx.select().from(merchantRefundReservationRetirements).where(eq(merchantRefundReservationRetirements.requestId, request.id));
  const [dispatch] = await ctx.tx.select({ id: merchantRefundDispatches.id }).from(merchantRefundDispatches).where(eq(merchantRefundDispatches.requestId, request.id)).limit(1);
  if (retired?.requestDigest === request.requestDigest && !dispatch) return { owed: false, review: false, replaced: false, canReplace: false };
  if (await returnedPromiseDischarged(ctx, request)) return { owed: false, review: false, replaced: true, canReplace: false };
  const [prepared] = await ctx.tx.execute<{ prepared: boolean }>(sql`select freeholder_refund_is_prepared_return(${refund.id}::uuid) as prepared`);
  const current = await originalMerchantRefundCurrentStates(ctx, [request.id]);
  const terminal = current.states[0];
  return { owed: true, review: refund.status !== "created", replaced: false,
    canReplace: !prepared?.prepared && refund.status === "failed" && terminal !== undefined && ["failed", "canceled"].includes(terminal.status ?? "unknown") };
}

export async function originalMerchantRefundDebt(ctx: ServiceContext, paymentId: string): Promise<boolean> {
  const requests = await ctx.tx.select({ id: merchantRefundRequests.id, purpose: merchantRefundRequests.purpose,
    refundId: merchantRefundRequests.refundId, paymentId: merchantRefundRequests.paymentId, idempotencyKey: merchantRefundRequests.idempotencyKey,
    amountMinor: merchantRefundRequests.amountMinor, currency: merchantRefundRequests.currency,
    providerPlatformAccountId: merchantRefundRequests.providerPlatformAccountId, chargeAccountId: merchantRefundRequests.chargeAccountId,
    originalPaymentRef: merchantRefundRequests.originalPaymentRef,
    status: refunds.status,
    resolved: sql<boolean>`case
      when ${refunds.status}='succeeded' then freeholder_original_refund_resolved(${merchantRefundRequests.id},'succeeded',${refunds.providerRef})
      when ${refunds.status}='failed' then freeholder_original_refund_resolved(${merchantRefundRequests.id},'failed')
      when ${refunds.status}='cancelled' then exists(select 1 from merchant_refund_reservation_retirements r where r.request_id=${merchantRefundRequests.id} and r.request_digest=${merchantRefundRequests.requestDigest})
        and not exists(select 1 from merchant_refund_dispatches d where d.request_id=${merchantRefundRequests.id})
      else false end` }).from(merchantRefundRequests)
    .leftJoin(refunds, eq(refunds.id, merchantRefundRequests.refundId)).where(eq(merchantRefundRequests.paymentId, paymentId)).limit(5001);
  const observations = await ctx.tx.select()
    .from(merchantRefundObservations).where(eq(merchantRefundObservations.paymentId, paymentId)).limit(5001);
  if (requests.length > 5000 || observations.length > 5000) return true;
  const ids = new Set(requests.map(row => row.id));
  const bindings = ids.size ? await ctx.tx.select().from(merchantRefundResourceBindings).where(inArray(merchantRefundResourceBindings.requestId, [...ids])).limit(5001) : [];
  if (bindings.length > 5000 || requests.some(request => new Set(bindings.filter(row => row.requestId === request.id).map(row => row.providerRef)).size > 1)) return true;
  const current = await originalMerchantRefundCurrentStates(ctx, [...ids]);
  if (current.unresolvedRequestIds.length) return true;
  for (const request of requests) {
    const [original] = await ctx.tx.select().from(merchantRefundRequests).where(eq(merchantRefundRequests.id, request.id));
    if (!original) return true;
    const chain = await readBankReplacementChain(ctx.tx, original);
    if (chain.incomplete) return true;
    if (chain.links.length) {
      const state = await bankReplacementFinancialState(ctx, chain);
      if (!state.fulfilled) return true; // Also retains an actual over-return debt.
    } else if (request.status === "failed") {
      const promise = await originalRefundPromiseState(ctx, request.id);
      if (promise.owed || promise.review) return true;
    }
  }
  if (observations.some(row => {
    const proof = current.states.find(state => refundObservationHasCurrentBinding(row, state));
    if (proof) return false;
    return !row.bindingVerified || !row.requestId || !ids.has(row.requestId)
      || !bindings.some(binding => binding.requestId === row.requestId && binding.providerRef === row.providerRef);
  })) return true;
  // Receipt-owned unapplied returns use their own canonical disposition.
  // Until that full payment-side disposition is integrated, keep the debt
  // visible rather than treating a missing logical refund as completion.
  return requests.some(row => row.purpose !== "invoice_refund" || row.resolved !== true);
}
