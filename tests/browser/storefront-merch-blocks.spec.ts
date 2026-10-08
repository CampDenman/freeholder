// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C2.24's flagship proof: an owner composes a page from the merchandising
// blocks (featured collection + product grid + buy button), publishes it,
// and a shopper browses the composed shelf, filters it through crawlable
// facet URLs and buys from it — the buy half rides the C3.25 slice-3 flow,
// ending at the token-gated confirmation without a hosted charge.
//
// Composing runs through the same cms services the editor saves with; the
// browser half is the shopper's side of the contract.
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { desc } from "drizzle-orm";
import { closeDb, db } from "@/core/db";
import { businessProfile } from "@/core/settings/schema";
import { pages, sections } from "@/modules/cms/schema";
import { defaultHeader } from "@/modules/cms/defaults";
import { mailOutbox } from "@/core/mail/schema";
import { decryptMailOutbox } from "@/core/mail/outbox-crypto";
import { invoices } from "@/modules/invoicing/schema";
import {
  optionTypes,
  optionValues,
  priceListEntries,
  priceLists,
  productOptionAssignments,
  productOptionValueAssignments,
  productVariantOptions,
  productVariants,
  products,
  collections,
  collectionProducts,
} from "@/modules/catalog/schema";
import { resetBrowserDatabase } from "./database";

const SHOPPER = {
  name: "Page Shopper",
  email: "shopper-page@example.test",
};

const PAGE_BLOCKS = [
  { id: "h1", type: "heading", props: { text: "The studio shop", level: 1 } },
  {
    id: "f1",
    type: "featuredCollection",
    props: {
      collectionSlug: "wall",
      eyebrow: "This week",
      intro: "Chosen for the north wall.",
      limit: 2,
      showViewAll: true,
    },
  },
  {
    id: "g1",
    type: "productGrid",
    props: { collectionSlug: "wall", pageSize: 12, showFacets: true },
  },
  { id: "b1", type: "buyButton", props: { productSlug: "coast-print" } },
];

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

test.describe("the merchandising blocks end to end (C2.24)", () => {
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
    await db().insert(sections).values({
      key: "header",
      locale: "en",
      name: "Header",
      kind: "chrome",
      blocks: defaultHeader(),
    });

    // Coast print: a Size option with two priced variants (the picker
    // product). Dune print: large only (the direct-button product).
    const sizeTypeId = randomUUID();
    const sizeSId = randomUUID();
    const sizeLId = randomUUID();
    const assignmentId = randomUUID();
    const coastId = randomUUID();
    const printSId = randomUUID();
    const printLId = randomUUID();
    const priceListId = randomUUID();
    const collectionId = randomUUID();
    const duneId = randomUUID();
    const duneVariantId = randomUUID();
    await db().insert(optionTypes).values({ id: sizeTypeId, name: "Size", code: "size" });
    await db().insert(optionValues).values([
      { id: sizeSId, optionTypeId: sizeTypeId, name: "Small", skuFragment: "s", position: 0 },
      { id: sizeLId, optionTypeId: sizeTypeId, name: "Large", skuFragment: "l", position: 1 },
    ]);
    await db().insert(products).values([
      {
        id: coastId,
        name: "Coast print",
        slug: "coast-print",
        kind: "digital",
        status: "active",
        visibility: "public",
        publishedAt: new Date(),
      },
      {
        id: duneId,
        name: "Dune print",
        slug: "dune-print",
        kind: "digital",
        status: "active",
        visibility: "public",
        publishedAt: new Date(),
      },
    ]);
    await db().insert(productOptionAssignments).values({
      id: assignmentId,
      productId: coastId,
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
        productId: coastId,
        combinationKey: "s",
        sku: "coast-print-s",
        isDefault: true,
        status: "active",
        requiresShipping: false,
      },
      {
        id: printLId,
        productId: coastId,
        combinationKey: "l",
        sku: "coast-print-l",
        status: "active",
        requiresShipping: false,
      },
      {
        id: duneVariantId,
        productId: duneId,
        combinationKey: "l",
        sku: "dune-print-l",
        isDefault: true,
        status: "active",
        requiresShipping: false,
      },
    ]);
    await db().insert(productVariantOptions).values([
      { variantId: printSId, optionTypeId: sizeTypeId, optionValueId: sizeSId },
      { variantId: printLId, optionTypeId: sizeTypeId, optionValueId: sizeLId },
      { variantId: duneVariantId, optionTypeId: sizeTypeId, optionValueId: sizeLId },
    ]);
    await db().insert(priceLists).values({
      id: priceListId,
      name: "CAD retail",
      currency: "CAD",
      kind: "retail",
      active: true,
    });
    await db().insert(priceListEntries).values([
      { priceListId, variantId: printSId, amountMinor: 2_000 },
      { priceListId, variantId: printLId, amountMinor: 3_500 },
      { priceListId, variantId: duneVariantId, amountMinor: 3_500 },
    ]);
    await db().insert(collections).values({
      id: collectionId,
      title: "The Wall",
      slug: "wall",
      description: "Prints for the long wall.",
      published: true,
      version: 1,
    });
    await db().insert(collectionProducts).values([
      { collectionId, productId: coastId, position: 0 },
      { collectionId, productId: duneId, position: 1 },
    ]);

    // The owner composes the shop page from the merchandising blocks and
    // publishes it: the same shape the editor's save-and-publish writes —
    // the published tree lives in `blocks`, exactly what the public route
    // renders.
    await db().insert(pages).values({
      slug: "shop",
      locale: "en",
      title: "Shop",
      blocks: PAGE_BLOCKS,
      status: "published",
      publishedAt: new Date(),
      version: 1,
    });
  });

  test.afterAll(async () => {
    await resetBrowserDatabase();
    await closeDb();
  });

  test("the composed page lets a shopper browse, filter and buy", async ({ page }) => {
    test.setTimeout(180_000);

    await test.step("the published page renders the hero, the grid and the buy button", async () => {
      await page.goto("/shop");
      await expect(page.getByRole("heading", { name: "The studio shop" })).toBeVisible();
      // The featured hero reads the collection itself under the owner's eyebrow.
      await expect(page.getByText("This week")).toBeVisible();
      await expect(page.getByRole("heading", { name: "The Wall" })).toBeVisible();
      await expect(page.getByText("Prints for the long wall.").first()).toBeVisible();
      await expect(page.getByRole("link", { name: "View all" })).toHaveAttribute("href", "/c/wall");
      // The grid and the embedded buy button both quote the shelf.
      await expect(page.getByRole("link", { name: "Coast print" }).first()).toBeVisible();
      await expect(page.getByText("Dune print").first()).toBeVisible();
      // ItemList JSON-LD, the collection page's shape, on the composed page.
      const itemList = await page.locator('script[type="application/ld+json"]').allTextContents();
      expect(itemList.some((script) => script.includes('"@type":"ItemList"'))).toBe(true);
      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(audit.violations).toEqual([]);
    });

    await test.step("the facets filter the grid through the page's own query params", async () => {
      await page.goto("/shop");
      // The shelf shows Dune twice before filtering: the curated featured
      // front and the grid.
      await expect(page.getByText("Dune print")).toHaveCount(2);
      const small = page.getByRole("link", { name: /Small/ }).first();
      await expect(small).toBeVisible();
      await small.click();
      await expect(page).toHaveURL(/\/shop\?filter%5Boption%3Asize%5D=s$/);
      // The grid drops Dune (it has no Small variant); the curated featured
      // front is not filterable — it is the collection's own pick.
      await expect(page.getByText("Dune print")).toHaveCount(1);
      await expect(page.getByRole("link", { name: "Coast print" }).first()).toBeVisible();
      // The picked facet marks itself and offers the way back to the clean shelf.
      await expect(page.getByRole("link", { name: /Small/ })).toHaveAttribute(
        "aria-current",
        "true",
      );
      await page.getByRole("link", { name: "Clear filters" }).click();
      await expect(page).toHaveURL(/\/shop$/);
      await expect(page.getByText("Dune print")).toHaveCount(2);
    });

    await test.step("the shopper buys the embedded product from the page", async () => {
      await page.goto("/shop");
      // The buy button block is the card whose heading links the product —
      // the grid and featured front link it without a heading.
      const buyCard = page
        .getByRole("heading", { name: "Coast print" })
        .locator("xpath=ancestor::article[1]");
      await expect(buyCard.getByText("Choose options")).toBeVisible();
      await buyCard.locator("summary").click();
      const smallRow = buyCard.locator("li", { hasText: "Size: Small" });
      await expect(smallRow.getByText("Size: Small")).toBeVisible();
      await smallRow.getByRole("button", { name: "Add to cart" }).click();
      await expect(page).toHaveURL(/\/shop\?added=coast-print$/);
      await expect(page.getByText("1 item")).toBeVisible();
    });

    await test.step("checkout proves the email before the order exists", async () => {
      await page.goto("/checkout");
      await page.getByLabel("Email").fill(SHOPPER.email);
      await page.getByLabel("Full name").fill(SHOPPER.name);
      await page.getByLabel("I agree to the terms of sale.").check();
      await page.getByRole("button", { name: "Place order" }).click();
      await expect(page).toHaveURL(/\/checkout\?sent=1$/);
      await expect(page.getByText("Check your inbox")).toBeVisible();
      expect(await db().select().from(invoices)).toHaveLength(0);
    });

    await test.step("the magic link proves the email and the order lands", async () => {
      const text = await latestMailTo(SHOPPER.email, "/portal/magic?token=");
      const link = text.split("\n").find((line) => line.includes("/portal/magic?token="))!;
      await page.goto(new URL(link).pathname + new URL(link).search);
      await expect(page).toHaveURL(/\/portal\/magic\/confirm$/);
      await page.getByRole("button").first().click();
      await expect(page).toHaveURL(/\/portal$/);
      await expect(page.getByText(SHOPPER.email, { exact: true })).toBeVisible();

      await page.goto("/checkout");
      await expect(page.getByText(`signed in as ${SHOPPER.email}`)).toBeVisible();
      await page.getByLabel("I agree to the terms of sale.").check();
      await page.getByRole("button", { name: "Place order" }).click();
      await expect(page).toHaveURL(/\/orders\/confirm\?cart=[0-9a-f-]+&t=[0-9a-f-]+$/);
      await expect(page.getByRole("heading", { name: "Thank you for your order" })).toBeVisible();
      await expect(page.getByText("Coast print")).toBeVisible();
      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(audit.violations).toEqual([]);
      const [invoice] = await db().select().from(invoices);
      expect(invoice).toBeDefined();
      expect(invoice!.paidMinor).toBe(0);
    });
  });
});
