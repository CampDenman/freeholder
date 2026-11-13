// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: exact paid invoice, never acceptance alone, permits new access.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ServiceError, type ServiceContext } from "@/core/service";
import { invoiceLines, invoices } from "@/modules/invoicing/schema";
import { getInvoiceMarketPolicy } from "@/modules/invoicing/market-policy";
import { invoiceMerchantTaxQuoteLines, invoiceMerchantTaxQuotes } from "@/modules/invoicing/merchant-tax-schema";
import { admittedProviderPeriod, assertCanonicalProviderPeriod } from "./provider-periods";
import { periodEnd } from "./calendar";
import { subscriptionCommercialTerms, subscriptionMarketPolicies, subscriptions } from "./schema";

export async function assertPaidAmendmentInvoice(ctx: ServiceContext, parent: typeof subscriptions.$inferSelect,
  accepted: typeof subscriptionCommercialTerms.$inferSelect, invoice: typeof invoices.$inferSelect) {
  const start = accepted.effectivePeriodStart, end = periodEnd(start, accepted.snapshot.interval, accepted.snapshot.intervalCount);
  const setup = parent.setupFeeInvoiceId === invoice.id ? parent.acceptedSetupFeeMinor ?? 0 : 0;
  const components = [{ kind: "period", amount: accepted.snapshot.periodAmountMinor }, ...(setup > 0 ? [{ kind: "setup", amount: setup }] : [])];
  const lines = await ctx.tx.select({ line: invoiceLines, quoteId: invoiceMerchantTaxQuoteLines.quoteId }).from(invoiceLines)
    .leftJoin(invoiceMerchantTaxQuoteLines, eq(invoiceMerchantTaxQuoteLines.invoiceLineId, invoiceLines.id))
    .where(eq(invoiceLines.invoiceId, invoice.id)).orderBy(invoiceLines.position).limit(3);
  const taxes = await ctx.tx.select().from(invoiceMerchantTaxQuotes).where(eq(invoiceMerchantTaxQuotes.invoiceId, invoice.id)).limit(2);
  const [original] = await ctx.tx.select().from(subscriptionMarketPolicies).where(eq(subscriptionMarketPolicies.subscriptionId, parent.id)).limit(1);
  const fee = await ctx.callAsSystem(getInvoiceMarketPolicy, { invoiceId: invoice.id });
  const tax = taxes[0];
  if (invoice.contactId !== parent.contactId || invoice.currency !== parent.currency || !invoice.issuedAt || invoice.status !== "paid"
    || invoice.paidMinor !== invoice.totalMinor || invoice.refundedMinor !== 0 || invoice.sourceType !== "subscription" || invoice.sourceId !== `${parent.id}:${start.toISOString()}`
    || invoice.shippingMinor !== 0 || invoice.discountMinor !== 0 || invoice.subtotalMinor !== components.reduce((sum, item) => sum + item.amount, 0)
    || parent.acceptedSetupFeeMinor && !parent.setupFeeInvoiceId || lines.length !== components.length || taxes.length !== 1 || !tax
    || tax.profileId !== accepted.profileId || tax.profileVersion !== accepted.profileVersion || tax.liability !== accepted.taxLiability
    || tax.occurredAt.getTime() !== start.getTime() || tax.shippingMinor !== 0 || tax.shippingTaxMinor !== 0 || tax.taxMinor !== invoice.taxMinor
    || !original || !fee || fee.model !== original.model || fee.sellerUserId !== original.sellerUserId || fee.siteFeeBps !== original.siteFeeBps
    || fee.providerAccountId !== original.providerAccountId || fee.merchantContactId !== original.merchantContactId
    || lines.reduce((sum, value) => sum + value.line.taxMinor, 0) !== invoice.taxMinor
    || lines.some(({ line, quoteId }, index) => {
      const item = components[index]!, proof = z.record(z.string(), z.unknown()).safeParse(line.snapshot);
      return quoteId !== tax.id || !proof.success || line.sourceType !== "subscription" || line.sourceId !== parent.id
        || line.quantityMicros !== 1000000 || line.unitAmountMinor !== item.amount || line.subtotalMinor !== item.amount || line.discountMinor !== 0
        || line.taxCategoryCode !== accepted.snapshot.taxCategoryCode || proof.data.subscriptionTermsId !== accepted.id
        || proof.data.subscriptionPeriodStart !== start.toISOString() || proof.data.subscriptionPeriodEnd !== end.toISOString() || proof.data.subscriptionComponent !== item.kind;
    })) throw new ServiceError("conflict", "The paid amendment invoice must reproduce this exact accepted period, original net/setup obligation, dated tax and shared merchant policy.");
  if (parent.billingMode === "provider") {
    const phase = await admittedProviderPeriod(ctx, parent, accepted.id, start, end);
    if (!phase) throw new ServiceError("conflict", "Retain the actual admitted future phase before granting this paid amendment.");
    await assertCanonicalProviderPeriod(ctx, invoice.id, phase);
  }
}
