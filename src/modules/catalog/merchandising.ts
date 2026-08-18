// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Product attributes, comparison and ordered media (C5.11).

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { isUniqueViolation } from "@/core/db";
import { assets } from "@/core/media/schema";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import {
  ATTRIBUTE_KINDS,
  MEDIA_ROLES,
  PRODUCT_KINDS,
  PRODUCT_STATUSES,
  PRODUCT_VISIBILITIES,
} from "./contract";
import {
  attributeDefinitions,
  productAttributes,
  productMedia,
  productVariants,
  products,
} from "./schema";

const productId = z.string().uuid();
const expectedVersion = z.number().int().positive().max(2_147_483_647);
const attributeKey = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/)
  .max(40);

const THREE_D_MIME = new Set(["model/gltf-binary", "model/gltf+json", "model/vnd.usdz+zip"]);

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
const attributeDefinitionRow = row({
  id: uuid,
  key: z.string(),
  label: z.string(),
  kind: z.enum(ATTRIBUTE_KINDS),
  unit: z.string().nullable(),
  groupName: z.string().nullable(),
  isFilterable: z.boolean(),
  isComparable: z.boolean(),
  enumOptions: listed(z.string()),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const productAttributeRow = row({
  productId: uuid,
  attributeId: uuid,
  textValue: z.string().nullable(),
  numberValue: z.string().nullable(),
  boolValue: z.boolean().nullable(),
  key: z.string(),
  label: z.string(),
  kind: z.enum(ATTRIBUTE_KINDS),
  unit: z.string().nullable(),
  groupName: z.string().nullable(),
  isFilterable: z.boolean(),
  isComparable: z.boolean(),
});
const productMediaRow = row({
  id: uuid,
  productId: uuid,
  variantId: uuid.nullable(),
  assetId: uuid,
  role: z.enum(MEDIA_ROLES),
  position: z.number().int(),
  createdAt: timestamp,
});
const assetRow = row({
  id: uuid,
  kind: z.enum(["image", "video", "doc", "audio"]),
  storageKey: z.string(),
  filename: z.string(),
  mime: z.string(),
  legacyBytes: z.number().int(),
  bytes: z.number().int(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationSeconds: z.number().int().nullable(),
  variants: z.unknown(),
  altText: z.string().nullable(),
  blurhash: z.string().nullable(),
  status: z.string(),
  scanStatus: z.string(),
  scanEngine: z.string().nullable(),
  scanMessage: z.string().nullable(),
  scannedAt: timestamp.nullable(),
  checksumSha256: z.string().nullable(),
  metadata: z.unknown(),
  provenance: z.unknown(),
  source: z.string(),
  uploadedBy: z.string().nullable(),
  focalX: z.number().int(),
  focalY: z.number().int(),
  deletedAt: timestamp.nullable(),
  purgeAfter: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const mediaAttachment = z.object({ media: productMediaRow, asset: assetRow });

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
    throw new ServiceError("conflict", "Restore this product to draft before editing merchandising.");
  }
  return product;
}

async function bumpProduct(ctx: ServiceContext, id: string, version: number) {
  const [updated] = await ctx.tx
    .update(products)
    .set({ version: version + 1, updatedAt: sql`now()` })
    .where(and(eq(products.id, id), eq(products.version, version)))
    .returning();
  if (!updated) throw new ServiceError("conflict", "This product changed while merchandising was being updated.");
  return updated;
}

function attributePayload(
  kind: (typeof ATTRIBUTE_KINDS)[number],
  value: { text?: string; number?: string; bool?: boolean; enum?: string },
) {
  if (kind === "text") {
    if (!value.text) throw new ServiceError("validation", "That attribute needs a text value.");
    return { textValue: value.text, numberValue: null, boolValue: null };
  }
  if (kind === "number" || kind === "measure") {
    if (!value.number || !/^-?[0-9]+(?:\.[0-9]+)?$/.test(value.number)) {
      throw new ServiceError("validation", "That attribute needs a numeric value.");
    }
    return { textValue: null, numberValue: value.number, boolValue: null };
  }
  if (kind === "bool") {
    if (value.bool === undefined) throw new ServiceError("validation", "That attribute needs a yes or no value.");
    return { textValue: null, numberValue: null, boolValue: value.bool };
  }
  if (!value.enum) throw new ServiceError("validation", "That attribute needs one of its listed values.");
  return { textValue: value.enum, numberValue: null, boolValue: null };
}

export const listAttributeDefinitions = defineService({
  name: "catalog.listAttributeDefinitions",
  summary: "List reusable product attributes used for facts, filters and comparison.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(attributeDefinitionRow),
  handler: (_input, ctx) =>
    ctx.tx.select().from(attributeDefinitions).orderBy(asc(attributeDefinitions.groupName), asc(attributeDefinitions.label)),
});

export const createAttributeDefinition = defineService({
  name: "catalog.createAttributeDefinition",
  summary: "Create a reusable product attribute that is not a buyable option.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    key: attributeKey,
    label: z.string().trim().min(1).max(80),
    kind: z.enum(ATTRIBUTE_KINDS),
    unit: z.string().trim().min(1).max(24).optional(),
    groupName: z.string().trim().min(1).max(80).optional(),
    isFilterable: z.boolean().default(false),
    isComparable: z.boolean().default(false),
    enumOptions: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
  }),
  output: attributeDefinitionRow,
  handler: async (input, ctx) => {
    if (input.kind === "measure" && !input.unit) {
      throw new ServiceError("validation", "A measured attribute needs a unit.");
    }
    if (input.kind === "enum" && input.enumOptions.length === 0) {
      throw new ServiceError("validation", "An enumerated attribute needs at least one option.");
    }
    const [created] = await ctx.tx
      .insert(attributeDefinitions)
      .values(input)
      .returning()
      .catch((error: unknown) => {
        if (isUniqueViolation(error, "attribute_definitions_key_idx")) {
          throw new ServiceError("conflict", "Another attribute already uses that key.");
        }
        throw error;
      });
    ctx.setSubject("attributeDefinition", created!.id);
    ctx.queueEvent("catalog.attributeDefined", { attributeId: created!.id, key: created!.key });
    return created!;
  },
});

export const listProductAttributes = defineService({
  name: "catalog.listProductAttributes",
  summary: "Read the facts attached to one product.",
  kind: "query",
  permission: "scoped",
  input: z.object({ productId }),
  output: listed(productAttributeRow),
  handler: async (input, ctx) => {
    const [product] = await ctx.tx.select({ id: products.id }).from(products).where(eq(products.id, input.productId));
    if (!product) throw new ServiceError("not_found", "That product is not here.");
    return ctx.tx
      .select({
        productId: productAttributes.productId,
        attributeId: productAttributes.attributeId,
        textValue: productAttributes.textValue,
        numberValue: productAttributes.numberValue,
        boolValue: productAttributes.boolValue,
        key: attributeDefinitions.key,
        label: attributeDefinitions.label,
        kind: attributeDefinitions.kind,
        unit: attributeDefinitions.unit,
        groupName: attributeDefinitions.groupName,
        isFilterable: attributeDefinitions.isFilterable,
        isComparable: attributeDefinitions.isComparable,
      })
      .from(productAttributes)
      .innerJoin(attributeDefinitions, eq(attributeDefinitions.id, productAttributes.attributeId))
      .where(eq(productAttributes.productId, input.productId))
      .orderBy(asc(attributeDefinitions.groupName), asc(attributeDefinitions.label));
  },
});

export const setProductAttribute = defineService({
  name: "catalog.setProductAttribute",
  summary: "Set or replace one product attribute value.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    productId,
    expectedVersion,
    attributeId: productId,
    text: z.string().trim().min(1).max(500).optional(),
    number: z.string().trim().max(40).optional(),
    bool: z.boolean().optional(),
    enum: z.string().trim().min(1).max(80).optional(),
  }),
  output: productRow,
  handler: async (input, ctx) => {
    const product = await productForUpdate(ctx, input.productId, input.expectedVersion);
    const [definition] = await ctx.tx
      .select()
      .from(attributeDefinitions)
      .where(eq(attributeDefinitions.id, input.attributeId));
    if (!definition) throw new ServiceError("not_found", "That attribute is not here.");
    if (definition.kind === "enum" && input.enum && !definition.enumOptions.includes(input.enum)) {
      throw new ServiceError("validation", "Choose one of the listed values for that attribute.");
    }
    const payload = attributePayload(definition.kind, input);
    await ctx.tx
      .insert(productAttributes)
      .values({ productId: product.id, attributeId: definition.id, ...payload })
      .onConflictDoUpdate({
        target: [productAttributes.productId, productAttributes.attributeId],
        set: payload,
      });
    const updated = await bumpProduct(ctx, product.id, product.version);
    ctx.setSubject("product", updated.id);
    return updated;
  },
});

export const filterProductsByAttribute = defineService({
  name: "catalog.filterProductsByAttribute",
  summary: "List products matching one filterable attribute.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    key: attributeKey,
    equals: z.string().trim().min(1).max(500).optional(),
    min: z.string().trim().regex(/^-?[0-9]+(?:\.[0-9]+)?$/).optional(),
    max: z.string().trim().regex(/^-?[0-9]+(?:\.[0-9]+)?$/).optional(),
    bool: z.boolean().optional(),
  }),
  output: listed(productRow),
  handler: async (input, ctx) => {
    const [definition] = await ctx.tx
      .select()
      .from(attributeDefinitions)
      .where(eq(attributeDefinitions.key, input.key));
    if (!definition) throw new ServiceError("not_found", "That attribute is not here.");
    if (!definition.isFilterable) {
      throw new ServiceError("validation", "That attribute is not marked filterable.");
    }
    const rows = await ctx.tx
      .select({
        product: products,
        textValue: productAttributes.textValue,
        numberValue: productAttributes.numberValue,
        boolValue: productAttributes.boolValue,
      })
      .from(productAttributes)
      .innerJoin(products, eq(products.id, productAttributes.productId))
      .where(eq(productAttributes.attributeId, definition.id));
    return rows
      .filter((row) => {
        if (definition.kind === "bool") return input.bool === undefined || row.boolValue === input.bool;
        if (definition.kind === "number" || definition.kind === "measure") {
          const value = Number(row.numberValue);
          if (input.min !== undefined && value < Number(input.min)) return false;
          if (input.max !== undefined && value > Number(input.max)) return false;
          return input.equals === undefined || row.numberValue === input.equals;
        }
        return input.equals === undefined || row.textValue === input.equals;
      })
      .map((row) => row.product);
  },
});

export const compareProducts = defineService({
  name: "catalog.compareProducts",
  summary: "Build a comparison table from comparable attributes on the selected products.",
  kind: "query",
  permission: "scoped",
  input: z.object({ productIds: z.array(productId).min(2).max(8) }),
  output: z.object({
    products: listed(productRow),
    rows: listed(
      z.object({
        key: z.string(),
        label: z.string(),
        kind: z.enum(ATTRIBUTE_KINDS),
        unit: z.string().nullable(),
        groupName: z.string().nullable(),
        values: z.record(z.string(), z.union([z.boolean(), z.string(), z.null()])),
      }),
    ),
  }),
  handler: async (input, ctx) => {
    const uniqueIds = [...new Set(input.productIds)];
    const selected = await ctx.tx.select().from(products).where(inArray(products.id, uniqueIds));
    if (selected.length !== uniqueIds.length) throw new ServiceError("not_found", "One of those products is not here.");
    const facts = await ctx.tx
      .select({
        productId: productAttributes.productId,
        key: attributeDefinitions.key,
        label: attributeDefinitions.label,
        kind: attributeDefinitions.kind,
        unit: attributeDefinitions.unit,
        groupName: attributeDefinitions.groupName,
        textValue: productAttributes.textValue,
        numberValue: productAttributes.numberValue,
        boolValue: productAttributes.boolValue,
      })
      .from(productAttributes)
      .innerJoin(attributeDefinitions, eq(attributeDefinitions.id, productAttributes.attributeId))
      .where(and(inArray(productAttributes.productId, uniqueIds), eq(attributeDefinitions.isComparable, true)))
      .orderBy(asc(attributeDefinitions.groupName), asc(attributeDefinitions.label));
    const keys = [...new Map(facts.map((fact) => [fact.key, fact])).values()];
    return {
      products: selected,
      rows: keys.map((attribute) => ({
        key: attribute.key,
        label: attribute.label,
        kind: attribute.kind,
        unit: attribute.unit,
        groupName: attribute.groupName,
        values: Object.fromEntries(
          uniqueIds.map((id) => {
            const fact = facts.find((row) => row.productId === id && row.key === attribute.key);
            return [
              id,
              fact?.kind === "bool"
                ? fact.boolValue
                : fact?.numberValue ?? fact?.textValue ?? null,
            ];
          }),
        ),
      })),
    };
  },
});

function roleAllows(role: (typeof MEDIA_ROLES)[number], kind: string, mime: string): boolean {
  if (role === "model") return THREE_D_MIME.has(mime);
  if (role === "size_chart") return kind === "image" || kind === "doc";
  if (role === "360") return kind === "image" || kind === "video";
  return kind === "image" || kind === "video";
}

export const listProductMedia = defineService({
  name: "catalog.listProductMedia",
  summary: "List ordered product media, optionally swapped to a variant's role-specific assets.",
  kind: "query",
  permission: "scoped",
  input: z.object({ productId, variantId: productId.optional() }),
  output: listed(mediaAttachment),
  handler: async (input, ctx) => {
    const [product] = await ctx.tx.select({ id: products.id }).from(products).where(eq(products.id, input.productId));
    if (!product) throw new ServiceError("not_found", "That product is not here.");
    const rows = await ctx.tx
      .select({ media: productMedia, asset: assets })
      .from(productMedia)
      .innerJoin(assets, eq(assets.id, productMedia.assetId))
      .where(eq(productMedia.productId, input.productId))
      .orderBy(asc(productMedia.role), asc(productMedia.position), asc(productMedia.createdAt));
    if (!input.variantId) return rows;
    const [variant] = await ctx.tx
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(and(eq(productVariants.id, input.variantId), eq(productVariants.productId, input.productId)));
    if (!variant) throw new ServiceError("not_found", "That variant is not on this product.");
    const chosen: typeof rows = [];
    for (const role of MEDIA_ROLES) {
      const forRole = rows.filter((row) => row.media.role === role);
      const swapped = forRole.filter((row) => row.media.variantId === input.variantId);
      chosen.push(...(swapped.length ? swapped : forRole.filter((row) => row.media.variantId === null)));
    }
    return chosen;
  },
});

export const attachProductMedia = defineService({
  name: "catalog.attachProductMedia",
  summary: "Attach a ready library asset to a product or one of its variants.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    productId,
    expectedVersion,
    assetId: productId,
    role: z.enum(MEDIA_ROLES).default("gallery"),
    variantId: productId.optional(),
    position: z.number().int().min(0).max(100_000).optional(),
  }),
  output: productRow,
  handler: async (input, ctx) => {
    const product = await productForUpdate(ctx, input.productId, input.expectedVersion);
    const [asset] = await ctx.tx.select().from(assets).where(eq(assets.id, input.assetId));
    if (!asset || asset.status !== "ready") {
      throw new ServiceError("not_found", "Attach a ready media library asset.");
    }
    if (!roleAllows(input.role, asset.kind, asset.mime)) {
      throw new ServiceError("validation", "That asset kind cannot fill this media role.");
    }
    if (input.variantId) {
      const [variant] = await ctx.tx
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(and(eq(productVariants.id, input.variantId), eq(productVariants.productId, product.id)));
      if (!variant) throw new ServiceError("not_found", "That variant is not on this product.");
    }
    const siblings = await ctx.tx
      .select({ position: productMedia.position })
      .from(productMedia)
      .where(eq(productMedia.productId, product.id));
    await ctx.tx.insert(productMedia).values({
      productId: product.id,
      assetId: asset.id,
      role: input.role,
      variantId: input.variantId,
      position: input.position ?? siblings.length,
    });
    const updated = await bumpProduct(ctx, product.id, product.version);
    ctx.setSubject("product", updated.id);
    ctx.queueEvent("catalog.productMediaAttached", {
      productId: updated.id,
      assetId: asset.id,
      role: input.role,
    });
    return updated;
  },
});

export const detachProductMedia = defineService({
  name: "catalog.detachProductMedia",
  summary: "Remove one media attachment without deleting the underlying asset.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ productId, expectedVersion, mediaId: productId }),
  output: productRow,
  handler: async (input, ctx) => {
    const product = await productForUpdate(ctx, input.productId, input.expectedVersion);
    const deleted = await ctx.tx
      .delete(productMedia)
      .where(and(eq(productMedia.id, input.mediaId), eq(productMedia.productId, product.id)))
      .returning({ id: productMedia.id });
    if (!deleted[0]) throw new ServiceError("not_found", "That media attachment is not here.");
    const updated = await bumpProduct(ctx, product.id, product.version);
    ctx.setSubject("product", updated.id);
    return updated;
  },
});

export default [
  listAttributeDefinitions,
  createAttributeDefinition,
  listProductAttributes,
  setProductAttribute,
  filterProductsByAttribute,
  compareProducts,
  listProductMedia,
  attachProductMedia,
  detachProductMedia,
];
