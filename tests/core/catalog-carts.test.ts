// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.20 persistent carts, wishlists, live refresh and abandonment.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { createContact, mergeContacts } from "@/core/contacts/service";
import { carts } from "@/modules/catalog/schema";
import {
  abandonStaleCarts,
  addCartItem,
  addWishlistItem,
  applyVariantMatrix,
  attachCartToContact,
  createPriceList,
  createProduct,
  getCart,
  getOrCreateCart,
  getProductVariants,
  listSavedCarts,
  listWishlist,
  removeWishlistItem,
  saveCart,
  setCartItemQuantity,
  setPriceListEntry,
} from "@/modules/catalog/service";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe.runIf(hasDatabase)("catalog carts", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  async function pricedVariant(slug = "print") {
    const product = await createProduct.call({ name: "Print", slug, kind: "physical" }, OWNER);
    const updated = await applyVariantMatrix.call({ productId: product.id, expectedVersion: product.version }, OWNER);
    const bundle = await getProductVariants.call({ productId: updated.id }, OWNER);
    const variant = bundle.variants[0]!;
    const list = await createPriceList.call({ name: "CAD retail", currency: "CAD", kind: "retail" }, OWNER);
    await setPriceListEntry.call({ priceListId: list.id, variantId: variant.id, amount: "40.00" }, OWNER);
    return variant;
  }

  it("opens a guest token cart, refreshes live prices, and merges into a contact cart", async () => {
    const variant = await pricedVariant();
    const guest = await getOrCreateCart.call({ currency: "CAD" }, ANONYMOUS);
    expect(guest.cart.contactId).toBeNull();
    const filled = await addCartItem.call({ cartId: guest.cart.id, variantId: variant.id, quantity: 2 }, ANONYMOUS);
    expect(filled.lines).toHaveLength(1);
    expect(filled.subtotalMinor).toBe(8_000);
    expect(filled.allPriced).toBe(true);

    const contact = await createContact.call({ name: "Ada", email: "ada@example.test" }, OWNER);
    // A contact UUID is an identifier, not a credential: an anonymous caller
    // holding one must not be able to read or fill that contact's basket.
    const refused = await failure(
      attachCartToContact.call({ token: guest.cart.token, contactId: contact.id }, ANONYMOUS),
    );
    expect(refused.code).toBe("permission");
    expect(
      (
        await failure(
          getOrCreateCart.call(
            { contactId: contact.id, currency: "CAD" },
            ANONYMOUS,
          ),
        )
      ).code,
    ).toBe("permission");

    const owned = await attachCartToContact.call({ token: guest.cart.token, contactId: contact.id }, OWNER);
    expect(owned.cart.contactId).toBe(contact.id);
    expect(owned.lines[0]?.quantity).toBe(2);

    const again = await getOrCreateCart.call(
      { token: guest.cart.token, contactId: contact.id, currency: "CAD" },
      OWNER,
    );
    expect(again.cart.id).toBe(owned.cart.id);
  });

  it("combines quantities when identifying a guest cart into an existing contact cart", async () => {
    const variant = await pricedVariant("combo");
    const contact = await createContact.call({ name: "Bea", email: "bea@example.test" }, OWNER);
    const owned = await getOrCreateCart.call({ contactId: contact.id, currency: "CAD" }, OWNER);
    await addCartItem.call({ cartId: owned.cart.id, variantId: variant.id, quantity: 1 }, OWNER);
    const guest = await getOrCreateCart.call({ currency: "CAD" }, ANONYMOUS);
    await addCartItem.call({ cartId: guest.cart.id, variantId: variant.id, quantity: 3 }, ANONYMOUS);
    const merged = await attachCartToContact.call({ token: guest.cart.token, contactId: contact.id }, OWNER);
    expect(merged.cart.id).toBe(owned.cart.id);
    expect(merged.lines[0]?.quantity).toBe(4);
  });

  it("saves a named cart and keeps one wishlist per contact", async () => {
    const variant = await pricedVariant("wish");
    const contact = await createContact.call({ name: "Cal", email: "cal@example.test" }, OWNER);
    const basket = await getOrCreateCart.call({ contactId: contact.id, currency: "CAD" }, OWNER);
    await addCartItem.call({ cartId: basket.cart.id, variantId: variant.id, quantity: 1 }, OWNER);
    const saved = await saveCart.call({ cartId: basket.cart.id, name: "Studio kit" }, OWNER);
    expect(saved.cart.kind).toBe("saved");
    expect(saved.cart.name).toBe("Studio kit");
    const named = await listSavedCarts.call({ contactId: contact.id }, OWNER);
    expect(named).toHaveLength(1);

    const list = await addWishlistItem.call({ contactId: contact.id, variantId: variant.id }, OWNER);
    expect(list.items).toHaveLength(1);
    const again = await addWishlistItem.call({ contactId: contact.id, variantId: variant.id }, OWNER);
    expect(again.items).toHaveLength(1);
    const empty = await removeWishlistItem.call({ contactId: contact.id, variantId: variant.id }, OWNER);
    expect(empty.items).toHaveLength(0);
    expect((await listWishlist.call({ contactId: contact.id }, OWNER)).wishlist).not.toBeNull();
  });

  it("refuses a zero-stock add when a location is given and marks stale carts abandoned", async () => {
    const variant = await pricedVariant("stale");
    const contact = await createContact.call({ name: "Dee", email: "dee@example.test" }, OWNER);
    const basket = await getOrCreateCart.call({ contactId: contact.id, currency: "CAD" }, OWNER);
    await addCartItem.call({ cartId: basket.cart.id, variantId: variant.id, quantity: 1 }, OWNER);
    await setCartItemQuantity.call({ cartId: basket.cart.id, variantId: variant.id, quantity: 0 }, OWNER);
    expect((await getCart.call({ cartId: basket.cart.id }, OWNER)).lines).toHaveLength(0);

    await addCartItem.call({ cartId: basket.cart.id, variantId: variant.id, quantity: 1 }, OWNER);
    await db().update(carts).set({ lastActivityAt: new Date("2020-01-01T00:00:00Z") }).where(eq(carts.id, basket.cart.id));
    const result = await abandonStaleCarts.call({}, OWNER);
    expect(result.abandoned).toBe(1);
    expect((await getCart.call({ cartId: basket.cart.id }, OWNER)).cart.status).toBe("abandoned");
    expect((await failure(addCartItem.call({ cartId: basket.cart.id, variantId: variant.id, quantity: 1 }, OWNER))).code)
      .toBe("conflict");
  });

  it("merges open carts onto the surviving contact", async () => {
    const variant = await pricedVariant("merge");
    const keep = await createContact.call({ name: "Keep", email: "keep@example.test" }, OWNER);
    const drop = await createContact.call({ name: "Drop", email: "drop@example.test" }, OWNER);
    const keepCart = await getOrCreateCart.call({ contactId: keep.id, currency: "CAD" }, OWNER);
    const dropCart = await getOrCreateCart.call({ contactId: drop.id, currency: "CAD" }, OWNER);
    await addCartItem.call({ cartId: keepCart.cart.id, variantId: variant.id, quantity: 1 }, OWNER);
    await addCartItem.call({ cartId: dropCart.cart.id, variantId: variant.id, quantity: 2 }, OWNER);
    await mergeContacts.call({ survivingId: keep.id, duplicateId: drop.id }, OWNER);
    const after = await getOrCreateCart.call({ contactId: keep.id, currency: "CAD" }, OWNER);
    expect(after.lines[0]?.quantity).toBe(3);
  });
});
