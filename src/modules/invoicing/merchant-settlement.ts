// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: direct seller earnings describe money already delivered, never a transfer due.
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { defineService, ServiceError } from "@/core/service";
import { getInvoiceMarketPolicy } from "./market-policy";
import { invoiceMerchantAllocationLines, invoiceMerchantAllocations, invoices, paymentDisputes, paymentMerchantRoutes, payments } from "./schema";
import { invoiceMerchantCollections, merchantPaymentRoutes } from "./merchant-collection-schema";
import { merchantPaymentRecoveryDebt } from "./merchant-payment-debt";

export const merchantSettlement = defineService({
  name: "invoicing.merchantSettlement", summary: "Verify original-account settlement before recording a directly paid seller's earnings.",
  kind: "query", permission: "system", external: false,
  input: z.object({ invoiceId:z.uuid(),sellerUserId:z.uuid() }),
  output: z.object({ state:z.enum(["paid","review","cancelled"]),reference:z.string(),paidAt:z.date(), lineFees:z.array(z.object({invoiceLineId:z.uuid(),revenueMinor:z.number().int().nonnegative(),feeMinor:z.number().int().nonnegative()})).optional() }),
  handler: async ({invoiceId,sellerUserId},ctx) => {
    const policy = await ctx.callAsSystem(getInvoiceMarketPolicy,{invoiceId});
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id,invoiceId)).limit(1);
    const unproven = () => new ServiceError("conflict","The original seller payment needs reconciliation before recording earnings.");
    if (!policy || policy.model!=="seller_merchant" || !invoice?.paidAt || !["paid","refunded"].includes(invoice.status) || invoice.paidMinor!==invoice.totalMinor || !Number.isSafeInteger(invoice.totalMinor)) throw unproven();
    if (policy.collectionVersion === 1) {
      // Each new original portion owns its own charge. Whole-invoice totals,
      // another seller's capture and today's payout account cannot prove it.
      const [original] = await ctx.tx.select({ allocation: invoiceMerchantAllocations, collection: invoiceMerchantCollections })
        .from(invoiceMerchantAllocations).innerJoin(invoiceMerchantCollections, eq(invoiceMerchantCollections.allocationId, invoiceMerchantAllocations.id))
        .where(and(eq(invoiceMerchantAllocations.invoiceId, invoiceId), eq(invoiceMerchantAllocations.sellerUserId, sellerUserId))).limit(1);
      if (!original || original.collection.invoiceId !== invoiceId || original.collection.collectionKind === "platform"
        || [original.allocation.totalMinor,original.allocation.revenueMinor,original.allocation.feeMinor].some(value=>!Number.isSafeInteger(value)||value<0)
        || original.allocation.feeMinor>original.allocation.revenueMinor) throw unproven();
      const captured = await ctx.tx.select({ payment: payments, route: merchantPaymentRoutes }).from(merchantPaymentRoutes)
        .innerJoin(payments, eq(payments.id, merchantPaymentRoutes.paymentId)).where(eq(merchantPaymentRoutes.allocationId, original.allocation.id));
      let amount = 0n, fee = 0n, returned = 0n, review = false;
      for (const { payment, route } of captured) {
        if (payment.invoiceId !== invoiceId || payment.provider !== "stripe" || payment.currency !== invoice.currency
          || !Number.isSafeInteger(payment.amountMinor) || payment.amountMinor <= 0 || !Number.isSafeInteger(payment.refundedMinor)
          || payment.refundedMinor < 0 || payment.refundedMinor > payment.amountMinor || !Number.isSafeInteger(route.applicationFeeMinor)
          || route.applicationFeeMinor < 0 || route.applicationFeeMinor > payment.amountMinor) throw unproven();
        const debt = await ctx.callAsSystem(merchantPaymentRecoveryDebt, { paymentId: payment.id });
        review ||= debt.pending;
        if (payment.status !== "succeeded") continue;
        if (!payment.providerRef?.startsWith("pi_")) throw unproven();
        amount += BigInt(payment.amountMinor); fee += BigInt(route.applicationFeeMinor); returned += BigInt(payment.refundedMinor);
      }
      if (amount !== BigInt(original.allocation.totalMinor) || fee !== BigInt(original.allocation.feeMinor)) throw unproven();
      // A partially returned balance always needs an explicit earnings decision.
      // Missing refund/reversal/commission proof keeps the row in review.
      const lineFees = await ctx.tx.select({invoiceLineId:invoiceMerchantAllocationLines.invoiceLineId,revenueMinor:invoiceMerchantAllocationLines.revenueMinor,feeMinor:invoiceMerchantAllocationLines.feeMinor})
        .from(invoiceMerchantAllocationLines).where(eq(invoiceMerchantAllocationLines.allocationId,original.allocation.id));
      if (lineFees.reduce((sum,line)=>sum+BigInt(line.revenueMinor),0n)!==BigInt(original.allocation.revenueMinor)
        || lineFees.reduce((sum,line)=>sum+BigInt(line.feeMinor),0n)!==BigInt(original.allocation.feeMinor)) throw unproven();
      const fullyReturned = amount > 0n && returned === amount;
      return { state: review || (returned > 0n && !fullyReturned) ? "review" as const : fullyReturned ? "cancelled" as const : "paid" as const,
        reference: amount===0n ? `invoice-zero:${original.allocation.id}` : `stripe-${original.collection.collectionKind}:${original.allocation.id}`, paidAt: invoice.paidAt, lineFees };
    }
    if (policy.sellerUserId !== sellerUserId || !policy.providerAccountId) throw unproven();
    const captured = await ctx.tx.select({payment:payments,route:paymentMerchantRoutes}).from(payments)
      .leftJoin(paymentMerchantRoutes,eq(paymentMerchantRoutes.paymentId,payments.id))
      .where(and(eq(payments.invoiceId,invoiceId),eq(payments.status,"succeeded")));
    for(const {payment,route} of captured) {
      if(payment.provider!=="stripe" || !payment.providerRef?.startsWith("pi_") || payment.currency!==invoice.currency || !Number.isSafeInteger(payment.amountMinor) || payment.amountMinor<=0 || !route || route.providerAccountId!==policy.providerAccountId || !Number.isSafeInteger(route.applicationFeeMinor) || route.applicationFeeMinor<0 || route.applicationFeeMinor>=payment.amountMinor) throw unproven();
    }
    const total = captured.reduce((sum,{payment})=>sum+BigInt(payment.amountMinor),0n);
    const fee = captured.reduce((sum,{route})=>sum+BigInt(route!.applicationFeeMinor),0n);
    if(total!==BigInt(invoice.totalMinor) || fee!==BigInt(policy.feeMinor)) throw unproven();
    const disputes = await ctx.tx.select({id:paymentDisputes.id}).from(paymentDisputes).where(and(eq(paymentDisputes.invoiceId,invoiceId),inArray(paymentDisputes.status,["open","lost"]))).limit(1);
    return {state:invoice.refundedMinor>=invoice.totalMinor && invoice.totalMinor>0 ? "cancelled" as const : invoice.refundedMinor>0 || disputes.length ? "review" as const : "paid" as const,reference:`stripe-direct:${invoice.id}`,paidAt:invoice.paidAt};
  },
});

export default [merchantSettlement];
