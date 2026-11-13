// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: original server prices and declared public merchant consent.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { publicMerchantSupport } from "@/core/commerce/merchant-identity";
import { bookingCommercialPrice, bookingCommercialSelection } from "@/core/scheduling/commercial-quote";
import { bookingTaxDestination } from "@/core/scheduling/commercial-policy";
import { bookingCommercialSources, bookings } from "@/core/scheduling/schema";
import { contacts } from "@/core/contacts/schema";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { defineService, ServiceError } from "@/core/service";
import { quoteBookingCommercialSource } from "@/modules/catalog/booking-commercial-source";
import { serviceOfferings, products } from "@/modules/catalog/schema";
import { getMerchantCollectionConfiguration } from "@/modules/invoicing/merchant-collection";
import { currentMerchantTaxProfile } from "@/modules/invoicing/merchant-tax";
import { previewMerchantTax, merchantTaxPreviewOutput } from "@/modules/invoicing/merchant-tax-preview";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { policyForSellers } from "./market-merchant";
import { bookingMarketPolicies, bookingMerchantScopes } from "./booking-merchant-schema";

export const bookingMerchantQuote = z.object({
  price: bookingCommercialPrice, sellerUserId: z.uuid(), merchantName: z.string(), merchantSupport: publicMerchantSupport,
  collectionKind: z.enum(["direct", "destination"]), providerPlatformAccountId: z.string(), recipientAccountId: z.string(),
  profileId: z.uuid(), profileVersion: z.number().int().positive(), tax: merchantTaxPreviewOutput,
  commercialQuoteDigest: z.string().regex(/^[a-f0-9]{64}$/),
});

export function bookingCommercialConsentDigest(input: {
  offeringId: string; sellerUserId: string; merchantName: string; merchantSupport: z.infer<typeof publicMerchantSupport>;
  collectionKind: "direct" | "destination"; providerPlatformAccountId: string; recipientAccountId: string;
  siteFeeBps: number; price: z.infer<typeof bookingCommercialPrice>; taxQuoteDigest: string;
}): string {
  return merchantTaxDigest({ version: 1, ...input });
}

export const quoteBookingMerchantTerms = defineService({
  name: "members.quoteBookingMerchantTerms", summary: "Quote an actual new member service's public business, original price and declared tax before consent.",
  kind: "query", permission: "system", external: false,
  input: bookingCommercialSelection.extend({ offeringId: z.uuid(), contactId: z.uuid().nullable(), seats: z.number().int().min(1).max(1000), destination: bookingTaxDestination.optional() }),
  output: bookingMerchantQuote.nullable(),
  handler: async (input, ctx) => {
    const [source] = await ctx.tx.select({ sellerUserId: products.sellerUserId }).from(serviceOfferings)
      .innerJoin(products, eq(products.id, serviceOfferings.productId)).where(eq(serviceOfferings.id, input.offeringId)).for("share");
    if (!source?.sellerUserId) return null;
    const policy = await policyForSellers([source.sellerUserId], false, ctx);
    if (policy.model !== "seller_merchant") return null;
    if (!input.destination) throw new ServiceError("validation", "Choose your billing country and required tax location before accepting this service's price.");
    const configuration = await ctx.callAsSystem(getMerchantCollectionConfiguration, {});
    const profile = await ctx.callAsSystem(currentMerchantTaxProfile, { sellerUserId: source.sellerUserId });
    if (!configuration || !policy.providerAccountId || !policy.merchantName || !policy.merchantSupport || profile.liability !== "seller") throw new ServiceError("conflict", "The original merchant needs their explicit payment, public business and tax policy before accepting a new booking.");
    const price = await ctx.callAsSystem(quoteBookingCommercialSource, { offeringId: input.offeringId, expectedSellerUserId: source.sellerUserId, contactId: input.contactId, seats: input.seats, currency: input.currency, mode: input.mode });
    const tax = await ctx.callAsSystem(previewMerchantTax, { profileId: profile.profileId, profileVersion: profile.profileVersion, contactId: input.contactId, destination: input.destination, currency: price.currency,
      items: [{ id: "line:0", quantityMicros: 1000000, unitAmountMinor: price.baseAmountMinor, discountMinor: 0, category: price.taxCategoryCode, requiresShipping: false }], shippingMinor: 0 });
    if (tax.sellerUserId !== source.sellerUserId) throw new ServiceError("conflict", "The booking tax quote belongs to another business.");
    const commercialQuoteDigest = bookingCommercialConsentDigest({ offeringId: input.offeringId, sellerUserId: source.sellerUserId, merchantName: policy.merchantName, merchantSupport: policy.merchantSupport, collectionKind: configuration.collectionKind, providerPlatformAccountId: configuration.providerPlatformAccountId, recipientAccountId: policy.providerAccountId, siteFeeBps: policy.siteFeeBps, price, taxQuoteDigest: tax.quoteDigest });
    return { price, sellerUserId: source.sellerUserId, merchantName: policy.merchantName, merchantSupport: policy.merchantSupport, collectionKind: configuration.collectionKind, providerPlatformAccountId: configuration.providerPlatformAccountId, recipientAccountId: policy.providerAccountId, profileId: profile.profileId, profileVersion: profile.profileVersion, tax, commercialQuoteDigest };
  },
});
export const quoteOriginalBookingMerchantTerms = defineService({
  name: "members.quoteOriginalBookingMerchantTerms", summary: "Quote a booking's original accepted business and current original product price without rebinding its merchant.",
  kind: "query", permission: "system", external: false,
  input: bookingCommercialSelection.extend({ bookingId: z.uuid(), destination: bookingTaxDestination }), output: bookingMerchantQuote,
  handler: async (input, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    const [original] = await ctx.tx.select({ booking: bookings, source: bookingCommercialSources, scope: bookingMerchantScopes, policy: bookingMarketPolicies })
      .from(bookings).innerJoin(bookingCommercialSources, eq(bookingCommercialSources.bookingId, bookings.id))
      .innerJoin(bookingMerchantScopes, eq(bookingMerchantScopes.bookingId, bookings.id))
      .innerJoin(bookingMarketPolicies, eq(bookingMarketPolicies.bookingId, bookings.id)).where(eq(bookings.id, input.bookingId));
    const [buyer] = original ? await ctx.tx.select({ source: contacts.source }).from(contacts).where(eq(contacts.id, original.booking.contactId)) : [];
    if (!original || original.booking.marketPolicyVersion !== 1 || !buyer || buyer.source === "privacy-erasure" || original.scope.destinationErasedAt || original.scope.merchantIdentityErasedAt || !original.scope.merchantSupport) throw new ServiceError("conflict", "The booking's original buyer or business needs recovery before a new quote.");
    const { booking, source, scope, policy } = original;
    const price = scope.commercialPrice ? bookingCommercialPrice.parse(scope.commercialPrice) : await ctx.callAsSystem(quoteBookingCommercialSource, { offeringId: source.serviceOfferingId, expectedSellerUserId: scope.sellerUserId, contactId: booking.contactId, seats: booking.capacityUsed, currency: input.currency, mode: input.mode });
    if (price.currency !== input.currency || price.mode !== input.mode || price.seats !== booking.capacityUsed) throw new ServiceError("conflict", "The selected money terms differ from this booking's accepted original quote.");
    const tax = await ctx.callAsSystem(previewMerchantTax, { profileId: scope.taxProfileId, profileVersion: scope.taxProfileVersion, contactId: booking.contactId, destination: input.destination, currency: price.currency, ...(scope.taxOccurredAt ? { occurredAt: scope.taxOccurredAt } : {}),
      items: [{ id: "line:0", quantityMicros: 1000000, unitAmountMinor: price.baseAmountMinor, discountMinor: 0, category: price.taxCategoryCode, requiresShipping: false }], shippingMinor: 0 });
    if (tax.sellerUserId !== scope.sellerUserId) throw new ServiceError("conflict", "The booking's tax business does not match its original owner.");
    const commercialQuoteDigest = bookingCommercialConsentDigest({ offeringId: source.serviceOfferingId, sellerUserId: scope.sellerUserId, merchantName: scope.merchantName, merchantSupport: scope.merchantSupport!, collectionKind: scope.collectionKind, providerPlatformAccountId: scope.providerPlatformAccountId, recipientAccountId: scope.recipientAccountId, siteFeeBps: policy.siteFeeBps, price, taxQuoteDigest: tax.quoteDigest });
    return { price, sellerUserId: scope.sellerUserId, merchantName: scope.merchantName, merchantSupport: scope.merchantSupport!, collectionKind: scope.collectionKind, providerPlatformAccountId: scope.providerPlatformAccountId, recipientAccountId: scope.recipientAccountId, profileId: scope.taxProfileId, profileVersion: scope.taxProfileVersion, tax, commercialQuoteDigest };
  },
});
export default [quoteBookingMerchantTerms, quoteOriginalBookingMerchantTerms];
