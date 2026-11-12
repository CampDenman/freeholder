// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: the real agreement owns invoice amounts, business and tax date.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { invoiceLines, invoices } from "@/modules/invoicing/schema";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { merchantTaxSourceParty, merchantTaxSourceRequest, registerMerchantTaxSourceResolver } from "@/modules/invoicing/merchant-tax-invoice";
import { periodEnd } from "./calendar";
import { originalMerchantTerms } from "./merchant-terms-read";
import { subscriptionMarketPolicies, subscriptions } from "./schema";

type Subscription = typeof subscriptions.$inferSelect;

export async function originalMerchantInvoiceShape(ctx: ServiceContext, subscription: Subscription, start: Date, end: Date) {
  const terms = await originalMerchantTerms(ctx, subscription, start);
  if (!terms) return null;
  const sourceId = `${subscription.id}:${start.toISOString()}`;
  const [existing] = await ctx.tx.select().from(invoices).where(and(eq(invoices.sourceType, "subscription"), eq(invoices.sourceId, sourceId))).limit(1);
  if (existing) {
    const lines = await ctx.tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, existing.id)).orderBy(invoiceLines.position).limit(3);
    if (existing.currency !== subscription.currency || existing.contactId !== subscription.contactId || existing.status === "void"
      || lines.length < 1 || lines.length > 2 || lines.some(line => {
        const proof = line.snapshot as Record<string, unknown>;
        return proof.subscriptionTermsId !== terms.id || proof.subscriptionPeriodStart !== start.toISOString()
          || proof.subscriptionPeriodEnd !== end.toISOString() || !["period", "setup"].includes(String(proof.subscriptionComponent));
      })) throw new ServiceError("conflict", "Restore the original frozen period invoice and its accepted commercial lineage before replay.");
    return { terms, sourceId, existingInvoiceId: existing.id, periodAmountMinor: 0, setupFeeMinor: 0 };
  }
  const first = start.getTime() === subscription.currentPeriodStart.getTime();
  const next = start.getTime() === subscription.currentPeriodEnd.getTime();
  const expectedEnd = first ? subscription.currentPeriodEnd : periodEnd(start, terms.snapshot.interval, terms.snapshot.intervalCount);
  if ((!first && !next) || end.getTime() !== expectedEnd.getTime()) {
    throw new ServiceError("conflict", "The invoice is not the agreement's actual original or next accepted calendar period.");
  }
  const awaitingCard = first && subscription.signupPending && terms.snapshot.trialDays > 0 && terms.snapshot.trialRequiresCard && !subscription.trialEndsAt;
  if (first && subscription.status === "trialing") throw new ServiceError("conflict", "A free trial cannot acquire an unaccepted paid period invoice.");
  let setupFeeMinor = subscription.acceptedSetupFeeMinor ?? 0;
  if (subscription.setupFeeInvoiceId) {
    const [original] = await ctx.tx.select({ sourceType: invoices.sourceType, sourceId: invoices.sourceId, status: invoices.status })
      .from(invoices).where(eq(invoices.id, subscription.setupFeeInvoiceId)).limit(1);
    if (!original || original.sourceType !== "subscription" || original.sourceId?.split(":")[0] !== subscription.id || original.status === "void") {
      throw new ServiceError("conflict", "Review the actual original setup-fee invoice before billing another period.");
    }
    setupFeeMinor = original.sourceId === sourceId ? setupFeeMinor : 0;
  }
  return { terms, sourceId, existingInvoiceId: null, periodAmountMinor: awaitingCard ? 0 : terms.snapshot.periodAmountMinor, setupFeeMinor };
}

export const resolveOriginalMerchantInvoice = defineService({
  name: "subscriptions.resolveOriginalMerchantInvoice", summary: "Prove a new invoice against its accepted original agreement and actual period before freezing tax.",
  kind: "query", permission: "system", external: false, input: merchantTaxSourceRequest, output: z.array(merchantTaxSourceParty).length(1),
  handler: async (input, ctx) => {
    const id = input.sourceId?.split(":")[0], parsedId = z.uuid().safeParse(id);
    if (input.sourceType !== "subscription" || !parsedId.success || !input.sourceId) throw new ServiceError("conflict", "This tax source is not an original subscription invoice.");
    const encodedStart = input.sourceId.slice(parsedId.data.length + 1), start = new Date(encodedStart);
    if (!Number.isFinite(start.getTime()) || start.toISOString() !== encodedStart) throw new ServiceError("conflict", "The original invoice period date is invalid.");
    const [subscription] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, parsedId.data)).limit(1).for("share");
    if (!subscription || subscription.contactId !== input.contactId || subscription.currency !== input.currency) throw new ServiceError("conflict", "The invoice does not belong to this original buyer and currency.");
    const terms = await originalMerchantTerms(ctx, subscription, start);
    if (!terms?.taxDestination || merchantTaxDigest(terms.taxDestination) !== merchantTaxDigest(input.destination) || input.shippingMinor !== 0) {
      throw new ServiceError("conflict", "The original agreement's declared tax destination or freight cannot be proved.");
    }
    const end = start.getTime() === subscription.currentPeriodStart.getTime() ? subscription.currentPeriodEnd : periodEnd(start, terms.snapshot.interval, terms.snapshot.intervalCount);
    const shape = await originalMerchantInvoiceShape(ctx, subscription, start, end);
    if (!shape || shape.existingInvoiceId) throw new ServiceError("conflict", "Read the already-frozen original invoice rather than quoting it again.");
    const components = [{ kind: "period", amountMinor: shape.periodAmountMinor }, ...(shape.setupFeeMinor > 0 ? [{ kind: "setup", amountMinor: shape.setupFeeMinor }] : [])];
    if (input.lines.length !== components.length || input.lines.some((line, index) => {
      const component = components[index]!, proof = line.snapshot;
      return line.sourceType !== "subscription" || line.sourceId !== subscription.id || line.quantityMicros !== 1000000
        || line.unitAmountMinor !== component.amountMinor || line.discountMinor !== 0 || line.taxCategoryCode !== terms.snapshot.taxCategoryCode
        || line.requiresShipping !== terms.snapshot.requiresShipping || proof.subscriptionTermsId !== terms.id
        || proof.subscriptionPeriodStart !== start.toISOString() || proof.subscriptionPeriodEnd !== end.toISOString() || proof.subscriptionComponent !== component.kind;
    })) throw new ServiceError("conflict", "The invoice lines differ from this period's accepted original agreement.");
    const [policy] = await ctx.tx.select().from(subscriptionMarketPolicies).where(eq(subscriptionMarketPolicies.subscriptionId, subscription.id)).limit(1);
    if (policy?.model !== "seller_merchant" || !policy.sellerUserId) throw new ServiceError("conflict", "Restore the original agreement's seller identity before quoting tax.");
    return [{ sellerUserId: policy.sellerUserId, profileId: terms.profileId, profileVersion: terms.profileVersion,
      linePositions: components.map((_, index) => index), shippingMinor: 0, occurredAt: start,
      ...(terms.revision === 1 && start.getTime() === terms.effectivePeriodStart.getTime() ? { expectedQuoteDigest: terms.initialTaxQuote.quoteDigest } : {}) }];
  },
});

registerMerchantTaxSourceResolver("subscription", (input, ctx) => ctx.callAsSystem(resolveOriginalMerchantInvoice, input));
export default [resolveOriginalMerchantInvoice];
