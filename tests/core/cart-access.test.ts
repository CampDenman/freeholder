// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.20/C11.10: identifiers do not grant access to carts or private wishlists.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { carts } from "@/modules/catalog/schema";
import { ready } from "@/core/runtime";
import { createContact } from "@/core/contacts/service";
import { addCartItem, addWishlistItem, applyCouponToCart, listCartOffers, quoteCartPromotions, applyVariantMatrix, createPriceList, createProduct, getCart,
 getOrCreateCart, getProductVariants, listCarts, listSavedCarts, listWishlist, removeCartItem,
 removeWishlistItem, saveCart, setCartItemQuantity, setPriceListEntry } from "@/modules/catalog/service";
import { ANONYMOUS, CUSTOMER, closeDb, hasDatabase, OWNER, STAFF, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("cart capabilities", { timeout: 30_000 }, () => {
 beforeEach(async () => { await ready(); await truncateSpine(); });
 afterAll(closeDb);
 async function fixture() {
  const contact = await createContact.call({ name: "Private shopper", email: "private-cart@example.test" }, OWNER);
  const product = await createProduct.call({ name: "Print", slug: "private-cart-print", kind: "physical" }, OWNER);
  await applyVariantMatrix.call({ productId: product.id, expectedVersion: product.version }, OWNER);
  const variant = (await getProductVariants.call({ productId: product.id }, OWNER)).variants[0]!;
  const priceList = await createPriceList.call({ name: "Retail", currency: "CAD", kind: "retail" }, OWNER);
  await setPriceListEntry.call({ priceListId: priceList.id, variantId: variant.id, amount: "10.00" }, OWNER);
  const basket = await getOrCreateCart.call({ contactId: contact.id, currency: "CAD" }, OWNER);
  await addCartItem.call({ cartId: basket.cart.id, variantId: variant.id }, OWNER);
  return { contact, variant, basket };
 }
 it("refuses ID-only cart reads and accepts the matching cart token", async () => {
  const { basket } = await fixture();
  await expect(getCart.call({ cartId: basket.cart.id }, ANONYMOUS)).rejects.toMatchObject({ code: "permission" });
  await expect(getCart.call({ cartId: basket.cart.id, token: "00000000-0000-4000-8000-000000000099" }, ANONYMOUS)).rejects.toMatchObject({ code: "permission" });
  expect((await getCart.call({ token: basket.cart.token }, ANONYMOUS)).cart.id).toBe(basket.cart.id);
 });
 it("refuses cart mutations by ID alone", async () => {
  const { basket, variant } = await fixture();
  const common = { cartId: basket.cart.id, variantId: variant.id };
  for (const attempt of [() => addCartItem.call(common, ANONYMOUS), () => setCartItemQuantity.call({ ...common, quantity: 0 }, ANONYMOUS),
    () => removeCartItem.call(common, ANONYMOUS), () => saveCart.call({ cartId: basket.cart.id, name: "Stolen" }, ANONYMOUS)]) {
    await expect(attempt()).rejects.toMatchObject({ code: "permission" });
  }
  expect((await getCart.call({ cartId: basket.cart.id }, OWNER)).lines[0]!.quantity).toBe(1);
 });
 it("does not disclose write capabilities to view-only staff or read-only API keys", async () => {
  const { basket } = await fixture();
  const reader = { ...STAFF, grants: [{ module: "catalog", access: "view" as const }] };
  expect((await getCart.call({ cartId: basket.cart.id }, reader)).cart.token).toBeNull();
  expect((await listCarts.call({}, reader))[0]!.token).toBeNull();
  const key = { kind: "agent" as const, keyName: "cart-reader", scopes: ["catalog.getCart"] };
  expect((await getCart.call({ cartId: basket.cart.id }, key)).cart.token).toBeNull();
 });
 it("refuses private saved-cart and wishlist reads or edits by contact ID", async () => {
  const { contact, basket, variant } = await fixture();
  await saveCart.call({ cartId: basket.cart.id, name: "Private saved cart" }, OWNER);
  await addWishlistItem.call({ contactId: contact.id, variantId: variant.id }, OWNER);
  await expect(listSavedCarts.call({ contactId: contact.id }, ANONYMOUS)).rejects.toMatchObject({ code: "permission" });
  await expect(listWishlist.call({ contactId: contact.id }, ANONYMOUS)).rejects.toMatchObject({ code: "permission" });
  await expect(addWishlistItem.call({ contactId: contact.id, variantId: variant.id }, ANONYMOUS)).rejects.toMatchObject({ code: "permission" });
  await expect(removeWishlistItem.call({ contactId: contact.id, variantId: variant.id }, ANONYMOUS)).rejects.toMatchObject({ code: "permission" });
 });
 it("keeps real guest tokens working through quantity composition without granting other carts", async () => {
  const { variant, basket } = await fixture();
  const guest = await getOrCreateCart.call({ currency: "CAD" }, ANONYMOUS);
  const input = { cartId: guest.cart.id, cartToken: guest.cart.token, variantId: variant.id };
  await addCartItem.call(input, ANONYMOUS);
  expect((await setCartItemQuantity.call({ ...input, quantity: 3 }, ANONYMOUS)).lines[0]!.quantity).toBe(3);
  expect((await setCartItemQuantity.call({ ...input, quantity: 0 }, ANONYMOUS)).lines).toHaveLength(0);
  await expect(addCartItem.call({ ...input, cartId: basket.cart.id }, ANONYMOUS)).rejects.toMatchObject({ code: "permission" });
  await expect(saveCart.call({ cartId: basket.cart.id, cartToken: basket.cart.token, name: "Profile write" }, ANONYMOUS)).rejects.toMatchObject({ code: "permission" });
 });
 it("keeps an exact mutation key within its operation and returns no new bearer token", async () => {
  const { basket, variant } = await fixture();
  const key = { kind: "agent" as const, keyName: "quantity-only", scopes: ["catalog.setCartItemQuantity"] };
  const result = await setCartItemQuantity.call({ cartId: basket.cart.id, variantId: variant.id, quantity: 2 }, key);
  expect(result.lines[0]!.quantity).toBe(2);
  expect(result.cart.token).toBeNull();
  await expect(removeCartItem.call({ cartId: basket.cart.id, variantId: variant.id }, key)).rejects.toMatchObject({ code: "permission" });
  await db().update(carts).set({ status: "converted" }).where(eq(carts.id, basket.cart.id));
  await expect(setCartItemQuantity.call({ cartId: basket.cart.id, cartToken: basket.cart.token, variantId: variant.id, quantity: 0 }, ANONYMOUS)).rejects.toMatchObject({ code: "conflict" });
 });
 it("uses the signed-in contact for saved carts and private wishlist access", async () => {
  const { contact, basket, variant } = await fixture();
  await db().insert(users).values({ id: CUSTOMER.userId, email: "private-cart@example.test", role: "customer" });
  await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, contact.id));
  const own = await getOrCreateCart.call({ contactId: contact.id, currency: "CAD" }, CUSTOMER);
  expect(own.cart.id).toBe(basket.cart.id);
  await saveCart.call({ cartId: basket.cart.id, name: "Own saved cart" }, CUSTOMER);
  expect(await listSavedCarts.call({ contactId: contact.id }, CUSTOMER)).toHaveLength(1);
  await addWishlistItem.call({ contactId: contact.id, variantId: variant.id }, CUSTOMER);
  expect((await listWishlist.call({}, CUSTOMER)).items).toHaveLength(1);
  const other = await createContact.call({ name: "Other", email: "other-cart@example.test" }, OWNER);
  await expect(listWishlist.call({ contactId: other.id }, CUSTOMER)).rejects.toMatchObject({ code: "permission" });
  await expect(addWishlistItem.call({ contactId: other.id, variantId: variant.id }, CUSTOMER)).rejects.toMatchObject({ code: "permission" });
  const view = { ...STAFF, grants: [{ module: "catalog", access: "view" as const }] };
  expect((await listSavedCarts.call({ contactId: contact.id }, view))[0]!.cart.token).toBeNull();
 });
 it("does not expose cart promotions or apply coupons through an unauthenticated cart ID", async () => {
  const { basket } = await fixture();
  await expect(listCartOffers.call({ cartId: basket.cart.id }, ANONYMOUS)).rejects.toMatchObject({ code: "permission" });
  await expect(quoteCartPromotions.call({ cartId: basket.cart.id, subtotalMinor: 1000, shippingMinor: 0, currency: "CAD" }, ANONYMOUS)).rejects.toMatchObject({ code: "permission" });
  await expect(applyCouponToCart.call({ cartId: basket.cart.id, code: "UNKNOWN" }, ANONYMOUS)).rejects.toMatchObject({ code: "permission" });
  expect(await listCartOffers.call({ cartId: basket.cart.id, cartToken: basket.cart.token }, ANONYMOUS)).toEqual([]);
 });

});
