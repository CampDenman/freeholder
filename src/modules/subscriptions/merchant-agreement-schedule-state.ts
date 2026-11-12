// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: one original agreement's physical and money proof is shared by privacy consumers.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getService, type ServiceContext } from "@/core/service";
import { invoiceMerchantTaxQuoteLines, invoiceMerchantTaxQuotes } from "@/modules/invoicing/merchant-tax-schema";
import { invoiceLines, invoices } from "@/modules/invoicing/schema";
import { merchantAgreementPaymentRoutes } from "@/modules/invoicing/merchant-agreement-schema";
import { subscriptionProviderScheduleOperations } from "./provider-schedule-schema";
import type { subscriptionProviderScheduleResources } from "./provider-schedule-schema";
import { scheduleQuiescenceCovers } from "./provider-schedule-proof";
import { subscriptionProviderChargeObservations, subscriptionProviderChargeReceipts } from "./schema";
import type { subscriptionMerchantScopes, subscriptions } from "./schema";
const application = z.object({ invoiceId: z.uuid(), paymentId: z.uuid() }).nullable();

/** Shared exact-agreement proof; callers decide which original buyers belong
 * to their operation. No provider I/O or local-status shortcut is introduced. */
export async function merchantAgreementScheduleState(ctx:ServiceContext,agreement:{
  subscription:typeof subscriptions.$inferSelect;scope:typeof subscriptionMerchantScopes.$inferSelect;
  resource:typeof subscriptionProviderScheduleResources.$inferSelect|null;
}):Promise<{safe:boolean;external:boolean}>{
  let external=false;
    const routes = await ctx.tx.select().from(merchantAgreementPaymentRoutes).where(eq(merchantAgreementPaymentRoutes.subscriptionId, agreement.subscription.id)).limit(5001);
    if (routes.length > 5000) return { safe: false, external: true };
    if (routes.length) external = true;
    for (const route of routes) {
      if (route.providerPlatformAccountId !== agreement.scope.providerPlatformAccountId || route.chargeAccountId !== agreement.scope.chargeAccountId
        || route.recipientAccountId !== agreement.scope.recipientAccountId || route.settlementMerchantAccountId !== agreement.scope.settlementMerchantAccountId) return { safe: false, external: true };
      const debt = getService("invoicing.merchantPaymentRecoveryDebt");
      if (!debt || z.object({ pending: z.boolean() }).passthrough().parse(await ctx.callAsSystem(debt, { paymentId: route.paymentId })).pending) return { safe: false, external: true };
    }
    const operations = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.subscriptionId, agreement.subscription.id)).orderBy(subscriptionProviderScheduleOperations.operationRevision).limit(5001);
    const receipts = await ctx.tx.select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId, agreement.subscription.id)).orderBy(subscriptionProviderChargeReceipts.id).limit(5001);
    const observations = await ctx.tx.select().from(subscriptionProviderChargeObservations).where(eq(subscriptionProviderChargeObservations.subscriptionId, agreement.subscription.id)).orderBy(subscriptionProviderChargeObservations.id).limit(5001);
    if (!agreement.resource || operations.length > 5000 || receipts.length > 5000 || observations.length > 5000) return { safe: false, external: true };
    const neverAdmitted = agreement.resource.state === "uncreated" && agreement.resource.operationRevision === 0
      && !agreement.resource.providerSubscriptionRef && !agreement.resource.providerCustomerRef && !agreement.subscription.providerRef
      && !operations.length && !receipts.length && !observations.length;
    if (neverAdmitted) return { safe: true, external };
    external = true;
    if (!scheduleQuiescenceCovers(agreement.resource, operations)) return { safe: false, external };
    for (const resource of agreement.resource.stoppedProof!.resources) for (const invoice of resource.invoices) {
      if (!invoice.zeroTotalInvoiceId) continue;
      const [zero] = await ctx.tx.select().from(invoices).where(eq(invoices.id, invoice.zeroTotalInvoiceId)).limit(1);
      if (!zero || zero.sourceType !== "subscription" || zero.sourceId?.split(":")[0] !== agreement.subscription.id
        || zero.currency !== agreement.subscription.currency || zero.totalMinor !== 0 || zero.paidMinor !== 0 || zero.status !== "paid") return { safe: false, external };
      const [quote] = await ctx.tx.select().from(invoiceMerchantTaxQuotes).where(and(eq(invoiceMerchantTaxQuotes.invoiceId, zero.id),
        eq(invoiceMerchantTaxQuotes.profileId, agreement.scope.taxProfileId), eq(invoiceMerchantTaxQuotes.profileVersion, agreement.scope.taxProfileVersion))).limit(1);
      const lines = await ctx.tx.select({ quoteId: invoiceMerchantTaxQuoteLines.quoteId }).from(invoiceLines)
        .leftJoin(invoiceMerchantTaxQuoteLines, eq(invoiceMerchantTaxQuoteLines.invoiceLineId, invoiceLines.id)).where(eq(invoiceLines.invoiceId, zero.id));
      if (!quote || !quote.evidenceDigest || !lines.length || lines.some(line => line.quoteId !== quote.id)) return { safe: false, external };
    }
    const coverage = agreement.resource.stoppedProof!.resources.flatMap(resource => resource.invoices.flatMap(invoice => invoice.paid.map(paid => ({ ...paid, providerSubscriptionRef: resource.providerSubscriptionRef, providerInvoiceRef: invoice.providerInvoiceRef }))));
    if (coverage.length !== receipts.length) return { safe: false, external };
    for (const observation of observations) {
      const receipt = receipts.find(row => row.providerPaymentIntentRef === observation.providerPaymentIntentRef);
      if (!receipt || receipt.providerPlatformAccountId !== observation.providerPlatformAccountId || receipt.chargeAccountId !== observation.chargeAccountId
        || receipt.providerSubscriptionRef !== observation.providerSubscriptionRef || receipt.providerInvoiceRef !== observation.providerInvoiceRef
        || (observation.providerChargeRef !== null && receipt.providerChargeRef !== observation.providerChargeRef) || receipt.amountMinor !== observation.amountMinor || receipt.currency !== observation.currency) return { safe: false, external };
    }
    for (const receipt of receipts) {
      if (!observations.some(observation => observation.providerPaymentIntentRef === receipt.providerPaymentIntentRef && observation.customerChargeVerified)) return { safe: false, external };
      const covered = coverage.find(row => row.receiptId === receipt.id);
      if (!covered || covered.providerSubscriptionRef !== receipt.providerSubscriptionRef || covered.providerInvoiceRef !== receipt.providerInvoiceRef || covered.providerPaymentIntentRef !== receipt.providerPaymentIntentRef) return { safe: false, external };
      const prove = getService("invoicing.subscriptionChargeApplication"), debt = getService("invoicing.merchantPaymentRecoveryDebt");
      if (!prove || !debt) return { safe: false, external };
      const applied = application.parse(await ctx.callAsSystem(prove, { receiptId: receipt.id }));
      if (!applied || applied.invoiceId !== covered.invoiceId || applied.paymentId !== covered.paymentId) return { safe: false, external };
      const financial = z.object({ pending: z.boolean() }).passthrough().parse(await ctx.callAsSystem(debt, { paymentId: applied.paymentId }));
      if (financial.pending) return { safe: false, external };
    }
  return {safe:true,external};
}

