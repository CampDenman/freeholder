// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Source-only native fixture: actual current marketplace services, fake payment edge.
// Caller owns ready/truncate and must restore Vitest mocks after every case.
import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { resolveContact } from "@/core/contacts/service";
import { updateBusiness } from "@/core/settings/service";
import * as paymentAdapters from "@/adapters/payments";
import { joinSite, updateMembershipRules } from "@/modules/members/service";
import { memberPayoutAccounts } from "@/modules/members/schema";
import { createListing } from "@/modules/members/listings";
import { payoutAdapters, registerPayoutAdapter } from "@/modules/members/payouts";
import { checkoutCart } from "@/modules/catalog/orders";
import { addCartItem, getOrCreateCart } from "@/modules/catalog/cart";
import { getProductVariants } from "@/modules/catalog/variants";
import { quoteMerchantCheckout } from "@/modules/catalog/merchant-checkout-quote";
import { configureMerchantCollection } from "@/modules/invoicing/merchant-collection";
import { merchantTaxZoneConfiguration, saveMyMerchantTaxProfile } from "@/modules/invoicing/merchant-tax-profiles";
import { addTaxRate, createTaxZone } from "@/modules/invoicing/tax-service";
import { ANONYMOUS, CUSTOMER, OWNER } from "./spine";

export const MERCHANT_FIXTURE_BUYER_EMAIL = "merchant-fixture-buyer@example.test";
export const MERCHANT_FIXTURE_DESTINATION = { country: "CA", region: "BC" };
export const MERCHANT_FIXTURE_SELLERS = [CUSTOMER, { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c2" }] as const;
export async function seedMerchantCheckout80(collectionKind: "direct" | "destination" = "direct", sellerCount: 1 | 2 = 1) {
  const previous = payoutAdapters().find(adapter => adapter.id === "stripe_connect")!;
  registerPayoutAdapter({ ...previous, models: [...previous.models, "seller_merchant"] });
  const manual = paymentAdapters.createManualPayments();
  const stripe: paymentAdapters.PaymentAdapter = { ...manual, id: "stripe", status: { ...manual.status, id: "stripe", available: true },
    capabilities: () => ({ ...manual.capabilities(), sellerMerchantCharges: true, destinationMerchantCharges: true, savedMethods: true }),
    platformAccountIdentity: async () => ({ providerPlatformAccountId: "acct_fixturePlatform" }) };
  const adapterSpy = vi.spyOn(paymentAdapters, "paymentAdapter").mockReturnValue(stripe);
  const cleanup = () => { adapterSpy.mockRestore(); registerPayoutAdapter(previous); };
  try {
    const sellers = MERCHANT_FIXTURE_SELLERS.slice(0, sellerCount);
    await db().insert(users).values([{ id: OWNER.userId, email: "merchant-fixture-owner@example.test", role: "owner" }, ...sellers.map((seller, index) => ({ id: seller.userId, email: `merchant-fixture-seller-${index}@example.test`, role: "customer" }))]);
    await updateBusiness.call({ name: "Synthetic current merchant checkout", country: "CA", baseCurrency: "CAD", timezone: "UTC" }, OWNER);
    await updateMembershipRules.call({ marketplaceEnabled: true, listingReview: false, payoutAdapter: "stripe_connect", payoutModel: "seller_merchant", siteFeeBps: 1000 }, OWNER);
    await configureMerchantCollection.call({ collectionKind }, OWNER);
    const zone = await createTaxZone.call({ name: "Fixture merchant jurisdiction", country: "CA", regions: ["BC"], basis: "destination", pricesIncludeTax: false, roundingScope: "line", roundingMode: "half_up" }, OWNER);
    const rate = await addTaxRate.call({ zoneId: zone.id, name: "Fixture business tax", jurisdiction: "Synthetic fixture jurisdiction", ratePpm: 50000, appliesToShipping: true }, OWNER);
    const buyer = (await resolveContact.call({ email: MERCHANT_FIXTURE_BUYER_EMAIL, name: "Fixture buyer" }, OWNER)).contact;
    const cart = (await getOrCreateCart.call({ contactId: buyer.id, currency: "CAD" }, OWNER)).cart;
    const profiles = [];
    for (const [index, seller] of sellers.entries()) {
      await joinSite.call({ handle: `merchant_fixture_${index}`, displayName: `Original merchant ${index}`, meetsMinimumAge: true, isAdult: true }, seller);
      await db().insert(memberPayoutAccounts).values({ userId: seller.userId, adapter: "stripe_connect", externalAccountId: `acct_fixtureSeller${index}`, status: "ready", chargesReady: true,
        merchantName: `Original merchant ${index}`, merchantSupport: { email: `support-${index}@merchant.example`, phone: null, url: null, address: null } });
      const configuration = await merchantTaxZoneConfiguration.call({ zoneId: zone.id }, seller);
      const profile = await saveMyMerchantTaxProfile.call({ expectedVersion: 0, idempotencyKey: randomUUID(), acceptPolicy: true, liability: "seller", origin: MERCHANT_FIXTURE_DESTINATION, collectionStatus: "registered", registrations: [{ zoneId: zone.id, number: `FIXTURE-TAX-${index}`, rateIds: [rate.id], configurationDigest: configuration.configurationDigest, status: "active" }] }, seller);
      profiles.push(profile);
      const listing = await createListing.call({ title: `Original merchant download ${index}`, kind: "digital", price: index === 0 ? "40" : "10", acceptPolicy: true }, seller);
      const variant = (await getProductVariants.call({ productId: listing.productId }, OWNER)).variants[0]!;
      await addCartItem.call({ cartId: cart.id, cartToken: cart.token, variantId: variant.id }, ANONYMOUS);
    }
    const quoteInput = { cartId: cart.id, cartToken: cart.token, taxDestination: MERCHANT_FIXTURE_DESTINATION };
    const review = () => quoteMerchantCheckout.call(quoteInput, ANONYMOUS);
    const checkout = async () => {
      const accepted = await review();
      if (!accepted) throw new Error("The actual current merchant quote unexpectedly selected legacy collection.");
      return checkoutCart.call({ cartId: cart.id, contactId: buyer.id, acceptedTerms: true, idempotencyKey: randomUUID(), taxDestination: MERCHANT_FIXTURE_DESTINATION,
        taxQuoteDigest: accepted.taxQuoteDigest, commercialQuoteDigest: accepted.commercialQuoteDigest }, OWNER);
    };
    return { sellers, profiles, zone, rate, buyer, cart, stripe, quoteInput, review, checkout, cleanup };
  } catch (error) { cleanup(); throw error; }
}

/** Actual catalogue/merchant/customer setup only; no cart is born or moved.
 * Original checkout constructor above remains unchanged. */
export async function seedMerchantCatalogue80(collectionKind: "direct" | "destination" = "direct", sellerCount: 1 | 2 = 1) {
  const previous = payoutAdapters().find(adapter => adapter.id === "stripe_connect")!;
  registerPayoutAdapter({ ...previous, models: [...previous.models, "seller_merchant"] });
  const manual = paymentAdapters.createManualPayments();
  const stripe: paymentAdapters.PaymentAdapter = { ...manual, id: "stripe", status: { ...manual.status, id: "stripe", available: true },
    capabilities: () => ({ ...manual.capabilities(), sellerMerchantCharges: true, destinationMerchantCharges: true, savedMethods: true }),
    platformAccountIdentity: async () => ({ providerPlatformAccountId: "acct_fixturePlatform" }) };
  const adapterSpy = vi.spyOn(paymentAdapters, "paymentAdapter").mockReturnValue(stripe);
  const cleanup = () => { adapterSpy.mockRestore(); registerPayoutAdapter(previous); };
  try {
    const sellers = MERCHANT_FIXTURE_SELLERS.slice(0, sellerCount);
    await db().insert(users).values([{ id: OWNER.userId, email: "merchant-fixture-owner@example.test", role: "owner" }, ...sellers.map((seller, index) => ({ id: seller.userId, email: `merchant-fixture-seller-${index}@example.test`, role: "customer" }))]);
    await updateBusiness.call({ name: "Synthetic current merchant checkout", country: "CA", baseCurrency: "CAD", timezone: "UTC" }, OWNER);
    await updateMembershipRules.call({ marketplaceEnabled: true, listingReview: false, payoutAdapter: "stripe_connect", payoutModel: "seller_merchant", siteFeeBps: 1000 }, OWNER);
    await configureMerchantCollection.call({ collectionKind }, OWNER);
    const zone = await createTaxZone.call({ name: "Fixture merchant jurisdiction", country: "CA", regions: ["BC"], basis: "destination", pricesIncludeTax: false, roundingScope: "line", roundingMode: "half_up" }, OWNER);
    const rate = await addTaxRate.call({ zoneId: zone.id, name: "Fixture business tax", jurisdiction: "Synthetic fixture jurisdiction", ratePpm: 50000, appliesToShipping: true }, OWNER);
    const buyer = (await resolveContact.call({ email: MERCHANT_FIXTURE_BUYER_EMAIL, name: "Fixture buyer" }, OWNER)).contact;
    const profiles = [];
    const variants: Array<Awaited<ReturnType<typeof getProductVariants.call>>["variants"][number]> = [];
    for (const [index, seller] of sellers.entries()) {
      await joinSite.call({ handle: `merchant_fixture_${index}`, displayName: `Original merchant ${index}`, meetsMinimumAge: true, isAdult: true }, seller);
      await db().insert(memberPayoutAccounts).values({ userId: seller.userId, adapter: "stripe_connect", externalAccountId: `acct_fixtureSeller${index}`, status: "ready", chargesReady: true,
        merchantName: `Original merchant ${index}`, merchantSupport: { email: `support-${index}@merchant.example`, phone: null, url: null, address: null } });
      const configuration = await merchantTaxZoneConfiguration.call({ zoneId: zone.id }, seller);
      const profile = await saveMyMerchantTaxProfile.call({ expectedVersion: 0, idempotencyKey: randomUUID(), acceptPolicy: true, liability: "seller", origin: MERCHANT_FIXTURE_DESTINATION, collectionStatus: "registered", registrations: [{ zoneId: zone.id, number: `FIXTURE-TAX-${index}`, rateIds: [rate.id], configurationDigest: configuration.configurationDigest, status: "active" }] }, seller);
      profiles.push(profile);
      const listing = await createListing.call({ title: `Original merchant download ${index}`, kind: "digital", price: index === 0 ? "40" : "10", acceptPolicy: true }, seller);
      const variant = (await getProductVariants.call({ productId: listing.productId }, OWNER)).variants[0]!;
      variants.push(variant);
    }
    return { sellers, profiles, zone, rate, buyer, variants, stripe, cleanup };
  } catch (error) { cleanup(); throw error; }
}
