// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: every new merchant refund reservation captures its original POST once.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { stripeMerchantRefundBody } from "@/adapters/payments/stripe-merchant-refund-body";
import { ServiceError, type ServiceContext } from "@/core/service";
import { routingForPayment } from "./merchant-charge";
import { lockMerchantRefundCash, originalMerchantRefundCash } from "./merchant-refund-origin";
import { merchantRefundRequests, type MerchantRefundProviderArguments } from "./merchant-refund-schema";
import { merchantTaxDigest } from "./merchant-tax-store";
import type { payments, refunds } from "./schema";

/** Runs in createRefund's existing payment/idempotency transaction. Prepared
 * return batches therefore get the same provenance as a direct owner refund.
 * A pre-existing reservation is not retroactively adopted here.
 */
export async function captureOriginalMerchantRefund(ctx: ServiceContext, payment: typeof payments.$inferSelect, refund: typeof refunds.$inferSelect): Promise<void> {
  const routing = await routingForPayment(ctx, payment.id);
  if (!routing.providerPlatformAccountId) return; // Existing original legacy policy.
  if (payment.provider !== "stripe" || payment.status !== "succeeded" || refund.paymentId !== payment.id || refund.status !== "created" || refund.providerRef) throw new ServiceError("conflict", "Capture a new reservation's exact original merchant cash before dispatch.");
  const [existing] = await ctx.tx.select().from(merchantRefundRequests).where(eq(merchantRefundRequests.refundId, refund.id));
  if (existing) throw new ServiceError("conflict", "This original merchant refund request has already been captured; restore its immutable receipt rather than replacing it.");
  const cash = await originalMerchantRefundCash(ctx, { kind: "payment", paymentId: payment.id });
  await lockMerchantRefundCash(ctx, cash);
  if (!cash.applied || refund.currency !== cash.currency || refund.amountMinor > cash.amountMinor) throw new ServiceError("conflict", "The original applied payment does not cover this refund reservation.");
  const id = randomUUID(), originalRequest: MerchantRefundProviderArguments = {
    refundAttemptId: id, paymentId: payment.id, providerRef: cash.providerRef, providerPlatformAccountId: cash.providerPlatformAccountId,
    ...(cash.chargeAccountId ? { providerAccountId: cash.chargeAccountId } : {}), providerApiVersion: cash.providerApiVersion,
    currency: cash.currency, amountMinor: refund.amountMinor, idempotencyKey: `freeholder-merchant-refund:${id}`, reverseTransfer: false, refundApplicationFee: false,
    frozenBody: stripeMerchantRefundBody({ refundAttemptId: id, paymentId: payment.id, paymentProviderRef: cash.providerRef,
      amountMinor: refund.amountMinor, providerPlatformAccountId: cash.providerPlatformAccountId }),
  };
  await ctx.tx.insert(merchantRefundRequests).values({ id, purpose: "invoice_refund", refundId: refund.id, paymentId: payment.id,
    originalObservationId: cash.originalObservationId, subscriptionChargeReceiptId: null, subscriptionChargeObservationId: null,
    providerPlatformAccountId: cash.providerPlatformAccountId, chargeAccountId: cash.chargeAccountId, providerApiVersion: cash.providerApiVersion,
    originalPaymentRef: cash.providerRef, originalCashAmountMinor: cash.amountMinor, amountMinor: refund.amountMinor, currency: cash.currency,
    idempotencyKey: refund.idempotencyKey, reasonDigest: merchantTaxDigest(refund.reason), originalRequest, requestDigest: merchantTaxDigest(originalRequest) });
}
// The isolated shared-core hook is pending fresh-schema/native qualification;
// no existing reservation is silently backfilled.
