// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: direct seller earnings describe money already delivered, never a transfer due.
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { defineService, ServiceError } from "@/core/service";
import { getInvoiceMarketPolicy } from "./market-policy";
import { invoices, paymentDisputes, paymentMerchantRoutes, payments } from "./schema";

export const merchantSettlement = defineService({
  name: "invoicing.merchantSettlement", summary: "Verify original-account settlement before recording a directly paid seller's earnings.",
  kind: "query", permission: "system", external: false,
  input: z.object({ invoiceId:z.uuid(),sellerUserId:z.uuid() }),
  output: z.object({ state:z.enum(["paid","review","cancelled"]),reference:z.string(),paidAt:z.date() }),
  handler: async ({invoiceId,sellerUserId},ctx) => {
    const policy = await ctx.callAsSystem(getInvoiceMarketPolicy,{invoiceId});
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id,invoiceId)).limit(1);
    const unproven = () => new ServiceError("conflict","The original seller payment needs reconciliation before recording earnings.");
    if (!policy || policy.model!=="seller_merchant" || policy.sellerUserId!==sellerUserId || !policy.providerAccountId || !invoice?.paidAt || !["paid","refunded"].includes(invoice.status) || invoice.paidMinor!==invoice.totalMinor || !Number.isSafeInteger(invoice.totalMinor)) throw unproven();
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
