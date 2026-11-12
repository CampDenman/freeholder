// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: the existing authorized refund orchestrator delegates fixed phases.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { paymentAdapter, type MerchantRefundObservation } from "@/adapters/payments";
import { actorString, defineService, ServiceError, type Actor } from "@/core/service";
import { refundRow } from "./contract";
import { claimMerchantRefundDispatch, assertMerchantRefundCreatorsQuiesced, flushLocalMerchantRefundDispatchFinishes, performMerchantRefundDispatch,
  recordMerchantRefundResourceAcknowledgement } from "./merchant-refund-dispatch";
import { recordMerchantRefundObservation } from "./merchant-refund-observations";
import { claimMerchantRefundRequest, merchantRefundRequestRow } from "./merchant-refund-request";
import { merchantRefundDispatches, merchantRefundRequests, merchantRefundResourceBindings } from "./merchant-refund-schema";
import { recordProviderRefundResult } from "./payment-provider-service";
import { refunds } from "./schema";
export const merchantRefundOperationState = defineService({
  name: "invoicing.merchantRefundOperationState", summary: "Read an immutable original refund and its actual caller/resource recovery state.",
  kind: "query", permission: "system", external: false, input: z.object({ requestId: z.uuid() }),
  output: z.object({ original: merchantRefundRequestRow, refund: refundRow.nullable(), dispatched: z.boolean(), creatorsQuiesced: z.boolean(), originalRefundRef: z.string().nullable() }),
  handler: async ({ requestId }, ctx) => {
    const [original] = await ctx.tx.select().from(merchantRefundRequests).where(eq(merchantRefundRequests.id, requestId));
    if (!original) throw new ServiceError("conflict", "Restore the original captured refund request before any provider recovery.");
    const [refund] = original.refundId ? await ctx.tx.select().from(refunds).where(eq(refunds.id, original.refundId)) : [];
    if (original.refundId && !refund) throw new ServiceError("conflict", "Restore the original logical refund without creating a replacement.");
    const calls = await ctx.tx.select({ id: merchantRefundDispatches.id }).from(merchantRefundDispatches).where(eq(merchantRefundDispatches.requestId, requestId)).limit(2);
    const bindings = await ctx.tx.select().from(merchantRefundResourceBindings).where(eq(merchantRefundResourceBindings.requestId, requestId)).limit(5001);
    if (calls.length > 1 || bindings.length > 5000) throw new ServiceError("conflict", "The original physical refund history needs complete review.");
    let creatorsQuiesced = true;
    try { await assertMerchantRefundCreatorsQuiesced(ctx, requestId); }
    catch (error) { if (!(error instanceof ServiceError) || error.code !== "conflict") throw error; creatorsQuiesced = false; }
    const acknowledgements = bindings.filter(row => row.origin === "physical_ack"), refs = new Set((acknowledgements.length ? acknowledgements : bindings).map(row => row.providerRef));
    if (refs.size > 1) throw new ServiceError("conflict", "The actual original refund resource is ambiguous; do not select one by metadata.");
    return { original: merchantRefundRequestRow.parse(original), refund: refund ?? null, dispatched: calls.length > 0, creatorsQuiesced, originalRefundRef: [...refs][0] ?? null };
  },
});

/** The caller is already authorized by the existing public orchestrator. This
 * function is not an additional public permission boundary or service bypass.
 */
export async function submitOriginalMerchantRefund(input: { paymentId: string; amountMinor: number; reason: string; idempotencyKey: string }, caller: Actor) {
  const system = { kind: "system", request: caller.request } as const;
  const original = await claimMerchantRefundRequest.call({ source: { kind: "payment", paymentId: input.paymentId },
    amountMinor: input.amountMinor, reason: input.reason, idempotencyKey: input.idempotencyKey, initiatedBy: actorString(caller) }, system);
  await flushLocalMerchantRefundDispatchFinishes(original.id);
  const state = await merchantRefundOperationState.call({ requestId: original.id }, system);
  if (!state.refund) throw new ServiceError("conflict", "An applied invoice refund requires its actual original logical reservation.");
  if (["succeeded", "failed", "cancelled"].includes(state.refund.status)) return state.refund;
  if (!state.creatorsQuiesced) throw new ServiceError("conflict", "The original refund caller is still unfinished. Another physical request cannot be admitted.");
  const adapter = paymentAdapter("stripe");
  if (!adapter.createMerchantRefund || !adapter.recoverMerchantRefund) throw new ServiceError("conflict", "The original provider lacks complete original-cash refund and recovery support.");
  const { originalRequest: request } = original;
  const observe = async (evidence: MerchantRefundObservation) => {
    await recordMerchantRefundObservation.call({ source: { kind: "payment", paymentId: input.paymentId }, requestId: original.id,
      evidence: { ...evidence, providerApiVersion: evidence.providerApiVersion ?? original.providerApiVersion,
        status: Object.hasOwn(evidence, "providerStatus") ? evidence.providerStatus ?? null : evidence.status } }, system);
    // Original-profile erasure reopening + periodic crash-window repair must
    // be composed before activation; the primary source fact already commits.
  };
  let actual: MerchantRefundObservation | undefined;
  if (!state.dispatched) {
    const dispatch = await claimMerchantRefundDispatch.call({ requestId: original.id }, system);
    actual = await performMerchantRefundDispatch(dispatch, original.id, () => adapter.createMerchantRefund!({ ...request,
      providerPlatformAccountId: original.providerPlatformAccountId, refundAttemptId: original.id, paymentProviderRef: original.originalPaymentRef,
      onRefundResourceAcknowledged: async providerRef => { await recordMerchantRefundResourceAcknowledgement.call({ ...dispatch, providerRef }, system); }, onRefundObserved: observe }));
  } else {
    const recovered = await adapter.recoverMerchantRefund({ ...request, providerPlatformAccountId: original.providerPlatformAccountId,
      refundAttemptId: original.id, paymentProviderRef: original.originalPaymentRef, ...(state.originalRefundRef ? { originalRefundRef: state.originalRefundRef } : {}), onRefundObserved: observe });
    if (recovered.state === "observed") actual = recovered.evidence;
    else return state.refund; // Unknown/ambiguous evidence never authorizes a POST.
  }
  if (!actual.bindingVerified) throw new ServiceError("conflict", "The actual original refund money was retained but does not match this reservation.");
  return recordProviderRefundResult.call({ refundId: state.refund.id, initiatedBy: actorString(caller), outcome: actual.status === "succeeded"
    ? { kind: "settle", providerRef: actual.providerRef } : actual.status === "failed"
      ? { kind: "fail", code: actual.failureCode ?? "provider_failed", message: "The original provider confirmed this refund was unsuccessful." }
      : { kind: "start", providerRef: actual.providerRef } }, system);
}
// Private registry metadata is present; financial SQL/native qualification pending.

export default [merchantRefundOperationState];
