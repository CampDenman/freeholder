// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.09 product lifecycle, visibility, concurrency and database proof.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/core/db";
import { resolveRedirect } from "@/core/seo/service";
import type { Actor } from "@/core/service";
import {
  activateProduct,
  archiveProduct,
  createProduct,
  getProduct,
  listProducts,
  listVisibleProducts,
  resolveVisibleProduct,
  restoreProduct,
  updateProduct,
  updateProductDescription,
} from "@/modules/catalog/service";
import { PRODUCT_KINDS } from "@/modules/catalog/contract";
import { createTaxCategory } from "@/modules/invoicing/tax-service";
import {
  ANONYMOUS,
  closeDb,
  CUSTOMER,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

const VIEWER: Actor = {
  kind: "user",
  userId: "00000000-0000-4000-8000-000000000004",
  role: "catalog-viewer",
  grants: [{ module: "catalog", access: "view" }],
};

async function category() {
  return createTaxCategory.call(
    { code: "standard", name: "Standard taxable" },
    OWNER,
  );
}

async function draft(
  key: string,
  options: {
    kind?: (typeof PRODUCT_KINDS)[number];
    visibility?: "public" | "unlisted" | "member_only";
    taxCategoryId?: string;
  } = {},
) {
  return createProduct.call(
    {
      name: `Product ${key}`,
      slug: `product-${key}`,
      kind: options.kind ?? "physical",
      visibility: options.visibility ?? "public",
      taxCategoryId: options.taxCategoryId,
    },
    OWNER,
  );
}

describe.runIf(hasDatabase)("catalog product lifecycle", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  it("governs all six product kinds through one lifecycle and visibility projection", async () => {
    const tax = await category();
    const created = [];
    for (const [position, kind] of PRODUCT_KINDS.entries()) {
      const visibility = position === 1 ? "unlisted" : position === 2 ? "member_only" : "public";
      const product = await draft(kind, { kind, visibility, taxCategoryId: tax.id });
      created.push(await activateProduct.call({ id: product.id, expectedVersion: product.version }, OWNER));
    }

    expect(created.map((product) => product.kind)).toEqual(PRODUCT_KINDS);
    expect(created.find((product) => product.kind === "service")?.schemaType).toBe("Service");
    expect(created.filter((product) => product.kind !== "service").every((product) => product.schemaType === "Product")).toBe(true);
    expect((await listVisibleProducts.call({}, ANONYMOUS)).map((product) => product.kind)).toEqual([
      "pass",
      "bundle",
      "rental",
      "physical",
    ]);

    const unlisted = created.find((product) => product.visibility === "unlisted")!;
    expect((await resolveVisibleProduct.call({ slug: unlisted.slug }, ANONYMOUS))?.id).toBe(unlisted.id);
    const members = created.find((product) => product.visibility === "member_only")!;
    expect(await resolveVisibleProduct.call({ slug: members.slug }, ANONYMOUS)).toBeNull();
    expect((await resolveVisibleProduct.call({ slug: members.slug }, CUSTOMER))?.id).toBe(members.id);

    const bundle = await getProduct.call({ id: created[0]!.id }, OWNER);
    expect(bundle.history.map((event) => event.toStatus)).toEqual(["active", "draft"]);
  });

  it("enforces activation, block vocabulary, immutable post-publication kind and redirect-safe slugs", async () => {
    const product = await draft("interlocks");
    const missingTax = await failure(
      activateProduct.call({ id: product.id, expectedVersion: product.version }, OWNER),
    );
    expect(missingTax.code).toBe("validation");

    const unknownBlock = await failure(
      updateProductDescription.call(
        {
          id: product.id,
          expectedVersion: product.version,
          description: [{ id: "unsafe", type: "raw-commerce-html", props: {} }],
        },
        OWNER,
      ),
    );
    expect(unknownBlock.code).toBe("validation");

    const tax = await category();
    const configured = await updateProduct.call(
      { id: product.id, expectedVersion: product.version, taxCategoryId: tax.id },
      OWNER,
    );
    const active = await activateProduct.call(
      { id: configured.id, expectedVersion: configured.version },
      OWNER,
    );
    const kindChange = await failure(
      updateProduct.call(
        { id: active.id, expectedVersion: active.version, kind: "service" },
        OWNER,
      ),
    );
    expect(kindChange.code).toBe("conflict");

    const renamed = await updateProduct.call(
      { id: active.id, expectedVersion: active.version, slug: "renamed-product" },
      OWNER,
    );
    expect(renamed.slug).toBe("renamed-product");
    expect(
      await resolveRedirect.call({ path: "products/product-interlocks" }, ANONYMOUS),
    ).toMatchObject({ toPath: "products/renamed-product", status: "301" });
  });

  it("allows exactly one concurrent writer for a product version", async () => {
    const product = await draft("concurrent");
    const outcomes = await Promise.allSettled([
      updateProduct.call(
        { id: product.id, expectedVersion: product.version, name: "First writer" },
        OWNER,
      ),
      updateProduct.call(
        { id: product.id, expectedVersion: product.version, name: "Second writer" },
        OWNER,
      ),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((result) => result.status === "rejected");
    expect(rejected).toBeDefined();
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({ code: "conflict" });
    const current = await getProduct.call({ id: product.id }, OWNER);
    expect(current.product.version).toBe(2);
    expect(["First writer", "Second writer"]).toContain(current.product.name);
  });

  it("archives without deletion, restores only to draft, and preserves history", async () => {
    const tax = await category();
    const product = await draft("history", { taxCategoryId: tax.id });
    const active = await activateProduct.call(
      { id: product.id, expectedVersion: product.version },
      OWNER,
    );
    const archived = await archiveProduct.call(
      {
        id: active.id,
        expectedVersion: active.version,
        reason: "Seasonal product is unavailable.",
      },
      OWNER,
    );
    expect(await resolveVisibleProduct.call({ slug: archived.slug }, ANONYMOUS)).toBeNull();
    expect(
      (await failure(
        updateProduct.call(
          { id: archived.id, expectedVersion: archived.version, name: "Hidden edit" },
          OWNER,
        ),
      )).code,
    ).toBe("conflict");

    const restored = await restoreProduct.call(
      {
        id: archived.id,
        expectedVersion: archived.version,
        reason: "Prepare the next seasonal release.",
      },
      OWNER,
    );
    expect(restored).toMatchObject({ status: "draft", archivedAt: null });
    expect(restored.publishedAt).toEqual(active.publishedAt);
    const history = await getProduct.call({ id: product.id }, OWNER);
    expect(history.history.map((event) => event.toStatus)).toEqual([
      "draft",
      "archived",
      "active",
      "draft",
    ]);
  });

  it("applies catalog grants and database lifecycle constraints independently of callers", async () => {
    const product = await draft("permissions");
    expect((await listProducts.call({}, VIEWER))[0]?.id).toBe(product.id);
    expect(
      (await failure(
        createProduct.call(
          { name: "Forbidden", slug: "forbidden", kind: "physical" },
          VIEWER,
        ),
      )).code,
    ).toBe("permission");

    await expect(
      db().execute(sql`
        insert into products (name, slug, kind, status, visibility, schema_type, version)
        values ('Invalid', 'invalid-product', 'imaginary', 'draft', 'public', 'Product', 1)
      `),
    ).rejects.toBeDefined();
  });
});
