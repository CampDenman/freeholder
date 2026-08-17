// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Public product landing pages (MASTER.md §5, C2.21).

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { pages } from "@/modules/cms/schema";
import { publishedPaths } from "@/modules/cms/service";
import { updateBusiness } from "@/core/settings/service";
import { activateProduct, archiveProduct, createProduct } from "@/modules/catalog/service";
import { createTaxCategory } from "@/modules/invoicing/tax-service";
import { kindFromSlug } from "@/core/seo/classify";
import { ANONYMOUS, closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

async function pageAt(slug: string) {
  const [page] = await db()
    .select()
    .from(pages)
    .where(and(eq(pages.slug, slug), eq(pages.locale, "en")))
    .limit(1);
  return page ?? null;
}

describe.runIf(hasDatabase)("public product landing pages", { timeout: 30_000 }, () => {
  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(
      {
        name: "Aurora Coast Photography",
        country: "CA",
        baseCurrency: "CAD",
        timezone: "America/Vancouver",
      },
      OWNER,
    );
  });
  afterAll(closeDb);

  it("writes a RIBA /products index and leaf when a public product is activated", async () => {
    const tax = await createTaxCategory.call({ code: "standard", name: "Standard" }, OWNER);
    const draft = await createProduct.call(
      {
        name: "Print set",
        slug: "print-set",
        kind: "physical",
        subtitle: "A coastal set",
        taxCategoryId: tax.id,
      },
      OWNER,
    );
    await activateProduct.call({ id: draft.id, expectedVersion: draft.version }, OWNER);

    const leaf = await pageAt("products/print-set");
    const index = await pageAt("products");
    expect(index).toMatchObject({ status: "published", title: "Products" });
    expect(leaf).toMatchObject({ status: "published", title: "Print set" });
    expect(kindFromSlug("products")).toBe("section");
    expect(kindFromSlug("products/print-set")).toBe("product");

    const paths = await publishedPaths.call({ locale: "en" }, ANONYMOUS);
    expect(paths.map((entry) => entry.slug)).toEqual(
      expect.arrayContaining(["products", "products/print-set"]),
    );
    expect(paths.find((entry) => entry.slug === "products/print-set")?.kind).toBe("product");

    await archiveProduct.call(
      { id: draft.id, expectedVersion: draft.version + 1, reason: "Season ended" },
      OWNER,
    );
    expect((await pageAt("products/print-set"))?.status).toBe("draft");
  });
});
