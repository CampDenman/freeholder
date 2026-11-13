// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: schedule quiescence reads real applied money, never inferred success.
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { defineService, ServiceError } from "@/core/service";
import { subscriptionMerchantScopes, subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import { merchantPaymentObservations } from "./merchant-collection-schema";
import { assertNoUnappliedMerchantCharge } from "./merchant-payment-observations";
import { invoiceMerchantTaxQuoteLines, invoiceMerchantTaxQuotes } from "./merchant-tax-schema";
import { invoiceLines, invoiceMarketPolicies, invoices, payments } from "./schema";

export const subscriptionChargeApplication = defineService({
  name: "invoicing.subscriptionChargeApplication", summary: "Verify that one exact original subscription cash receipt became a succeeded payment with its canonical frozen invoice tax.",
  kind: "query", permission: "system", external: false, input: z.object({ receiptId: z.uuid() }), output: z.object({ invoiceId: z.uuid(), paymentId: z.uuid() }).nullable(),
  handler: async ({ receiptId }, ctx) => {
    const matches = await ctx.tx.select({ receipt: subscriptionProviderChargeReceipts, scope: subscriptionMerchantScopes, route: merchantAgreementPaymentRoutes, payment: payments, invoice: invoices, policy: invoiceMarketPolicies })
      .from(subscriptionProviderChargeReceipts).innerJoin(subscriptionMerchantScopes, eq(subscriptionMerchantScopes.subscriptionId, subscriptionProviderChargeReceipts.subscriptionId))
      .innerJoin(merchantAgreementPaymentRoutes, eq(merchantAgreementPaymentRoutes.originalChargeReceiptId, subscriptionProviderChargeReceipts.id))
      .innerJoin(payments, eq(payments.id, merchantAgreementPaymentRoutes.paymentId)).innerJoin(invoices, eq(invoices.id, payments.invoiceId))
      .innerJoin(invoiceMarketPolicies, eq(invoiceMarketPolicies.invoiceId, invoices.id)).where(eq(subscriptionProviderChargeReceipts.id, receiptId)).limit(2);
    const source = matches.length === 1 ? matches[0] : undefined;
    if (!source) return null;
    const { receipt, scope, route, payment, invoice, policy } = source;
    if (payment.status !== "succeeded" || payment.provider !== "stripe" || payment.method !== "provider_schedule" || payment.amountMinor !== receipt.amountMinor || payment.currency !== receipt.currency || payment.providerRef !== receipt.providerPaymentIntentRef
      || invoice.sourceType !== "subscription" || invoice.sourceId?.split(":")[0] !== receipt.subscriptionId || invoice.currency !== receipt.currency
      || route.originKind !== "provider_schedule" || route.subscriptionId !== receipt.subscriptionId || route.providerApiVersion !== receipt.providerApiVersion || route.providerApiVersion !== scope.providerScheduleApiVersion
      || route.providerSubscriptionRef !== receipt.providerSubscriptionRef || route.providerInvoiceRef !== receipt.providerInvoiceRef || route.providerPaymentIntentRef !== receipt.providerPaymentIntentRef || route.providerChargeRef !== receipt.providerChargeRef
      || route.providerPlatformAccountId !== receipt.providerPlatformAccountId || route.chargeAccountId !== receipt.chargeAccountId
      || route.providerPlatformAccountId !== scope.providerPlatformAccountId || route.chargeAccountId !== scope.chargeAccountId || route.recipientAccountId !== scope.recipientAccountId || route.settlementMerchantAccountId !== scope.settlementMerchantAccountId
      || policy.model !== "seller_merchant" || policy.collectionVersion !== 0 || !policy.sellerUserId || policy.providerAccountId !== scope.recipientAccountId) return null;
    const [quote] = await ctx.tx.select().from(invoiceMerchantTaxQuotes).where(and(eq(invoiceMerchantTaxQuotes.invoiceId, invoice.id), eq(invoiceMerchantTaxQuotes.sellerUserId, policy.sellerUserId)));
    if (!quote || quote.profileId !== scope.taxProfileId || quote.liability !== scope.taxLiability || !quote.evidenceDigest) return null;
    const lines = await ctx.tx.select({ id: invoiceLines.id, quoteId: invoiceMerchantTaxQuoteLines.quoteId }).from(invoiceLines)
      .leftJoin(invoiceMerchantTaxQuoteLines, eq(invoiceMerchantTaxQuoteLines.invoiceLineId, invoiceLines.id)).where(eq(invoiceLines.invoiceId, invoice.id));
    if (!lines.length || lines.some(line => line.quoteId !== quote.id)) return null;
    try { await assertNoUnappliedMerchantCharge(ctx, invoice.id); }
    catch (error) { if (error instanceof ServiceError && error.code === "conflict") return null; throw error; }
    const proof = await ctx.tx.select({ id: merchantPaymentObservations.id }).from(merchantPaymentObservations).where(and(
      eq(merchantPaymentObservations.paymentId, payment.id), eq(merchantPaymentObservations.status, "succeeded"), eq(merchantPaymentObservations.providerRef, receipt.providerPaymentIntentRef),
      eq(merchantPaymentObservations.providerPlatformAccountId, receipt.providerPlatformAccountId), receipt.chargeAccountId ? eq(merchantPaymentObservations.chargeAccountId, receipt.chargeAccountId) : isNull(merchantPaymentObservations.chargeAccountId),
      eq(merchantPaymentObservations.amountMinor, receipt.amountMinor), eq(merchantPaymentObservations.currency, receipt.currency), eq(merchantPaymentObservations.customerChargeVerified, true))).limit(1);
    return proof.length ? { invoiceId: invoice.id, paymentId: payment.id } : null;
  },
});
export default [subscriptionChargeApplication];
