// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: buyer input cannot choose a seller account or application fee.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { paymentAdapter } from "@/adapters/payments";
import { ServiceError, type ServiceContext } from "@/core/service";
import { getInvoiceMarketPolicy, verifyInvoiceMerchant } from "./market-policy";
import { type invoices, invoiceMarketPolicies, payments, paymentMerchantRoutes } from "./schema";
import { checkoutSession } from "./contract";

export const paymentRouting = z.object({
  providerAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200).optional(),
  applicationFeeMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
});
export const verifiedCheckoutSession = checkoutSession.extend({ providerAccountId: paymentRouting.shape.providerAccountId });

export function assertProviderAccount(expected: { providerAccountId?: string }, actual: { providerAccountId?: string }): void {
  if ((expected.providerAccountId ?? "") !== (actual.providerAccountId ?? "")) throw new ServiceError("conflict", "The provider response does not match the original payment account.");
}
export function assertChargeEvidence(expected: z.infer<typeof paymentRouting>, actual: { providerAccountId?: string; applicationFeeMinor?: number; status: string }): void {
  assertProviderAccount(expected, actual);
  if (expected.providerAccountId && actual.status === "succeeded" && expected.applicationFeeMinor !== actual.applicationFeeMinor) throw new ServiceError("conflict", "The provider application fee does not match the reserved payment.");
}

/** Called while createPayment holds its existing invoice/idempotency locks. */
export async function reserveMerchantCharge(
  ctx: ServiceContext,
  invoice: typeof invoices.$inferSelect,
  request: { provider: string; amountMinor: number; method: string },
): Promise<{ providerAccountId: string; applicationFeeMinor: number }> {
  const policy = await ctx.callAsSystem(getInvoiceMarketPolicy, { invoiceId: invoice.id });
  if (policy?.model !== "seller_merchant") return { providerAccountId: "", applicationFeeMinor: 0 };
  if (request.provider !== "stripe" || !paymentAdapter(request.provider).capabilities().sellerMerchantCharges || !policy.providerAccountId) throw new ServiceError("conflict", "This seller invoice requires Stripe direct checkout.");
  if (!["hosted_checkout", "saved_method", "provider_schedule"].includes(request.method)) throw new ServiceError("conflict", "Use the seller's online payment flow for this invoice.");
  if (request.method === "provider_schedule") {
    // Reconciliation records a charge that already happened on an immutable
    // agreement. Disabling a seller must not erase authenticated money.
    // Only core system reconciliation may use this recording path.
    if (ctx.actor.kind !== "system") throw new ServiceError("permission", "Seller schedule payments require authenticated provider reconciliation.");
  } else await verifyInvoiceMerchant(invoice.id, ctx);
  const previous = await ctx.tx.select({ payment: payments, fee: paymentMerchantRoutes.applicationFeeMinor }).from(payments)
    .leftJoin(paymentMerchantRoutes, eq(paymentMerchantRoutes.paymentId, payments.id)).where(eq(payments.invoiceId, invoice.id));
  if (previous.some(({ payment }) => ["created", "processing"].includes(payment.status))) throw new ServiceError("conflict", "An existing seller payment needs reconciliation before another attempt.");
  const chargedFee = previous.filter(({ payment }) => payment.status === "succeeded").reduce((total, row) => total + (row.fee ?? 0), 0);
  const targetFee = Number(BigInt(policy.feeMinor) * BigInt(invoice.paidMinor + request.amountMinor) / BigInt(invoice.totalMinor));
  const applicationFeeMinor = targetFee - chargedFee;
  if (!Number.isSafeInteger(applicationFeeMinor) || applicationFeeMinor < 0 || applicationFeeMinor >= request.amountMinor) throw new ServiceError("validation", "This payment is too small for its remaining application fee. Review the payment schedule.");
  return { providerAccountId: policy.providerAccountId, applicationFeeMinor };
}

/** Internal claim/apply services return this only to their provider caller. */
export async function routingForPayment(ctx: ServiceContext, paymentId: string): Promise<z.infer<typeof paymentRouting>> {
  const [payment] = await ctx.tx.select({ providerAccountId: paymentMerchantRoutes.providerAccountId, applicationFeeMinor: paymentMerchantRoutes.applicationFeeMinor, model: invoiceMarketPolicies.model, expectedAccount: invoiceMarketPolicies.providerAccountId })
    .from(payments).leftJoin(paymentMerchantRoutes, eq(paymentMerchantRoutes.paymentId, payments.id))
    .leftJoin(invoiceMarketPolicies, eq(invoiceMarketPolicies.invoiceId, payments.invoiceId)).where(eq(payments.id, paymentId)).limit(1);
  if (!payment) throw new ServiceError("not_found", "That payment is not here.");
  if (payment.model === "seller_merchant" && (!payment.providerAccountId || payment.providerAccountId !== payment.expectedAccount) || payment.providerAccountId && payment.model !== "seller_merchant") throw new ServiceError("conflict", "The original seller payment routing needs reconciliation.");
  return payment.providerAccountId ? paymentRouting.parse(payment) : {};
}
