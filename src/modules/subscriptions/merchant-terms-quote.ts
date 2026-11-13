// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: quote original commercial terms before accepting or billing them.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { subscriptionMerchantScope } from "./merchant-scope-contract";
import { subscriptionMerchantScopes, subscriptionMarketPolicies, subscriptions } from "./schema";
import { invoices } from "@/modules/invoicing/schema";
import { publicMerchantSupport } from "@/core/commerce/merchant-identity";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { contacts } from "@/core/contacts/schema";
import { translator } from "@/core/i18n";
import { defineService, getService, ServiceError } from "@/core/service";
import { getBusiness } from "@/core/settings/service";
import { resolvePrice } from "@/modules/catalog/pricing";
import { products, productVariants } from "@/modules/catalog/schema";
import { getMerchantCollectionConfiguration } from "@/modules/invoicing/merchant-collection";
import { merchantTaxPreviewOutput, previewMerchantTax } from "@/modules/invoicing/merchant-tax-preview";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { paymentMethods, taxCategories } from "@/modules/invoicing/schema";
import { resolveSubscriptionPlanMarketPolicy } from "./market-policy";
import { subscriptionTaxDestination } from "./merchant-scope-contract";
import { initialMerchantInvoiceAmounts, subscriptionCommercialSnapshot, subscriptionInitialTaxQuote } from "./merchant-terms-contract";
import { plans } from "./schema";
import { periodEnd } from "./calendar";

const account = z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200);
const profileReceipt = z.object({ profileId: z.uuid(), profileVersion: z.number().int().positive(), liability: z.enum(["platform", "seller"]) });
export const merchantTermsQuoteInput = z.object({ planId: z.uuid(), contactId: z.uuid(), productVariantId: z.uuid().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(), taxDestination: subscriptionTaxDestination,
  paymentMethodId: z.uuid().optional(), deferFirstPayment: z.boolean().default(false), locale: z.enum(["en", "es", "fr", "ar"]).default("en") }).strict();
export const merchantTermsQuoteOutput = z.object({ planId: z.uuid(), contactId: z.uuid(), snapshot: subscriptionCommercialSnapshot,
  issuer: z.object({ name: z.string(), support: publicMerchantSupport.nullable() }),
  profile: profileReceipt,
  siteFeeBps: z.number().int().min(0).max(10000),
  route: z.object({ collectionKind: z.enum(["direct", "destination"]), providerPlatformAccountId: account, chargeAccountId: account.nullable(),
    recipientAccountId: account, settlementMerchantAccountId: account }),
  taxDestination: subscriptionTaxDestination,
  initialTaxQuote: subscriptionInitialTaxQuote, firstPeriodTaxQuote: subscriptionInitialTaxQuote, renewalTaxQuote: subscriptionInitialTaxQuote,
  quoteOccurredAt: z.date(), quoteDigest: z.string().regex(/^[a-f0-9]{64}$/), noticeDigest: z.string().regex(/^[a-f0-9]{64}$/),
  noticeSnapshot: z.object({ locale: z.enum(["en", "es", "fr", "ar"]), text: z.string().min(1) }),
}).nullable();
export const publicMerchantTermsQuote = merchantTermsQuoteOutput.unwrap().pick({ planId: true, snapshot: true, issuer: true,
  initialTaxQuote: true, firstPeriodTaxQuote: true, renewalTaxQuote: true, quoteDigest: true, noticeDigest: true, noticeSnapshot: true }).nullable();

/** Internal quote contains private routing. Customer projections must select
 * only public supplier details, commercial amounts and opaque consent digests. */
export const quoteOriginalMerchantTerms = defineService({
  name: "subscriptions.quoteOriginalMerchantTerms", summary: "Quote the actual new agreement's original price, declared business and exact first invoice before consent.",
  kind: "query", permission: "system", external: false, input: merchantTermsQuoteInput.extend({ calendarStart: z.date().optional(), amendmentFor: z.uuid().optional() }), output: merchantTermsQuoteOutput,
  handler: async (input, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    const [buyer] = await ctx.tx.select({ source: contacts.source }).from(contacts).where(eq(contacts.id, input.contactId)).limit(1);
    if (!buyer || buyer.source === "privacy-erasure") throw new ServiceError("conflict", "The buyer is no longer available for a new agreement quote.");
    const [found] = await ctx.tx.select({ plan: plans, product: products, variant: productVariants, category: taxCategories }).from(plans)
      .innerJoin(products, eq(products.id, plans.productId)).innerJoin(productVariants, and(eq(productVariants.productId, products.id),
        input.productVariantId ? eq(productVariants.id, input.productVariantId) : eq(productVariants.isDefault, true)))
      .leftJoin(taxCategories, eq(taxCategories.id, products.taxCategoryId)).where(eq(plans.id, input.planId)).limit(1).for("share", { of: plans });
    if (!found || found.plan.status !== "active" || found.product.status !== "active" || found.variant.status !== "active") throw new ServiceError("conflict", "This plan is not available for a new agreement.");
    const policy = await resolveSubscriptionPlanMarketPolicy(ctx, found.plan.id);
    if (policy?.model !== "seller_merchant") return null;
    if (!policy.sellerUserId || !policy.providerAccountId || !policy.merchantName || !policy.merchantSupport) throw new ServiceError("conflict", "This original merchant needs verified public identity, support and collection details.");
    const configuration = await ctx.callAsSystem(getMerchantCollectionConfiguration, {});
    if (!configuration) throw new ServiceError("conflict", "Verify the original collection platform before quoting this merchant plan.");
    const currentProfile = getService("invoicing.currentMerchantTaxProfile");
    if (!currentProfile) throw new ServiceError("conflict", "The original declared merchant tax policy is unavailable.");
    const profile = profileReceipt.parse(await ctx.callAsSystem(currentProfile, { sellerUserId: policy.sellerUserId }));
    if (profile.liability !== "seller") throw new ServiceError("conflict", "This merchant quote needs its deliberately declared seller tax policy.");
    const currency = input.currency ?? (await ctx.callAsSystem(getBusiness, {}))?.baseCurrency;
    if (!currency) throw new ServiceError("conflict", "Set the agreement's currency before quoting it.");
    const price = await ctx.callAsSystem(resolvePrice, { variantId: found.variant.id, contactId: input.contactId, currency, quantity: 1 });
    if (!price.available || price.amountMinor === undefined) throw new ServiceError("conflict", "This plan has no available original price in the chosen currency.");
    if (found.product.taxCategoryId && (!found.category || !found.category.active)) throw new ServiceError("conflict", "Review the original product tax category before quoting a new agreement.");
    let snapshot = subscriptionCommercialSnapshot.parse({ version: 1, name: found.plan.name, description: found.product.subtitle,
      productVariantId: found.variant.id, taxCategoryCode: found.category?.code ?? "standard", requiresShipping: found.variant.requiresShipping,
      currency, periodAmountMinor: price.amountMinor, setupFeeMinor: found.plan.setupFeeMinor, interval: found.plan.interval, intervalCount: found.plan.intervalCount,
      trialDays: found.plan.trialDays, trialRequiresCard: found.plan.trialRequiresCard, cancelBehaviour: found.plan.cancelBehaviour,
      proration: found.plan.proration, billingMode: found.plan.billingMode });
    const route = { collectionKind: configuration.collectionKind, providerPlatformAccountId: configuration.providerPlatformAccountId,
      chargeAccountId: configuration.collectionKind === "direct" ? policy.providerAccountId : null,
      recipientAccountId: policy.providerAccountId, settlementMerchantAccountId: policy.providerAccountId };
    if (input.amendmentFor) {
      const [parent] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, input.amendmentFor)).limit(1).for("share");
      const [scopeRow] = await ctx.tx.select().from(subscriptionMerchantScopes).where(eq(subscriptionMerchantScopes.subscriptionId, input.amendmentFor)).limit(1).for("share");
      const [originalPolicy] = await ctx.tx.select().from(subscriptionMarketPolicies).where(eq(subscriptionMarketPolicies.subscriptionId, input.amendmentFor)).limit(1).for("share");
      if (!parent || !scopeRow || !originalPolicy || parent.merchantScopeVersion !== 1 || parent.contactId !== input.contactId || parent.currency !== currency || parent.billingMode !== snapshot.billingMode
        || !input.calendarStart || input.calendarStart.getTime() < parent.currentPeriodEnd.getTime()
        || input.calendarStart.getTime() > parent.currentPeriodEnd.getTime() && input.calendarStart.getTime() <= Date.now()) throw new ServiceError("conflict", "Review an amendment for this original buyer, billing protocol and exact next period.");
      const original = subscriptionMerchantScope.parse(scopeRow);
      if (originalPolicy.sellerUserId !== policy.sellerUserId || originalPolicy.siteFeeBps !== policy.siteFeeBps || profile.profileId !== original.taxProfileId || profile.liability !== original.taxLiability
        || merchantTaxDigest(route) !== merchantTaxDigest({ collectionKind: original.collectionKind, providerPlatformAccountId: original.providerPlatformAccountId, chargeAccountId: original.chargeAccountId,
          recipientAccountId: original.recipientAccountId, settlementMerchantAccountId: original.settlementMerchantAccountId })) throw new ServiceError("conflict", "A different original merchant, fee contract or charge namespace requires a new agreement.");
      let outstandingSetup = parent.acceptedSetupFeeMinor ?? 0;
      if (parent.setupFeeInvoiceId) {
        const [setup] = await ctx.tx.select().from(invoices).where(eq(invoices.id, parent.setupFeeInvoiceId)).limit(1).for("share");
        if (!setup || setup.sourceType !== "subscription" || setup.sourceId?.split(":")[0] !== parent.id || setup.status === "void") throw new ServiceError("conflict", "Resolve the original setup obligation before amending this agreement.");
        outstandingSetup = 0;
      }
      snapshot = subscriptionCommercialSnapshot.parse({ ...snapshot, setupFeeMinor: outstandingSetup, trialDays: 0, trialRequiresCard: false });
    }
    let hasSavedMethod = false;
    if (input.paymentMethodId && snapshot.billingMode !== "manual") {
      const [method] = await ctx.tx.select().from(paymentMethods).where(eq(paymentMethods.id, input.paymentMethodId)).limit(1);
      if (!method || method.contactId !== input.contactId || method.status !== "active" || method.provider !== "stripe" || method.consentSource !== "provider_checkout"
        || method.providerPlatformAccountId !== route.providerPlatformAccountId || method.providerAccountId !== (route.chargeAccountId ?? "")) throw new ServiceError("conflict", "The saved method does not belong to this buyer's original platform and charge account.");
      hasSavedMethod = true;
    }
    const phase = initialMerchantInvoiceAmounts(snapshot, { deferFirstPayment: input.deferFirstPayment, hasSavedMethod });
    if (phase.awaitingCard && snapshot.billingMode === "manual") throw new ServiceError("conflict", "This manual-billing plan cannot start a card-required trial.");
    const occurredAt = new Date();
    const quote = async (periodAmountMinor: number, setupFeeMinor: number, taxOccurredAt: Date) => {
      const items = [{ id: "line:0", quantityMicros: 1000000, unitAmountMinor: periodAmountMinor, discountMinor: 0,
        category: snapshot.taxCategoryCode, requiresShipping: snapshot.requiresShipping }];
      if (setupFeeMinor > 0) items.push({ ...items[0]!, id: "line:1", unitAmountMinor: setupFeeMinor });
      const actual = merchantTaxPreviewOutput.parse(await ctx.callAsSystem(previewMerchantTax, { profileId: profile.profileId, profileVersion: profile.profileVersion,
        contactId: input.contactId, destination: input.taxDestination, currency, items, shippingMinor: 0, occurredAt: taxOccurredAt }));
      return subscriptionInitialTaxQuote.parse({ quoteDigest: actual.quoteDigest, subtotalMinor: actual.amounts.subtotalMinor,
        taxMinor: actual.amounts.taxMinor, totalMinor: actual.amounts.totalMinor });
    };
    // A currently valid exemption can already have a known expiry before the
    // accepted trial ends. Use the same UTC calendar as the actual agreement,
    // rather than pricing every future obligation on today's tax date.
    const calendarStart = input.calendarStart ?? occurredAt;
    const firstPaidAt = phase.trialing ? periodEnd(calendarStart, "day", snapshot.trialDays) : calendarStart;
    const renewalAt = periodEnd(firstPaidAt, snapshot.interval, snapshot.intervalCount);
    const initialTaxQuote = await quote(phase.periodAmountMinor, phase.setupFeeMinor, input.amendmentFor ? calendarStart : occurredAt), firstPeriodTaxQuote = await quote(snapshot.periodAmountMinor,
      snapshot.trialDays > 0 ? phase.firstPaidSetupFeeMinor : snapshot.setupFeeMinor, firstPaidAt), renewalTaxQuote = await quote(snapshot.periodAmountMinor, 0, renewalAt);
    const issuer = { name: policy.merchantName, support: policy.merchantSupport ?? null };
    const noticeSnapshot = { locale: input.locale, text: translator(input.locale)("subscriptions.merchantTermsNotice") };
    const noticeDigest = merchantTaxDigest({ version: 1, snapshot, issuer, initialTaxQuote, firstPeriodTaxQuote, renewalTaxQuote, noticeSnapshot });
    const quoteDigest = merchantTaxDigest({ version: 1, kind: "subscription-commercial-terms", contactId: input.contactId, planId: input.planId,
      snapshot, issuer, profile, route, siteFeeBps: policy.siteFeeBps, taxDestination: input.taxDestination, date: occurredAt.toISOString().slice(0, 10),
      initialTaxQuote, firstPeriodTaxQuote, renewalTaxQuote, noticeDigest });
    return { planId: input.planId, contactId: input.contactId, snapshot, issuer, profile, route, siteFeeBps: policy.siteFeeBps, taxDestination: input.taxDestination,
      initialTaxQuote, firstPeriodTaxQuote, renewalTaxQuote, quoteOccurredAt: occurredAt, quoteDigest, noticeDigest, noticeSnapshot };
  },
});
export const quoteNewAgreement = defineService({
  name: "subscriptions.quoteNewAgreement", summary: "Review a new agreement's actual commercial quote before accepting it for the selected contact.",
  kind: "query", permission: "scoped", input: merchantTermsQuoteInput, output: publicMerchantTermsQuote,
  handler: async (input, ctx) => publicMerchantTermsQuote.parse(await ctx.callAsSystem(quoteOriginalMerchantTerms, input)),
});
export default [quoteOriginalMerchantTerms, quoteNewAgreement];
