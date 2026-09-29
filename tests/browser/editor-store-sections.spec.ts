// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The flagship C2.25 slice C proof: compose a store-front landing page on the
// canvas — a hero, a picked featured-products row, a promotional band bound to
// a collection — publish it, and read live catalog data back from the public
// page. Then edit the section where it renders (swap the band's collection),
// publish once, and the public page follows.
//
// Unlike the drag-and-drop journey, this one composes a page from an empty
// draft entirely through the editor: the palette adds the sections, the
// canvas raises the pickers, the headings type where they render. The
// sections resolve the same public catalog projections the storefront uses,
// so the canvas and the public page cannot disagree about the shelf.

import { eq } from "drizzle-orm";
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { API_BASE } from "@/core/api/dispatch";
import { createSession, SESSION_COOKIE } from "@/core/auth/sessions";
import { users, totpFactors } from "@/core/auth/schema";
import { CSRF_COOKIE, CSRF_HEADER, issueCsrfToken } from "@/core/http/csrf";
import { closeDb, db } from "@/core/db";
import { collections, products } from "@/modules/catalog/schema";
import { OWNER } from "../helpers/spine";
import { resetBrowserDatabase } from "./database";

const BASE_URL = process.env.APP_URL ?? "http://localhost:3100";

async function callService(
  sessionToken: string,
  service: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const csrf = issueCsrfToken();
  const response = await fetch(`${BASE_URL}${API_BASE}/${service}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(sessionToken)}; ${CSRF_COOKIE}=${encodeURIComponent(csrf)}`,
      [CSRF_HEADER]: csrf,
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`${service} refused (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

function pageFrame(page: Page): FrameLocator {
  return page.frameLocator("iframe[title='Preview']");
}

/** A priced, active, public print with one Size option and two variants. */
async function seedPrint(
  sessionToken: string,
  taxCategoryId: string,
  currency: string,
  name: string,
  slug: string,
  price: string,
): Promise<{ id: string }> {
  const size = (await callService(sessionToken, "catalog.createOptionType", {
    name: "Size",
    code: `size-${slug}`,
  })) as { id: string };
  const small = (await callService(sessionToken, "catalog.addOptionValue", {
    optionTypeId: size.id,
    name: "Small",
    skuFragment: "s",
  })) as { id: string };
  const large = (await callService(sessionToken, "catalog.addOptionValue", {
    optionTypeId: size.id,
    name: "Large",
    skuFragment: "l",
  })) as { id: string };
  let product = (await callService(sessionToken, "catalog.createProduct", {
    name,
    slug,
    kind: "digital",
    taxCategoryId,
  })) as { id: string; version: number };
  let version = (
    (await callService(sessionToken, "catalog.assignProductOption", {
      productId: product.id,
      expectedVersion: product.version,
      optionTypeId: size.id,
    })) as { version: number }
  ).version;
  version = (
    (await callService(sessionToken, "catalog.setProductOptionValues", {
      productId: product.id,
      expectedVersion: version,
      optionTypeId: size.id,
      optionValueIds: [small.id, large.id],
    })) as { version: number }
  ).version;
  version = (
    (await callService(sessionToken, "catalog.applyVariantMatrix", {
      productId: product.id,
      expectedVersion: version,
    })) as { version: number }
  ).version;
  const list = (await callService(sessionToken, "catalog.createPriceList", {
    name: `Retail ${slug}`,
    currency,
    kind: "retail",
  })) as { id: string };
  const variants = (
    (await callService(sessionToken, "catalog.getProductVariants", {
      productId: product.id,
    })) as { variants: { id: string; status: string }[] }
  ).variants;
  for (const variant of variants) {
    if (variant.status === "active") {
      await callService(sessionToken, "catalog.setPriceListEntry", {
        priceListId: list.id,
        variantId: variant.id,
        amount: price,
      });
    }
  }
  product = (await callService(sessionToken, "catalog.activateProduct", {
    id: product.id,
    expectedVersion: version,
  })) as { id: string; version: number };
  return product;
}

async function seedCollection(
  sessionToken: string,
  title: string,
  slug: string,
  productIds: string[],
): Promise<void> {
  const collection = (await callService(sessionToken, "catalog.createCollection", {
    title,
    slug,
  })) as { id: string };
  for (const productId of productIds) {
    await callService(sessionToken, "catalog.addCollectionProduct", {
      collectionId: collection.id,
      productId,
    });
  }
  await callService(sessionToken, "catalog.updateCollection", {
    id: collection.id,
    expectedVersion: 1,
    published: true,
  });
}

test.describe("store-section composition on the canvas", () => {
  let sessionToken = "";
  let landingPageId = "";

  test.beforeAll(async () => {
    await resetBrowserDatabase();
    await db().insert(users).values({
      id: OWNER.userId,
      email: "owner-c225-sections@example.test",
      role: "owner",
    });
    await db().insert(totpFactors).values({
      userId: OWNER.userId,
      encryptedSecret: "c225-sections-fixture",
    });
    const session = await db().transaction((tx) =>
      createSession(tx, OWNER.userId, { twoFactorVerified: true }),
    );
    sessionToken = session.token;

    await callService(sessionToken, "demo.install", { publish: true });

    // The catalog the sections will read: two prints on the wall, one light
    // in the harbour — disjoint shelves so a collection swap is observable.
    const tax = (await callService(sessionToken, "invoicing.createTaxCategory", {
      code: "standard_print",
      name: "Standard",
    })) as { id: string };
    // The demo business profile names the currency; the purchase projection
    // only resolves price lists in that currency.
    const business = (await callService(sessionToken, "settings.getBusiness", {})) as {
      baseCurrency: string;
    };
    const currency = business.baseCurrency;
    const coast = await seedPrint(
      sessionToken,
      tax.id,
      currency,
      "Coast print",
      "coast-print",
      "25.00",
    );
    await seedPrint(sessionToken, tax.id, currency, "Dune print", "dune-print", "30.00");
    const harbour = await seedPrint(
      sessionToken,
      tax.id,
      currency,
      "Harbour light",
      "harbour-light",
      "40.00",
    );
    await seedCollection(sessionToken, "The Wall", "the-wall", [coast.id]);
    await seedCollection(sessionToken, "Harbour Lights", "harbour-lights", [harbour.id]);

    const page = (await callService(sessionToken, "cms.createPage", {
      title: "Summer drop",
      slug: "summer-drop",
    })) as { id: string };
    landingPageId = page.id;
  });

  test.afterAll(async () => {
    await resetBrowserDatabase();
    await closeDb();
  });

  test("compose hero + product row + promo band on the canvas, publish, read live catalog data, swap the collection, publish again", async ({
    page,
    context,
  }) => {
    test.setTimeout(360_000);
    await context.addCookies([
      { name: SESSION_COOKIE, value: sessionToken, url: BASE_URL },
    ]);

    const saved = page.locator('p[role="status"]');
    const canvas = pageFrame(page);

    const addBlock = async (name: string) => {
      await page.getByRole("button", { name: "Add a block", exact: true }).click();
      await page.getByPlaceholder("/").fill(name);
      await page.getByRole("button", { name, exact: true }).last().click();
    };

    await test.step("open the editor on an empty landing page", async () => {
      await page.goto(`/admin/pages/${landingPageId}`);
      await expect(
        page.getByText("Nothing here yet. Add your first block."),
      ).toBeVisible();
    });

    await test.step("hero: add a heading and type it on the canvas", async () => {
      await addBlock("Heading");
      // The publish gate requires one H1 — a hero is one.
      await page.locator("[id$='-level']").selectOption("1");
      const headline = canvas.locator(".fh-canvas h1");
      await headline.click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type("The summer drop");
      await page.keyboard.press("Enter");
      await expect(canvas.locator(".fh-canvas h1")).toHaveText("The summer drop");
    });

    await test.step("featured products: add a row and pick both prints on the canvas", async () => {
      await addBlock("Product row");
      const row = canvas.locator("[data-block-type='productRow']");
      await row.getByRole("button", { name: "Choose products" }).click();
      const picker = page.getByRole("dialog", { name: "Choose products" });
      await expect(picker).toBeVisible();
      await picker.getByText("Coast print", { exact: true }).click();
      await picker.getByText("Dune print", { exact: true }).click();
      await picker.getByRole("button", { name: "Done" }).click();
      // The row renders the picked products on the canvas at once.
      await expect(row.getByText("Coast print", { exact: true })).toBeVisible();
      await expect(row.getByText("Dune print", { exact: true })).toBeVisible();
      await expect(saved).toHaveText("Saved", { timeout: 15_000 });
    });

    await test.step("collection band: add a promo band and bind it to The Wall on the canvas", async () => {
      await addBlock("Promotional band");
      const band = canvas.locator("[data-block-type='promoBand']");
      await band.getByRole("button", { name: "Feature a collection" }).click();
      const picker = page.getByRole("dialog", { name: "Choose a collection" });
      await expect(picker).toBeVisible();
      await picker.getByRole("button", { name: "The Wall" }).click();
      // The band re-renders from stored state with the live shelf.
      await expect(band.getByText("Coast print", { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(saved).toHaveText("Saved", { timeout: 15_000 });
    });

    await test.step("publish once and read live catalog data from the public page", async () => {
      await page.getByRole("button", { name: "Publish", exact: true }).click();
      await expect(page.getByRole("button", { name: "Unpublish" })).toBeVisible({
        timeout: 15_000,
      });

      await page.goto("/summer-drop");
      await expect(
        page.getByRole("heading", { name: "The summer drop" }),
      ).toBeVisible();
      // The row's picked products, with their live prices.
      await expect(
        page.getByText("Coast print", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByText("Dune print", { exact: true }).first(),
      ).toBeVisible();
      // Variant prices live inside each card's options picker — open one and
      // read the live quote through it.
      await page.getByText("Choose options").first().click();
      await expect(page.getByText("25.00").first()).toBeVisible();
      await page.getByText("Choose options").nth(1).click();
      await expect(page.getByText("30.00").first()).toBeVisible();
      // The band's live shelf and its collection link.
      const bandShelf = page
        .getByText("Coast print", { exact: true })
        .nth(1);
      await expect(bandShelf).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Shop The Wall" }),
      ).toBeVisible();
    });

    await test.step("the band is live: a product added to the collection appears without a republish", async () => {
      // Add Dune print to The Wall through the catalog service — the page
      // itself is untouched.
      const [wall] = await db()
        .select()
        .from(collections)
        .where(eq(collections.slug, "the-wall"))
        .limit(1);
      const [dune] = await db()
        .select()
        .from(products)
        .where(eq(products.slug, "dune-print"))
        .limit(1);
      await callService(sessionToken, "catalog.addCollectionProduct", {
        collectionId: wall!.id,
        productId: dune!.id,
      });
      await page.reload();
      // The band now shelves both prints — the section reads the catalog at
      // render time, so no edit and no publish stood between. (The row
      // already showed Dune print; the band's copy is the proof.)
      const bandDune = page
        .locator("main")
        .getByText("Dune print", { exact: true })
        .last();
      await expect(bandDune).toBeVisible();
    });

    await test.step("swap the band's collection on the canvas and publish the change", async () => {
      await page.goto(`/admin/pages/${landingPageId}`);
      const canvasBand = pageFrame(page).locator("[data-block-type='promoBand']");
      await canvasBand.getByRole("button", { name: "Swap collection" }).click();
      const picker = page.getByRole("dialog", { name: "Choose a collection" });
      await picker.getByRole("button", { name: "Harbour Lights" }).click();
      // The invisible reload lands the new shelf on the canvas.
      await expect(
        canvasBand.getByText("Harbour light", { exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(saved).toHaveText("Saved", { timeout: 15_000 });

      await page.getByRole("button", { name: "Publish changes" }).click();
      // The publish is a save-then-publish server round-trip: wait for the
      // editor to say it landed before reading the public page.
      await expect(saved).toHaveText("Saved", { timeout: 15_000 });
      await page.goto("/summer-drop");
      // The band now shelves the harbour light; the row still holds its
      // picked prints.
      await expect(
        page.getByRole("link", { name: "Shop Harbour Lights" }),
      ).toBeVisible();
      await expect(
        page.getByText("Harbour light", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByText("Coast print", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Shop The Wall" }),
      ).toHaveCount(0);
    });
  });
});
