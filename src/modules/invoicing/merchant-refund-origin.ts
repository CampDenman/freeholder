// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: an original cash receipt can exist before a local invoice or payment.
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ServiceError, type ServiceContext } from "@/core/service";
import { subscriptionProviderChargeObservations, subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import { routingForPayment } from "./merchant-charge";
import { merchantPaymentObservations } from "./merchant-collection-schema";
import { payments } from "./schema";

export const merchantRefundSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("payment"), paymentId: z.uuid(), observationId: z.uuid().optional() }),
  z.object({ kind: z.literal("subscription"), receiptId: z.uuid(), observationId: z.uuid() }),
]);
export type MerchantRefundSource = z.infer<typeof merchantRefundSource>;
export type MerchantRefundCashOrigin = {
  paymentId: string | null; originalObservationId: string | null;
  subscriptionChargeReceiptId: string | null; subscriptionChargeObservationId: string | null;
  providerPlatformAccountId: string; chargeAccountId: string | null;
  providerApiVersion: "2026-02-25.clover" | "2026-10-28.endive";
  providerRef: string; amountMinor: number; currency: string; applied: boolean;
  originalChargeRef?: string | null; originalFeeRef?: string | null; originalTransferRef?: string | null;
  subscriptionOrigin?: { providerApiVersion: "2026-10-28.endive"; providerSubscriptionRef: string; providerInvoiceRef: string; providerPaymentIntentRef: string };
};

/** Shared with scheduled retention; never acquire a subscription parent after this lock. */
export async function lockMerchantRefundCash(ctx: ServiceContext, cash: Pick<MerchantRefundCashOrigin, "providerPlatformAccountId" | "chargeAccountId" | "providerRef">): Promise<void> {
  await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`subscription-cash:${cash.providerPlatformAccountId}:${cash.chargeAccountId ?? ""}:${cash.providerRef}`}))`);
}

export async function originalMerchantRefundCash(ctx: ServiceContext, source: MerchantRefundSource): Promise<MerchantRefundCashOrigin> {
  if (source.kind === "subscription") {
    const [receipt] = await ctx.tx.select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.id, source.receiptId));
    const [cash] = await ctx.tx.select().from(subscriptionProviderChargeObservations).where(eq(subscriptionProviderChargeObservations.id, source.observationId));
    if (!receipt || !cash || receipt.providerApiVersion !== "2026-10-28.endive" || cash.subscriptionId !== receipt.subscriptionId
      || cash.providerPlatformAccountId !== receipt.providerPlatformAccountId || cash.chargeAccountId !== receipt.chargeAccountId
      || cash.providerApiVersion !== receipt.providerApiVersion || cash.providerSubscriptionRef !== receipt.providerSubscriptionRef
      || cash.providerInvoiceRef !== receipt.providerInvoiceRef || cash.providerPaymentIntentRef !== receipt.providerPaymentIntentRef
      || cash.amountMinor !== receipt.amountMinor || cash.currency !== receipt.currency) throw new ServiceError("conflict", "Restore the exact original subscription cash receipt and observation before returning its money.");
    const routes = await ctx.tx.select({ payment: payments }).from(merchantAgreementPaymentRoutes)
      .innerJoin(payments, eq(payments.id, merchantAgreementPaymentRoutes.paymentId)).where(eq(merchantAgreementPaymentRoutes.originalChargeReceiptId, receipt.id)).limit(2);
    // A route reservation is distinct from actual application. The caller must
    // recheck this result under the cash lock before inserting a return intent.
    const applied = routes.some(({ payment }) => payment.status === "succeeded" && payment.providerRef === cash.providerPaymentIntentRef);
    return { paymentId: null, originalObservationId: null, subscriptionChargeReceiptId: receipt.id, subscriptionChargeObservationId: cash.id,
      providerPlatformAccountId: cash.providerPlatformAccountId, chargeAccountId: cash.chargeAccountId, providerApiVersion: "2026-10-28.endive",
      providerRef: cash.providerPaymentIntentRef, amountMinor: cash.amountMinor, currency: cash.currency, applied, originalChargeRef: receipt.providerChargeRef, originalFeeRef: receipt.applicationFeeRef,
      subscriptionOrigin: { providerApiVersion: "2026-10-28.endive", providerSubscriptionRef: receipt.providerSubscriptionRef,
        providerInvoiceRef: receipt.providerInvoiceRef, providerPaymentIntentRef: receipt.providerPaymentIntentRef } };
  }
  const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, source.paymentId));
  if (!payment || payment.provider !== "stripe") throw new ServiceError("conflict", "Restore the original Stripe payment before returning its cash.");
  const routing = await routingForPayment(ctx, payment.id);
  if (!routing.providerPlatformAccountId) throw new ServiceError("conflict", "Historical money is never silently adopted into the new refund protocol.");
  const [cash] = await ctx.tx.select().from(merchantPaymentObservations).where(and(eq(merchantPaymentObservations.paymentId, payment.id),
    eq(merchantPaymentObservations.status, "succeeded"), source.observationId ? eq(merchantPaymentObservations.id, source.observationId)
      : and(eq(merchantPaymentObservations.providerRef, payment.providerRef ?? ""), eq(merchantPaymentObservations.amountMinor, payment.amountMinor),
        eq(merchantPaymentObservations.currency, payment.currency), eq(merchantPaymentObservations.customerChargeVerified, true))))
    .orderBy(desc(merchantPaymentObservations.observedAt), desc(merchantPaymentObservations.id)).limit(1);
  if (!cash || !/^pi_[A-Za-z0-9_]+$/.test(cash.providerRef)) throw new ServiceError("conflict", "Restore the actual positive original payment observation before returning its money.");
  const applied = payment.status === "succeeded" && payment.providerRef === cash.providerRef && payment.amountMinor === cash.amountMinor && payment.currency === cash.currency;
  if (!source.observationId && (!applied || cash.providerPlatformAccountId !== routing.providerPlatformAccountId || cash.chargeAccountId !== (routing.providerAccountId || null))) throw new ServiceError("conflict", "Use this invoice payment's actual applied cash for its refund.");
  const apiVersion = cash.providerApiVersion ?? routing.providerApiVersion ?? "2026-02-25.clover";
  if (apiVersion !== "2026-02-25.clover" && apiVersion !== "2026-10-28.endive") throw new ServiceError("conflict", "Restore the original provider protocol before refunding this payment.");
  return { paymentId: payment.id, originalObservationId: cash.id, subscriptionChargeReceiptId: null, subscriptionChargeObservationId: null,
    providerPlatformAccountId: cash.providerPlatformAccountId, chargeAccountId: cash.chargeAccountId, providerApiVersion: apiVersion,
    providerRef: cash.providerRef, amountMinor: cash.amountMinor, currency: cash.currency, applied, originalChargeRef: cash.providerChargeRef, originalFeeRef: cash.applicationFeeRef, originalTransferRef: cash.transferRef };
}
