// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Print and digital sales from a gallery (MASTER.md §4.5, C8.08).
//
// The rules:
//
//   1. Selling goes through the ordinary cart. §4.5 forbids a parallel
//      commerce path, and the gallery decides only *what may be bought and of
//      which frame* — price, stock and tax stay with the variant.
//   2. Two photographs ordered as the same product are two lines, not one line
//      of quantity two. The lab has to know which images to print.
//   3. Ordinary shopping still merges, exactly as before.
//   4. Only what the owner put on the price sheet can be bought.
//   5. Buying follows the view ceiling.
//   6. Provenance survives checkout onto the order line, or it was never
//      provenance.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { assets } from "@/core/media/schema";
import { createContact } from "@/core/contacts/service";
import { updateBusiness } from "@/core/settings/service";
import {
  addCartItem,
  getOrCreateCart,
} from "@/modules/catalog/cart";
import {
  applyVariantMatrix,
  createProduct,
  getProductVariants,
} from "@/modules/catalog/service";
import { createPriceList, setPriceListEntry } from "@/modules/catalog/pricing";
import { cartItems, orderItems } from "@/modules/catalog/schema";
import {
  addGalleryItem,
  addGalleryItemToCart,
  addGalleryPriceSheetItem,
  createGallery,
  listGalleryPriceSheet,
  removeGalleryPriceSheetItem,
  unlockGallery,
  updateGalleryItem,
} from "@/modules/galleries/service";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe.runIf(hasDatabase)("gallery sales", { timeout: 90_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await updateBusiness.call(
      {
        name: "Hearth & Pine",
        country: "CA",
        baseCurrency: "CAD",
        timezone: "America/Vancouver",
      },
      OWNER,
    );
  }, 60_000);
  afterAll(closeDb);

  async function pricedVariant(slug: string, name = "8x10 print", kind: "physical" | "digital" = "physical") {
    const product = await createProduct.call({ name, slug, kind }, OWNER);
    const updated = await applyVariantMatrix.call(
      { productId: product.id, expectedVersion: product.version },
      OWNER,
    );
    const bundle = await getProductVariants.call({ productId: updated.id }, OWNER);
    const variant = bundle.variants[0]!;
    const list = await createPriceList.call(
      { name: `CAD retail ${slug}`, currency: "CAD", kind: "retail" },
      OWNER,
    );
    await setPriceListEntry.call(
      { priceListId: list.id, variantId: variant.id, amount: "40.00" },
      OWNER,
    );
    return variant;
  }

  async function image(filename: string) {
    const [created] = await db()
      .insert(assets)
      .values({
        kind: "image",
        storageKey: `test/${crypto.randomUUID()}.jpg`,
        filename,
        mime: "image/jpeg",
        legacyBytes: 1024,
        bytes: 1024,
        status: "ready",
      })
      .returning();
    return created!;
  }

  async function sellingGallery() {
    const client = await createContact.call(
      { name: "Rae Lane", email: "client@example.test" },
      OWNER,
    );
    const gallery = await createGallery.call(
      { contactId: client.id, title: "Prints", access: "pin", secret: "2468" },
      OWNER,
    );
    const opened = await unlockGallery.call(
      { slug: gallery.slug, secret: "2468" },
      ANONYMOUS,
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error("expected the gallery to open");
    return { client, gallery, sessionToken: opened.sessionToken };
  }

  it("keeps two photographs of one product as two lines", async () => {
    const { gallery, sessionToken } = await sellingGallery();
    const variant = await pricedVariant("print-a");
    await addGalleryPriceSheetItem.call(
      { galleryId: gallery.id, variantId: variant.id },
      OWNER,
    );

    const one = await image("one.jpg");
    const two = await image("two.jpg");
    const itemOne = await addGalleryItem.call(
      { galleryId: gallery.id, assetId: one.id },
      OWNER,
    );
    const itemTwo = await addGalleryItem.call(
      { galleryId: gallery.id, assetId: two.id },
      OWNER,
    );

    const cart = await getOrCreateCart.call({ currency: "CAD" }, ANONYMOUS);
    await addGalleryItemToCart.call(
      { sessionToken, itemId: itemOne.id, variantId: variant.id, cartId: cart.cart.id },
      ANONYMOUS,
    );
    await addGalleryItemToCart.call(
      { sessionToken, itemId: itemTwo.id, variantId: variant.id, cartId: cart.cart.id },
      ANONYMOUS,
    );

    const lines = await db()
      .select()
      .from(cartItems)
      .where(eq(cartItems.cartId, cart.cart.id));
    // One line of quantity two would leave the lab with no idea which images
    // to print — the exact provenance this item exists to preserve.
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.assetId).sort()).toEqual([one.id, two.id].sort());
    expect(lines.every((l) => l.galleryId === gallery.id)).toBe(true);
    expect(lines.every((l) => l.quantity === 1)).toBe(true);
  });

  it("still merges ordinary shopping, which has no photograph", async () => {
    const variant = await pricedVariant("print-b");
    const cart = await getOrCreateCart.call({ currency: "CAD" }, ANONYMOUS);
    await addCartItem.call(
      { cartId: cart.cart.id, variantId: variant.id, quantity: 2 },
      ANONYMOUS,
    );
    const filled = await addCartItem.call(
      { cartId: cart.cart.id, variantId: variant.id, quantity: 3 },
      ANONYMOUS,
    );
    // The change must not turn every catalogue page into a line-per-click.
    expect(filled.lines).toHaveLength(1);
    expect(filled.lines[0]!.quantity).toBe(5);
    expect(filled.lines[0]!.assetId).toBeNull();
  });

  it("refuses a product the owner did not put on the sheet", async () => {
    const { gallery, sessionToken } = await sellingGallery();
    const offered = await pricedVariant("print-c");
    const notOffered = await pricedVariant("print-d", "Canvas");
    await addGalleryPriceSheetItem.call(
      { galleryId: gallery.id, variantId: offered.id },
      OWNER,
    );
    const one = await image("one.jpg");
    const item = await addGalleryItem.call(
      { galleryId: gallery.id, assetId: one.id },
      OWNER,
    );
    const cart = await getOrCreateCart.call({ currency: "CAD" }, ANONYMOUS);
    // Otherwise a variant id is an open door onto the whole catalogue from a
    // PIN-gated page.
    expect(
      (
        await failure(
          addGalleryItemToCart.call(
            { sessionToken, itemId: item.id, variantId: notOffered.id, cartId: cart.cart.id },
            ANONYMOUS,
          ),
        )
      ).message,
    ).toContain("not for sale");
  });

  it("refuses a print of a frame the person cannot see", async () => {
    const { gallery, sessionToken } = await sellingGallery();
    const variant = await pricedVariant("print-e");
    await addGalleryPriceSheetItem.call(
      { galleryId: gallery.id, variantId: variant.id },
      OWNER,
    );
    const hidden = await image("hidden.jpg");
    const item = await addGalleryItem.call(
      { galleryId: gallery.id, assetId: hidden.id },
      OWNER,
    );
    await updateGalleryItem.call({ id: item.id, canView: false }, OWNER);
    const cart = await getOrCreateCart.call({ currency: "CAD" }, ANONYMOUS);
    expect(
      (
        await failure(
          addGalleryItemToCart.call(
            { sessionToken, itemId: item.id, variantId: variant.id, cartId: cart.cart.id },
            ANONYMOUS,
          ),
        )
      ).message,
    ).toContain("not in this gallery");
  });

  it("manages the price sheet", async () => {
    const { gallery } = await sellingGallery();
    const variant = await pricedVariant("print-f");
    const added = await addGalleryPriceSheetItem.call(
      { galleryId: gallery.id, variantId: variant.id, position: 2 },
      OWNER,
    );
    expect(added).toMatchObject({ variantId: variant.id, position: 2 });
    // Offering the same thing twice moves it rather than duplicating it.
    const again = await addGalleryPriceSheetItem.call(
      { galleryId: gallery.id, variantId: variant.id, position: 5 },
      OWNER,
    );
    expect(again.id).toBe(added.id);
    expect(again.position).toBe(5);
    expect(await listGalleryPriceSheet.call({ galleryId: gallery.id }, OWNER)).toHaveLength(1);

    await removeGalleryPriceSheetItem.call({ id: added.id }, OWNER);
    expect(await listGalleryPriceSheet.call({ galleryId: gallery.id }, OWNER)).toEqual([]);
  });

  it("carries provenance onto the order line", async () => {
    const { client, gallery, sessionToken } = await sellingGallery();
    // A digital download: C8.08 is "print/digital", and this half of it needs
    // no shipping apparatus to prove the provenance point.
    const variant = await pricedVariant("download-g", "Digital download", "digital");
    // requires_shipping defaults to true on every variant regardless of the
    // product kind, and shipping zones are not this test's subject.
    const { productVariants } = await import("@/modules/catalog/schema");
    await db()
      .update(productVariants)
      .set({ requiresShipping: false })
      .where(eq(productVariants.id, variant.id));
    await addGalleryPriceSheetItem.call(
      { galleryId: gallery.id, variantId: variant.id },
      OWNER,
    );
    const one = await image("one.jpg");
    const item = await addGalleryItem.call(
      { galleryId: gallery.id, assetId: one.id },
      OWNER,
    );
    const cart = await getOrCreateCart.call(
      { currency: "CAD", contactId: client.id },
      OWNER,
    );
    await addGalleryItemToCart.call(
      { sessionToken, itemId: item.id, variantId: variant.id, cartId: cart.cart.id },
      ANONYMOUS,
    );

    const { checkoutCart } = await import("@/modules/catalog/orders");
    const order = await checkoutCart.call(
      {
        cartId: cart.cart.id,
        contactId: client.id,
        idempotencyKey: `gallery-sale-${crypto.randomUUID()}`,
        acceptedTerms: true as const,
      },
      OWNER,
    );

    const lines = await db()
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.order.id));
    expect(lines).toHaveLength(1);
    // The owner has to know which gallery and which frame long after the cart
    // is gone, so this rides on the line rather than in a jsonb blob.
    expect(lines[0]).toMatchObject({ galleryId: gallery.id, assetId: one.id });
  });
});
