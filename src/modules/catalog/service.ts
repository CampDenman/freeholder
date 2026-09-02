// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Transactional product lifecycle shared by admin, HTTP and MCP (C5.09).

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { isUniqueViolation } from "@/core/db";
import {
  actorString,
  defineService,
  ServiceError,
  type ServiceContext,
} from "@/core/service";
import { recordRedirect } from "@/core/seo/service";
import { blockTreeSchema } from "@/modules/cms/blocks/registry";
import { taxCategoryRow } from "@/modules/invoicing/contract";
import { listTaxConfiguration } from "@/modules/invoicing/tax-service";
import {
  PRODUCT_KINDS,
  PRODUCT_STATUSES,
  PRODUCT_VISIBILITIES,
  schemaTypeFor,
  type ProductStatus,
} from "./contract";
import { productLifecycleEvents, products } from "./schema";
import { syncProductPublicPage } from "./public-pages";
import merchandisingServices, {
  attachProductMedia,
  compareProducts,
  createAttributeDefinition,
  detachProductMedia,
  filterProductsByAttribute,
  listAttributeDefinitions,
  listProductAttributes,
  listProductMedia,
  setProductAttribute,
} from "./merchandising";
import pricingServices, {
  createCustomerGroup,
  createPriceList,
  listCustomerGroups,
  listPriceLists,
  resolvePrice,
  setPriceBreak,
  setPriceListEntry,
} from "./pricing";
import relationServices, {
  addBundleComponent,
  addProductRelation,
  listBundleComponents,
  listProductRelations,
  quoteBundle,
  removeBundleComponent,
  removeProductRelation,
} from "./relations";
import inventoryServices, {
  adjustStock,
  availability,
  consumeReservation,
  countStock,
  enableInventory,
  expireReservations,
  listInventory,
  listReservations,
  listStockMovements,
  listTrackedVariantChoices,
  recordDamage,
  recordStockMovement,
  releaseReservation,
  reserveStock,
  transferStock,
} from "./inventory";
import procurementServices, {
  addPurchaseOrderLine,
  cancelPurchaseOrder,
  createPurchaseOrder,
  createSupplier,
  listPurchaseOrders,
  listReorderQueue,
  listSuppliers,
  placePurchaseOrder,
  receivePurchaseOrderLine,
  setInventoryLevels,
  setVariantStockPolicy,
  subscribeBackInStock,
} from "./procurement";
// Imported for its side effect: registering what a segment may ask about
// commerce (C7.04). A shop instance can segment on orders; an instance with
// this module switched off has no such field, which is the honest answer.
import "./segment-fields";
import shippingServices, {
  addShippingRateBand,
  createDeliveryWindow,
  createPackagingBox,
  createShippingMethod,
  createShippingZone,
  listShippingCatalog,
  quoteShipping,
} from "./shipping";
import offeringServices, {
  createCancellationPolicy,
  deleteCancellationPolicy,
  getServiceOffering,
  listCancellationPolicies,
  listPriceRules,
  quoteServicePayment,
  removePriceRule,
  setPriceRule,
  upsertServiceOffering,
} from "./offerings";
import variantServices, {
  addOptionValue,
  applyVariantMatrix,
  assignProductOption,
  createOptionType,
  getProductVariants,
  listOptionTypes,
  setDefaultVariant,
  setProductOptionValues,
} from "./variants";
import cartServices, {
  abandonStaleCarts,
  addCartItem,
  addWishlistItem,
  attachCartToContact,
  getCart,
  getOrCreateCart,
  listCarts,
  listSavedCarts,
  listSellableVariants,
  listWishlist,
  removeCartItem,
  removeWishlistItem,
  saveCart,
  setCartItemQuantity,
} from "./cart";
import orderServices, {
  cancelOrder,
  checkoutCart,
  getOrder,
  listOrders,
  payOrder,
} from "./orders";
import fulfillmentServices, {
  createFulfillment,
  decideReturn,
  deliverFulfillment,
  failFulfillment,
  getFulfillment,
  getReturn,
  grantDigitalFulfillment,
  listDigitalDeliveries,
  listFulfillmentQueue,
  listFulfillments,
  listReturns,
  packFulfillment,
  receiveReturn,
  refundReturn,
  requestReturn,
  shipFulfillment,
} from "./fulfillment";
// Registers this module as the thing that can turn a redeemed reward into a
// real coupon (§4.13's convergence rule). Imported for its side effect: the
// registry lives in core precisely so loyalty and catalog never import each
// other, and something has to make the claim at load time.
import "./reward-issuer";
import promotionServices, {
  applyCouponToCart,
  applyGiftCardToInvoice,
  createCoupon,
  createOfferRule,
  issueGiftCard,
  listCartOffers,
  listCoupons,
  listGiftCards,
  listOfferRules,
  quoteCartPromotions,
  recoverAbandonedCarts,
} from "./promotions";
// Claims this module's room in the customer portal (C8.11). Imported for
// its side effect: core owns the registry so it never imports a module,
// and something has to make the claim at load time.
import "./portal";
// What the money was for (§4.7, C9.08).
import "./reporting";
// The funnel stages this module answers for (§4.7, C9.07).
import "./funnel";

export {
  abandonStaleCarts,
  addCartItem,
  addWishlistItem,
  attachCartToContact,
  cancelOrder,
  checkoutCart,
  getCart,
  getOrCreateCart,
  getOrder,
  listCarts,
  listOrders,
  listSavedCarts,
  listSellableVariants,
  listWishlist,
  payOrder,
  createFulfillment,
  decideReturn,
  deliverFulfillment,
  failFulfillment,
  getFulfillment,
  getReturn,
  grantDigitalFulfillment,
  listDigitalDeliveries,
  listFulfillmentQueue,
  listFulfillments,
  listReturns,
  packFulfillment,
  receiveReturn,
  refundReturn,
  requestReturn,
  shipFulfillment,
  applyCouponToCart,
  applyGiftCardToInvoice,
  createCoupon,
  createOfferRule,
  issueGiftCard,
  listCartOffers,
  listCoupons,
  listGiftCards,
  listOfferRules,
  quoteCartPromotions,
  recoverAbandonedCarts,
  removeCartItem,
  removeWishlistItem,
  saveCart,
  setCartItemQuantity,
  adjustStock,
  addPurchaseOrderLine,
  addShippingRateBand,
  availability,
  addBundleComponent,
  addOptionValue,
  addProductRelation,
  applyVariantMatrix,
  assignProductOption,
  attachProductMedia,
  cancelPurchaseOrder,
  compareProducts,
  consumeReservation,
  countStock,
  createAttributeDefinition,
  createCustomerGroup,
  createOptionType,
  createCancellationPolicy,
  createPurchaseOrder,
  createSupplier,
  createDeliveryWindow,
  createPackagingBox,
  createShippingMethod,
  createShippingZone,
  createPriceList,
  deleteCancellationPolicy,
  detachProductMedia,
  enableInventory,
  expireReservations,
  filterProductsByAttribute,
  getProductVariants,
  getServiceOffering,
  listAttributeDefinitions,
  listBundleComponents,
  listCancellationPolicies,
  listCustomerGroups,
  listInventory,
  listOptionTypes,
  listPurchaseOrders,
  listReorderQueue,
  listSuppliers,
  listShippingCatalog,
  listPriceLists,
  listPriceRules,
  listProductAttributes,
  listProductMedia,
  listProductRelations,
  listReservations,
  listStockMovements,
  listTrackedVariantChoices,
  placePurchaseOrder,
  quoteBundle,
  quoteShipping,
  quoteServicePayment,
  removeBundleComponent,
  removePriceRule,
  receivePurchaseOrderLine,
  recordDamage,
  recordStockMovement,
  releaseReservation,
  removeProductRelation,
  reserveStock,
  resolvePrice,
  setInventoryLevels,
  setVariantStockPolicy,
  setDefaultVariant,
  setPriceBreak,
  setPriceListEntry,
  setPriceRule,
  setProductAttribute,
  setProductOptionValues,
  subscribeBackInStock,
  transferStock,
  upsertServiceOffering,
};

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
const publicProductRow = row({
  id: uuid,
  name: z.string(),
  slug: z.string(),
  kind: z.enum(PRODUCT_KINDS),
  subtitle: z.string().nullable(),
  description: z.unknown(),
  brand: z.string().nullable(),
  visibility: z.enum(PRODUCT_VISIBILITIES),
  taxCategoryId: uuid.nullable(),
  seo: z.unknown(),
  schemaType: z.string(),
  publishedAt: timestamp.nullable(),
  updatedAt: timestamp,
});
const lifecycleEventRow = row({
  id: uuid,
  productId: uuid,
  fromStatus: z.enum(PRODUCT_STATUSES).nullable(),
  toStatus: z.enum(PRODUCT_STATUSES),
  fromVisibility: z.enum(PRODUCT_VISIBILITIES).nullable(),
  toVisibility: z.enum(PRODUCT_VISIBILITIES),
  resultingVersion: z.number().int(),
  actor: z.string(),
  reason: z.string().nullable(),
  createdAt: timestamp,
});
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
  output: listed(productRow),
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
  output: z.object({ product: productRow, history: listed(lifecycleEventRow) }),
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
  output: listed(taxCategoryRow),
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
  output: listed(publicProductRow),
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
  output: publicProductRow.nullable(),
  handler: async (input, ctx) => {
    const [product] = await ctx.tx
      .select()
      .from(products)
      .where(eq(products.slug, input.slug))
      .limit(1);
    if (!product || product.status !== "active") return null;
    if (product.visibility === "member_only") {
      const { contactHasAccess } = await import("@/core/entitlements/access");
      const { contacts } = await import("@/core/contacts/schema");
      let contactId: string | null = null;
      if (ctx.actor.kind === "user") {
        const [person] = await ctx.tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(eq(contacts.userId, ctx.actor.userId))
          .limit(1);
        contactId = person?.id ?? null;
      }
      const allowed = await contactHasAccess(ctx.tx, contactId, {
        kind: "catalog",
        selector: product.id,
      });
      if (!allowed) return null;
    }
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
  output: productRow,
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
  output: productRow,
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
    const liveContent =
      existing.status !== "active" ||
      (input.name === undefined && input.subtitle === undefined && input.seo === undefined);
    const [updated] = await ctx.tx
      .update(products)
      .set({
        ...patch,
        ...(liveContent
          ? {}
          : {
              name: existing.name,
              subtitle: existing.subtitle,
              seo: existing.seo,
              workingName: input.name ?? existing.workingName ?? existing.name,
              workingSubtitle:
                input.subtitle !== undefined
                  ? input.subtitle
                  : (existing.workingSubtitle ?? existing.subtitle),
              workingSeo: input.seo ?? existing.workingSeo ?? existing.seo,
            }),
        ...(liveContent && input.name !== undefined
          ? { workingName: input.name }
          : {}),
        ...(liveContent && input.subtitle !== undefined
          ? { workingSubtitle: input.subtitle }
          : {}),
        ...(liveContent && input.seo !== undefined
          ? { workingSeo: input.seo }
          : {}),
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
    if (input.slug !== undefined || input.visibility !== undefined) {
      await syncProductPublicPage(ctx, updated.id);
    }
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
  output: productRow,
  handler: async (input, ctx) => {
    const existing = await rowForUpdate(ctx, input.id);
    assertVersion(existing.version, input.expectedVersion);
    if (existing.status === "archived") {
      throw new ServiceError("conflict", "Restore this product to draft before editing it.");
    }
    const published = existing.status === "active";
    const [updated] = await ctx.tx
      .update(products)
      .set({
        ...(published ? {} : { description: input.description }),
        workingDescription: input.description,
        version: existing.version + 1,
      })
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
  const liveName = existing.workingName ?? existing.name;
  const liveSubtitle = existing.workingSubtitle ?? existing.subtitle;
  const liveDescription = existing.workingDescription ?? existing.description;
  const liveSeo = existing.workingSeo ?? existing.seo;
  const [updated] = await ctx.tx
    .update(products)
    .set({
      status: target,
      publishedAt:
        target === "active" ? existing.publishedAt ?? sql`now()` : existing.publishedAt,
      archivedAt: target === "archived" ? sql`now()` : null,
      ...(target === "active"
        ? {
            name: liveName,
            subtitle: liveSubtitle,
            description: liveDescription,
            seo: liveSeo,
            workingName: liveName,
            workingSubtitle: liveSubtitle,
            workingDescription: liveDescription,
            workingSeo: liveSeo,
          }
        : {}),
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
  output: productRow,
  handler: async (input, ctx) => {
    const product = await transition(input, ctx, "active");
    ctx.queueEvent("catalog.productActivated", { productId: product.id });
    await syncProductPublicPage(ctx, product.id);
    return product;
  },
});

export const publishProduct = defineService({
  name: "catalog.publishProduct",
  summary: "Copy an active product's working draft onto the live public row.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: productId, expectedVersion }),
  output: productRow,
  handler: async (input, ctx) => {
    const existing = await rowForUpdate(ctx, input.id);
    assertVersion(existing.version, input.expectedVersion);
    if (existing.status !== "active") {
      throw new ServiceError("conflict", "Activate this product before publishing a working draft.");
    }
    const name = existing.workingName ?? existing.name;
    const subtitle = existing.workingSubtitle ?? existing.subtitle;
    const description = existing.workingDescription ?? existing.description;
    const seo = existing.workingSeo ?? existing.seo;
    const [updated] = await ctx.tx
      .update(products)
      .set({
        name,
        subtitle,
        description,
        seo,
        workingName: name,
        workingSubtitle: subtitle,
        workingDescription: description,
        workingSeo: seo,
        version: existing.version + 1,
      })
      .where(and(eq(products.id, existing.id), eq(products.version, existing.version)))
      .returning();
    if (!updated) throw new ServiceError("conflict", "This product changed while it was being published.");
    ctx.setSubject("product", updated.id);
    ctx.queueEvent("catalog.productUpdated", { productId: updated.id, version: updated.version });
    await syncProductPublicPage(ctx, updated.id);
    return updated;
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
  output: productRow,
  handler: async (input, ctx) => {
    const product = await transition(input, ctx, "archived");
    ctx.queueEvent("catalog.productArchived", { productId: product.id, reason: input.reason });
    await syncProductPublicPage(ctx, product.id);
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
  output: productRow,
  handler: async (input, ctx) => {
    const product = await transition(input, ctx, "draft");
    ctx.queueEvent("catalog.productRestored", { productId: product.id, reason: input.reason });
    await syncProductPublicPage(ctx, product.id);
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
  publishProduct,
  archiveProduct,
  restoreProduct,
  ...variantServices,
  ...merchandisingServices,
  ...pricingServices,
  ...relationServices,
  ...offeringServices,
  ...inventoryServices,
  ...procurementServices,
  ...shippingServices,
  ...cartServices,
  ...orderServices,
  ...fulfillmentServices,
  ...promotionServices,
];
