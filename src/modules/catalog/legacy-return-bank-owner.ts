// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: prove actual existing RMA credit/part before any legacy replacement.
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { defineService, ServiceError } from "@/core/service";
import { providerPaymentSource } from "@/modules/invoicing/payment-provider-service";
import { getInvoice } from "@/modules/invoicing/invoice-service";
import { creditNoteLines, refunds } from "@/modules/invoicing/schema";
import { merchantRefundBankState } from "@/modules/invoicing/merchant-refund-bank-state-service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { legacyReturnBankOwnerResult, legacyReturnKeyOwnsAllocation } from "@/modules/invoicing/legacy-bank-return-contract";
import { QUANTITY_SCALE } from "@/modules/invoicing/money";
import { orderItems, orders, returnItems, returnRefundAllocations, returnRequests } from "./schema";
export const legacyReturnBankRefundOwner = defineService({
  name: "catalog.legacyReturnBankRefundOwner", summary: "Prove the actual original return allocation, credit and financial lines without reconstructing old ownership from an equal amount.",
  kind: "query", permission: "system", external: false, input: z.object({ refundId: z.uuid() }).strict(), output: legacyReturnBankOwnerResult,
  handler: async ({ refundId }, ctx) => {
    const [refund] = await ctx.tx.select().from(refunds).where(eq(refunds.id, refundId));
    if (!refund) throw new ServiceError("conflict", "Restore the actual original refund before resolving its return part.");
    const candidates = await ctx.tx.select({ part: returnRefundAllocations, request: returnRequests, order: orders }).from(returnRefundAllocations)
      .innerJoin(returnRequests, eq(returnRequests.id, returnRefundAllocations.returnId)).innerJoin(orders, eq(orders.id, returnRequests.orderId))
      .where(eq(returnRefundAllocations.paymentId, refund.paymentId)).limit(5001);
    if (candidates.length > 5000) throw new ServiceError("conflict", "Restore a complete bounded original return-part inventory before bank recovery.");
    const matches = candidates.filter(({ part, request, order }) => order.invoiceId === refund.invoiceId
      && legacyReturnKeyOwnsAllocation(refund.idempotencyKey, request.id, part.id, part.paymentId));
    if (!matches.length) return { owner: null, refundIds: [], cashRefundIds: [], confirmedRefundIds: [], unresolvedRefundIds: [], allocationMinor: 0, allCurrent: false, confirmedMinor: 0, partFulfilled: false, needsReview: true };
    if (matches.length !== 1) throw new ServiceError("conflict", "Restore this refund's one original return allocation; equal amounts cannot choose it.");
    const { part, request, order } = matches[0]!;
    const invoice = await ctx.callAsSystem(getInvoice, { id: refund.invoiceId });
    const credit = invoice.creditNotes.find(note => note.id === request.creditNoteId), payment = invoice.payments.find(row => row.id === part.paymentId);
    const source = await ctx.callAsSystem(providerPaymentSource, { paymentId: part.paymentId });
    if (part.providerAccountId !== (source.routing.providerAccountId ?? "") || part.applicationFeeMinor !== (source.routing.applicationFeeMinor ?? 0)) throw new ServiceError("conflict", "Restore the exact frozen original return payment route before recovery.");
    const allocations = await ctx.tx.select().from(returnRefundAllocations).where(eq(returnRefundAllocations.returnId, request.id)).limit(5001);
    if (!credit || credit.status === "void" || credit.idempotencyKey !== `return:${request.id}:credit` || credit.invoiceId !== invoice.invoice.id
      || !["received", "refunded"].includes(request.status)
      || !payment || payment.status !== "succeeded" || payment.invoiceId !== order.invoiceId || refund.provider !== part.provider || payment.provider !== part.provider
      || part.currency !== invoice.invoice.currency || credit.currency !== part.currency || refund.currency !== part.currency || refund.amountMinor > part.amountMinor
      || allocations.length > 5000 || allocations.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n) !== BigInt(credit.totalMinor)) {
      throw new ServiceError("conflict", "Restore the original return's exact frozen tender allocation and existing credit; never create another credit or infer a part by amount.");
    }
    const items = await ctx.tx.select().from(returnItems).where(eq(returnItems.returnId, request.id)).limit(5001);
    const lines = await ctx.tx.select().from(creditNoteLines).where(eq(creditNoteLines.creditNoteId, credit.id)).orderBy(asc(creditNoteLines.position), asc(creditNoteLines.id)).limit(5001);
    const ordered = items.length ? await ctx.tx.select().from(orderItems).where(and(eq(orderItems.orderId, order.id), inArray(orderItems.id, items.map(item => item.orderItemId)))).limit(5001) : [];
    if (!items.length || !lines.length || candidates.length + allocations.length + items.length + lines.length + ordered.length + invoice.refunds.length > 5000) throw new ServiceError("conflict", "Restore the complete original returned-item and credit-line ownership before bank recovery.");
    const quantities = new Map<string, bigint>();
    for (const item of items) {
      const originalItem = ordered.find(row => row.id === item.orderItemId), savedLine = originalItem?.snapshot.invoiceLineId;
      const invoiceLine = typeof savedLine === "string" ? invoice.lines.find(line => line.id === savedLine) : undefined;
      if (!originalItem || !invoiceLine || invoiceLine.sourceType !== "variant" || invoiceLine.sourceId !== originalItem.variantId
        || invoiceLine.quantityMicros !== originalItem.quantity * QUANTITY_SCALE || item.quantity > originalItem.quantity) throw new ServiceError("conflict", "Restore the actual saved original invoice-line identity; a same-price line cannot be adopted into this issued credit.");
      quantities.set(invoiceLine.id, (quantities.get(invoiceLine.id) ?? 0n) + BigInt(item.quantity) * BigInt(QUANTITY_SCALE));
    }
    for (const line of lines) {
      if (!line.invoiceLineId || !quantities.has(line.invoiceLineId)) throw new ServiceError("conflict", "Every original credit line must belong to an actual returned invoice line.");
      quantities.set(line.invoiceLineId, quantities.get(line.invoiceLineId)! - BigInt(line.quantityMicros));
    }
    if ([...quantities.values()].some(quantity => quantity !== 0n) || lines.reduce((sum, line) => sum + BigInt(line.totalMinor), 0n) !== BigInt(credit.totalMinor)) throw new ServiceError("conflict", "Retain the exact original issued-credit quantities and amounts before legacy bank replacement.");
    const belongs = (row: { paymentId: string; invoiceId: string; idempotencyKey: string }) => row.paymentId === part.paymentId && row.invoiceId === order.invoiceId && legacyReturnKeyOwnsAllocation(row.idempotencyKey, request.id, part.id, part.paymentId);
    const ownedRefunds = invoice.refunds.filter(belongs), refundIds = ownedRefunds.map(row => row.id).sort(), confirmedRefundIds: string[] = [], unresolvedRefundIds: string[] = [];
    let confirmed = 0n, allCurrent = ownedRefunds.length > 0;
    for (const actual of ownedRefunds) {
      const bank = await ctx.callAsSystem(merchantRefundBankState, { refundId: actual.id });
      if (!bank.original || !bank.verified || bank.status === null || bank.status === "pending" || bank.status === "requires_action"
        || bank.status === "succeeded" && actual.status !== "succeeded" || (bank.status === "failed" || bank.status === "canceled") && actual.status !== "failed") { allCurrent = false; unresolvedRefundIds.push(actual.id); }
      if (bank.original && bank.verified && bank.resolvedSuccess && actual.status === "succeeded") { confirmed += BigInt(actual.amountMinor); confirmedRefundIds.push(actual.id); }
    }
    if (confirmed > BigInt(Number.MAX_SAFE_INTEGER)) throw new ServiceError("conflict", "Retain the original return's excess cash for financial review; never clamp it.");
    const cashRefundIds = invoice.refunds.filter(row => row.paymentId === part.paymentId && candidates.some(candidate => candidate.order.invoiceId === row.invoiceId
      && legacyReturnKeyOwnsAllocation(row.idempotencyKey, candidate.request.id, candidate.part.id, candidate.part.paymentId))).map(row => row.id).sort();
    return { owner: { returnId: request.id, allocationId: part.id, creditNoteId: credit.id,
      allocationDigest: merchantTaxDigest({ id: part.id, returnId: part.returnId, paymentId: part.paymentId, amountMinor: part.amountMinor,
        currency: part.currency, provider: part.provider, providerAccountId: part.providerAccountId, applicationFeeMinor: part.applicationFeeMinor }),
      creditDigest: merchantTaxDigest({ id: credit.id, invoiceId: credit.invoiceId, requestHash: credit.requestHash, currency: credit.currency,
        subtotalMinor: credit.subtotalMinor, taxMinor: credit.taxMinor, totalMinor: credit.totalMinor,
        lines: lines.map(line => ({ id: line.id, invoiceLineId: line.invoiceLineId, position: line.position, quantityMicros: line.quantityMicros, subtotalMinor: line.subtotalMinor, taxMinor: line.taxMinor, totalMinor: line.totalMinor })) }),
    }, refundIds, cashRefundIds, confirmedRefundIds, unresolvedRefundIds, allocationMinor: part.amountMinor, allCurrent, confirmedMinor: Number(confirmed),
      partFulfilled: allCurrent && confirmed === BigInt(part.amountMinor), needsReview: !allCurrent || confirmed !== BigInt(part.amountMinor) };
  },
});
