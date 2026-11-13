// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: actual frozen RMA parts, retained credit and current legacy cash.
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { defineOrchestratedService, defineService, getService, ServiceError } from "@/core/service";
import { getInvoice } from "@/modules/invoicing/invoice-service";
import { refunds } from "@/modules/invoicing/schema";
import { legacyBankFeedbackReviewOwned } from "@/modules/invoicing/legacy-bank-feedback-store";
import { legacyBankReads } from "@/modules/invoicing/legacy-bank-read-schema";
import { refundIsProvenUnsubmitted, originalLegacyBankRefund } from "@/modules/invoicing/legacy-refund-dispatch";
import { invoiceRefundStates } from "@/modules/invoicing/merchant-refund-bank-state-service";
import { reconcileLegacyBankRefund } from "@/modules/invoicing/legacy-bank-current-service";
import { isLegacyReplacementKey } from "@/modules/invoicing/legacy-bank-replacement-proof";
import { replaceOriginalLegacyBankRefund } from "@/modules/invoicing/legacy-bank-replacement-service";
import { legacyReturnBankOwnerResult, legacyReturnKeyOwnsAllocation } from "@/modules/invoicing/legacy-bank-return-contract";
import { orders, returnRequests, returnRefundAllocations } from "./schema";
import { returnDetail } from "./return-contract";
export const RETURN_BANK_REPLACEMENT_CONFIRMATION = "REPLACE ORIGINAL RETURN BANK REFUNDS";
const id = z.object({ id: z.uuid() }).strict();
export const legacyReturnBankPlanResult = z.object({
  invoiceId: z.uuid().nullable(), participating: z.boolean(), needsReview: z.boolean(), canResumeOriginal: z.boolean(), canInspect: z.boolean(),
  replaceRefundIds: z.array(z.uuid()).max(5000), inspectRefundIds: z.array(z.uuid()).max(5000),
  parts: z.array(z.object({ allocationId: z.uuid(), confirmedMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) })).max(5000),
}).strict();
export const legacyReturnBankPlan = defineService({
  name: "catalog.legacyReturnBankPlan", summary: "Read current bank confirmation for the exact original return parts while retaining every issued credit and original payment.",
  kind: "query", permission: "system", external: false, input: id, output: legacyReturnBankPlanResult,
  handler: async ({ id }, ctx) => {
    const [request] = await ctx.tx.select().from(returnRequests).where(eq(returnRequests.id, id));
    if (!request) throw new ServiceError("not_found", "That original return is not here.");
    const [order] = await ctx.tx.select().from(orders).where(eq(orders.id, request.orderId));
    const empty = { invoiceId: order?.invoiceId ?? null, participating: false, needsReview: false, canResumeOriginal: false, canInspect: false, replaceRefundIds: [] as string[], inspectRefundIds: [] as string[], parts: [] as Array<{ allocationId: string; confirmedMinor: number }> };
    if (!order?.invoiceId || !request.creditNoteId) return empty;
    const invoice = await ctx.callAsSystem(getInvoice, { id: order.invoiceId });
    const allocations = await ctx.tx.select().from(returnRefundAllocations).where(eq(returnRefundAllocations.returnId, request.id)).limit(5001);
    if (allocations.length + invoice.refunds.length > 5000) throw new ServiceError("conflict", "Restore a bounded complete original return bank inventory.");
    if (!allocations.length && invoice.refunds.some(refund => refund.provider === "stripe" && refund.idempotencyKey.startsWith(`return:${request.id}:`))) {
      return { ...empty, participating: true, needsReview: true };
    }
    const stripe = allocations.filter(part => part.provider === "stripe"), paymentIds = stripe.map(part => part.paymentId);
    const assigned = stripe.flatMap(part => invoice.refunds.filter(refund => refund.paymentId === part.paymentId && legacyReturnKeyOwnsAllocation(refund.idempotencyKey, request.id, part.id, part.paymentId)));
    const priorReads = paymentIds.length ? await ctx.tx.select({ id: legacyBankReads.id, refundId: refunds.id }).from(legacyBankReads).innerJoin(refunds, eq(refunds.id, legacyBankReads.refundId)).where(inArray(refunds.paymentId, paymentIds)).limit(5001) : [];
    const reviewed: string[] = [];
    for (const refund of invoice.refunds.filter(row=>paymentIds.includes(row.paymentId))) if (await legacyBankFeedbackReviewOwned(ctx.tx, refund.id)) reviewed.push(refund.id);
    if (priorReads.length + reviewed.length + assigned.length > 5000) throw new ServiceError("conflict", "Restore complete signed bank feedback and original read history before return recovery.");
    const participating = priorReads.length > 0 || reviewed.length > 0;
    const result = { ...empty, participating, inspectRefundIds: [...new Set(priorReads.map(read => read.refundId))] };
    // Feedback against the original cash namespace can invalidate every
    // physical refund on that payment, including another genuine promise.
    // Inspect their real original owners; never call the return fulfilled by
    // merely observing an equal unrelated amount in aggregate cash.
    if (participating) for (const refund of invoice.refunds.filter(row => paymentIds.includes(row.paymentId))) {
      try { await originalLegacyBankRefund(ctx.tx, refund); result.inspectRefundIds.push(refund.id); }
      catch (error) { if (!(error instanceof ServiceError) && !(error instanceof z.ZodError)) throw error; }
    }
    // Initial provider confirmation remains a real original wrapper result.
    // Later signed/current bank participation requires each original Stripe
    // part to have its own fresh exact-resource proof before the return closes.
    const states = participating ? await ctx.callAsSystem(invoiceRefundStates, { invoiceId: invoice.invoice.id }) : [];
    for (const part of stripe) {
      const owned = assigned.filter(refund => refund.paymentId === part.paymentId && legacyReturnKeyOwnsAllocation(refund.idempotencyKey, request.id, part.id, part.paymentId));
      for (const refund of owned) {
        if (participating && !isLegacyReplacementKey(refund.idempotencyKey) && await refundIsProvenUnsubmitted(ctx.tx, refund)) result.canResumeOriginal = true;
        try { await originalLegacyBankRefund(ctx.tx, refund); result.inspectRefundIds.push(refund.id); }
        catch (error) { if (!(error instanceof ServiceError) && !(error instanceof z.ZodError)) throw error; }
      }
      if (!participating) continue;
      if (!owned.length) { result.needsReview = true; result.parts.push({ allocationId: part.id, confirmedMinor: 0 }); continue; }
      try {
        const source = legacyReturnBankOwnerResult.parse(await ctx.callAsSystem(getService("catalog.legacyReturnBankRefundOwner"), { refundId: owned[0]!.id }));
        if (!source.owner || source.owner.returnId !== request.id || source.owner.allocationId !== part.id || source.owner.creditNoteId !== request.creditNoteId) throw new ServiceError("conflict", "Restore the actual original return-part and credit owner.");
        result.parts.push({ allocationId: part.id, confirmedMinor: source.confirmedMinor });
        result.needsReview ||= source.needsReview || states.some(state => source.refundIds.includes(state.id) && state.reviewRequired);
        result.replaceRefundIds.push(...states.filter(state => source.refundIds.includes(state.id) && state.legacy && state.canReplace).map(state => state.id));
        result.inspectRefundIds.push(...source.cashRefundIds.filter(refundId=>invoice.refunds.some(row=>row.id===refundId&&row.providerRef)));
      } catch (error) {
        if (!(error instanceof ServiceError) && !(error instanceof z.ZodError)) throw error;
        result.needsReview = true; result.parts.push({ allocationId: part.id, confirmedMinor: 0 });
      }
    }
    result.inspectRefundIds = [...new Set(result.inspectRefundIds)].sort(); result.replaceRefundIds = [...new Set(result.replaceRefundIds)].sort();
    result.canInspect = result.inspectRefundIds.length > 0;
    if (result.inspectRefundIds.length + result.replaceRefundIds.length + result.parts.length > 5000) throw new ServiceError("conflict", "Restore the complete bounded exact return resource plan before recovery.");
    return result;
  },
});
async function reconcileActualReturn(id: string, actor: Parameters<typeof reconcileLegacyBankRefund.call>[1]) {
  const system = { kind: "system", request: actor.request } as const;
  const plan = await legacyReturnBankPlan.call({ id }, system), errors: unknown[] = [];
  for (const refundId of plan.inspectRefundIds) { try { await reconcileLegacyBankRefund.call({ refundId }, system); } catch (error) { errors.push(error); } }
  // All primary provider facts and cash projections commit before a later
  // return/notification callback is asked to close the business workflow.
  for (const refundId of plan.inspectRefundIds) {
    try {
      if (plan.invoiceId) await getService("catalog.reconcileReturnBankRefundState").call({ invoiceId: plan.invoiceId, refundId }, system);
    } catch (error) { errors.push(error); }
  }
  if (errors.length) throw errors[0];
  return returnDetail.parse(await getService("catalog.getReturn").call({ id }, actor));
}
export const recoverReturnBankRefunds = defineOrchestratedService({
  name: "catalog.recoverReturnBankRefunds", summary: "Check every exact original legacy return payment without issuing another credit, replacing a refund or charging the buyer.",
  kind: "mutation", permission: "scoped", stepUp: true, writeClass: "money", input: id, output: returnDetail,
  handler: (input, actor) => reconcileActualReturn(input.id, actor),
});
export const replaceReturnBankRefunds = defineOrchestratedService({
  name: "catalog.replaceReturnBankRefunds", summary: "Authorize exact failed original return-part replacements while retaining the same original credit, lines and payments.",
  kind: "mutation", permission: "scoped", stepUp: true, agentCallable: false, writeClass: "money", input: id.extend({ confirmation: z.literal(RETURN_BANK_REPLACEMENT_CONFIRMATION) }).strict(), output: returnDetail,
  handler: async (input, actor) => {
    if (actor.kind !== "user" || actor.keyScopes) throw new ServiceError("permission", "A freshly verified signed-in person must authorize the original return's exact bank replacements.");
    await reconcileActualReturn(input.id, actor);
    const plan = await legacyReturnBankPlan.call({ id: input.id }, { kind: "system", request: actor.request }), errors: unknown[] = [];
    for (const refundId of plan.replaceRefundIds) {
      try { await replaceOriginalLegacyBankRefund({ refundId, authorizedBy: actor.userId, expectedReturnId: input.id, dispatchActor: { kind: "system", request: actor.request } }); }
      catch (error) { errors.push(error); }
    }
    if (errors.length) throw errors[0];
    return reconcileActualReturn(input.id, actor);
  },
});
export default [legacyReturnBankPlan, recoverReturnBankRefunds, replaceReturnBankRefunds];
