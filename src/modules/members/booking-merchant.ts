// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Same-transaction booking ownership, policy and original account admission.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { contacts } from "@/core/contacts/schema";
import { bookingTaxDestination, registerBookingCommercialCapture } from "@/core/scheduling/commercial-policy";
import { bookingCommercialSelection } from "@/core/scheduling/commercial-quote";
import { bookingCommercialPrice } from "@/core/scheduling/commercial-quote";
import { bookingCommercialSources, bookings } from "@/core/scheduling/schema";
import { defineService, ServiceError } from "@/core/service";
import { invoiceMerchantScopeReceipt, registerInvoiceMerchantScopeResolver } from "@/modules/invoicing/merchant-invoice-scope";
import { invoiceMarketPolicies, invoices } from "@/modules/invoicing/schema";
import { currentMerchantTaxProfile, getInvoiceMerchantTaxReceipt } from "@/modules/invoicing/merchant-tax";
import { getMerchantCollectionConfiguration } from "@/modules/invoicing/merchant-collection";
import { merchantTaxSourceParty, merchantTaxSourceRequest, registerMerchantTaxSourceResolver } from "@/modules/invoicing/merchant-tax-invoice";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptionMarketPolicy } from "@/modules/subscriptions/market-policy";
import { bookingMarketPolicies, bookingMerchantScopes } from "./booking-merchant-schema";
import { policyForSellers } from "./market-merchant";
import { quoteBookingMerchantTerms, quoteOriginalBookingMerchantTerms } from "./booking-merchant-quote";

const taxProfile = z.object({ profileId: z.uuid(), profileVersion: z.number().int().positive(), liability: z.enum(["platform", "seller"]) });
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const captureBookingMarketPolicy = defineService({
  name: "members.captureBookingMarketPolicy", summary: "Freeze the actual original member offering and account when its booking is accepted.",
  kind: "mutation", permission: "system", external: false, writeClass: "money",
  input: z.object({ bookingId: z.uuid(), rescheduledFromId: z.uuid().optional(), taxDestination: bookingTaxDestination.optional(), taxQuoteDigest: digest.optional(), commercialQuoteDigest: digest.optional(), commercialSelection: bookingCommercialSelection.optional() }),
  output: z.object({ captured: z.boolean() }),
  handler: async (input, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    const [booking] = await ctx.tx.select().from(bookings).where(eq(bookings.id, input.bookingId));
    if (!booking || booking.marketPolicyVersion === 0) return { captured: false };
    const [source] = await ctx.tx.select().from(bookingCommercialSources).where(eq(bookingCommercialSources.bookingId, booking.id));
    if (!source?.sellerUserId) return { captured: false };
    const [existing] = await ctx.tx.select().from(bookingMarketPolicies).where(eq(bookingMarketPolicies.bookingId, booking.id));
    if (existing) return { captured: true };
    if (input.rescheduledFromId) {
      const [original] = await ctx.tx.select().from(bookingMarketPolicies).where(eq(bookingMarketPolicies.bookingId, input.rescheduledFromId));
      if (!original || original.sellerUserId !== source.sellerUserId) throw new ServiceError("conflict", "Restore this appointment's original member policy before rescheduling.");
      const { bookingId: _oldBooking, createdAt: _oldCreatedAt, ...policy } = original;
      await ctx.tx.insert(bookingMarketPolicies).values({ bookingId: booking.id, ...policy });
      const [scope] = await ctx.tx.select().from(bookingMerchantScopes).where(eq(bookingMerchantScopes.bookingId, original.bookingId));
      if (original.model === "seller_merchant" && !scope) throw new ServiceError("conflict", "The original appointment's merchant scope is missing.");
      if (scope) {
        const { bookingId: _oldScopeBooking, createdAt: _oldScopeCreatedAt, ...frozen } = scope;
        await ctx.tx.insert(bookingMerchantScopes).values({ bookingId: booking.id, ...frozen });
      }
      return { captured: true };
    }
    const policy = await policyForSellers([source.sellerUserId], false, ctx);
    const [owner] = await ctx.tx.select({ id: contacts.id, source: contacts.source }).from(contacts).where(eq(contacts.userId, source.sellerUserId));
    if (!owner || owner.source === "privacy-erasure") throw new ServiceError("conflict", "The original member needs their active unified contact before a commercial appointment is accepted.");
    await ctx.tx.insert(bookingMarketPolicies).values({ bookingId: booking.id, ...policy, sellerUserId: source.sellerUserId, merchantContactId: owner.id });
    if (policy.model !== "seller_merchant") return { captured: true };
    const configuration = await ctx.callAsSystem(getMerchantCollectionConfiguration, {});
    const parsedProfile = taxProfile.safeParse(await ctx.callAsSystem(currentMerchantTaxProfile, { sellerUserId: source.sellerUserId }));
    if (!parsedProfile.success) throw new ServiceError("conflict", "The original member needs their explicitly configured tax profile before accepting seller collection.");
    const profile = parsedProfile.data;
    if (!configuration || !policy.providerAccountId || !policy.merchantName || !policy.merchantSupport || profile.liability !== "seller") throw new ServiceError("conflict", "Configure the original merchant platform, public identity and declared seller tax responsibility before accepting this booking.");
    const quoted = Boolean(input.taxDestination || input.taxQuoteDigest || input.commercialQuoteDigest || input.commercialSelection);
    if (quoted && (!input.taxDestination || !input.taxQuoteDigest || !input.commercialQuoteDigest || !input.commercialSelection)) throw new ServiceError("validation", "A priced booking needs its declared tax destination, selected currency and both accepted quote digests.");
    const quote = quoted ? await ctx.callAsSystem(quoteBookingMerchantTerms, { offeringId: source.serviceOfferingId, contactId: booking.contactId, seats: booking.capacityUsed, ...input.commercialSelection!, destination: input.taxDestination }) : null;
    if (quoted && (!quote || quote.tax.quoteDigest !== input.taxQuoteDigest || quote.commercialQuoteDigest !== input.commercialQuoteDigest
      || quote.profileId !== profile.profileId || quote.profileVersion !== profile.profileVersion || quote.recipientAccountId !== policy.providerAccountId
      || quote.providerPlatformAccountId !== configuration.providerPlatformAccountId || quote.collectionKind !== configuration.collectionKind)) throw new ServiceError("conflict", "The service price, public business, payment route or tax terms changed. Review the current quote before booking.");
    await ctx.tx.insert(bookingMerchantScopes).values({ bookingId: booking.id, sellerUserId: source.sellerUserId, merchantContactId: owner.id, merchantScopeVersion: 1,
      collectionKind: configuration.collectionKind, providerPlatformAccountId: configuration.providerPlatformAccountId,
      chargeAccountId: configuration.collectionKind === "direct" ? policy.providerAccountId : null,
      recipientAccountId: policy.providerAccountId, settlementMerchantAccountId: policy.providerAccountId,
      merchantName: policy.merchantName, merchantSupport: policy.merchantSupport,
      taxProfileId: profile.profileId, taxProfileVersion: profile.profileVersion, taxLiability: profile.liability,
      taxDestination: input.taxDestination ?? null, quoteDigest: input.taxQuoteDigest ?? null,
      commercialQuoteDigest: quote?.commercialQuoteDigest ?? null, commercialPrice: quote?.price ?? null });
    ctx.setSubject("booking", booking.id);
    return { captured: true };
  },
});
registerBookingCommercialCapture(async (ctx, input) => { await ctx.callAsSystem(captureBookingMarketPolicy, input); });

export const getBookingMarketPolicy = defineService({
  name: "members.bookingMarketPolicy", summary: "Read the original accepted member policy without consulting the current offering owner.",
  kind: "query", permission: "system", external: false, input: z.object({ bookingId: z.uuid() }), output: subscriptionMarketPolicy.nullable(),
  handler: async ({ bookingId }, ctx) => {
    const [policy] = await ctx.tx.select().from(bookingMarketPolicies).where(eq(bookingMarketPolicies.bookingId, bookingId));
    return policy ? subscriptionMarketPolicy.parse(policy) : null;
  },
});

export const completeBookingTaxQuote = defineService({
  name: "members.completeBookingTaxQuote", summary: "Pin the first actual declared tax quote of a new original booking, or compare its accepted quote exactly.",
  kind: "mutation", permission: "system", external: false, writeClass: "money",
  input: bookingCommercialSelection.extend({ bookingId: z.uuid(), destination: bookingTaxDestination, quoteDigest: digest, commercialQuoteDigest: digest }), output: z.object({ pinned: z.literal(true) }),
  handler: async ({ bookingId, destination, quoteDigest, commercialQuoteDigest, currency, mode }, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    const [scope] = await ctx.tx.select().from(bookingMerchantScopes).where(eq(bookingMerchantScopes.bookingId, bookingId)).for("update");
    const [booking] = await ctx.tx.select().from(bookings).where(eq(bookings.id, bookingId));
    const [buyer] = booking ? await ctx.tx.select({ source: contacts.source }).from(contacts).where(eq(contacts.id, booking.contactId)) : [];
    if (!buyer || buyer.source === "privacy-erasure" || !scope || !booking || booking.marketPolicyVersion !== 1 || scope.destinationErasedAt || scope.merchantIdentityErasedAt) throw new ServiceError("conflict", "The original booking's erased or missing tax source cannot authorize new billing.");
    const quote = await ctx.callAsSystem(quoteOriginalBookingMerchantTerms, { bookingId, destination, currency, mode });
    if (quote.tax.quoteDigest !== quoteDigest || quote.commercialQuoteDigest !== commercialQuoteDigest) throw new ServiceError("conflict", "Review the actual original booking price, public business and tax terms before accepting billing.");
    if (scope.quoteDigest === null && scope.taxDestination === null) {
      if (booking.invoiceId) throw new ServiceError("conflict", "An already billed appointment cannot acquire invented original tax terms.");
      await ctx.tx.update(bookingMerchantScopes).set({ taxDestination: destination, quoteDigest, commercialQuoteDigest, commercialPrice: quote.price }).where(eq(bookingMerchantScopes.bookingId, bookingId));
    } else if (scope.quoteDigest !== quoteDigest || scope.commercialQuoteDigest !== commercialQuoteDigest || JSON.stringify(bookingTaxDestination.parse(scope.taxDestination)) !== JSON.stringify(destination)) {
      throw new ServiceError("conflict", "The appointment's actual tax quote changed. Review and accept its current terms before booking.");
    }
    ctx.setSubject("booking", bookingId);
    return { pinned: true as const };
  },
});

export const resolveBookingInvoiceMerchantScope = defineService({
  name: "members.resolveBookingInvoiceMerchantScope", summary: "Resolve only a booking's original merchant scope and its actual frozen invoice tax receipt.",
  kind: "query", permission: "system", external: false, input: z.object({ invoiceId: z.uuid() }), output: invoiceMerchantScopeReceipt.nullable(),
  handler: async ({ invoiceId }, ctx) => {
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, invoiceId));
    if (!invoice || invoice.sourceType !== "booking" || !invoice.sourceId) return null;
    const [scope] = await ctx.tx.select().from(bookingMerchantScopes).where(eq(bookingMerchantScopes.bookingId, invoice.sourceId));
    if (!scope) return null;
    const [policy] = await ctx.tx.select().from(invoiceMarketPolicies).where(eq(invoiceMarketPolicies.invoiceId, invoiceId));
    if (!policy || policy.model !== "seller_merchant" || policy.sellerUserId !== scope.sellerUserId || policy.providerAccountId !== scope.recipientAccountId
      || scope.merchantIdentityErasedAt || scope.destinationErasedAt || !scope.taxDestination || !scope.quoteDigest) throw new ServiceError("conflict", "The original booking identity, accepted tax quote or invoice policy needs reconciliation.");
    const receipt = invoiceMerchantScopeReceipt.shape.taxPolicy.parse(await ctx.callAsSystem(getInvoiceMerchantTaxReceipt, { invoiceId, sellerUserId: scope.sellerUserId }));
    if (receipt.profileId !== scope.taxProfileId || receipt.profileVersion !== scope.taxProfileVersion || receipt.liability !== scope.taxLiability) throw new ServiceError("conflict", "The invoice tax receipt does not match this booking's accepted original business profile.");
    return { bookingId: scope.bookingId, collectionKind: scope.collectionKind, providerPlatformAccountId: scope.providerPlatformAccountId, chargeAccountId: scope.chargeAccountId,
      recipientAccountId: scope.recipientAccountId, settlementMerchantAccountId: scope.settlementMerchantAccountId, taxPolicy: receipt };
  },
});
registerInvoiceMerchantScopeResolver((ctx, invoiceId) => ctx.callAsSystem(resolveBookingInvoiceMerchantScope, { invoiceId }));

export const resolveBookingMerchantTaxSource = defineService({
  name: "members.resolveBookingMerchantTaxSource", summary: "Prove the original booking buyer, accepted server price and tax business before invoice creation.",
  kind: "query", permission: "system", external: false, input: merchantTaxSourceRequest, output: merchantTaxSourceParty.array(),
  handler: async (input, ctx) => {
    if (input.sourceType !== "booking" || !z.uuid().safeParse(input.sourceId).success) throw new ServiceError("conflict", "A booking tax quote needs its actual original reservation.");
    const [original] = await ctx.tx.select({ booking: bookings, scope: bookingMerchantScopes }).from(bookings)
      .innerJoin(bookingMerchantScopes, eq(bookingMerchantScopes.bookingId, bookings.id)).where(eq(bookings.id, input.sourceId!));
    if (!original || original.booking.marketPolicyVersion !== 1 || original.booking.contactId !== input.contactId || original.scope.destinationErasedAt || original.scope.merchantIdentityErasedAt
      || !original.scope.taxDestination || !original.scope.quoteDigest || !original.scope.commercialQuoteDigest || !original.scope.commercialPrice) throw new ServiceError("conflict", "The original booking needs its buyer's accepted business, price and tax quote before billing.");
    const { booking, scope } = original, price = bookingCommercialPrice.parse(scope.commercialPrice), line = input.lines[0];
    if (input.currency !== price.currency || price.seats !== booking.capacityUsed || input.shippingMinor !== 0 || input.lines.length !== 1 || !line
      || line.quantityMicros !== 1000000 || line.unitAmountMinor !== price.baseAmountMinor || line.discountMinor !== 0 || line.taxCategoryCode !== price.taxCategoryCode || line.requiresShipping
      || (line.sourceType !== undefined && (line.sourceType !== "booking" || line.sourceId !== booking.id))
      || (line.sourceType === undefined && line.sourceId !== undefined)
      || merchantTaxDigest(bookingTaxDestination.parse(scope.taxDestination)) !== merchantTaxDigest(bookingTaxDestination.parse(input.destination))) throw new ServiceError("conflict", "The invoice differs from the original booking's accepted money or declared tax destination.");
    return [{ sellerUserId: scope.sellerUserId, profileId: scope.taxProfileId, profileVersion: scope.taxProfileVersion, linePositions: [0], shippingMinor: 0, expectedQuoteDigest: digest.parse(scope.quoteDigest) }];
  },
});
registerMerchantTaxSourceResolver("booking", (input, ctx) => ctx.callAsSystem(resolveBookingMerchantTaxSource, input));

export default [captureBookingMarketPolicy, getBookingMarketPolicy, completeBookingTaxQuote, resolveBookingInvoiceMerchantScope, resolveBookingMerchantTaxSource];
