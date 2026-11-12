// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: exact reviewed terms precede any new invoice or provider admission.
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { defineService, ServiceError } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { quoteOriginalMerchantTerms } from "./merchant-terms-quote";
import { subscriptionMerchantScope } from "./merchant-scope-contract";
import { subscriptionCommercialTerms, subscriptionMarketPolicies, subscriptionMerchantScopes, subscriptions } from "./schema";

const freezeResult = z.object({ recorded: z.boolean(), termsId: z.uuid().nullable() });
export const freezeOriginalMerchantTerms = defineService({
  name: "subscriptions.freezeOriginalMerchantTerms", summary: "Record the reviewed original merchant terms before first invoice or remote billing work.",
  kind: "mutation", permission: "system", external: false, auditInputFields: ["subscriptionId", "acceptedQuoteDigest", "acceptanceSource"],
  auditWhen: (output: z.infer<typeof freezeResult>) => output.recorded,
  input: z.object({ subscriptionId: z.uuid(), acceptedQuoteDigest: z.string().regex(/^[a-f0-9]{64}$/),
    acceptanceSource: z.enum(["public_join", "owner_subscription"]), deferFirstPayment: z.boolean(), locale: z.enum(["en", "es", "fr", "ar"]) }), output: freezeResult,
  handler: async (input, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    const [parent] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, input.subscriptionId)).limit(1).for("update");
    if (!parent) throw new ServiceError("not_found", "The original agreement is unavailable.");
    if (parent.merchantScopeVersion === 0) return { recorded: false, termsId: null };
    const [policy] = await ctx.tx.select().from(subscriptionMarketPolicies).where(eq(subscriptionMarketPolicies.subscriptionId, parent.id)).limit(1);
    if (policy?.model !== "seller_merchant") return { recorded: false, termsId: null };
    const [existing] = await ctx.tx.select().from(subscriptionCommercialTerms).where(and(eq(subscriptionCommercialTerms.subscriptionId, parent.id), eq(subscriptionCommercialTerms.revision, 1))).limit(1).for("update");
    ctx.setSubject("subscription", parent.id);
    if (existing) {
      if (existing.acceptedQuoteDigest !== input.acceptedQuoteDigest) throw new ServiceError("conflict", "This agreement already has different original reviewed terms. Accept an explicit amendment instead.");
      return { recorded: false, termsId: existing.id };
    }
    const [storedScope] = await ctx.tx.select().from(subscriptionMerchantScopes).where(eq(subscriptionMerchantScopes.subscriptionId, parent.id)).limit(1);
    if (!storedScope) throw new ServiceError("conflict", "Restore this agreement's original scope before recording its terms.");
    const original = subscriptionMerchantScope.parse(storedScope);
    if (!original.taxDestination) throw new ServiceError("conflict", "The original destination was erased; a new agreement is required before billing.");
    const quote = await ctx.callAsSystem(quoteOriginalMerchantTerms, { planId: parent.planId, contactId: parent.contactId,
      productVariantId: parent.productVariantId, currency: parent.currency, taxDestination: original.taxDestination,
      paymentMethodId: parent.paymentMethodId ?? undefined, deferFirstPayment: input.deferFirstPayment, locale: input.locale });
    if (!quote || quote.quoteDigest !== input.acceptedQuoteDigest) throw new ServiceError("conflict", "The original price, tax policy or billing notice changed. Review the exact quote again.");
    if (quote.profile.profileId !== original.taxProfileId || quote.profile.profileVersion !== original.taxProfileVersion || quote.profile.liability !== original.taxLiability
      || quote.route.collectionKind !== original.collectionKind || quote.route.providerPlatformAccountId !== original.providerPlatformAccountId
      || quote.route.chargeAccountId !== original.chargeAccountId || quote.route.recipientAccountId !== original.recipientAccountId
      || quote.route.settlementMerchantAccountId !== original.settlementMerchantAccountId || quote.siteFeeBps !== policy.siteFeeBps
      || merchantTaxDigest(quote.taxDestination) !== merchantTaxDigest(original.taxDestination)) throw new ServiceError("conflict", "The reviewed terms differ from this agreement's actual original business and charge scope.");
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_terms_v1','1',true)`);
    const [recorded] = await ctx.tx.insert(subscriptionCommercialTerms).values({ subscriptionId: parent.id, revision: 1, previousTermsId: null,
      snapshot: quote.snapshot, profileId: quote.profile.profileId, profileVersion: quote.profile.profileVersion, taxLiability: quote.profile.liability,
      taxDestination: quote.taxDestination, acceptedQuoteDigest: quote.quoteDigest, initialTaxQuote: quote.initialTaxQuote,
      firstPeriodTaxQuote: quote.firstPeriodTaxQuote, renewalTaxQuote: quote.renewalTaxQuote, noticeDigest: quote.noticeDigest,
      noticeSnapshot: quote.noticeSnapshot, quoteOccurredAt: quote.quoteOccurredAt, effectivePeriodStart: parent.currentPeriodStart,
      acceptedAt: new Date(), acceptanceSource: input.acceptanceSource }).returning({ id: subscriptionCommercialTerms.id });
    return { recorded: true, termsId: recorded!.id };
  },
});
export default [freezeOriginalMerchantTerms];
