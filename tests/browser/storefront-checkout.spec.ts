// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.25 slice 3's flagship shopper proof: browse the shelf, choose a variant,
// add to cart, check out as a guest, prove the email through the platform's
// magic link, place the order, and read the token-gated confirmation with its
// pay path. Runs against the production build on the disposable browser
// database; the payment half stops at the existing customer invoice surface
// (manual adapter → offline instructions), so no hosted charge is claimed.
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { desc } from "drizzle-orm";
import { closeDb, db } from "@/core/db";
import { businessProfile } from "@/core/settings/schema";
import { sections } from "@/modules/cms/schema";
import { defaultHeader } from "@/modules/cms/defaults";
import { mailOutbox } from "@/core/mail/schema";
import { decryptMailOutbox } from "@/core/mail/outbox-crypto";
import { invoices } from "@/modules/invoicing/schema";
import { SHOPPER_CART_COOKIE } from "@/modules/catalog/cookies";
import {
  collectionProducts,
  collections,
  optionTypes,
  optionValues,
  priceListEntries,
  priceLists,
  productOptionAssignments,
  productOptionValueAssignments,
  productVariantOptions,
  productVariants,
  products,
} from "@/modules/catalog/schema";
import { resetBrowserDatabase } from "./database";

const SHOPPER = {
  name: "Journey Shopper",
  email: "shopper-journey@example.test",
};

async function latestMailTo(address: string, containing: string): Promise<string> {
  const outbox = await db().select().from(mailOutbox).orderBy(desc(mailOutbox.createdAt));
  for (const row of outbox) {
    const body = decryptMailOutbox(row.encryptedMessage, row.deliveryId);
    if (!body.includes(address)) continue;
    const message = JSON.parse(body) as { text: string };
    if (!message.text.includes(containing)) continue;
    return message.text;
  }
  throw new Error(`No mail to ${address} containing ${containing}`);
}

test.describe("storefront shopper journey (C3.25 slice 3)", () => {
  test.beforeAll(async () => {
    await resetBrowserDatabase();
    await db().insert(businessProfile).values({
      name: "Journey Studio",
      country: "CA",
      baseCurrency: "CAD",
      timezone: "America/Vancouver",
      defaultLocale: "en",
      enabledLocales: ["en"],
      setupCompletedAt: new Date(),
    });
    // The default chrome header carries the cart widget, exactly what a fresh
    // instance ships.
    await db().insert(sections).values({
      key: "header",
      locale: "en",
      name: "Header",
      kind: "chrome",
      blocks: defaultHeader(),
    });

    // One digital print with a Size option and two active variants.
    const sizeTypeId = randomUUID();
    const sizeSId = randomUUID();
    const sizeLId = randomUUID();
    const productId = randomUUID();
    const assignmentId = randomUUID();
    const printSId = randomUUID();
    const printLId = randomUUID();
    const priceListId = randomUUID();
    const collectionId = randomUUID();
    await db().insert(optionTypes).values({ id: sizeTypeId, name: "Size", code: "size" });
    await db().insert(optionValues).values([
      { id: sizeSId, optionTypeId: sizeTypeId, name: "Small", skuFragment: "s", position: 0 },
      { id: sizeLId, optionTypeId: sizeTypeId, name: "Large", skuFragment: "l", position: 1 },
    ]);
    await db().insert(products).values({
      id: productId,
      name: "Coast print",
      slug: "coast-print",
      kind: "digital",
      status: "active",
      visibility: "public",
      publishedAt: new Date(),
    });
    await db().insert(productOptionAssignments).values({
      id: assignmentId,
      productId,
      optionTypeId: sizeTypeId,
      position: 0,
    });
    await db().insert(productOptionValueAssignments).values([
      { assignmentId, optionValueId: sizeSId },
      { assignmentId, optionValueId: sizeLId },
    ]);
    await db().insert(productVariants).values([
      {
        id: printSId,
        productId,
        combinationKey: "s",
        sku: "coast-print-s",
        isDefault: true,
        status: "active",
        requiresShipping: false,
      },
      {
        id: printLId,
        productId,
        combinationKey: "l",
        sku: "coast-print-l",
        status: "active",
        requiresShipping: false,
      },
    ]);
    await db().insert(productVariantOptions).values([
      { variantId: printSId, optionTypeId: sizeTypeId, optionValueId: sizeSId },
      { variantId: printLId, optionTypeId: sizeTypeId, optionValueId: sizeLId },
    ]);
    await db().insert(priceLists).values({
      id: priceListId,
      name: "CAD retail",
      currency: "CAD",
      kind: "retail",
      active: true,
    });
    await db().insert(priceListEntries).values([
      { priceListId, variantId: printSId, amountMinor: 2_500 },
      { priceListId, variantId: printLId, amountMinor: 3_500 },
    ]);
    await db().insert(collections).values({
      id: collectionId,
      title: "The Wall",
      slug: "wall",
      published: true,
      version: 1,
    });
    await db().insert(collectionProducts).values({
      collectionId,
      productId,
      position: 0,
    });
  });

  test.afterAll(async () => {
    await resetBrowserDatabase();
    await closeDb();
  });

  test("shops the shelf, proves the email, places the order and reads the confirmation", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);

    await test.step("the shelf offers the variant picker and adds the chosen variant", async () => {
      await page.goto("/c/wall");
      await expect(page.getByRole("heading", { name: "The Wall" })).toBeVisible();
      const card = page.locator("li", { hasText: "Coast print" }).first();
      await expect(card.getByText("Choose options")).toBeVisible();
      await card.locator("summary").click();
      const smallRow = card.locator("li", { hasText: "Size: Small" });
      await expect(smallRow.getByText("Size: Small")).toBeVisible();
      await smallRow.getByRole("button", { name: "Add to cart" }).click();
      await expect(page).toHaveURL(/\/c\/wall\?added=coast-print$/);
      // The chrome widget counts the line from the cookie capability.
      await expect(page.getByText("1 item")).toBeVisible();
    });

    await test.step("the cart shows the option label and edits quantity", async () => {
      await page.goto("/cart");
      await expect(page.getByRole("heading", { name: "Your cart" })).toBeVisible();
      await expect(page.getByText("Size: Small")).toBeVisible();
      await page.getByLabel("Quantity").fill("2");
      await page.getByRole("button", { name: "Update" }).click();
      await expect(page).toHaveURL(/\/cart\?saved=quantity$/);
      await expect(page.getByText("CA$50.00").first()).toBeVisible();
      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(audit.violations).toEqual([]);
    });

    await test.step("checkout asks for the email proof before any order exists", async () => {
      await page.goto("/checkout");
      await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
      await page.getByLabel("Email").fill(SHOPPER.email);
      await page.getByLabel("Full name").fill(SHOPPER.name);
      await page.getByLabel("I agree to the terms of sale.").check();
      await page.getByRole("button", { name: "Place order" }).click();
      await expect(page).toHaveURL(/\/checkout\?sent=1$/);
      await expect(page.getByText("Check your inbox")).toBeVisible();
      expect(await db().select().from(invoices)).toHaveLength(0);
    });

    await test.step("the magic link proves the email and signs the shopper in", async () => {
      const text = await latestMailTo(SHOPPER.email, "/portal/magic?token=");
      const link = text.split("\n").find((line) => line.includes("/portal/magic?token="))!;
      await page.goto(new URL(link).pathname + new URL(link).search);
      await expect(page).toHaveURL(/\/portal\/magic\/confirm$/);
      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(audit.violations).toEqual([]);
      await page.getByRole("button").first().click();
      await expect(page).toHaveURL(/\/portal\/(login|contact-import)$/);
    });

    await test.step("the signed-in shopper places the order in one step", async () => {
      await page.goto("/checkout");
      await expect(page.getByText(`signed in as ${SHOPPER.email}`)).toBeVisible();
      await expect(page.getByLabel("Email")).toHaveValue(SHOPPER.email);
      await page.getByLabel("I agree to the terms of sale.").check();
      await page.getByRole("button", { name: "Place order" }).click();
      await expect(page).toHaveURL(/\/orders\/confirm\?cart=[0-9a-f-]+&t=[0-9a-f-]+$/);
      await expect(page.getByRole("heading", { name: "Thank you for your order" })).toBeVisible();
      await expect(page.getByText("Coast print")).toBeVisible();
      await expect(page.getByText("CA$50.00").first()).toBeVisible();
      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(audit.violations).toEqual([]);
    });

    await test.step("the confirmation carries the existing invoice pay path without charging", async () => {
      const confirmUrl = new URL(page.url());
      const pay = page.getByRole("link", { name: "Pay now" });
      await expect(pay).toBeVisible();
      const href = await pay.getAttribute("href");
      expect(href).toMatch(/^\/portal\/invoices\/[0-9a-f-]+\?token=/);
      await pay.click();
      // The manual adapter's customer surface: offline instructions, no charge.
      await expect(page.getByRole("button", { name: "Arrange offline payment" })).toBeVisible();
      const [invoice] = await db().select().from(invoices);
      expect(invoice).toBeDefined();
      expect(invoice!.paidMinor).toBe(0);
      expect(invoice!.status).not.toBe("paid");

      // A stranger with the confirmation link's token tampered gets the same
      // plain 404 — and the cart credential cookie is gone from the shopper's
      // browser too.
      const stranger = await browser.newContext({ baseURL: confirmUrl.origin });
      try {
        const hostile = await stranger.newPage();
        confirmUrl.searchParams.set("t", "00000000-0000-4000-8000-000000000099");
        await hostile.goto(confirmUrl.pathname + confirmUrl.search);
        await expect(
          hostile.getByRole("heading", { name: "That page is not here" }),
        ).toBeVisible();
        await expect(hostile.getByText("Thank you for your order")).toHaveCount(0);
      } finally {
        await stranger.close();
      }
      expect(await page.context().cookies()).toEqual(
        expect.not.arrayContaining([expect.objectContaining({ name: SHOPPER_CART_COOKIE })]),
      );
    });
  });
});
