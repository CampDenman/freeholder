// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.16/C5.20/C8.08: shopper/owner edits preserve the selected photograph.
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "@/core/db";
import { contacts } from "@/core/contacts/schema";
import { THEME_COOKIE } from "@/core/design/theme";
import { CSRF_COOKIE, issueCsrfToken } from "@/core/http/csrf";
import { businessLocations } from "@/core/locations/schema";
import { businessProfile } from "@/core/settings/schema";
import { SHOPPER_CART_COOKIE } from "@/modules/catalog/cookies";
import { cartItems, carts, inventoryItems, orderItems, orders, priceListEntries, priceLists, products, productVariants, stockMovements, stockReservations } from "@/modules/catalog/schema";
import { C11_BASE_URL, seedC11Owner, useOwnerSession } from "./owner-session";

test.describe("photograph cart stock (C5.16/C5.20/C8.08)", () => {
  test.setTimeout(120_000);
  test.afterAll(closeDb);
  for (const locale of ["en", "es", "fr", "ar"] as const) {
    test(`${locale}: shopper and owner change the selected photo, then check out its complete stock`, async ({ browser }) => {
      const session = await seedC11Owner("Photograph stock proof");
      await db().update(businessProfile).set({ defaultLocale: locale, enabledLocales: ["en", "es", "fr", "ar"] }).where(eq(businessProfile.id, 1));
      const contactId = randomUUID(), locationId = randomUUID(), productId = randomUUID(), variantId = randomUUID(), listId = randomUUID(), itemId = randomUUID(), cartId = randomUUID(), cartToken = randomUUID(), galleryId = randomUUID(), holdId = randomUUID();
      const photoIds = [randomUUID(), randomUUID()], lineIds = [randomUUID(), randomUUID()];
      await db().insert(contacts).values({ id: contactId, name: "Photograph buyer", email: "photo-buyer@example.test" });
      await db().insert(businessLocations).values({ id: locationId, name: "Print stock", slug: "print-stock", country: "CA" });
      await db().insert(products).values({ id: productId, name: "Photograph print", slug: "photo-print", kind: "physical", status: "active", visibility: "public", publishedAt: new Date() });
      await db().insert(productVariants).values({ id: variantId, productId, combinationKey: "default", sku: "photo-print", isDefault: true, status: "active", requiresShipping: false });
      await db().insert(priceLists).values({ id: listId, name: "Photograph retail", currency: "CAD", kind: "retail" });
      await db().insert(priceListEntries).values({ priceListId: listId, variantId, amountMinor: 1000 });
      await db().insert(inventoryItems).values({ id: itemId, variantId, locationId });
      await db().insert(stockMovements).values({ inventoryItemId: itemId, delta: 3, reason: "receipt", actor: "system" });
      await db().insert(carts).values({ id: cartId, token: cartToken, contactId, currency: "CAD" });
      await db().insert(stockReservations).values({ id: holdId, inventoryItemId: itemId, quantity: 3, holderType: "cart", holderId: cartId, expiresAt: new Date(Date.now() + 30 * 60_000) });
      await db().insert(cartItems).values(lineIds.map((id, index) => ({ id, cartId, variantId, locationId, quantity: index + 1, reservationId: holdId, galleryId, assetId: photoIds[index], createdAt: new Date(Date.now() - (2 - index) * 1000) })));

      const shopper = await browser.newContext({ baseURL: C11_BASE_URL, viewport: { width: 320, height: 900 } });
      await shopper.addCookies([{ name: SHOPPER_CART_COOKIE, value: `${cartId}.${cartToken}`, url: C11_BASE_URL, httpOnly: true, sameSite: "Lax" }, { name: CSRF_COOKIE, value: issueCsrfToken(), url: C11_BASE_URL }]);
      const page = await shopper.newPage();
      await page.goto(locale === "en" ? "/cart" : `/${locale}/cart`);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      if (locale === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      const quantityForms = page.locator("form").filter({ has: page.locator('input[name="quantity"]') });
      await expect(quantityForms).toHaveCount(2);
      const selectedPhoto = quantityForms.filter({ has: page.locator(`input[name="lineId"][value="${lineIds[1]}"]`) });
      await expect(selectedPhoto.locator('input[name="quantity"]')).toHaveValue("2");
      await selectedPhoto.locator('input[name="quantity"]').fill("1");
      await selectedPhoto.getByRole("button").focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/saved=quantity/);
      const afterShopper = await db().select().from(cartItems).where(eq(cartItems.cartId, cartId));
      expect(afterShopper.find(line => line.assetId === photoIds[0])?.quantity).toBe(1);
      expect(afterShopper.find(line => line.assetId === photoIds[1])?.quantity).toBe(1);
      for (const theme of ["light", "dark"]) {
        await shopper.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]);
        await page.reload();
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (locale === "en" && theme === "light" || locale === "ar" && theme === "dark") await page.screenshot({ path: test.info().outputPath(`photo-cart-${locale}-${theme}.png`), fullPage: true });
      }

      const owner = await browser.newContext({ baseURL: C11_BASE_URL, viewport: { width: 320, height: 900 } });
      await useOwnerSession(owner, session);
      const ownerPage = await owner.newPage();
      await ownerPage.goto(`/admin/carts/${cartId}`);
      const ownerQuantities = ownerPage.locator("form").filter({ has: ownerPage.locator('input[name="intent"][value="setCartQty"]') });
      const ownerPhoto = ownerQuantities.filter({ has: ownerPage.locator(`input[name="lineId"][value="${lineIds[1]}"]`) });
      await expect(ownerPhoto.locator('input[name="quantity"]')).toHaveValue("1");
      await ownerPhoto.locator('input[name="quantity"]').fill("2");
      await ownerPhoto.getByRole("button").focus();
      await ownerPage.keyboard.press("Enter");
      await expect(ownerPage).toHaveURL(/saved=setCartQty/);
      const afterOwner = await db().select().from(cartItems).where(eq(cartItems.cartId, cartId));
      expect(afterOwner.find(line => line.assetId === photoIds[0])?.quantity).toBe(1);
      expect(afterOwner.find(line => line.assetId === photoIds[1])?.quantity).toBe(2);
      const checkout = ownerPage.locator("form").filter({ has: ownerPage.locator('input[name="intent"][value="checkoutCart"]') });
      await checkout.locator('input[name="acceptedTerms"]').focus();
      await ownerPage.keyboard.press("Space");
      await ownerPage.keyboard.press("Tab");
      await ownerPage.keyboard.press("Enter");
      await expect(ownerPage).toHaveURL(/\/admin\/orders\/.+saved=checkoutCart/);
      const [placed] = await db().select().from(orders).where(eq(orders.cartId, cartId));
      expect(placed?.totalMinor).toBe(3000);
      const lines = await db().select().from(orderItems).where(eq(orderItems.orderId, placed!.id));
      expect(lines.map(line => [line.assetId, line.quantity]).sort()).toEqual([[photoIds[0], 1], [photoIds[1], 2]].sort());
      expect((await db().select().from(stockReservations).where(and(eq(stockReservations.inventoryItemId, itemId), eq(stockReservations.status, "active")))).map(hold => [hold.holderType, hold.holderId, hold.quantity])).toEqual([["order", placed!.id, 3]]);
      await owner.close(); await shopper.close();
    });
  }
});
