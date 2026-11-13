// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: exact original returned units and linked cash own fee credits.
import { and, asc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { getService, ServiceError, type ServiceContext } from "@/core/service";
import { merchantReturnFeeSourceResult } from "@/modules/catalog/merchant-return-fee-contract";
import type { paymentRouting } from "./merchant-charge";
import { invoiceMerchantCollections, merchantPaymentRoutes } from "./merchant-collection-schema";
import { merchantRefundRequests } from "./merchant-refund-schema";
import { creditNoteLines, creditNotes, invoiceLines, invoiceMerchantAllocationLines, invoiceMerchantAllocations, payments, refunds } from "./schema";
import { creditedOriginalLineFee, originalFeeResourceTargets } from "./merchant-line-fee-amounts";
import { assertMerchantCreatorsQuiesced, assertMerchantPaymentTerminal } from "./merchant-payment-request";

/** null is explicit incomplete/ambiguous recovery debt, never a new dispatch. */
export async function originalMerchantFeeTarget(ctx: ServiceContext, payment: typeof payments.$inferSelect, routing: z.infer<typeof paymentRouting>): Promise<number | null> {
  const fee = routing.applicationFeeMinor;
  if (fee === undefined || !Number.isSafeInteger(fee) || fee < 0 || !Number.isSafeInteger(payment.amountMinor) || payment.amountMinor <= 0
    || !Number.isSafeInteger(payment.refundedMinor) || payment.refundedMinor < 0 || payment.refundedMinor > payment.amountMinor) return null;
  const prior = Number(BigInt(fee) * BigInt(payment.amountMinor - payment.refundedMinor) / BigInt(payment.amountMinor));
  if (!routing.merchantAllocationId) return prior;
  const [allocation] = await ctx.tx.select().from(invoiceMerchantAllocations).where(and(eq(invoiceMerchantAllocations.id, routing.merchantAllocationId), eq(invoiceMerchantAllocations.invoiceId, payment.invoiceId)));
  const [collection] = await ctx.tx.select().from(invoiceMerchantCollections).where(eq(invoiceMerchantCollections.allocationId, routing.merchantAllocationId));
  if (!allocation || !collection) return null;
  const lines = await ctx.tx.select({ original: invoiceLines, frozen: invoiceMerchantAllocationLines })
    .from(invoiceMerchantAllocationLines).innerJoin(invoiceLines, eq(invoiceLines.id, invoiceMerchantAllocationLines.invoiceLineId))
    .innerJoin(invoiceMerchantAllocations, eq(invoiceMerchantAllocations.id, invoiceMerchantAllocationLines.allocationId))
    .where(eq(invoiceMerchantAllocations.invoiceId, payment.invoiceId)).limit(5001);
  const issued = await ctx.tx.select({ line: creditNoteLines, note: creditNotes }).from(creditNoteLines)
    .innerJoin(creditNotes, eq(creditNotes.id, creditNoteLines.creditNoteId)).where(and(eq(creditNotes.invoiceId, payment.invoiceId), sql`${creditNotes.status} <> 'void'`)).limit(5001);
  if (lines.length > 5000 || issued.length > 5000) return null;
  const own = lines.filter(row => row.frozen.allocationId === allocation.id), ownIds = new Set(own.map(row => row.original.id));
  if (!own.length || own.some(row => row.original.invoiceId !== payment.invoiceId || !Number.isSafeInteger(row.original.quantityMicros) || row.original.quantityMicros <= 0
    || !Number.isSafeInteger(row.frozen.feeMinor) || row.frozen.feeMinor < 0 || row.frozen.revenueMinor !== row.original.subtotalMinor - row.original.discountMinor)
    || own.reduce((sum, row) => sum + BigInt(row.frozen.feeMinor), 0n) !== BigInt(allocation.feeMinor)) return null;
  const ownedCredits = issued.filter(row => row.line.invoiceLineId && ownIds.has(row.line.invoiceLineId));
  const sourceService = getService("catalog.originalMerchantReturnFeeSource");
  if (!sourceService) return null;
  const source = merchantReturnFeeSourceResult.parse(await ctx.callAsSystem(sourceService, { invoiceId: payment.invoiceId }));
  if (!source.hasOrder || source.incomplete) return null;
  const originalReturns = source.returns.filter(row => row.items.some(item => ownIds.has(item.invoiceLineId)));
  if (!originalReturns.length && !ownedCredits.length) return prior;
  // A manual credit cannot be paired to a coincidentally equal refund amount.
  const returnCredits = new Set(originalReturns.map(row => row.creditNoteId));
  if (ownedCredits.some(row => !returnCredits.has(row.note.id))) return null;
  const charges = await ctx.tx.select({ payment: payments, route: merchantPaymentRoutes }).from(payments)
    .innerJoin(merchantPaymentRoutes, eq(merchantPaymentRoutes.paymentId, payments.id)).where(eq(payments.invoiceId, payment.invoiceId))
    .orderBy(asc(payments.createdAt), asc(payments.id)).limit(5001);
  const money = await ctx.tx.select({ refund: refunds, request: merchantRefundRequests,
    resolved: sql<boolean>`case when ${merchantRefundRequests.id} is null then false else freeholder_original_refund_resolved(${merchantRefundRequests.id},'succeeded',${refunds.providerRef}) end` })
    .from(refunds).innerJoin(payments, eq(payments.id, refunds.paymentId)).leftJoin(merchantRefundRequests, eq(merchantRefundRequests.refundId, refunds.id))
    .where(eq(payments.invoiceId, payment.invoiceId)).limit(5001);
  if (charges.length > 5000 || money.length > 5000 || new Set(money.map(row => row.refund.id)).size !== money.length) return null;
  const scopedCharges = charges.filter(row => row.route.allocationId === allocation.id);
  const resources = scopedCharges.filter(row => row.payment.status === "succeeded");
  if (!resources.some(row => row.payment.id === payment.id) || scopedCharges.some(row => row.payment.currency !== payment.currency || ["created", "processing"].includes(row.payment.status))) return null;
  if (resources.some(row => !Number.isSafeInteger(row.route.applicationFeeMinor) || row.route.applicationFeeMinor < 0 || row.route.applicationFeeMinor > row.payment.amountMinor)
    || resources.reduce((sum, row) => sum + BigInt(row.route.applicationFeeMinor), 0n) > BigInt(allocation.feeMinor)) return null;
  try {
    for (const row of scopedCharges) {
      await assertMerchantCreatorsQuiesced(ctx, row.payment.id);
      if (["failed", "cancelled"].includes(row.payment.status)) await assertMerchantPaymentTerminal(ctx, row.payment.id);
    }
  } catch (error) { if (error instanceof ServiceError && error.code === "conflict") return null; throw error; }
  const byPayment = new Map(charges.map(row => [row.payment.id, row])), byRefund = new Map(money.map(row => [row.refund.id, row]));
  const quantities = new Map<string, bigint>(), creditedNet = new Map<string, bigint>(), creditedTax = new Map<string, bigint>();
  const linkedCash = new Map<string, bigint>(), usedRefunds = new Set<string>();
  for (const returned of originalReturns) {
    if (!returned.completed) return null;
    const expected = returned.items.filter(item => ownIds.has(item.invoiceLineId));
    if (new Set(expected.map(item => item.invoiceLineId)).size !== expected.length) return null;
    const actual = ownedCredits.filter(row => row.note.id === returned.creditNoteId);
    if (actual.length !== expected.length || actual.some(row => row.note.status !== "issued" || row.note.currency !== payment.currency)) return null;
    let creditedGross = 0n;
    for (const item of expected) {
      const credit = actual.find(row => row.line.invoiceLineId === item.invoiceLineId)?.line;
      if (!credit || credit.quantityMicros !== item.quantityMicros || credit.subtotalMinor + credit.taxMinor !== credit.totalMinor) return null;
      quantities.set(item.invoiceLineId, (quantities.get(item.invoiceLineId) ?? 0n) + BigInt(item.quantityMicros));
      creditedNet.set(item.invoiceLineId, (creditedNet.get(item.invoiceLineId) ?? 0n) + BigInt(credit.subtotalMinor));
      creditedTax.set(item.invoiceLineId, (creditedTax.get(item.invoiceLineId) ?? 0n) + BigInt(credit.taxMinor));
      creditedGross += BigInt(credit.totalMinor);
    }
    let boundGross = 0n;
    for (const part of returned.parts) {
      const charge = byPayment.get(part.paymentId);
      if (!charge) return null;
      if (charge.route.allocationId !== allocation.id) continue;
      let confirmed = 0n;
      for (const refundId of part.refundIds) {
        const fact = byRefund.get(refundId), key = fact?.refund.idempotencyKey;
        const exactLineage = key && (key.startsWith(`return:${returned.returnId}:allocation:${part.id}:`)
          || key === `return:${returned.returnId}:refund:${part.paymentId}`
          || (key.startsWith(`return:${returned.returnId}:provider:`) && key.endsWith(`:${part.paymentId}`)));
        if (!fact?.request || !exactLineage || usedRefunds.has(refundId) || fact.refund.paymentId !== part.paymentId || fact.refund.status !== "succeeded"
          || fact.refund.currency !== payment.currency || !fact.resolved || fact.request.purpose !== "invoice_refund" || fact.request.paymentId !== part.paymentId
          || fact.request.refundId !== refundId || fact.request.idempotencyKey !== key || fact.request.amountMinor !== fact.refund.amountMinor
          || fact.request.originalPaymentRef !== charge.payment.providerRef || fact.request.providerPlatformAccountId !== collection.providerPlatformAccountId
          || fact.request.chargeAccountId !== collection.chargeAccountId) return null;
        usedRefunds.add(refundId); confirmed += BigInt(fact.refund.amountMinor);
      }
      // Conservation follows the actual frozen lineage above; equality alone
      // never supplied the source association.
      if (confirmed !== BigInt(part.amountMinor)) return null;
      linkedCash.set(part.paymentId, (linkedCash.get(part.paymentId) ?? 0n) + confirmed); boundGross += confirmed;
    }
    if (boundGross !== creditedGross) return null;
  }
  if (resources.some(row => BigInt(row.payment.refundedMinor) !== (linkedCash.get(row.payment.id) ?? 0n))) return null;
  let credit = 0n;
  for (const row of own) {
    const quantity = quantities.get(row.original.id) ?? 0n, originalQuantity = BigInt(row.original.quantityMicros);
    if (quantity > originalQuantity || quantity < 0n || originalQuantity <= 0n
      || (creditedNet.get(row.original.id) ?? 0n) !== BigInt(row.frozen.revenueMinor) * quantity / originalQuantity
      || (creditedTax.get(row.original.id) ?? 0n) !== BigInt(row.original.taxMinor) * quantity / originalQuantity) return null;
    credit += BigInt(creditedOriginalLineFee(row.frozen.feeMinor, row.original.quantityMicros, Number(quantity)));
  }
  if (credit > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  try {
    return originalFeeResourceTargets(Number(credit), resources.map(row => ({ paymentId: row.payment.id, feeMinor: row.route.applicationFeeMinor }))).get(payment.id) ?? null;
  } catch (error) { if (error instanceof ServiceError && error.code === "conflict") return null; throw error; }
}
