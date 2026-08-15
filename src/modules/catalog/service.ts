// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Transactional product lifecycle shared by admin, HTTP and MCP (C5.09).

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { isUniqueViolation } from "@/core/db";
import {
  actorString,
  defineService,
  ServiceError,
  type ServiceContext,
} from "@/core/service";
import { recordRedirect } from "@/core/seo/service";
import { blockTreeSchema } from "@/modules/cms/blocks/registry";
import { listTaxConfiguration } from "@/modules/invoicing/tax-service";
import {
  PRODUCT_KINDS,
  PRODUCT_STATUSES,
  PRODUCT_VISIBILITIES,
  schemaTypeFor,
  type ProductStatus,
} from "./contract";
import { productLifecycleEvents, products } from "./schema";

const productId = z.string().uuid();
const expectedVersion = z.number().int().positive().max(2_147_483_647);
const name = z.string().trim().min(1).max(240);
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/\s+/g, "-"))
  .refine(
    (value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 180,
    "Use lowercase words separated by hyphens.",
  );
const optionalText = (max: number) =>
  z.string().trim().max(max).transform((value) => value || null).nullable();
const seo = z
  .object({
    title: z.string().trim().max(60).optional(),
    description: z.string().trim().max(155).optional(),
  })
  .default({});

function duplicateSlug(value: string): ServiceError {
  return new ServiceError(
    "conflict",
    `Another product already uses /products/${value}. Choose a different address.`,
  );
}

function publicProduct(product: typeof products.$inferSelect) {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    kind: product.kind,
    subtitle: product.subtitle,
    description: product.description,
    brand: product.brand,
    visibility: product.visibility,
    taxCategoryId: product.taxCategoryId,
    seo: product.seo,
    schemaType: product.schemaType,
    publishedAt: product.publishedAt,
    updatedAt: product.updatedAt,
  };
}

async function rowForUpdate(ctx: ServiceContext, id: string) {
  const [product] = await ctx.tx
    .select()
    .from(products)
    .where(eq(products.id, id))
    .for("update");
  if (!product) throw new ServiceError("not_found", "That product is not here.");
  return product;
}

function assertVersion(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new ServiceError(
      "conflict",
      "This product changed after you opened it. Refresh before applying another edit.",
    );
  }
}

async function taxCategory(
  ctx: ServiceContext,
  id: string | null,
): Promise<{ id: string; active: boolean } | null> {
  if (!id) return null;
  const configuration = await ctx.callAsSystem(listTaxConfiguration, {});
  const category = configuration.categories.find((candidate) => candidate.id === id);
  if (!category) throw new ServiceError("not_found", "That tax category is not here.");
  return category;
}

async function recordLifecycle(
  ctx: ServiceContext,
  product: typeof products.$inferSelect,
  previous: {
    status: ProductStatus | null;
    visibility: (typeof PRODUCT_VISIBILITIES)[number] | null;
  },
  reason?: string,
): Promise<void> {
  await ctx.tx.insert(productLifecycleEvents).values({
    productId: product.id,
    fromStatus: previous.status,
    toStatus: product.status,
    fromVisibility: previous.visibility,
    toVisibility: product.visibility,
    resultingVersion: product.version,
    actor: actorString(ctx.actor),
    reason,
  });
}

export const listProducts = defineService({
  name: "catalog.listProducts",
  summary: "List products for owner operations by lifecycle, kind, or visibility.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    status: z.enum(PRODUCT_STATUSES).optional(),
    kind: z.enum(PRODUCT_KINDS).optional(),
    visibility: z.enum(PRODUCT_VISIBILITIES).optional(),
    limit: z.number().int().min(1).max(500).default(200),
  }),
  handler: (input, ctx) => {
    const filters = [
      input.status ? eq(products.status, input.status) : undefined,
      input.kind ? eq(products.kind, input.kind) : undefined,
      input.visibility ? eq(products.visibility, input.visibility) : undefined,
    ].filter((value): value is NonNullable<typeof value> => Boolean(value));
    return ctx.tx
      .select()
      .from(products)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(products.updatedAt), asc(products.name))
      .limit(input.limit);
  },
});

export const getProduct = defineService({
  name: "catalog.getProduct",
  summary: "Read one product and its append-only lifecycle history.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: productId }),
  handler: async (input, ctx) => {
    const [product] = await ctx.tx
      .select()
      .from(products)
      .where(eq(products.id, input.id))
      .limit(1);
    if (!product) throw new ServiceError("not_found", "That product is not here.");
    const history = await ctx.tx
      .select()
      .from(productLifecycleEvents)
      .where(eq(productLifecycleEvents.productId, product.id))
      .orderBy(desc(productLifecycleEvents.createdAt));
    return { product, history };
  },
});

export const listProductTaxCategories = defineService({
  name: "catalog.listTaxCategories",
  summary: "List tax categories available to product operations, including inactive history.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  handler: async (_input, ctx) => {
    const configuration = await ctx.callAsSystem(listTaxConfiguration, {});
    return configuration.categories;
  },
});

export const listVisibleProducts = defineService({
  name: "catalog.listVisibleProducts",
  summary: "List active public products for future storefront projections.",
  kind: "query",
  permission: "public",
  input: z.object({ limit: z.number().int().min(1).max(500).default(100) }),
  handler: async (input, ctx) => {
    const rows = await ctx.tx
      .select()
      .from(products)
      .where(and(eq(products.status, "active"), eq(products.visibility, "public")))
      .orderBy(desc(products.updatedAt), asc(products.name))
      .limit(input.limit);
    return rows.map(publicProduct);
  },
});

export const resolveVisibleProduct = defineService({
  name: "catalog.resolveVisibleProduct",
  summary: "Resolve an active public, unlisted, or authenticated member product by slug.",
  kind: "query",
  permission: "public",
  input: z.object({ slug }),
  handler: async (input, ctx) => {
    const [product] = await ctx.tx
      .select()
      .from(products)
      .where(eq(products.slug, input.slug))
      .limit(1);
    if (!product || product.status !== "active") return null;
    if (product.visibility === "member_only" && ctx.actor.kind === "anonymous") return null;
    return publicProduct(product);
  },
});

export const createProduct = defineService({
  name: "catalog.createProduct",
  summary: "Create one draft product of any supported catalog kind.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    name,
    slug,
    kind: z.enum(PRODUCT_KINDS),
    visibility: z.enum(PRODUCT_VISIBILITIES).default("public"),
    subtitle: optionalText(300).optional(),
    brand: optionalText(200).optional(),
    taxCategoryId: productId.nullable().optional(),
    description: blockTreeSchema("page").default([]),
    seo,
  }),
  handler: async (input, ctx) => {
    await taxCategory(ctx, input.taxCategoryId ?? null);
    const [created] = await ctx.tx
      .insert(products)
      .values({
        ...input,
        subtitle: input.subtitle ?? null,
        brand: input.brand ?? null,
        taxCategoryId: input.taxCategoryId ?? null,
        schemaType: schemaTypeFor(input.kind),
      })
      .returning()
      .catch((error: unknown) => {
        if (isUniqueViolation(error, "products_slug_idx")) throw duplicateSlug(input.slug);
        throw error;
      });
    await recordLifecycle(ctx, created!, { status: null, visibility: null }, "Product draft created.");
    ctx.setSubject("product", created!.id);
    ctx.queueEvent("catalog.productCreated", { productId: created!.id, kind: created!.kind });
    return created!;
  },
});

const updateProductInput = z
  .object({
    id: productId,
    expectedVersion,
    name: name.optional(),
    slug: slug.optional(),
    kind: z.enum(PRODUCT_KINDS).optional(),
    subtitle: optionalText(300).optional(),
    brand: optionalText(200).optional(),
    visibility: z.enum(PRODUCT_VISIBILITIES).optional(),
    taxCategoryId: productId.nullable().optional(),
    seo: seo.optional(),
  })
  .refine(
    (value) =>
      ["name", "slug", "kind", "subtitle", "brand", "visibility", "taxCategoryId", "seo"].some(
        (key) => key in value,
      ),
    "Provide at least one product field to update.",
  );

export const updateProduct = defineService({
  name: "catalog.updateProduct",
  summary: "Update product identity and visibility with stale-write refusal.",
  kind: "mutation",
  permission: "scoped",
  input: updateProductInput,
  handler: async (input, ctx) => {
    const existing = await rowForUpdate(ctx, input.id);
    assertVersion(existing.version, input.expectedVersion);
    if (existing.status === "archived") {
      throw new ServiceError("conflict", "Restore this product to draft before editing it.");
    }
    if (input.kind && input.kind !== existing.kind && existing.publishedAt) {
      throw new ServiceError(
        "conflict",
        "A product kind cannot change after its first activation. Create a new product instead.",
      );
    }
    if (input.taxCategoryId !== undefined) await taxCategory(ctx, input.taxCategoryId);

    const { id: _id, expectedVersion: _version, ...patch } = input;
    const nextKind = input.kind ?? existing.kind;
    const [updated] = await ctx.tx
      .update(products)
      .set({
        ...patch,
        ...(input.kind ? { schemaType: schemaTypeFor(nextKind) } : {}),
        version: existing.version + 1,
      })
      .where(and(eq(products.id, existing.id), eq(products.version, existing.version)))
      .returning()
      .catch((error: unknown) => {
        if (isUniqueViolation(error, "products_slug_idx")) {
          throw duplicateSlug(input.slug ?? existing.slug);
        }
        throw error;
      });
    if (!updated) throw new ServiceError("conflict", "This product changed while it was being saved.");

    if (existing.slug !== updated.slug && existing.publishedAt) {
      await ctx.callAsSystem(recordRedirect, {
        fromPath: `products/${existing.slug}`,
        toPath: `products/${updated.slug}`,
        status: "301",
        source: `catalog:${updated.id}`,
      });
    }
    if (existing.visibility !== updated.visibility) {
      await recordLifecycle(
        ctx,
        updated,
        { status: existing.status, visibility: existing.visibility },
        "Product visibility changed.",
      );
      ctx.queueEvent("catalog.productVisibilityChanged", {
        productId: updated.id,
        from: existing.visibility,
        to: updated.visibility,
      });
    }
    ctx.setSubject("product", updated.id);
    ctx.queueEvent("catalog.productUpdated", { productId: updated.id, version: updated.version });
    return updated;
  },
});

export const updateProductDescription = defineService({
  name: "catalog.updateProductDescription",
  summary: "Save a validated product-description block tree with stale-write refusal.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: productId,
    expectedVersion,
    description: blockTreeSchema("page"),
  }),
  handler: async (input, ctx) => {
    const existing = await rowForUpdate(ctx, input.id);
    assertVersion(existing.version, input.expectedVersion);
    if (existing.status === "archived") {
      throw new ServiceError("conflict", "Restore this product to draft before editing it.");
    }
    const [updated] = await ctx.tx
      .update(products)
      .set({ description: input.description, version: existing.version + 1 })
      .where(and(eq(products.id, existing.id), eq(products.version, existing.version)))
      .returning();
    if (!updated) throw new ServiceError("conflict", "This product changed while it was being saved.");
    ctx.setSubject("product", updated.id);
    ctx.queueEvent("catalog.productUpdated", { productId: updated.id, version: updated.version });
    return updated;
  },
});

async function transition(
  input: { id: string; expectedVersion: number; reason?: string },
  ctx: ServiceContext,
  target: ProductStatus,
) {
  const existing = await rowForUpdate(ctx, input.id);
  assertVersion(existing.version, input.expectedVersion);
  const allowed =
    (target === "active" && existing.status === "draft") ||
    (target === "archived" && (existing.status === "draft" || existing.status === "active")) ||
    (target === "draft" && existing.status === "archived");
  if (!allowed) {
    throw new ServiceError(
      "conflict",
      `A ${existing.status.replaceAll("_", " ")} product cannot move directly to ${target.replaceAll("_", " ")}.`,
    );
  }
  if (target === "active") {
    const category = await taxCategory(ctx, existing.taxCategoryId);
    if (!category) {
      throw new ServiceError("validation", "Choose a tax category before activating this product.");
    }
    if (!category.active) {
      throw new ServiceError("validation", "Choose an active tax category before activating this product.");
    }
  }
  const [updated] = await ctx.tx
    .update(products)
    .set({
      status: target,
      publishedAt:
        target === "active" ? existing.publishedAt ?? sql`now()` : existing.publishedAt,
      archivedAt: target === "archived" ? sql`now()` : null,
      version: existing.version + 1,
    })
    .where(and(eq(products.id, existing.id), eq(products.version, existing.version)))
    .returning();
  if (!updated) throw new ServiceError("conflict", "This product changed during its lifecycle transition.");
  await recordLifecycle(
    ctx,
    updated,
    { status: existing.status, visibility: existing.visibility },
    input.reason,
  );
  ctx.setSubject("product", updated.id);
  return updated;
}

export const activateProduct = defineService({
  name: "catalog.activateProduct",
  summary: "Activate a reviewed draft after catalog safety interlocks pass.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: productId, expectedVersion }),
  handler: async (input, ctx) => {
    const product = await transition(input, ctx, "active");
    ctx.queueEvent("catalog.productActivated", { productId: product.id });
    return product;
  },
});

export const archiveProduct = defineService({
  name: "catalog.archiveProduct",
  summary: "Remove a product from use while retaining its complete history.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: productId,
    expectedVersion,
    reason: z.string().trim().min(3).max(1_000),
  }),
  handler: async (input, ctx) => {
    const product = await transition(input, ctx, "archived");
    ctx.queueEvent("catalog.productArchived", { productId: product.id, reason: input.reason });
    return product;
  },
});

export const restoreProduct = defineService({
  name: "catalog.restoreProduct",
  summary: "Restore an archived product to draft for explicit review.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: productId,
    expectedVersion,
    reason: z.string().trim().min(3).max(1_000),
  }),
  handler: async (input, ctx) => {
    const product = await transition(input, ctx, "draft");
    ctx.queueEvent("catalog.productRestored", { productId: product.id, reason: input.reason });
    return product;
  },
});

export default [
  listProducts,
  getProduct,
  listProductTaxCategories,
  listVisibleProducts,
  resolveVisibleProduct,
  createProduct,
  updateProduct,
  updateProductDescription,
  activateProduct,
  archiveProduct,
  restoreProduct,
];
