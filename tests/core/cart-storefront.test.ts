// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The public cart, checkout and confirmation surfaces (C3.25 slice 3): the
// page states, the add-to-cart flow, the security isolation between guests,
// and the EN/FR/ES/AR chrome.
//
// Four claims:
//   1. **Every page state renders** — empty cart, cart with options, the
//      checkout form and its error/notice states, the confirmation summary
//      and its denials — against the real services and database.
//   2. **The buy flow is one honest pipeline** — the card's add-to-cart posts
//      through the Server Action, the cookie carries the capability, and the
//      cart page shows the line with its variant label.
//   3. **Isolation holds at the page layer** — one guest's cookie cannot read
//      another guest's cart or order; a missing token is a 404, not a hint.
//   4. **The chrome translates and stays themeless** — every control in
//      EN/FR/ES/AR with localized links, and only semantic token classes.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { createElement } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { productVariants } from "@/modules/catalog/schema";
import { createTaxCategory } from "@/modules/invoicing/tax-service";
import {
  activateProduct,
  addCartItem,
  addOptionValue,
  applyVariantMatrix,
  assignProductOption,
  createOptionType,
  createPriceList,
  createProduct,
  getOrCreateCart,
  getProductVariants,
  setPriceListEntry,
  setProductOptionValues,
} from "@/modules/catalog/service";
import { createSession, SESSION_COOKIE } from "@/core/auth/sessions";
import { SHOPPER_CART_COOKIE } from "@/modules/catalog/cookies";
import { quoteDeliveryAction } from "../../app/(public)/checkout/checkout-actions";
import { createContact } from "@/core/contacts/service";
import { updateBusiness } from "@/core/settings/service";
import { localeDirection } from "@/core/i18n";
import { LOCALE_HEADER, PATH_HEADER } from "@/core/http/headers";
import { ANONYMOUS, closeDb, CUSTOMER, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
import { cartWidget } from "@/modules/cms/blocks/library";
import { addToCartAction } from "../../app/(public)/buy/buy-actions";
import CartPage, { generateMetadata as cartMetadata } from "../../app/(public)/cart/page";
import CheckoutPage, { generateMetadata as checkoutMetadata } from "../../app/(public)/checkout/page";
import OrderConfirmPage, {
  generateMetadata as confirmMetadata,
} from "../../app/(public)/orders/confirm/page";

const headerState = vi.hoisted((): { locale: string | undefined; path: string } => ({
  locale: undefined,
  path: "/cart",
}));
const jarState = vi.hoisted((): { cookies: Record<string, string> } => ({ cookies: {} }));

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) =>
      name === LOCALE_HEADER
        ? headerState.locale
        : name === PATH_HEADER
          ? headerState.path
          : null,
  }),
  cookies: async () => ({
    get: (name: string) =>
      jarState.cookies[name] === undefined ? undefined : { value: jarState.cookies[name] },
    set: (name: string, value: string) => {
      jarState.cookies[name] = value;
    },
    delete: (name: string) => {
      delete jarState.cookies[name];
    },
  }),
}));

async function renderElement(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  const reader = stream.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const decoder = new TextDecoder();
  let html = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) html += decoder.decode(value, { stream: true });
  }
  html += decoder.decode();
  return html;
}

type Query = Record<string, string | string[] | undefined>;

async function renderCart(query: Query = {}, locale?: string) {
  headerState.locale = locale;
  const searchParams = Promise.resolve(query);
  const metadata = await cartMetadata({ searchParams });
  const element = await CartPage({ searchParams });
  return { metadata, html: await renderElement(element) };
}

async function renderCheckout(query: Query = {}, locale?: string) {
  headerState.locale = locale;
  const searchParams = Promise.resolve(query);
  const metadata = await checkoutMetadata({ searchParams });
  const element = await CheckoutPage({ searchParams });
  return { metadata, html: await renderElement(element) };
}

async function renderConfirm(query: Query, locale?: string) {
  headerState.locale = locale;
  const searchParams = Promise.resolve(query);
  const metadata = await confirmMetadata({ searchParams });
  const element = await OrderConfirmPage({ searchParams });
  return { metadata, html: await renderElement(element) };
}

describe.runIf(hasDatabase)("the public cart, checkout and confirmation pages", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    headerState.locale = undefined;
    headerState.path = "/cart";
    jarState.cookies = {};
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

  /** One digital print with one Size option and two active variants. */
  async function twinPrint() {
    const tax = await createTaxCategory.call({ code: "standard_print", name: "Standard" }, OWNER);
    const size = await createOptionType.call({ name: "Size", code: "size" }, OWNER);
    const small = await addOptionValue.call({ optionTypeId: size.id, name: "Small", skuFragment: "s" }, OWNER);
    const large = await addOptionValue.call({ optionTypeId: size.id, name: "Large", skuFragment: "l" }, OWNER);
    let product = await createProduct.call(
      { name: "Coast print", slug: "coast-print", kind: "digital", taxCategoryId: tax.id },
      OWNER,
    );
    let version = (
      await assignProductOption.call(
        { productId: product.id, expectedVersion: product.version, optionTypeId: size.id },
        OWNER,
      )
    ).version;
    version = (
      await setProductOptionValues.call(
        {
          productId: product.id,
          expectedVersion: version,
          optionTypeId: size.id,
          optionValueIds: [small.id, large.id],
        },
        OWNER,
      )
    ).version;
    version = (
      await applyVariantMatrix.call({ productId: product.id, expectedVersion: version }, OWNER)
    ).version;
    const list = await createPriceList.call({ name: "CAD retail", currency: "CAD", kind: "retail" }, OWNER);
    const variants = (await getProductVariants.call({ productId: product.id }, OWNER)).variants;
    for (const variant of variants) {
      if (variant.status === "active") {
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
    return { product, variants: variants.filter((variant) => variant.status === "active") };
  }

  async function signedInCustomer(email = "buyer@example.test") {
    await db().insert(users).values({ id: CUSTOMER.userId, email, role: "customer" });
    const contact = await createContact.call({ name: "Buyer", email }, OWNER);
    await db().update(contacts).set({ userId: CUSTOMER.userId }).where(eq(contacts.id, contact.id));
    const session = await db().transaction((tx) => createSession(tx, CUSTOMER.userId));
    return { contact, session };
  }

  it("renders the empty cart as a noindexed utility with a way back to the shop", async () => {
    const { metadata, html } = await renderCart();
    expect(html).toContain("Your cart is empty.");
    expect(html).toContain('href="/search"');
    expect(html).not.toContain("Check out");
    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(metadata.alternates?.canonical).toBe("http://localhost:3000/cart");
  });

  it("adds to cart through the action and renders the line with its variant label", async () => {
    const { variants } = await twinPrint();
    const small = variants.find((variant) => variant.sku.endsWith("-s"))!;

    // The Server Action is the same door the card's form posts to: no cookie
    // yet, so it opens a cart, stores the capability and redirects back.
    headerState.path = "/c/wall";
    const form = new FormData();
    form.set("variantId", small.id);
    form.set("product", "coast-print");
    await expect(addToCartAction(form)).rejects.toThrow(/NEXT_REDIRECT/);
    const credential = jarState.cookies[SHOPPER_CART_COOKIE];
    expect(credential).toMatch(/^[0-9a-f-]{36}\.[0-9a-f-]{36}$/);

    headerState.path = "/cart";
    const { html } = await renderCart();
    expect(html).toContain("Coast print");
    expect(html).toContain("Size: Small");
    expect(html).toContain("Subtotal");
    expect(html).toContain("CA$25.00");
    expect(html).toContain('href="/checkout"');
    // Anonymous visitors get no wishlist handoff — it needs a signed-in contact.
    expect(html).not.toContain("Save for later");
  });

  it("offers the variant picker on the shelf for products with options", async () => {
    const { product } = await twinPrint();
    const { createCollection, addCollectionProduct, updateCollection } = await import("@/modules/catalog/service");
    const collection = await createCollection.call({ title: "The Wall", slug: "wall" }, OWNER);
    await addCollectionProduct.call({ collectionId: collection.id, productId: product.id }, OWNER);
    await updateCollection.call({ id: collection.id, expectedVersion: 1, published: true }, OWNER);

    const { default: PublicCollectionPage } = await import("../../app/(public)/c/[slug]/page");
    headerState.path = "/c/wall";
    const element = await PublicCollectionPage({
      params: Promise.resolve({ slug: "wall" }),
      searchParams: Promise.resolve({}),
    });
    const html = await renderElement(element);
    // One product, two variants: a chooser, one form per variant, both priced.
    expect(html).toContain("Choose options");
    expect(html.match(/name="variantId"/g)).toHaveLength(2);
    expect(html).toContain("Size: Small");
    expect(html).toContain("Size: Large");
  });

  it("shows the save-for-later handoff only to a signed-in customer", async () => {
    const { variants } = await twinPrint();
    const { session } = await signedInCustomer();
    const basket = await getOrCreateCart.call({ currency: "CAD" }, ANONYMOUS);
    await addCartItem.call(
      { cartId: basket.cart.id, cartToken: basket.cart.token!, variantId: variants[0]!.id },
      ANONYMOUS,
    );
    jarState.cookies[SHOPPER_CART_COOKIE] = `${basket.cart.id}.${basket.cart.token}`;
    jarState.cookies[SESSION_COOKIE] = session.token;

    const { html } = await renderCart();
    expect(html).toContain("Save for later");
  });

  it("redirects an empty cart away from checkout and renders the form otherwise", async () => {
    await expect(renderCheckout()).rejects.toThrow(/NEXT_REDIRECT/);

    const { variants } = await twinPrint();
    const basket = await getOrCreateCart.call({ currency: "CAD" }, ANONYMOUS);
    await addCartItem.call(
      { cartId: basket.cart.id, cartToken: basket.cart.token!, variantId: variants[0]!.id },
      ANONYMOUS,
    );
    jarState.cookies[SHOPPER_CART_COOKIE] = `${basket.cart.id}.${basket.cart.token}`;

    const { metadata, html } = await renderCheckout();
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(html).toContain('id="checkout-email"');
    expect(html).toContain('id="checkout-terms"');
    expect(html).toContain("Place order");
    // Digital cart: no shipping address, and the methods island says so.
    expect(html).not.toContain('id="checkout-country"');
    expect(html).toContain("Digital delivery");
  });

  it("maps checkout error codes and the verification notice without echoing text", async () => {
    const { variants } = await twinPrint();
    const basket = await getOrCreateCart.call({ currency: "CAD" }, ANONYMOUS);
    await addCartItem.call(
      { cartId: basket.cart.id, cartToken: basket.cart.token!, variantId: variants[0]!.id },
      ANONYMOUS,
    );
    jarState.cookies[SHOPPER_CART_COOKIE] = `${basket.cart.id}.${basket.cart.token}`;

    const terms = await renderCheckout({ error: "terms" });
    expect(terms.html).toContain("Please accept the terms of sale");
    const address = await renderCheckout({ error: "address" });
    expect(address.html).toContain("country code");
    const unknown = await renderCheckout({ error: "bogus-code" });
    expect(unknown.html).toContain("The order could not be placed.");
    const sent = await renderCheckout({ sent: "1" });
    expect(sent.html).toContain("Check your inbox");
  });

  it("shows the signed-in shopper their email and prefills the contact fields", async () => {
    const { variants } = await twinPrint();
    const { session } = await signedInCustomer("prefill@example.test");
    const basket = await getOrCreateCart.call({ currency: "CAD" }, ANONYMOUS);
    await addCartItem.call(
      { cartId: basket.cart.id, cartToken: basket.cart.token!, variantId: variants[0]!.id },
      ANONYMOUS,
    );
    jarState.cookies[SHOPPER_CART_COOKIE] = `${basket.cart.id}.${basket.cart.token}`;
    jarState.cookies[SESSION_COOKIE] = session.token;

    const { html } = await renderCheckout();
    expect(html).toContain("signed in as prefill@example.test");
    expect(html).toContain('value="prefill@example.test"');
  });

  it("confirms the order for the token holder with the pay path, and refuses everyone else", async () => {
    const { variants } = await twinPrint();
    const { session } = await signedInCustomer();
    const basket = await getOrCreateCart.call({ currency: "CAD" }, ANONYMOUS);
    await addCartItem.call(
      { cartId: basket.cart.id, cartToken: basket.cart.token!, variantId: variants[0]!.id, quantity: 2 },
      ANONYMOUS,
    );
    jarState.cookies[SHOPPER_CART_COOKIE] = `${basket.cart.id}.${basket.cart.token}`;
    jarState.cookies[SESSION_COOKIE] = session.token;
    const { shopperCheckout } = await import("@/modules/catalog/service");
    await shopperCheckout.call(
      {
        cartId: basket.cart.id,
        cartToken: basket.cart.token!,
        email: "buyer@example.test",
        acceptedTerms: true,
        idempotencyKey: "confirm-render-1",
      },
      CUSTOMER,
    );

    const ok = await renderConfirm({ cart: basket.cart.id, t: basket.cart.token! });
    expect(ok.metadata.robots).toEqual({ index: false, follow: false });
    expect(ok.html).toContain("Thank you for your order");
    expect(ok.html).toContain("Coast print");
    expect(ok.html).toContain("CA$50.00");
    expect(ok.html).toContain("Pay now");
    expect(ok.html).toMatch(/\/portal\/invoices\/[0-9a-f-]+\?token=/);

    // Another guest's token is refused, and so is none at all — both the
    // same plain 404 the services answer.
    const stranger = await getOrCreateCart.call({ currency: "CAD" }, ANONYMOUS);
    await expect(renderConfirm({ cart: basket.cart.id, t: stranger.cart.token! })).rejects.toThrow(/404/);
    await expect(renderConfirm({ cart: basket.cart.id })).rejects.toThrow(/404/);
  });

  it("translates the chrome and prefixes links in fr, es and ar", async () => {
    const { variants } = await twinPrint();
    const basket = await getOrCreateCart.call({ currency: "CAD" }, ANONYMOUS);
    await addCartItem.call(
      { cartId: basket.cart.id, cartToken: basket.cart.token!, variantId: variants[0]!.id },
      ANONYMOUS,
    );
    jarState.cookies[SHOPPER_CART_COOKIE] = `${basket.cart.id}.${basket.cart.token}`;

    const expected: Record<string, { title: string; subtotal: string; checkout: string }> = {
      fr: { title: "Votre panier", subtotal: "Sous-total", checkout: "Passer commande" },
      es: { title: "Tu carrito", subtotal: "Subtotal", checkout: "Pagar" },
      ar: { title: "سلتك", subtotal: "المجموع الفرعي", checkout: "إتمام الطلب" },
    };
    for (const [locale, labels] of Object.entries(expected)) {
      const { html } = await renderCart({}, locale);
      expect(html).toContain(labels.title);
      expect(html).toContain(labels.subtotal);
      expect(html).toContain(`href="/${locale}/checkout"`);
      expect(localeDirection(locale)).toBe(locale === "ar" ? "rtl" : "ltr");
    }
    const english = await renderCart();
    expect(english.html).toContain('href="/checkout"');

    const frCheckout = await renderCheckout({}, "fr");
    expect(frCheckout.html).toContain("Commande");
    const esConfirmTerms = await renderCheckout({ error: "terms" }, "es");
    expect(esConfirmTerms.html).toContain("Acepto");
  });

  it("uses semantic token classes so both themes inherit it unchanged", async () => {
    const { variants } = await twinPrint();
    const basket = await getOrCreateCart.call({ currency: "CAD" }, ANONYMOUS);
    await addCartItem.call(
      { cartId: basket.cart.id, cartToken: basket.cart.token!, variantId: variants[0]!.id },
      ANONYMOUS,
    );
    jarState.cookies[SHOPPER_CART_COOKIE] = `${basket.cart.id}.${basket.cart.token}`;
    const { html } = await renderCart();
    expect(html).toContain("text-ink");
    expect(html).toContain("border-rule");
    expect(html).not.toMatch(/text-(gray|slate|zinc|white|black)/);
  });

  it("quotes the eligible delivery methods for a physical cart's address", async () => {
    const {
      createShippingZone,
      createShippingMethod,
    } = await import("@/modules/catalog/service");
    const tax = await createTaxCategory.call({ code: "standard_ship", name: "Standard" }, OWNER);
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
    const zone = await createShippingZone.call({ name: "World", countries: [], regions: [], postalPatterns: [] }, OWNER);
    await createShippingMethod.call({ zoneId: zone.id, name: "Parcel", kind: "flat", currency: "CAD", amount: "9.00" }, OWNER);

    const basket = await getOrCreateCart.call({ currency: "CAD" }, ANONYMOUS);
    await addCartItem.call(
      { cartId: basket.cart.id, cartToken: basket.cart.token!, variantId: variant.id },
      ANONYMOUS,
    );
    jarState.cookies[SHOPPER_CART_COOKIE] = `${basket.cart.id}.${basket.cart.token}`;

    const quotes = await quoteDeliveryAction({ country: "CA", region: "BC", postal: "V9N1A1" });
    expect(quotes.needed).toBe(true);
    expect(quotes.quotes).toEqual([
      expect.objectContaining({ name: "Parcel", amountMinor: 900, currency: "CAD" }),
    ]);

    // The checkout page now renders the address block and the methods island.
    const { html } = await renderCheckout();
    expect(html).toContain('id="checkout-country"');
    expect(html).toContain("Enter your address to see the delivery methods");
  });
});

describe("the cart widget block", () => {
  const tStub = ((key: string, vars?: { count?: number }) => {
    if (key === "cms.block.cartWidget.count") return `${vars?.count ?? 0} item${vars?.count === 1 ? "" : "s"}`;
    if (key === "cms.block.cartWidget.summary") return "Your cart";
    if (key === "cms.block.cartWidget.empty") return "Your cart is empty.";
    if (key === "cms.block.cartWidget.view") return "View cart";
    if (key === "cms.block.cartWidget.checkout") return "Check out";
    return key;
  }) as never;
  const snapshot = {
    currency: "CAD",
    lineCount: 2,
    subtotalMinor: 5_000,
    lines: [
      { variantId: "v1", productName: "Coast print", quantity: 2, lineTotalMinor: 5_000 },
    ],
  };

  it("renders the count, mini lines and actions from the request snapshot", async () => {
    const resolved = await cartWidget.resolve!({}, {
      locale: "en",
      t: ((key: string, vars?: { count?: number }) =>
        key === "cms.block.cartWidget.count"
          ? `${vars?.count ?? 0} item${vars?.count === 1 ? "" : "s"}`
          : key),
      business: null,
      path: "/",
      shopperCart: async () => snapshot,
    });
    const html = renderToStaticMarkup(
      createElement(cartWidget.render, {
        props: {},
        ctx: {
          locale: "en",
          t: tStub,
          business: null,
          path: "/",
          shopperCart: async () => snapshot,
        },
        resolved,
      }),
    );
    expect(html).toContain("2 items");
    expect(html).toContain("Coast print");
    expect(html).toContain('href="/cart"');
    expect(html).toContain('href="/checkout"');
  });

  it("renders nothing where there is no request cart to show", async () => {
    const resolved = await cartWidget.resolve!({}, {
      locale: "en",
      t: (() => ""),
      business: null,
      path: "/",
    });
    expect(resolved).toBeNull();
  });
});
