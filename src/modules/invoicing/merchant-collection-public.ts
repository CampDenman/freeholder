// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.26/C12.38: public invoice identity never exposes provider routing or fees.
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { ERASED_MERCHANT_NAME, publicMerchantSupport } from "@/core/commerce/merchant-identity";
import type { ServiceContext } from "@/core/service";
import { invoiceMerchantAllocations, invoiceMerchantAllocationLines, payments } from "./schema";
import { invoiceMerchantCollections, merchantPaymentRoutes } from "./merchant-collection-schema";
import { sumMinor } from "./money";

export const publicInvoiceMerchant = z.object({
  allocationId: z.uuid(), merchantName: z.string().nullable(), merchantSupport: publicMerchantSupport.nullable(),
  lineIds: z.array(z.uuid()),
  subtotalMinor: z.number().int(), discountMinor: z.number().int(), shippingMinor: z.number().int(), taxMinor: z.number().int(), totalMinor: z.number().int(),
  paidMinor: z.number().int(), refundedMinor: z.number().int(),
});

/** Caller first authorizes its invoice/payment; this helper does no elevation. */
export async function publicInvoiceMerchants(ctx: ServiceContext, invoiceId: string): Promise<z.infer<typeof publicInvoiceMerchant>[]> {
  const parts = await ctx.tx.select({ allocation: invoiceMerchantAllocations, collection: invoiceMerchantCollections })
    .from(invoiceMerchantAllocations).innerJoin(invoiceMerchantCollections, eq(invoiceMerchantCollections.allocationId, invoiceMerchantAllocations.id))
    .where(eq(invoiceMerchantAllocations.invoiceId, invoiceId)).orderBy(invoiceMerchantAllocations.id);
  const charged = await ctx.tx.select({ allocationId: merchantPaymentRoutes.allocationId, amountMinor: payments.amountMinor, refundedMinor: payments.refundedMinor, status: payments.status })
    .from(merchantPaymentRoutes).innerJoin(payments, eq(payments.id, merchantPaymentRoutes.paymentId)).where(eq(payments.invoiceId, invoiceId));
  const bindings = parts.length ? await ctx.tx.select({ allocationId: invoiceMerchantAllocationLines.allocationId, invoiceLineId: invoiceMerchantAllocationLines.invoiceLineId })
    .from(invoiceMerchantAllocationLines).where(inArray(invoiceMerchantAllocationLines.allocationId, parts.map(row => row.allocation.id))) : [];
  return parts.map(({ allocation, collection }) => {
    const paid = charged.filter(row => row.allocationId === allocation.id && row.status === "succeeded");
    const erased = collection.merchantName === ERASED_MERCHANT_NAME;
    return {
      allocationId: allocation.id, merchantName: erased ? null : collection.merchantName, merchantSupport: erased ? null : collection.merchantSupport,
      lineIds: bindings.filter(row => row.allocationId === allocation.id).map(row => row.invoiceLineId),
      subtotalMinor: allocation.subtotalMinor, discountMinor: allocation.discountMinor, shippingMinor: allocation.shippingMinor, taxMinor: allocation.taxMinor, totalMinor: allocation.totalMinor,
      paidMinor: sumMinor(paid.map(row => row.amountMinor), "Original merchant paid balance"),
      refundedMinor: sumMinor(paid.map(row => row.refundedMinor), "Original merchant refunded balance"),
    };
  });
}

export async function publicPaymentMerchant(ctx: ServiceContext, paymentId: string) {
  const [collection] = await ctx.tx.select({ merchantName: invoiceMerchantCollections.merchantName, merchantSupport: invoiceMerchantCollections.merchantSupport })
    .from(merchantPaymentRoutes).innerJoin(invoiceMerchantCollections, eq(invoiceMerchantCollections.allocationId, merchantPaymentRoutes.allocationId)).where(eq(merchantPaymentRoutes.paymentId, paymentId));
  if (!collection) return null;
  return {
    issuerIsMerchant: true,
    issuerName: collection.merchantName === ERASED_MERCHANT_NAME ? null : collection.merchantName,
    issuerSupport: collection.merchantName === ERASED_MERCHANT_NAME ? null : collection.merchantSupport,
  };
}
