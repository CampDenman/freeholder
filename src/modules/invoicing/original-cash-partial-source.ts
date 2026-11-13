// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: exact original RMA lines/parts and separate canonical credit capacity.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getService, listServices, ServiceError, type ServiceContext } from "@/core/service";
import { merchantReturnFeeSourceResult } from "@/modules/catalog/merchant-return-fee-contract";
import { routingForPayment } from "./merchant-charge";
import { originalMerchantFeeTarget } from "./merchant-line-fee-target";
import { creditNoteLines, creditNotes, payments,refunds } from "./schema";
import { merchantRefundRequests } from "./merchant-refund-schema";
import { originalPartialFeePolicy } from "./original-cash-partial-policy";
import { returnItems,returnRequests,orderItems } from "@/modules/catalog/schema";
import { QUANTITY_SCALE } from "./money";
import { merchantTaxDigest } from "./merchant-tax-store";
const disposition = z.object({ reservedForReturns: z.boolean(), appliedMinor: z.number().int().min(0), reservedMinor: z.number().int().min(0),
  availableMinor: z.number().int().min(0), reviewRequired: z.boolean(), revision: z.string().regex(/^[a-f0-9]{64}$/), receiptFingerprints: z.array(z.unknown()) });
/** Existing mutation ordering: original payment, invoice, then exact credit.
 * Never acquire an order row or another payment after its canonical cash lock. */
export async function lockOriginalPartialCashSource(ctx: ServiceContext, paymentId: string, lock = true) {
  if (lock) await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payment:${paymentId}`}))`);
  const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, paymentId));
  if (!payment) throw new ServiceError("conflict", "Restore the actual original partial-return payment.");
  if (lock) await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice:${payment.invoiceId}`}))`);
  const catalog = getService("catalog.originalMerchantReturnFeeSource");
  const source = merchantReturnFeeSourceResult.parse(await ctx.callAsSystem(catalog, { invoiceId: payment.invoiceId }));
  const returns = source.returns.filter(returned => returned.parts.some(part => part.paymentId === paymentId));
  if (source.hasOrder&&source.incomplete || returns.some(returned => !returned.completed)) throw new ServiceError("conflict", "Restore exact completed original return parts and their issued credit lines before cumulative auxiliary targets.");
  if (lock) for (const creditId of [...new Set(returns.map(returned => returned.creditNoteId))].sort()) await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`credit-note:${creditId}`}))`);
  return { payment, source, returns };
}
export async function originalPartialCashSource(ctx: ServiceContext, paymentId: string, lock = true) {
  const { payment, source, returns } = await lockOriginalPartialCashSource(ctx, paymentId, lock), routing = await routingForPayment(ctx, paymentId);
  if (payment.status !== "succeeded" || payment.amountMinor <= 0 || payment.refundedMinor <= 0 || payment.refundedMinor > payment.amountMinor
    || routing.applicationFeeMinor === undefined || !routing.providerPlatformAccountId) throw new ServiceError("conflict", "Use the original accepted merchant policy, principal and actual returned resources; equal generic refunds cannot choose this policy.");
  const retainedFeeMinor = await originalMerchantFeeTarget(ctx, payment, routing);
  if (retainedFeeMinor === null) throw new ServiceError("conflict", "Restore exact original returned quantities, credited lines, current refund resources and accepted commission policy.");
  const invoiceFeePolicy=await originalPartialFeePolicy(ctx,payment);
  if(!returns.length) {
    // A deliberate original invoice refund can exist without an RMA credit.
    // Its own immutable request/caller/current resource supplies authority;
    // no same-amount credit or later catalog line is attached to it.
    const actual=await ctx.tx.select({refund:refunds,request:merchantRefundRequests,resolved:sql<boolean>`case when ${merchantRefundRequests.id} is null then false else freeholder_original_refund_resolved(${merchantRefundRequests.id},'succeeded',${refunds.providerRef}) end`})
      .from(refunds).leftJoin(merchantRefundRequests,eq(merchantRefundRequests.refundId,refunds.id)).where(eq(refunds.paymentId,paymentId)).orderBy(asc(refunds.id)).limit(5001);
    const confirmed=actual.filter(row=>row.refund.status==="succeeded");
    if(actual.length>5000||!confirmed.length||confirmed.some(({refund,request,resolved})=>!request||!resolved||request.purpose!=="invoice_refund"||request.paymentId!==paymentId||request.refundId!==refund.id
      ||refund.invoiceId!==payment.invoiceId||refund.currency!==payment.currency||request.currency!==payment.currency||request.amountMinor!==refund.amountMinor||request.idempotencyKey!==refund.idempotencyKey
      ||request.originalPaymentRef!==payment.providerRef||request.providerPlatformAccountId!==routing.providerPlatformAccountId||request.chargeAccountId!==(routing.providerAccountId??null))
      ||confirmed.reduce((sum,row)=>sum+BigInt(row.refund.amountMinor),0n)!==BigInt(payment.refundedMinor))throw new ServiceError("conflict","Restore every exact original authorized refund request and current bank resource before the proportional original-payment policy.");
    const body={paymentId,invoiceId:payment.invoiceId,originalPrincipalMinor:payment.amountMinor,customerReturnedMinor:payment.refundedMinor,currency:payment.currency,
      allocationId:routing.merchantAllocationId??null,acceptedFeeMinor:routing.applicationFeeMinor,acceptedFeeRetainedMinor:retainedFeeMinor,policy:"original-payment-proportional-refund-v1",
      invoiceFeePolicy,returns:[],notes:[],lines:[],capacities:[],refundIds:confirmed.map(row=>row.refund.id),refundLineage:confirmed.map(({refund,request})=>({refundId:refund.id,requestId:request!.id,requestDigest:request!.requestDigest,providerRef:refund.providerRef,amountMinor:refund.amountMinor,currency:refund.currency}))};
    return {...body,sourceDigest:merchantTaxDigest(body)};
  }
  const creditService = listServices().get("invoicing.creditNoteDisposition");
  if (!creditService) throw new ServiceError("conflict", "Install the canonical exact-credit disposition service before partial return targets; the whole original RMA credit remains reserved.");
  const creditIds = [...new Set(returns.map(returned => returned.creditNoteId))].sort();
  const items=await ctx.tx.select({item:returnItems,ordered:orderItems}).from(returnItems).innerJoin(returnRequests,eq(returnRequests.id,returnItems.returnId)).innerJoin(orderItems,and(eq(orderItems.id,returnItems.orderItemId),eq(orderItems.orderId,returnRequests.orderId)))
    .where(inArray(returnItems.returnId,returns.map(returned=>returned.returnId))).limit(5001);
  if(items.length>5000||items.length!==returns.reduce((count,returned)=>count+returned.items.length,0)||items.some(({item,ordered})=>typeof ordered.snapshot.invoiceLineId!=="string"||!returns.find(returned=>returned.returnId===item.returnId)?.items.some(line=>line.invoiceLineId===ordered.snapshot.invoiceLineId&&line.quantityMicros===item.quantity*QUANTITY_SCALE)))throw new ServiceError("conflict","Restore exact saved original returned invoice-line UUIDs; a unique same-price candidate is not original ownership.");
  const notes = await ctx.tx.select().from(creditNotes).where(and(inArray(creditNotes.id, creditIds), eq(creditNotes.invoiceId, payment.invoiceId))).orderBy(asc(creditNotes.id)).limit(5001);
  const lines = creditIds.length ? await ctx.tx.select().from(creditNoteLines).where(inArray(creditNoteLines.creditNoteId, creditIds)).orderBy(asc(creditNoteLines.id)).limit(5001) : [];
  if (notes.length !== creditIds.length || notes.length + lines.length + source.returns.length > 5000 || notes.some(note => note.status !== "issued" || note.currency !== payment.currency)) throw new ServiceError("conflict", "Restore each actual issued original RMA credit and its complete financial lines.");
  const capacities = [];
  for (const creditNoteId of creditIds) {
    const actual = disposition.parse(await ctx.callAsSystem(creditService, { creditNoteId }));
    if (!actual.reservedForReturns || actual.appliedMinor !== 0 || actual.reservedMinor !== notes.find(note => note.id === creditNoteId)?.totalMinor || actual.availableMinor !== 0 || actual.reviewRequired) throw new ServiceError("conflict", "This original return credit has conflicting application or reservation evidence. Preserve the whole refund promise; it cannot also pay another invoice.");
    capacities.push({ creditNoteId, ...actual, receiptFingerprints: [...actual.receiptFingerprints].sort((a,b) => merchantTaxDigest(a).localeCompare(merchantTaxDigest(b))) });
  }
  const originalReturns = returns.map(returned => ({ returnId: returned.returnId, creditNoteId: returned.creditNoteId, items: [...returned.items].sort((a,b) => a.invoiceLineId.localeCompare(b.invoiceLineId)),
    parts: returned.parts.filter(part => part.paymentId === paymentId).map(part => ({ id: part.id, paymentId: part.paymentId, amountMinor: part.amountMinor, refundIds: [...part.refundIds].sort() })).sort((a,b) => a.id.localeCompare(b.id)) })).sort((a,b) => a.returnId.localeCompare(b.returnId));
  const principal = originalReturns.flatMap(returned => returned.parts).reduce((sum, part) => sum + BigInt(part.amountMinor), 0n);
  if (principal !== BigInt(payment.refundedMinor)) throw new ServiceError("conflict", "Every returned principal unit must belong to its exact original part; an unrelated equal refund cannot fill the difference.");
  const body = { paymentId, invoiceId: payment.invoiceId, originalPrincipalMinor: payment.amountMinor, customerReturnedMinor: payment.refundedMinor, currency: payment.currency,
    allocationId: routing.merchantAllocationId, acceptedFeeMinor: routing.applicationFeeMinor, acceptedFeeRetainedMinor: retainedFeeMinor,
    policy:"original-return-line-policy-v1",invoiceFeePolicy,refundIds:originalReturns.flatMap(returned=>returned.parts.flatMap(part=>part.refundIds)).sort(),
    returns: originalReturns, notes: notes.map(note => ({ id: note.id, invoiceId: note.invoiceId, requestHash: note.requestHash, currency: note.currency, totalMinor: note.totalMinor })),
    lines: lines.map(line => ({ id: line.id, creditNoteId: line.creditNoteId, invoiceLineId: line.invoiceLineId, position: line.position, quantityMicros: line.quantityMicros,
      subtotalMinor: line.subtotalMinor, taxMinor: line.taxMinor, totalMinor: line.totalMinor })), capacities };
  return { ...body, sourceDigest: merchantTaxDigest(body) };
}
