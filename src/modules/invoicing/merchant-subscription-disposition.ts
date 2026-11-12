// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: original scheduled cash is applied, actually returned, or pending.
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { defineService } from "@/core/service";
import { subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { originalCashReturnedDisposition } from "./merchant-cash-return-service";
import { lockMerchantRefundCash } from "./merchant-refund-origin";
import { merchantRefundRequests } from "./merchant-refund-schema";
import { subscriptionChargeApplication } from "./merchant-subscription-application";
export const subscriptionChargeDisposition = defineService({
  name: "invoicing.subscriptionChargeDisposition", summary: "Read the actual canonical application or complete return of one original scheduled cash receipt.",
  kind: "query", permission: "system", external: false, input: z.object({ receiptId: z.uuid() }),
  output: z.discriminatedUnion("kind", [z.object({ kind: z.literal("applied"), invoiceId: z.uuid(), paymentId: z.uuid() }),
    z.object({ kind: z.literal("returned_unapplied"), returnReceiptId: z.uuid() })]).nullable(),
  handler: async ({ receiptId }, ctx) => {
    const [receipt] = await ctx.tx.select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.id, receiptId));
    if (!receipt) return null;
    await lockMerchantRefundCash(ctx, { ...receipt, providerRef: receipt.providerPaymentIntentRef });
    const [returnedIntent] = await ctx.tx.select({ id: merchantRefundRequests.id }).from(merchantRefundRequests).where(and(
      eq(merchantRefundRequests.providerPlatformAccountId, receipt.providerPlatformAccountId), sql`${merchantRefundRequests.chargeAccountId} is not distinct from ${receipt.chargeAccountId}`,
      eq(merchantRefundRequests.originalPaymentRef, receipt.providerPaymentIntentRef), eq(merchantRefundRequests.purpose, "unapplied_return"))).limit(1);
    const applied = await ctx.callAsSystem(subscriptionChargeApplication, { receiptId });
    if (applied) return returnedIntent ? null : { kind: "applied" as const, ...applied };
    const returned = await originalCashReturnedDisposition(ctx, receiptId);
    return returned ? { kind: "returned_unapplied" as const, ...returned } : null;
  },
});
// Private prototype still requires schema, fee/recipient callers and atomic alternate-
// writer guards qualify. Missing current integration must remain fail-closed.

export default [subscriptionChargeDisposition];
