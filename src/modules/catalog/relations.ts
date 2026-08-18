// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Product relations and bundle composition (C5.12).

import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { isUniqueViolation } from "@/core/db";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { decimalToMinor } from "@/adapters/payments/currency";
import { assertPositiveMinor, safeMinor } from "@/modules/invoicing/money";
import {
  BUNDLE_PRICE_MODES,
  PRODUCT_KINDS,
  PRODUCT_STATUSES,
  PRODUCT_VISIBILITIES,
  RELATION_KINDS,
} from "./contract";
import { resolvePrice } from "./pricing";
import {
  bundleComponents,
  productRelations,
  productVariants,
  products,
} from "./schema";

const productId = z.string().uuid();
const expectedVersion = z.number().int().positive().max(2_147_483_647);

const productRow = row({
  id: uuid,
  name: z.string(),
  slug: z.string(),
  kind: z.enum(PRODUCT_KINDS),
  subtitle: z.string().nullable(),
  description: z.unknown(),
  brand: z.string().nullable(),
  status: z.enum(PRODUCT_STATUSES),
  visibility: z.enum(PRODUCT_VISIBILITIES),
  taxCategoryId: uuid.nullable(),
  seo: z.unknown(),
  workingName: z.string().nullable(),
  workingSubtitle: z.string().nullable(),
  workingDescription: z.unknown().nullable(),
  workingSeo: z.unknown().nullable(),
  schemaType: z.string(),
  publishedAt: timestamp.nullable(),
  archivedAt: timestamp.nullable(),
  version: z.number().int(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const bundleComponentRow = row({
  id: uuid,
  bundleProductId: uuid,
  componentVariantId: uuid,
  quantity: z.number().int(),
  priceMode: z.enum(BUNDLE_PRICE_MODES),
  amountMinor: z.number().int().nullable(),
  percentOffPpm: z.number().int().nullable(),
  position: z.number().int(),
  createdAt: timestamp,
});
const bundleQuoteLine = z.object({
  componentId: uuid,
  variantId: uuid,
  quantity: z.number().int(),
  priceMode: z.enum(BUNDLE_PRICE_MODES),
  amountMinor: z.number().int(),
  explanation: z.string(),
});
const bundleQuote = z.object({
  available: z.boolean(),
  currency: z.string(),
  productId: uuid,
  totalMinor: z.number().int(),
  reason: z.string(),
  lines: listed(bundleQuoteLine),
});

async function productForUpdate(ctx: ServiceContext, id: string, version: number) {
  const [product] = await ctx.tx.select().from(products).where(eq(products.id, id)).for("update");
  if (!product) throw new ServiceError("not_found", "That product is not here.");
  if (product.version !== version) {
    throw new ServiceError(
      "conflict",
      "This product changed after you opened it. Refresh before applying another edit.",
    );
  }
  if (product.status === "archived") {
    throw new ServiceError("conflict", "Restore this product to draft before editing relations.");
  }
  return product;
}

async function bumpProduct(ctx: ServiceContext, id: string, version: number) {
  const [updated] = await ctx.tx
    .update(products)
    .set({ version: version + 1, updatedAt: sql`now()` })
    .where(and(eq(products.id, id), eq(products.version, version)))
    .returning();
  if (!updated) throw new ServiceError("conflict", "This product changed while relations were being updated.");
  return updated;
}

export const listProductRelations = defineService({
  name: "catalog.listProductRelations",
  summary: "List merchandising relations from one product.",
  kind: "query",
  permission: "scoped",
  input: z.object({ productId }),
  output: listed(
    row({
      id: uuid,
      kind: z.enum(RELATION_KINDS),
      position: z.number().int(),
      related: productRow,
    }),
  ),
  handler: async (input, ctx) => {
    const [product] = await ctx.tx.select({ id: products.id }).from(products).where(eq(products.id, input.productId));
    if (!product) throw new ServiceError("not_found", "That product is not here.");
    return ctx.tx
      .select({
        id: productRelations.id,
        kind: productRelations.kind,
        position: productRelations.position,
        related: products,
      })
      .from(productRelations)
      .innerJoin(products, eq(products.id, productRelations.relatedProductId))
      .where(eq(productRelations.productId, input.productId))
      .orderBy(asc(productRelations.kind), asc(productRelations.position));
  },
});

export const addProductRelation = defineService({
  name: "catalog.addProductRelation",
  summary: "Attach an upsell, cross-sell, accessory, replacement or merchandising sibling.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    productId,
    expectedVersion,
    relatedProductId: productId,
    kind: z.enum(RELATION_KINDS),
  }),
  output: productRow,
  handler: async (input, ctx) => {
    if (input.productId === input.relatedProductId) {
      throw new ServiceError("validation", "A product cannot be related to itself.");
    }
    const product = await productForUpdate(ctx, input.productId, input.expectedVersion);
    const [related] = await ctx.tx.select({ id: products.id }).from(products).where(eq(products.id, input.relatedProductId));
    if (!related) throw new ServiceError("not_found", "That related product is not here.");
    const count = (
      await ctx.tx
        .select({ id: productRelations.id })
        .from(productRelations)
        .where(and(eq(productRelations.productId, product.id), eq(productRelations.kind, input.kind)))
    ).length;
    await ctx.tx
      .insert(productRelations)
      .values({
        productId: product.id,
        relatedProductId: related.id,
        kind: input.kind,
        position: count,
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error, "product_relations_unique_idx")) {
          throw new ServiceError("conflict", "That merchandising relation already exists.");
        }
        throw error;
      });
    const updated = await bumpProduct(ctx, product.id, product.version);
    ctx.setSubject("product", updated.id);
    ctx.queueEvent("catalog.productRelated", {
      productId: updated.id,
      relatedProductId: related.id,
      kind: input.kind,
    });
    return updated;
  },
});

export const removeProductRelation = defineService({
  name: "catalog.removeProductRelation",
  summary: "Remove one merchandising relation.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ productId, expectedVersion, relationId: productId }),
  output: productRow,
  handler: async (input, ctx) => {
    const product = await productForUpdate(ctx, input.productId, input.expectedVersion);
    const deleted = await ctx.tx
      .delete(productRelations)
      .where(and(eq(productRelations.id, input.relationId), eq(productRelations.productId, product.id)))
      .returning({ id: productRelations.id });
    if (!deleted[0]) throw new ServiceError("not_found", "That relation is not here.");
    return bumpProduct(ctx, product.id, product.version);
  },
});

export const listBundleComponents = defineService({
  name: "catalog.listBundleComponents",
  summary: "List the variants a bundle contains.",
  kind: "query",
  permission: "scoped",
  input: z.object({ productId }),
  output: listed(bundleComponentRow),
  handler: async (input, ctx) => {
    const [product] = await ctx.tx.select({ id: products.id, kind: products.kind }).from(products).where(eq(products.id, input.productId));
    if (!product) throw new ServiceError("not_found", "That product is not here.");
    return ctx.tx
      .select()
      .from(bundleComponents)
      .where(eq(bundleComponents.bundleProductId, input.productId))
      .orderBy(asc(bundleComponents.position), asc(bundleComponents.createdAt));
  },
});

export const addBundleComponent = defineService({
  name: "catalog.addBundleComponent",
  summary: "Add a component variant to a bundle with an explicit price rule.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    productId,
    expectedVersion,
    componentVariantId: productId,
    quantity: z.number().int().positive().max(10_000).default(1),
    priceMode: z.enum(BUNDLE_PRICE_MODES).default("sum"),
    amount: z.string().trim().min(1).max(20).optional(),
    percentOffPpm: z.number().int().min(1).max(1_000_000).optional(),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
  }),
  output: productRow,
  handler: async (input, ctx) => {
    const product = await productForUpdate(ctx, input.productId, input.expectedVersion);
    if (product.kind !== "bundle") {
      throw new ServiceError("validation", "Only a bundle product can contain other variants.");
    }
    const [variant] = await ctx.tx
      .select()
      .from(productVariants)
      .where(eq(productVariants.id, input.componentVariantId));
    if (!variant) throw new ServiceError("not_found", "That component variant is not here.");
    if (variant.productId === product.id) {
      throw new ServiceError("validation", "A bundle cannot contain one of its own variants.");
    }
    let amountMinor: number | undefined;
    if (input.priceMode === "fixed") {
      if (!input.amount || !input.currency) {
        throw new ServiceError("validation", "A fixed bundle component needs an amount and currency.");
      }
      try {
        amountMinor = assertPositiveMinor(decimalToMinor(input.amount, input.currency), "Bundle component price");
      } catch (error) {
        if (error instanceof ServiceError) throw error;
        throw new ServiceError("validation", "Enter a valid fixed component amount.");
      }
    }
    if (input.priceMode === "percent_off" && !input.percentOffPpm) {
      throw new ServiceError("validation", "A percent-off component needs a percent.");
    }
    const count = (
      await ctx.tx
        .select({ id: bundleComponents.id })
        .from(bundleComponents)
        .where(eq(bundleComponents.bundleProductId, product.id))
    ).length;
    await ctx.tx
      .insert(bundleComponents)
      .values({
        bundleProductId: product.id,
        componentVariantId: variant.id,
        quantity: input.quantity,
        priceMode: input.priceMode,
        amountMinor,
        percentOffPpm: input.priceMode === "percent_off" ? input.percentOffPpm : undefined,
        position: count,
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error, "bundle_components_unique_idx")) {
          throw new ServiceError("conflict", "That variant is already in this bundle.");
        }
        throw error;
      });
    const updated = await bumpProduct(ctx, product.id, product.version);
    ctx.setSubject("product", updated.id);
    ctx.queueEvent("catalog.bundleComponentAdded", {
      productId: updated.id,
      componentVariantId: variant.id,
    });
    return updated;
  },
});

export const removeBundleComponent = defineService({
  name: "catalog.removeBundleComponent",
  summary: "Remove one variant from a bundle.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ productId, expectedVersion, componentId: productId }),
  output: productRow,
  handler: async (input, ctx) => {
    const product = await productForUpdate(ctx, input.productId, input.expectedVersion);
    const deleted = await ctx.tx
      .delete(bundleComponents)
      .where(and(eq(bundleComponents.id, input.componentId), eq(bundleComponents.bundleProductId, product.id)))
      .returning({ id: bundleComponents.id });
    if (!deleted[0]) throw new ServiceError("not_found", "That bundle component is not here.");
    return bumpProduct(ctx, product.id, product.version);
  },
});

export const quoteBundle = defineService({
  name: "catalog.quoteBundle",
  summary: "Quote a bundle from its component rules without a parallel money path.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    productId,
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
    contactId: productId.optional(),
    quantity: z.number().int().positive().max(10_000).default(1),
    at: z.coerce.date().default(() => new Date()),
  }),
  output: bundleQuote,
  handler: async (input, ctx) => {
    const [product] = await ctx.tx.select().from(products).where(eq(products.id, input.productId));
    if (!product) throw new ServiceError("not_found", "That product is not here.");
    if (product.kind !== "bundle") {
      throw new ServiceError("validation", "Only a bundle product can be quoted as a bundle.");
    }
    const components = await ctx.tx
      .select()
      .from(bundleComponents)
      .where(eq(bundleComponents.bundleProductId, product.id))
      .orderBy(asc(bundleComponents.position));
    if (components.length === 0) {
      throw new ServiceError("validation", "Add at least one component before quoting this bundle.");
    }
    const lines = [];
    for (const component of components) {
      const [variant] = await ctx.tx
        .select()
        .from(productVariants)
        .where(eq(productVariants.id, component.componentVariantId));
      if (!variant || variant.status !== "active") {
        return {
          available: false,
          currency: input.currency,
          productId: product.id,
          totalMinor: 0,
          reason: "A bundle component is archived or missing, so the bundle cannot be sold.",
          lines: [],
        };
      }
      const units = component.quantity * input.quantity;
      let contributionMinor: number;
      let explanation: string;
      if (component.priceMode === "fixed") {
        contributionMinor = safeMinor(BigInt(component.amountMinor ?? 0) * BigInt(units), "Fixed bundle component");
        explanation = `Fixed ${component.amountMinor} minor units × ${units}.`;
      } else {
        const resolved = await ctx.call(resolvePrice, {
          variantId: variant.id,
          currency: input.currency,
          contactId: input.contactId,
          quantity: units,
          at: input.at,
        });
        if (!resolved.available || resolved.totalMinor === undefined) {
          return {
            available: false,
            currency: input.currency,
            productId: product.id,
            totalMinor: 0,
            reason: resolved.reason,
            lines: [],
          };
        }
        contributionMinor =
          component.priceMode === "percent_off"
            ? safeMinor(
                (BigInt(resolved.totalMinor) * BigInt(1_000_000 - (component.percentOffPpm ?? 0))) /
                  1_000_000n,
                "Percent-off bundle component",
              )
            : resolved.totalMinor;
        explanation =
          component.priceMode === "percent_off"
            ? `${resolved.reason} Then ${((component.percentOffPpm ?? 0) / 10_000).toString()}% off this component.`
            : resolved.reason;
      }
      lines.push({
        componentId: component.id,
        variantId: variant.id,
        quantity: units,
        priceMode: component.priceMode,
        amountMinor: contributionMinor,
        explanation,
      });
    }
    const totalMinor = safeMinor(
      lines.reduce((sum, line) => sum + BigInt(line.amountMinor), 0n),
      "Bundle total",
    );
    return {
      available: true,
      currency: input.currency,
      productId: product.id,
      totalMinor,
      reason: "Bundle price is the sum of each component's configured rule. Stock is untracked until inventory lands, so availability follows active component variants.",
      lines,
    };
  },
});

export default [
  listProductRelations,
  addProductRelation,
  removeProductRelation,
  listBundleComponents,
  addBundleComponent,
  removeBundleComponent,
  quoteBundle,
];
