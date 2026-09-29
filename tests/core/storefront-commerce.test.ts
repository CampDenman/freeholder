// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The public storefront commerce services (C3.25 slice 3): the purchase
// projection, the verified-email checkout entry point, and the token-gated
// order summary.
//
// Three claims, all against the real services and database:
//   1. catalog.purchaseOptions quotes variants through the same resolvePrice
//      and availability the cart refreshes from — card, cart and invoice can
//      never disagree — and only ever describes products a visitor may see.
//   2. catalog.shopperCheckout enforces the C5.21 doctrine: an anonymous
//      caller cannot name a contact and place an order in one step. The email
//      proof is demanded first (the platform's customer magic link), and only
//      a caller whose signed-in contact matches the submitted email — or the
//      idempotent retry of a placed order — reaches checkoutCart.
//   3. catalog.shopperOrder extends the cart-token gate to the converted
//      cart's order, and nothing wider: one guest cannot read another's
//      order, and the projection carries no contact ids or addresses.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts, customerMagicLinks } from "@/core/contacts/schema";
import { orders, productVariants } from "@/modules/catalog/schema";
import { updateBusiness } from "@/core/settings/service";
import {
  addCartItem,
  activateProduct,
  addOptionValue,
  applyVariantMatrix,
  assignProductOption,
  createOptionType,
  createPriceList,
  createProduct,
  getOrCreateCart,
  getProductVariants,
  purchaseOptions,
  setPriceListEntry,
  setProductOptionValues,
  shopperCheckout,
  shopperOrder,
} from "@/modules/catalog/service";
import { createContact } from "@/core/contacts/service";
import { createTaxCategory } from "@/modules/invoicing/tax-service";
import { ANONYMOUS, closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("storefront commerce services", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(
      {
        name: "Aurora Coast Photography",
        country: "CA",
        baseCurrency: "CAD",
        timezone: "America/Vancouver",
        defaultLocale: "en",
        enabledLocales: ["en", "fr", "es", "ar"],
      },
      OWNER,
    );
  });
  afterAll(closeDb);

  async function sizedPrint(name: string, slug: string, size: "s" | "l") {
    const tax = await createTaxCategory.call({ code: `standard_${slug.replace(/-/g, "_")}`, name: "Standard" }, OWNER);
    const option = await createOptionType.call({ name: "Size", code: `size-${slug}` }, OWNER);
    const small = await addOptionValue.call({ optionTypeId: option.id, name: "Small", skuFragment: "s" }, OWNER);
    const large = await addOptionValue.call({ optionTypeId: option.id, name: "Large", skuFragment: "l" }, OWNER);
    let product = await createProduct.call(
      { name, slug, kind: "digital", taxCategoryId: tax.id },
      OWNER,
    );
    let version = (
      await assignProductOption.call(
        { productId: product.id, expectedVersion: product.version, optionTypeId: option.id },
        OWNER,
      )
    ).version;
    const wanted = size === "s" ? small : large;
    version = (
      await setProductOptionValues.call(
        { productId: product.id, expectedVersion: version, optionTypeId: option.id, optionValueIds: [wanted.id] },
        OWNER,
      )
    ).version;
    version = (
      await applyVariantMatrix.call({ productId: product.id, expectedVersion: version }, OWNER)
    ).version;
    const list = await createPriceList.call({ name: `Retail ${slug}`, currency: "CAD", kind: "retail" }, OWNER);
    const variants = (await getProductVariants.call({ productId: product.id }, OWNER)).variants;
    for (const variant of variants) {
      if (variant.status === "active") {
        // Digital goods do not ship; the matrix defaults the flag on.
        await db()
          .update(productVariants)
          .set({ requiresShipping: false })
          .where(eq(productVariants.id, variant.id));
        await setPriceListEntry.call(
          { priceListId: list.id, variantId: variant.id, amount: "25.00" },
          OWNER,
        );
      }
    }
    product = await activateProduct.call({ id: product.id, expectedVersion: version }, OWNER);
    return { product, variants };
  }

  describe("catalog.purchaseOptions", () => {
    it("quotes each variant's options, price and availability from the cart's own sources", async () => {
      await sizedPrint("Coast print", "coast-print", "s");
      await sizedPrint("Dune print", "dune-print", "l");
      const [coast] = await purchaseOptions.call({ slugs: ["coast-print", "dune-print"] }, ANONYMOUS);
      expect(coast!.name).toBe("Coast print");
      expect(coast!.currency).toBe("CAD");
      expect(coast!.priceFromMinor).toBe(2_500);
      expect(coast!.variants).toHaveLength(1);
      expect(coast!.variants[0]).toMatchObject({
        optionLabel: "Size: Small",
        priceMinor: 2_500,
        priceAvailable: true,
        available: true,
        requiresShipping: false,
      });
      // An unknown slug is not an error; it is not there either.
      const gone = await purchaseOptions.call({ slugs: ["coast-print", "nope"] }, ANONYMOUS);
      expect(gone.map((entry) => entry.slug)).toEqual(["coast-print"]);
    });

    it("never describes products a visitor may not see", async () => {
      const { product } = await sizedPrint("Secret print", "secret-print", "s");
      await createProduct.call({ name: "Draft", slug: "draft-print", kind: "digital" }, OWNER);
      const hidden = await purchaseOptions.call(
        { productIds: [product.id] },
        ANONYMOUS,
      );
      expect(hidden).toHaveLength(1);
      const rows = await purchaseOptions.call(
        { slugs: ["draft-print"] },
        ANONYMOUS,
      );
      expect(rows).toEqual([]);
    });
  });

  describe("catalog.shopperCheckout", () => {
    it("refuses anonymous one-step checkout and demands the email proof first", async () => {
      const { variants } = await sizedPrint("Coast print", "coast-print", "s");
      const variant = variants.find((row) => row.status === "active")!;
      const basket = await getOrCreateCart.call({ currency: "CAD" }, ANONYMOUS);
      await addCartItem.call(
        { cartId: basket.cart.id, cartToken: basket.cart.token!, variantId: variant.id },
        ANONYMOUS,
      );

      const asked = await shopperCheckout.call(
        {
          cartId: basket.cart.id,
          cartToken: basket.cart.token!,
          email: "guest@example.test",
          acceptedTerms: true,
          idempotencyKey: "guest-checkout-1",
        },
        ANONYMOUS,
      );
      expect(asked).toEqual({ status: "verification_sent", email: "guest@example.test", orderId: null });

      // The spine resolved the contact (automated paths resolve, never
      // create), and the platform's existing proof is on its way.
      const [contact] = await db().select().from(contacts).where(eq(contacts.email, "guest@example.test"));
      expect(contact).toBeDefined();
      expect(contact!.source).toBe("storefront_checkout");
      const [link] = await db().select().from(customerMagicLinks).where(eq(customerMagicLinks.contactId, contact!.id));
      expect(link).toBeDefined();
      expect(link!.usedAt).toBeNull();

      // No order was created, and the cart is still open and owned by its token.
      expect(await db().select().from(orders)).toHaveLength(0);
      const still = await getOrCreateCart.call({ token: basket.cart.token, currency: "CAD" }, ANONYMOUS);
      expect(still.cart.id).toBe(basket.cart.id);
      expect(still.lines).toHaveLength(1);
    });

    it("places the order for a signed-in customer whose contact email matches, idempotently", async () => {
      const { variants } = await sizedPrint("Coast print", "coast-print", "s");
      const variant = variants.find((row) => row.status === "active")!;
      const basket = await getOrCreateCart.call({ currency: "CAD" }, ANONYMOUS);
      await addCartItem.call(
        { cartId: basket.cart.id, cartToken: basket.cart.token!, variantId: variant.id, quantity: 2 },
        ANONYMOUS,
      );
      await db().insert(users).values({ id: CUSTOMER.userId, email: "buyer@example.test", role: "customer" });
      const contact = await createContact.call({ name: "Buyer", email: "buyer@example.test" }, OWNER);
      await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, contact.id));

      const placed = await shopperCheckout.call(
        {
          cartId: basket.cart.id,
          cartToken: basket.cart.token!,
          email: "buyer@example.test",
          acceptedTerms: true,
          idempotencyKey: "buyer-checkout-1",
        },
        CUSTOMER,
      );
      expect(placed.status).toBe("placed");
      expect(placed.orderId).toBeTruthy();

      // The order carries the contact, an issued invoice, and the converted cart.
      const [order] = await db().select().from(orders).where(eq(orders.id, placed.orderId!));
      expect(order).toMatchObject({
        contactId: contact.id,
        cartId: basket.cart.id,
        status: "pending_payment",
        subtotalMinor: 5_000,
        totalMinor: 5_000,
      });
      expect(order!.invoiceId).toBeTruthy();

      // The same idempotency key (a retry) and even a fresh key on the
      // converted cart both converge on the one order.
      const retry = await shopperCheckout.call(
        {
          cartId: basket.cart.id,
          cartToken: basket.cart.token!,
          email: "buyer@example.test",
          acceptedTerms: true,
          idempotencyKey: "buyer-checkout-1",
        },
        CUSTOMER,
      );
      expect(retry.orderId).toBe(placed.orderId);
      expect(await db().select().from(orders)).toHaveLength(1);
    });

    it("never lets a signed-in customer name somebody else's email", async () => {
      const { variants } = await sizedPrint("Coast print", "coast-print", "s");
      const variant = variants.find((row) => row.status === "active")!;
      const basket = await getOrCreateCart.call({ currency: "CAD" }, ANONYMOUS);
      await addCartItem.call(
        { cartId: basket.cart.id, cartToken: basket.cart.token!, variantId: variant.id },
        ANONYMOUS,
      );
      await db().insert(users).values({ id: CUSTOMER.userId, email: "buyer@example.test", role: "customer" });
      const contact = await createContact.call({ name: "Buyer", email: "buyer@example.test" }, OWNER);
      await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, contact.id));

      const asked = await shopperCheckout.call(
        {
          cartId: basket.cart.id,
          cartToken: basket.cart.token!,
          email: "someone-else@example.test",
          acceptedTerms: true,
          idempotencyKey: "wrong-email-1",
        },
        CUSTOMER,
      );
      expect(asked.status).toBe("verification_sent");
      expect(await db().select().from(orders)).toHaveLength(0);
    });

    it("requires the cart token, open cart, terms and lines", async () => {
      const { variants } = await sizedPrint("Coast print", "coast-print", "s");
      const variant = variants.find((row) => row.status === "active")!;
      const basket = await getOrCreateCart.call({ currency: "CAD" }, ANONYMOUS);
      await addCartItem.call(
        { cartId: basket.cart.id, cartToken: basket.cart.token!, variantId: variant.id },
        ANONYMOUS,
      );

      await expect(
        shopperCheckout.call(
          { cartId: basket.cart.id, email: "a@example.test", acceptedTerms: true, idempotencyKey: "no-token-1" },
          ANONYMOUS,
        ),
      ).rejects.toMatchObject({ code: "permission" });
      await expect(
        shopperCheckout.call(
          {
            cartId: basket.cart.id,
            cartToken: "00000000-0000-4000-8000-000000000099",
            email: "a@example.test",
            acceptedTerms: true,
            idempotencyKey: "bad-token-1",
          },
          ANONYMOUS,
        ),
      ).rejects.toMatchObject({ code: "permission" });
      await expect(
        shopperCheckout.call(
          {
            cartId: basket.cart.id,
            cartToken: basket.cart.token!,
            email: "not-an-email",
            acceptedTerms: true,
            idempotencyKey: "bad-email-1",
          },
          ANONYMOUS,
        ),
      ).rejects.toMatchObject({ code: "validation" });
      expect((await failure(shopperCheckout.call({
        cartId: basket.cart.id,
        cartToken: basket.cart.token!,
        email: "a@example.test",
        acceptedTerms: false as unknown as true,
        idempotencyKey: "no-terms-1",
      }, ANONYMOUS))).code).toBe("validation");

      const empty = await getOrCreateCart.call({ currency: "CAD" }, ANONYMOUS);
      expect((await failure(shopperCheckout.call({
        cartId: empty.cart.id,
        cartToken: empty.cart.token!,
        email: "a@example.test",
        acceptedTerms: true,
        idempotencyKey: "empty-cart-1",
      }, ANONYMOUS))).code).toBe("validation");
    });

    it("requires a shipping address for physical carts through the composed checkout", async () => {
      const tax = await createTaxCategory.call({ code: "physical_standard", name: "Standard" }, OWNER);
      const product = await createProduct.call(
        { name: "Framed print", slug: "framed-print", kind: "physical", taxCategoryId: tax.id },
        OWNER,
      );
      const version = (
        await applyVariantMatrix.call({ productId: product.id, expectedVersion: product.version }, OWNER)
      ).version;
      const list = await createPriceList.call({ name: "Retail framed", currency: "CAD", kind: "retail" }, OWNER);
      const variant = (await getProductVariants.call({ productId: product.id }, OWNER)).variants[0]!;
      await setPriceListEntry.call({ priceListId: list.id, variantId: variant.id, amount: "80.00" }, OWNER);
      await activateProduct.call({ id: product.id, expectedVersion: version }, OWNER);

      const basket = await getOrCreateCart.call({ currency: "CAD" }, ANONYMOUS);
      await addCartItem.call(
        { cartId: basket.cart.id, cartToken: basket.cart.token!, variantId: variant.id },
        ANONYMOUS,
      );
      await db().insert(users).values({ id: CUSTOMER.userId, email: "buyer@example.test", role: "customer" });
      const contact = await createContact.call({ name: "Buyer", email: "buyer@example.test" }, OWNER);
      await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, contact.id));

      const refused = await failure(
        shopperCheckout.call(
          {
            cartId: basket.cart.id,
            cartToken: basket.cart.token!,
            email: "buyer@example.test",
            acceptedTerms: true,
            idempotencyKey: "physical-no-address-1",
          },
          CUSTOMER,
        ),
      );
      expect(refused.code).toBe("validation");
      expect(refused.message).toMatch(/shipping address/i);
    });
  });

  describe("catalog.shopperOrder", () => {
    async function placedOrder() {
      const { variants } = await sizedPrint("Coast print", "coast-print", "s");
      const variant = variants.find((row) => row.status === "active")!;
      const basket = await getOrCreateCart.call({ currency: "CAD" }, ANONYMOUS);
      await addCartItem.call(
        { cartId: basket.cart.id, cartToken: basket.cart.token!, variantId: variant.id, quantity: 2 },
        ANONYMOUS,
      );
      await db().insert(users).values({ id: CUSTOMER.userId, email: "buyer@example.test", role: "customer" });
      const contact = await createContact.call({ name: "Buyer", email: "buyer@example.test" }, OWNER);
      await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, contact.id));
      const placed = await shopperCheckout.call(
        {
          cartId: basket.cart.id,
          cartToken: basket.cart.token!,
          email: "buyer@example.test",
          acceptedTerms: true,
          idempotencyKey: "order-view-1",
        },
        CUSTOMER,
      );
      return { basket, orderId: placed.orderId! };
    }

    it("shows the token holder the reduced summary with the invoice pay path", async () => {
      const { basket, orderId } = await placedOrder();
      const view = await shopperOrder.call(
        { cartId: basket.cart.id, cartToken: basket.cart.token! },
        ANONYMOUS,
      );
      expect(view.order).toMatchObject({
        id: orderId,
        status: "pending_payment",
        currency: "CAD",
        subtotalMinor: 5_000,
        totalMinor: 5_000,
      });
      expect(view.lines).toHaveLength(1);
      expect(view.lines[0]).toMatchObject({
        productName: "Coast print",
        quantity: 2,
        unitAmountMinor: 2_500,
        lineTotalMinor: 5_000,
      });
      expect(view.lines[0]!.sku).toContain("coast-print");
      expect(view.invoice?.number).toBeTruthy();
      // The existing customer invoice surface, token and all — the same link
      // shape the emailed invoice carries.
      expect(view.payHref).toMatch(new RegExp(`^/portal/invoices/${view.invoice!.id}\\?token=`));
    });

    it("refuses everyone who does not hold the cart's token", async () => {
      const { basket } = await placedOrder();
      const other = await getOrCreateCart.call({ currency: "CAD" }, ANONYMOUS);
      // Another guest's token, pointed at this order's cart.
      await expect(
        shopperOrder.call(
          { cartId: basket.cart.id, cartToken: other.cart.token! },
          ANONYMOUS,
        ),
      ).rejects.toMatchObject({ code: "permission" });
      // No token at all.
      await expect(
        shopperOrder.call({ cartId: basket.cart.id, cartToken: "00000000-0000-4000-8000-000000000099" }, ANONYMOUS),
      ).rejects.toMatchObject({ code: "permission" });
      // An open cart has no order to show.
      await expect(
        shopperOrder.call({ cartId: other.cart.id, cartToken: other.cart.token! }, ANONYMOUS),
      ).rejects.toMatchObject({ code: "not_found" });
    });
  });
});
