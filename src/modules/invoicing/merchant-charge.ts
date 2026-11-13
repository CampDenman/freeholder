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
import type { MerchantChargeScope } from "@/adapters/payments";
import { invoiceMerchantCollections, merchantPaymentRoutes } from "./merchant-collection-schema";
import { chargeScopeForCollection, reserveCollectionCharge } from "./merchant-collection";
import { invoiceScopedRoutingForPayment, reserveInvoiceScopedCharge } from "./merchant-invoice-scope";
import { agreementRoutingForPayment, reserveAgreementCharge } from "./merchant-agreement-charge";
import { reserveCommercialOfflineRecord } from "./commercial-attestations";
export { registerSubscriptionInvoiceRouting, type SubscriptionInvoiceRouting } from "./merchant-agreement-charge";

export const paymentRouting = z.object({
  moneyOrigin: z.literal("recorded_external").optional(),
  providerApiVersion: z.enum(["2026-02-25.clover", "2026-10-28.endive"]).optional(),
  providerAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200).optional(),
  providerPlatformAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200).optional(),
  destinationAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200).optional(),
  settlementMerchantAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200).optional(),
  merchantAllocationId: z.uuid().optional(),
  invoiceScopeId: z.uuid().optional(),
  agreementSubscriptionId: z.uuid().optional(),
  providerSubscriptionRef: z.string().min(1).max(500).optional(),
  providerInvoiceRef: z.string().min(1).max(500).optional(),
  providerPaymentIntentRef: z.string().min(1).max(500).optional(),
  providerChargeRef: z.string().min(1).max(500).optional(),
  originalChargeReceiptId: z.uuid().optional(),
  applicationFeeMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
});
export const verifiedCheckoutSession = checkoutSession.extend({
  providerAccountId: paymentRouting.shape.providerAccountId,
  providerPlatformAccountId: paymentRouting.shape.providerPlatformAccountId,
  destinationAccountId: paymentRouting.shape.destinationAccountId,
  settlementMerchantAccountId: paymentRouting.shape.settlementMerchantAccountId,
});
type ReservedMerchantCharge = Omit<z.infer<typeof paymentRouting>, "providerAccountId" | "applicationFeeMinor"> & { providerAccountId: string; applicationFeeMinor: number };

export function assertProviderAccount(expected: MerchantChargeScope, actual: MerchantChargeScope): void {
  for (const key of ["providerAccountId", "providerPlatformAccountId", "destinationAccountId", "settlementMerchantAccountId"] as const) {
    if ((expected[key] ?? "") !== (actual[key] ?? "")) throw new ServiceError("conflict", "The provider response does not match the original payment accounts.");
  }
}
export function assertChargeEvidence(expected: z.infer<typeof paymentRouting>, actual: MerchantChargeScope & { applicationFeeMinor?: number; status: string; customerChargeVerified?: boolean }): void {
  if (expected.providerPlatformAccountId) {
    if (expected.providerPlatformAccountId !== actual.providerPlatformAccountId || (expected.providerAccountId ?? "") !== (actual.providerAccountId ?? "")) throw new ServiceError("conflict", "The provider observation belongs to a different original charge namespace.");
    if (actual.status === "succeeded" && actual.customerChargeVerified !== true) throw new ServiceError("conflict", "The positive provider observation needs original charge verification before applying its customer balance.");
    // New physical observations commit independently before this comparison.
    // The actual customer charge remains paid while recipient/fee proof is
    // reconciled separately against the immutable original collection receipt.
    return;
  }
  assertProviderAccount(expected, actual);
  if (expected.providerAccountId && actual.status === "succeeded" && expected.applicationFeeMinor !== actual.applicationFeeMinor) throw new ServiceError("conflict", "The provider application fee does not match the reserved payment.");
}

/** Called while createPayment holds its existing invoice/idempotency locks. */
export async function reserveMerchantCharge(
  ctx: ServiceContext,
  invoice: typeof invoices.$inferSelect,
  request: { provider: string; amountMinor: number; method: string; merchantAllocationId?: string; subscriptionChargeReceiptId?: string },
): Promise<ReservedMerchantCharge> {
  const policy = await ctx.callAsSystem(getInvoiceMarketPolicy, { invoiceId: invoice.id });
  if (policy?.model !== "seller_merchant") return { providerAccountId: "", applicationFeeMinor: 0 };
  if (request.provider === "manual") {
    await reserveCommercialOfflineRecord(ctx, invoice, request);
    return { moneyOrigin: "recorded_external", providerAccountId: "", applicationFeeMinor: 0 };
  }
  if (policy.collectionVersion === 1) {
    const routing = await reserveCollectionCharge(ctx, invoice, request);
    return { ...routing, providerAccountId: routing.providerAccountId ?? "", merchantAllocationId: routing.allocationId };
  }
  const single = await reserveInvoiceScopedCharge(ctx, invoice, request);
  if (single) return { ...single, providerAccountId: single.providerAccountId ?? "" };
  const agreement = await reserveAgreementCharge(ctx, invoice, request);
  if (agreement) return agreement;
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
  const [origin] = await ctx.tx.select({ provider: payments.provider, model: invoiceMarketPolicies.model }).from(payments)
    .leftJoin(invoiceMarketPolicies, eq(invoiceMarketPolicies.invoiceId, payments.invoiceId)).where(eq(payments.id, paymentId)).limit(1);
  if (origin?.provider === "manual" && origin.model === "seller_merchant") return { moneyOrigin: "recorded_external" };
  const [current] = await ctx.tx.select({ version: invoiceMarketPolicies.collectionVersion, route: merchantPaymentRoutes, collection: invoiceMerchantCollections })
    .from(payments).leftJoin(invoiceMarketPolicies, eq(invoiceMarketPolicies.invoiceId, payments.invoiceId))
    .leftJoin(merchantPaymentRoutes, eq(merchantPaymentRoutes.paymentId, payments.id))
    .leftJoin(invoiceMerchantCollections, eq(invoiceMerchantCollections.allocationId, merchantPaymentRoutes.allocationId)).where(eq(payments.id, paymentId));
  if (current?.version === 1) {
    if (!current.route || !current.collection) throw new ServiceError("conflict", "The original per-party payment route needs reconciliation.");
    return paymentRouting.parse({ ...chargeScopeForCollection(current.collection), merchantAllocationId: current.route.allocationId, applicationFeeMinor: current.route.applicationFeeMinor });
  }
  const single = await invoiceScopedRoutingForPayment(ctx, paymentId);
  if (single) return paymentRouting.parse(single);
  const agreement = await agreementRoutingForPayment(ctx, paymentId);
  if (agreement) return paymentRouting.parse(agreement);
  const [payment] = await ctx.tx.select({ providerAccountId: paymentMerchantRoutes.providerAccountId, applicationFeeMinor: paymentMerchantRoutes.applicationFeeMinor, model: invoiceMarketPolicies.model, expectedAccount: invoiceMarketPolicies.providerAccountId })
    .from(payments).leftJoin(paymentMerchantRoutes, eq(paymentMerchantRoutes.paymentId, payments.id))
    .leftJoin(invoiceMarketPolicies, eq(invoiceMarketPolicies.invoiceId, payments.invoiceId)).where(eq(payments.id, paymentId)).limit(1);
  if (!payment) throw new ServiceError("not_found", "That payment is not here.");
  if (payment.model === "seller_merchant" && (!payment.providerAccountId || payment.providerAccountId !== payment.expectedAccount) || payment.providerAccountId && payment.model !== "seller_merchant") throw new ServiceError("conflict", "The original seller payment routing needs reconciliation.");
  return payment.providerAccountId ? paymentRouting.parse(payment) : {};
}
