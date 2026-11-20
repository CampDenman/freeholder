// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: catalog returns consume original financial ownership by service.
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { defineService, ServiceError } from "@/core/service";
import { merchantPaymentRoutes } from "./merchant-collection-schema";
import { getInvoiceMarketPolicy } from "./market-policy";
import { invoiceLines, invoiceMerchantAllocationLines, invoiceMerchantAllocations, payments } from "./schema";

export const merchantRefundBasis = defineService({
  name: "invoicing.merchantRefundBasis", summary: "Read complete original line and payment allocation ownership for one versioned merchant invoice.",
  kind: "query", permission: "system", external: false, input: z.object({ invoiceId: z.uuid(), invoiceLineIds: z.array(z.uuid()).min(1).max(5000) }),
  output: z.object({ lines: z.array(z.object({ invoiceLineId: z.uuid(), allocationId: z.uuid() })), payments: z.array(z.object({ paymentId: z.uuid(), allocationId: z.uuid() })) }).nullable(),
  handler: async ({ invoiceId, invoiceLineIds }, ctx) => {
    const policy = await ctx.callAsSystem(getInvoiceMarketPolicy, { invoiceId });
    if (policy?.collectionVersion !== 1) return null;
    if (new Set(invoiceLineIds).size !== invoiceLineIds.length) throw new ServiceError("validation", "Choose each original returned invoice line only once.");
    const actualLines = await ctx.tx.select({ id: invoiceLines.id }).from(invoiceLines).where(and(eq(invoiceLines.invoiceId, invoiceId), inArray(invoiceLines.id, invoiceLineIds))).limit(5001);
    const lines = await ctx.tx.select({ invoiceLineId: invoiceMerchantAllocationLines.invoiceLineId, allocationId: invoiceMerchantAllocationLines.allocationId,
      invoiceId: invoiceMerchantAllocations.invoiceId }).from(invoiceMerchantAllocationLines)
      .innerJoin(invoiceLines, eq(invoiceLines.id, invoiceMerchantAllocationLines.invoiceLineId))
      .innerJoin(invoiceMerchantAllocations, eq(invoiceMerchantAllocations.id, invoiceMerchantAllocationLines.allocationId))
      .where(and(eq(invoiceLines.invoiceId, invoiceId), inArray(invoiceLines.id, invoiceLineIds))).limit(5001);
    const allocationIds = [...new Set(lines.map(row => row.allocationId))];
    const charged = await ctx.tx.select({ paymentId: merchantPaymentRoutes.paymentId, allocationId: merchantPaymentRoutes.allocationId,
      invoiceId: invoiceMerchantAllocations.invoiceId }).from(merchantPaymentRoutes)
      .innerJoin(payments, eq(payments.id, merchantPaymentRoutes.paymentId))
      .innerJoin(invoiceMerchantAllocations, eq(invoiceMerchantAllocations.id, merchantPaymentRoutes.allocationId))
      .where(and(eq(payments.invoiceId, invoiceId), inArray(merchantPaymentRoutes.allocationId, allocationIds))).limit(5001);
    if ([actualLines, lines, charged].some(rows => rows.length > 5000)
      || actualLines.length !== invoiceLineIds.length || lines.length !== actualLines.length
      || lines.some(row => row.invoiceId !== invoiceId) || charged.some(row => row.invoiceId !== invoiceId)
      || new Set(lines.map(row => row.invoiceLineId)).size !== actualLines.length
      || new Set(charged.map(row => row.paymentId)).size !== charged.length) {
      throw new ServiceError("conflict", "Restore the complete original merchant line and payment ownership before preparing a return.");
    }
    return { lines: lines.map(({ invoiceLineId, allocationId }) => ({ invoiceLineId, allocationId })),
      payments: charged.map(({ paymentId, allocationId }) => ({ paymentId, allocationId })) };
  },
});

export default [merchantRefundBasis];
