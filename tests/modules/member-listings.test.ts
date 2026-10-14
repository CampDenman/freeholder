// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.08: members list things for sale once the site turns the market on;
// listings wait for review when the site asks; approved listings appear in
// the market and on the seller's storefront, never in the site's own shop;
// and nobody can put a member's listing in a cart before payouts exist.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { ready } from "@/core/runtime";
import { updateBusiness } from "@/core/settings/service";
import { joinSite, updateMembershipRules } from "@/modules/members/service";
import { archiveListing, createListing, myListings, pendingListings, reviewListing, storefront } from "@/modules/members/listings";
import { browseProducts } from "@/modules/catalog/browse";
import { marketListings } from "@/modules/catalog/market";
import { addCartItem, getOrCreateCart } from "@/modules/catalog/cart";
import { getProductVariants } from "@/modules/catalog/variants";
import { ANONYMOUS, closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const RAE = CUSTOMER;
const SAM = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c2" };
const print = { title: "Harbour print, 8×10", kind: "physical" as const, description: "Signed giclée print.", price: "45" };

describe.runIf(hasDatabase)("member listings (C12.08)", () => {
  beforeAll(async () => { await ready(); }, 60_000);
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values([
      { id: OWNER.userId, email: "owner@example.test", role: "owner" },
      { id: RAE.userId, email: "rae@example.test", role: "customer" },
      { id: SAM.userId, email: "sam@example.test", role: "customer" },
    ]);
    await updateBusiness.call({ name: "Market proof", country: "CA", baseCurrency: "CAD", timezone: "UTC" }, OWNER);
    await joinSite.call({ handle: "rae", displayName: "Rae", meetsMinimumAge: true, isAdult: true }, RAE);
    await joinSite.call({ handle: "sam", displayName: "Sam", meetsMinimumAge: true, isAdult: true }, SAM);
  });
  afterAll(closeDb);

  it("keeps the market off until the site turns it on, then reviews new listings", async () => {
    expect((await failure(createListing.call(print, RAE))).code).toBe("permission");
    await updateMembershipRules.call({ marketplaceEnabled: true }, OWNER);
    const listing = await createListing.call(print, RAE);
    expect(listing).toMatchObject({ status: "draft", review: "pending", kind: "physical" });
    expect(await marketListings.call({}, ANONYMOUS)).toEqual([]);
    expect((await pendingListings.call({}, OWNER)).map((l) => l.sellerHandle)).toEqual(["rae"]);
    expect((await failure(pendingListings.call({}, RAE))).code).toBe("permission");
    expect((await failure(reviewListing.call({ productId: listing.productId, approve: false }, OWNER))).code).toBe("validation");
    await reviewListing.call({ productId: listing.productId, approve: true }, OWNER);
    const market = await marketListings.call({}, ANONYMOUS);
    expect(market).toMatchObject([{ name: "Harbour print, 8×10", priceMinor: 4500, currency: "CAD", sellerUserId: RAE.userId }]);
    expect((await storefront.call({ handle: "rae" }, ANONYMOUS)).map((l) => l.name)).toEqual(["Harbour print, 8×10"]);
    expect(await storefront.call({ handle: "sam" }, ANONYMOUS)).toEqual([]);
    expect((await browseProducts.call({}, ANONYMOUS)).products).toEqual([]);
  });

  it("publishes immediately without review, refuses carts, and lets the seller take it down", async () => {
    await updateMembershipRules.call({ marketplaceEnabled: true, listingReview: false }, OWNER);
    const listing = await createListing.call({ ...print, kind: "service", title: "Portrait session", price: "180.50" }, RAE);
    expect(listing).toMatchObject({ status: "active", review: "approved" });
    const { variants } = await getProductVariants.call({ productId: listing.productId }, OWNER);
    const cart = await getOrCreateCart.call({ currency: "CAD" }, ANONYMOUS);
    expect((await failure(addCartItem.call({ cartId: cart.cart.id, cartToken: cart.cart.token ?? undefined, variantId: variants[0]!.id }, ANONYMOUS))).code).toBe("conflict");
    expect((await failure(archiveListing.call({ productId: listing.productId, archived: true }, SAM))).code).toBe("not_found");
    expect((await archiveListing.call({ productId: listing.productId, archived: true }, RAE)).status).toBe("archived");
    expect(await marketListings.call({}, ANONYMOUS)).toEqual([]);
    expect((await archiveListing.call({ productId: listing.productId, archived: false }, RAE)).status).toBe("active");
    expect((await myListings.call({}, RAE)).map((l) => l.name)).toEqual(["Portrait session"]);
    expect((await failure(createListing.call({ ...print, price: "free" }, RAE))).code).toBe("validation");
    expect((await failure(createListing.call(print, ANONYMOUS))).code).toBe("permission");
  });
});
