// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: actual frozen return lineage, never equal-amount inference.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { defineService } from "@/core/service";
import { getInvoice } from "@/modules/invoicing/invoice-service";
import { QUANTITY_SCALE } from "@/modules/invoicing/money";
import { orderItems, orders, returnItems, returnRefundAllocations, returnRequests } from "./schema";
import { merchantReturnFeeSourceResult } from "./merchant-return-fee-contract";
export const originalMerchantReturnFeeSource = defineService({
  name: "catalog.originalMerchantReturnFeeSource", summary: "Prove actual original return, credit, tender allocation and refund references for commission recovery.",
  kind: "query", permission: "system", external: false, input: z.object({ invoiceId: z.uuid() }), output: merchantReturnFeeSourceResult,
  handler: async ({ invoiceId }, ctx) => {
    const [order] = await ctx.tx.select().from(orders).where(eq(orders.invoiceId, invoiceId)).limit(1);
    if (!order) return { hasOrder: false, incomplete: true, returns: [] };
    const invoice = await ctx.callAsSystem(getInvoice, { id: invoiceId });
    const requests = await ctx.tx.select().from(returnRequests).where(eq(returnRequests.orderId, order.id)).limit(5001);
    const result: z.infer<typeof merchantReturnFeeSourceResult> = { hasOrder: true, incomplete: false, returns: [] };
    let count = requests.length + invoice.lines.length + invoice.refunds.length + invoice.creditNotes.length;
    if (count > 5000) return { ...result, incomplete: true };
    const used = new Set<string>();
    for (const request of requests) {
      if (!request.creditNoteId) continue;
      const credit = invoice.creditNotes.find(row => row.id === request.creditNoteId);
      if (!credit) return { ...result, incomplete: true };
      const items = await ctx.tx.select().from(returnItems).where(eq(returnItems.returnId, request.id)).limit(5001);
      const parts = await ctx.tx.select().from(returnRefundAllocations).where(eq(returnRefundAllocations.returnId, request.id)).limit(5001);
      count += items.length + parts.length;
      if (count > 5000 || !items.length || !parts.length) return { ...result, incomplete: true };
      const output: z.infer<typeof merchantReturnFeeSourceResult>["returns"][number] = {
        returnId: request.id, creditNoteId: credit.id, completed: request.status === "refunded" && credit.status === "issued", items: [], parts: [],
      };
      for (const item of items) {
        const [ordered] = await ctx.tx.select().from(orderItems).where(and(eq(orderItems.id, item.orderItemId), eq(orderItems.orderId, order.id))).limit(1);
        if (!ordered) return { ...result, incomplete: true };
        const candidates = invoice.lines.filter(line => line.sourceType === "variant" && line.sourceId === ordered.variantId
          && line.quantityMicros === ordered.quantity * QUANTITY_SCALE && line.unitAmountMinor === ordered.unitAmountMinor);
        const original = typeof ordered.snapshot.invoiceLineId === "string" ? candidates.find(line => line.id === ordered.snapshot.invoiceLineId)
          : candidates.length === 1 ? candidates[0] : undefined;
        const quantityMicros = item.quantity * QUANTITY_SCALE;
        if (!original || !Number.isSafeInteger(quantityMicros) || quantityMicros <= 0) return { ...result, incomplete: true };
        output.items.push({ invoiceLineId: original.id, quantityMicros });
      }
      for (const part of parts) {
        const actual = invoice.refunds.filter(refund => refund.paymentId === part.paymentId && refund.status === "succeeded" && (
          refund.idempotencyKey.startsWith(`return:${request.id}:allocation:${part.id}:`)
          || refund.idempotencyKey === `return:${request.id}:refund:${refund.paymentId}`
          || (refund.idempotencyKey.startsWith(`return:${request.id}:provider:`) && refund.idempotencyKey.endsWith(`:${refund.paymentId}`))));
        count += actual.length;
        if (count > 5000 || actual.some(refund => used.has(refund.id))) return { ...result, incomplete: true };
        for (const refund of actual) used.add(refund.id);
        output.parts.push({ id: part.id, paymentId: part.paymentId, amountMinor: part.amountMinor, refundIds: actual.map(refund => refund.id) });
      }
      result.returns.push(output);
    }
    return result;
  },
});
