// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: canonical cash application and unapplied-return admission are exclusive.
import { and, eq, or, sql } from "drizzle-orm";
import { ServiceError, type ServiceContext } from "@/core/service";
import { subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { lockMerchantRefundCash } from "./merchant-refund-origin";
import { merchantRefundRequests, merchantUnappliedChargeResolutions } from "./merchant-refund-schema";

/** Called before NEW scheduled payment insertion, while the original parent is
 * locked. The same cash lock is retained until the invoice application commits.
 * A logical retry cannot apply money that a committed return intent owns.
 * SQL80 also needs an independently guarded route/payment transition trigger;
 * this service helper by itself does not fence alternate or previous writers.
 */
export async function reserveOriginalSubscriptionCashApplication(ctx: ServiceContext, receiptId: string): Promise<void> {
  const [receipt] = await ctx.tx.select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.id, receiptId));
  if (!receipt) throw new ServiceError("conflict", "Restore the actual original subscription cash receipt before applying its money.");
  await lockMerchantRefundCash(ctx, { ...receipt, providerRef: receipt.providerPaymentIntentRef });
  const cash = and(eq(merchantRefundRequests.providerPlatformAccountId, receipt.providerPlatformAccountId),
    sql`${merchantRefundRequests.chargeAccountId} is not distinct from ${receipt.chargeAccountId}`,
    eq(merchantRefundRequests.originalPaymentRef, receipt.providerPaymentIntentRef));
  const returns = await ctx.tx.select({ id: merchantRefundRequests.id }).from(merchantRefundRequests)
    .where(and(cash, eq(merchantRefundRequests.purpose, "unapplied_return"))).limit(1);
  const resolutions = await ctx.tx.select({ id: merchantUnappliedChargeResolutions.id }).from(merchantUnappliedChargeResolutions)
    .where(or(eq(merchantUnappliedChargeResolutions.subscriptionChargeReceiptId, receiptId), and(
      eq(merchantUnappliedChargeResolutions.providerPlatformAccountId, receipt.providerPlatformAccountId),
      sql`${merchantUnappliedChargeResolutions.chargeAccountId} is not distinct from ${receipt.chargeAccountId}`,
      eq(merchantUnappliedChargeResolutions.originalPaymentRef, receipt.providerPaymentIntentRef)))).limit(1);
  if (returns.length || resolutions.length) throw new ServiceError("conflict", "This original cash is reserved for return or has already been returned; it cannot be credited to an invoice.");
}
// Source-only until financial tables, SQL guards and native race controls qualify.
