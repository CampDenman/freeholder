// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.16/C5.20/C8.08: distinct photographs share stock, never line identity.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { createContact, mergeContacts } from "@/core/contacts/service";
import { createLocationService } from "@/core/locations/service";
import { cartItems, productVariants, stockMovements, stockReservations } from "@/modules/catalog/schema";
import { addCartItem, applyVariantMatrix, attachCartToContact, availability, cancelOrder, checkoutCart, createFulfillment, createPriceList, createProduct, createShippingMethod, createShippingZone, enableInventory, getCart, getOrCreateCart, getProductVariants, payOrder, recordStockMovement, removeCartItem, reserveStock, saveCart, setCartItemQuantity, setPriceListEntry, shipFulfillment } from "@/modules/catalog/service";
import { createPayment, settlePayment } from "@/modules/invoicing/invoice-service";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("shared cart-line stock (C5.16/C5.20/C8.08)", () => {
  beforeEach(truncateSpine, 60_000);
  afterAll(closeDb);
  async function setup(shipping = false) {
    const product = await createProduct.call({ name: "Photograph print", slug: "photo-print", kind: "physical" }, OWNER);
    const updated = await applyVariantMatrix.call({ productId: product.id, expectedVersion: product.version }, OWNER);
    const variant = (await getProductVariants.call({ productId: updated.id }, OWNER)).variants[0]!;
    await db().update(productVariants).set({ requiresShipping: shipping }).where(eq(productVariants.id, variant.id));
    if (shipping) {
      const zone = await createShippingZone.call({ name: "Print delivery", countries: [], regions: [], postalPatterns: [] }, OWNER);
      await createShippingMethod.call({ zoneId: zone.id, name: "Print parcel", kind: "flat", currency: "CAD", amount: "5.00" }, OWNER);
    }
    const list = await createPriceList.call({ name: "Photograph retail", currency: "CAD", kind: "retail" }, OWNER);
    await setPriceListEntry.call({ priceListId: list.id, variantId: variant.id, amount: "10.00" }, OWNER);
    const location = await createLocationService.call({ name: "Print stock", slug: "print-stock", country: "CA" }, OWNER);
    const item = await enableInventory.call({ variantId: variant.id, locationId: location.id }, OWNER);
    await recordStockMovement.call({ itemId: item.id, delta: 3, reason: "receipt" }, OWNER);
    const contact = await createContact.call({ name: "Print buyer", email: "print-buyer@example.test" }, OWNER);
    const basket = await getOrCreateCart.call({ contactId: contact.id, currency: "CAD" }, OWNER);
    return { variant, location, item, contact, cart: basket.cart, galleryId: crypto.randomUUID(), assets: [crypto.randomUUID(), crypto.randomUUID()] };
  }
  it("holds all units for two different photographs of the same tracked print variant", { timeout: 60_000 }, async () => {
    const { variant, location, item, cart, galleryId, assets } = await setup();
    await addCartItem.call({ cartId: cart.id, variantId: variant.id, locationId: location.id, quantity: 1, galleryId, assetId: assets[0] }, OWNER);
    const filled = await addCartItem.call({ cartId: cart.id, variantId: variant.id, locationId: location.id, quantity: 2, galleryId, assetId: assets[1] }, OWNER);
    expect(filled.lines.map(line => [line.assetId, line.quantity]).sort()).toEqual([[assets[0], 1], [assets[1], 2]].sort());
    const holds = await db().select().from(stockReservations).where(and(eq(stockReservations.inventoryItemId, item.id), eq(stockReservations.holderType, "cart"), eq(stockReservations.holderId, cart.id), eq(stockReservations.status, "active")));
    expect(holds.map(hold => hold.quantity)).toEqual([3]);
    expect(filled.lines.every(line => line.reservationId === holds[0]!.id)).toBe(true);
    expect((await availability.call({ variantId: variant.id, locationId: location.id, quantity: 1 }, OWNER)).available).toBe(false);
  });
  it("converts an existing multi-photograph cart into one full order hold without collapsing its lines", { timeout: 60_000 }, async () => {
    const { variant, location, item, contact, cart, galleryId, assets } = await setup();
    // Existing imported/restored carts can have no active hold. Checkout must
    // preserve each photograph and reserve the group's complete quantity.
    await db().insert(cartItems).values(assets.map((assetId, index) => ({ cartId: cart.id, variantId: variant.id, locationId: location.id, quantity: index + 1, galleryId, assetId })));
    const placed = await checkoutCart.call({ cartId: cart.id, contactId: contact.id, acceptedTerms: true, idempotencyKey: "shared-photo-stock-checkout" }, OWNER);
    expect(placed.lines.map(line => [line.assetId, line.quantity]).sort()).toEqual([[assets[0], 1], [assets[1], 2]].sort());
    const holds = await db().select().from(stockReservations).where(and(eq(stockReservations.inventoryItemId, item.id), eq(stockReservations.holderType, "order"), eq(stockReservations.holderId, placed.order.id), eq(stockReservations.status, "active")));
    expect(holds.map(hold => hold.quantity)).toEqual([3]);
  });
  it("merges a guest cart without losing photograph identity or its held stock", { timeout: 60_000 }, async () => {
    const { variant, location, contact, cart, galleryId, assets } = await setup();
    await addCartItem.call({ cartId: cart.id, variantId: variant.id, locationId: location.id, quantity: 1, galleryId, assetId: assets[0] }, OWNER);
    const guest = (await getOrCreateCart.call({ currency: "CAD" }, OWNER)).cart;
    await addCartItem.call({ cartId: guest.id, variantId: variant.id, locationId: location.id, quantity: 2, galleryId, assetId: assets[1] }, OWNER);
    const merged = await attachCartToContact.call({ token: guest.token!, contactId: contact.id }, OWNER);
    expect(merged.lines.map(line => [line.assetId, line.quantity]).sort()).toEqual([[assets[0], 1], [assets[1], 2]].sort());
    expect(merged.allAvailable).toBe(true);
  });
  it("merges contact carts without losing photograph identity or its held stock", { timeout: 60_000 }, async () => {
    const { variant, location, contact, cart, galleryId, assets } = await setup();
    await addCartItem.call({ cartId: cart.id, variantId: variant.id, locationId: location.id, quantity: 1, galleryId, assetId: assets[0] }, OWNER);
    const duplicate = await createContact.call({ name: "Duplicate print buyer", email: "duplicate-print@example.test" }, OWNER);
    const other = (await getOrCreateCart.call({ contactId: duplicate.id, currency: "CAD" }, OWNER)).cart;
    await addCartItem.call({ cartId: other.id, variantId: variant.id, locationId: location.id, quantity: 2, galleryId, assetId: assets[1] }, OWNER);
    const contactsOnly = { kind: "agent" as const, keyName: "contact-merge-only", scopes: ["contacts.merge"] };
    await expect(reserveStock.call({ variantId: variant.id, locationId: location.id, quantity: 1, holderType: "cart", holderId: cart.id, expiresAt: new Date(Date.now() + 60_000) }, contactsOnly)).rejects.toMatchObject({ code: "permission" });
    await mergeContacts.call({ survivingId: contact.id, duplicateId: duplicate.id }, contactsOnly);
    const merged = await getCart.call({ cartId: cart.id }, OWNER);
    expect(merged.lines.map(line => [line.assetId, line.quantity]).sort()).toEqual([[assets[0], 1], [assets[1], 2]].sort());
    expect(merged.allAvailable).toBe(true);
  });
  it("updates/removes the selected photograph and never guesses an ambiguous variant", { timeout: 60_000 }, async () => {
    const { variant, location, cart, galleryId, assets } = await setup();
    await addCartItem.call({ cartId: cart.id, variantId: variant.id, locationId: location.id, quantity: 1, galleryId, assetId: assets[0] }, OWNER);
    const filled = await addCartItem.call({ cartId: cart.id, variantId: variant.id, locationId: location.id, quantity: 1, galleryId, assetId: assets[1] }, OWNER);
    const second = filled.lines.find(line => line.assetId === assets[1])!;
    await expect(setCartItemQuantity.call({ cartId: cart.id, variantId: variant.id, quantity: 2 }, OWNER)).rejects.toMatchObject({ code: "validation" });
    const changed = await setCartItemQuantity.call({ cartId: cart.id, variantId: variant.id, lineId: second.id, quantity: 2 }, OWNER);
    expect(changed.lines.map(line => [line.assetId, line.quantity]).sort()).toEqual([[assets[0], 1], [assets[1], 2]].sort());
    const removed = await removeCartItem.call({ cartId: cart.id, variantId: variant.id, lineId: second.id }, OWNER);
    expect(removed.lines.map(line => [line.assetId, line.quantity])).toEqual([[assets[0], 1]]);
    expect((await availability.call({ variantId: variant.id, locationId: location.id, quantity: 2 }, OWNER)).available).toBe(true);
  });
  it("can shrink and empty an expired multi-photo cart without releasing another cart's stock", { timeout: 60_000 }, async () => {
    const { variant, location, cart, galleryId, assets } = await setup();
    await addCartItem.call({ cartId: cart.id, variantId: variant.id, locationId: location.id, quantity: 1, galleryId, assetId: assets[0] }, OWNER);
    const filled = await addCartItem.call({ cartId: cart.id, variantId: variant.id, locationId: location.id, quantity: 2, galleryId, assetId: assets[1] }, OWNER);
    await db().update(stockReservations).set({ expiresAt: new Date(0) }).where(eq(stockReservations.holderId, cart.id));
    const other = (await getOrCreateCart.call({ currency: "CAD" }, OWNER)).cart;
    const otherHeld = await addCartItem.call({ cartId: other.id, variantId: variant.id, locationId: location.id, quantity: 3 }, OWNER);
    const second = filled.lines.find(line => line.assetId === assets[1])!;
    await db().update(cartItems).set({ reservationId: otherHeld.lines[0]!.reservationId }).where(eq(cartItems.id, second.id));
    const changed = await setCartItemQuantity.call({ cartId: cart.id, variantId: variant.id, lineId: second.id, quantity: 1 }, OWNER);
    expect(changed.allAvailable).toBe(false);
    for (const line of changed.lines) await removeCartItem.call({ cartId: cart.id, variantId: variant.id, lineId: line.id }, OWNER);
    expect((await getCart.call({ cartId: cart.id }, OWNER)).lines).toEqual([]);
    expect((await getCart.call({ cartId: other.id }, OWNER)).allAvailable).toBe(true);
    expect((await db().select().from(stockReservations).where(eq(stockReservations.id, otherHeld.lines[0]!.reservationId!)))[0]!.status).toBe("active");
  });
  it("serializes separate photograph adds and cancels one complete order hold without duplicate checkout", { timeout: 60_000 }, async () => {
    const { variant, location, contact, cart, galleryId, assets } = await setup();
    await Promise.all(assets.map((assetId, index) => addCartItem.call({ cartId: cart.id, variantId: variant.id, locationId: location.id, quantity: index + 1, galleryId, assetId }, OWNER)));
    const input = { cartId: cart.id, contactId: contact.id, acceptedTerms: true as const, idempotencyKey: "shared-stock-cancel-replay" };
    const placed = await checkoutCart.call(input, OWNER);
    expect((await checkoutCart.call(input, OWNER)).order.id).toBe(placed.order.id);
    await cancelOrder.call({ id: placed.order.id }, OWNER);
    expect((await availability.call({ variantId: variant.id, locationId: location.id, quantity: 3 }, OWNER)).available).toBe(true);
    expect((await checkoutCart.call(input, OWNER)).order.status).toBe("cancelled");
  });
  it("saves both photograph identities without reserving a named snapshot", { timeout: 60_000 }, async () => {
    const { variant, location, cart, galleryId, assets } = await setup();
    await addCartItem.call({ cartId: cart.id, variantId: variant.id, locationId: location.id, quantity: 1, galleryId, assetId: assets[0] }, OWNER);
    await addCartItem.call({ cartId: cart.id, variantId: variant.id, locationId: location.id, quantity: 2, galleryId, assetId: assets[1] }, OWNER);
    const saved = await saveCart.call({ cartId: cart.id, name: "Both photographs" }, OWNER);
    expect(saved.lines.map(line => [line.assetId, line.quantity]).sort()).toEqual([[assets[0], 1], [assets[1], 2]].sort());
    await setCartItemQuantity.call({ cartId: saved.cart.id, variantId: variant.id, lineId: saved.lines[0]!.id, quantity: 2 }, OWNER);
    expect(await db().select().from(stockReservations).where(and(eq(stockReservations.holderId, saved.cart.id), eq(stockReservations.status, "active")))).toEqual([]);
  });
  it("consumes one shared order hold across separate photograph shipments", { timeout: 90_000 }, async () => {
    const { variant, location, item, contact, cart, galleryId, assets } = await setup(true);
    await addCartItem.call({ cartId: cart.id, variantId: variant.id, locationId: location.id, quantity: 1, galleryId, assetId: assets[0] }, OWNER);
    await addCartItem.call({ cartId: cart.id, variantId: variant.id, locationId: location.id, quantity: 2, galleryId, assetId: assets[1] }, OWNER);
    const placed = await checkoutCart.call({ cartId: cart.id, contactId: contact.id, acceptedTerms: true, idempotencyKey: "shared-photo-partial-shipment", shippingAddress: { country: "CA", city: "Courtenay" } }, OWNER);
    const payment = await createPayment.call({ invoiceId: placed.order.invoiceId!, provider: "manual", method: "cash", amountMinor: placed.order.totalMinor, idempotencyKey: "shared-photo-manual-payment" }, OWNER);
    await settlePayment.call({ id: payment.id, providerRef: `manual:${placed.order.id}` }, OWNER);
    await payOrder.call({ id: placed.order.id }, OWNER);
    for (const [index, assetId] of assets.entries()) {
      const line = placed.lines.find(line => line.assetId === assetId)!;
      const shipment = await createFulfillment.call({ orderId: placed.order.id, locationId: location.id, items: [{ orderItemId: line.id, quantity: line.quantity }] }, OWNER);
      await shipFulfillment.call({ id: shipment.fulfillment.id }, OWNER);
      if (index === 0) expect((await db().select().from(stockReservations).where(and(eq(stockReservations.holderId, placed.order.id), eq(stockReservations.status, "active")))).map(hold => hold.quantity)).toEqual([2]);
    }
    const sold = await db().select().from(stockMovements).where(and(eq(stockMovements.inventoryItemId, item.id), eq(stockMovements.reason, "sale")));
    expect(sold.map(row => row.delta).sort((a, b) => a - b)).toEqual([-2, -1]);
    expect(await db().select().from(stockReservations).where(and(eq(stockReservations.holderId, placed.order.id), eq(stockReservations.status, "active")))).toEqual([]);
  });
  it("merges expired carts without borrowing a third buyer's reserved units", { timeout: 60_000 }, async () => {
    const { variant, location, contact, cart, galleryId, assets } = await setup();
    await addCartItem.call({ cartId: cart.id, variantId: variant.id, locationId: location.id, quantity: 1, galleryId, assetId: assets[0] }, OWNER);
    const duplicate = await createContact.call({ name: "Expired duplicate", email: "expired-duplicate@example.test" }, OWNER);
    const incoming = (await getOrCreateCart.call({ contactId: duplicate.id, currency: "CAD" }, OWNER)).cart;
    await addCartItem.call({ cartId: incoming.id, variantId: variant.id, locationId: location.id, quantity: 2, galleryId, assetId: assets[1] }, OWNER);
    await db().update(stockReservations).set({ expiresAt: new Date(0) }).where(eq(stockReservations.holderType, "cart"));
    const third = (await getOrCreateCart.call({ currency: "CAD" }, OWNER)).cart;
    await addCartItem.call({ cartId: third.id, variantId: variant.id, locationId: location.id, quantity: 3 }, OWNER);
    await mergeContacts.call({ survivingId: contact.id, duplicateId: duplicate.id }, OWNER);
    const merged = await getCart.call({ cartId: cart.id }, OWNER);
    expect(merged.lines.map(line => [line.assetId, line.quantity]).sort()).toEqual([[assets[0], 1], [assets[1], 2]].sort());
    expect(merged.allAvailable).toBe(false);
    expect((await getCart.call({ cartId: third.id }, OWNER)).allAvailable).toBe(true);
  });
});
