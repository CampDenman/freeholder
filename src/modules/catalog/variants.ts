// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Option dimensions and generated variant matrices (C5.10).

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { isUniqueViolation } from "@/core/db";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { BACKORDER_POLICIES, PRODUCT_KINDS, PRODUCT_STATUSES, PRODUCT_VISIBILITIES } from "./contract";
import {
  optionTypes,
  optionValues,
  productOptionAssignments,
  productOptionValueAssignments,
  productVariantOptions,
  productVariants,
  products,
} from "./schema";

const productId = z.string().uuid();
const expectedVersion = z.number().int().positive().max(2_147_483_647);
const optionCode = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(40);
const skuFragment = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(24);

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
const optionTypeRow = row({
  id: uuid,
  name: z.string(),
  code: z.string(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const optionValueRow = row({
  id: uuid,
  optionTypeId: uuid,
  name: z.string(),
  skuFragment: z.string(),
  position: z.number().int(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const variantRow = row({
  id: uuid,
  productId: uuid,
  combinationKey: z.string(),
  sku: z.string(),
  isDefault: z.boolean(),
  status: z.enum(["active", "archived"]),
  backorderPolicy: z.enum(BACKORDER_POLICIES),
  expectedRestockAt: timestamp.nullable(),
  requiresShipping: z.boolean(),
  weightG: z.number().int().nullable(),
  lengthMm: z.number().int().nullable(),
  widthMm: z.number().int().nullable(),
  heightMm: z.number().int().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const variantOptionRow = row({
  variantId: uuid,
  optionTypeId: uuid,
  optionValueId: uuid,
});
const assignmentRow = row({
  id: uuid,
  productId: uuid,
  optionTypeId: uuid,
  position: z.number().int(),
  createdAt: timestamp,
  optionType: optionTypeRow.nullable(),
  selectedValueIds: listed(uuid),
  values: listed(optionValueRow),
});
const matrixCombo = z.object({
  valueIds: listed(uuid),
  fragments: listed(z.string()),
  labels: listed(z.string()),
});

function combinationKey(valueIds: readonly string[]): string {
  return [...valueIds].sort().join(":");
}

function cartesian<T>(groups: readonly (readonly T[])[]): T[][] {
  return groups.reduce<T[][]>(
    (acc, group) => acc.flatMap((prefix) => group.map((item) => [...prefix, item])),
    [[]],
  );
}

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
    throw new ServiceError("conflict", "Restore this product to draft before editing options.");
  }
  return product;
}

async function bumpProduct(ctx: ServiceContext, id: string, version: number) {
  const [updated] = await ctx.tx
    .update(products)
    .set({ version: version + 1, updatedAt: sql`now()` })
    .where(and(eq(products.id, id), eq(products.version, version)))
    .returning();
  if (!updated) throw new ServiceError("conflict", "This product changed while its options were being updated.");
  return updated;
}

export const listOptionTypes = defineService({
  name: "catalog.listOptionTypes",
  summary: "List reusable option dimensions and their values.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(optionTypeRow.extend({ values: listed(optionValueRow) })),
  handler: async (_input, ctx) => {
    const types = await ctx.tx.select().from(optionTypes).orderBy(asc(optionTypes.name));
    const values = types.length
      ? await ctx.tx
          .select()
          .from(optionValues)
          .where(inArray(optionValues.optionTypeId, types.map((type) => type.id)))
          .orderBy(asc(optionValues.position), asc(optionValues.name))
      : [];
    return types.map((type) => ({
      ...type,
      values: values.filter((value) => value.optionTypeId === type.id),
    }));
  },
});

export const createOptionType = defineService({
  name: "catalog.createOptionType",
  summary: "Create a reusable option dimension such as size or colour.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    name: z.string().trim().min(1).max(80),
    code: optionCode,
  }),
  output: optionTypeRow,
  handler: async (input, ctx) => {
    const [created] = await ctx.tx
      .insert(optionTypes)
      .values(input)
      .returning()
      .catch((error: unknown) => {
        if (isUniqueViolation(error, "option_types_code_idx")) {
          throw new ServiceError("conflict", "Another option type already uses that code.");
        }
        throw error;
      });
    ctx.setSubject("optionType", created!.id);
    ctx.queueEvent("catalog.optionTypeCreated", { optionTypeId: created!.id, code: created!.code });
    return created!;
  },
});

export const addOptionValue = defineService({
  name: "catalog.addOptionValue",
  summary: "Add a named value and SKU fragment to a reusable option type.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    optionTypeId: productId,
    name: z.string().trim().min(1).max(80),
    skuFragment,
    position: z.number().int().min(0).max(100_000).optional(),
  }),
  output: optionValueRow,
  handler: async (input, ctx) => {
    const [type] = await ctx.tx.select({ id: optionTypes.id }).from(optionTypes).where(eq(optionTypes.id, input.optionTypeId));
    if (!type) throw new ServiceError("not_found", "That option type is not here.");
    const [created] = await ctx.tx
      .insert(optionValues)
      .values({
        optionTypeId: input.optionTypeId,
        name: input.name,
        skuFragment: input.skuFragment,
        position: input.position ?? 0,
      })
      .returning()
      .catch((error: unknown) => {
        if (isUniqueViolation(error, "option_values_type_fragment_idx")) {
          throw new ServiceError("conflict", "That SKU fragment is already used on this option type.");
        }
        throw error;
      });
    ctx.setSubject("optionValue", created!.id);
    return created!;
  },
});

async function loadAssignments(ctx: ServiceContext, productIdValue: string) {
  const assignments = await ctx.tx
    .select()
    .from(productOptionAssignments)
    .where(eq(productOptionAssignments.productId, productIdValue))
    .orderBy(asc(productOptionAssignments.position), asc(productOptionAssignments.createdAt));
  const selected = assignments.length
    ? await ctx.tx
        .select()
        .from(productOptionValueAssignments)
        .where(inArray(productOptionValueAssignments.assignmentId, assignments.map((row) => row.id)))
    : [];
  const types = assignments.length
    ? await ctx.tx.select().from(optionTypes).where(inArray(optionTypes.id, assignments.map((row) => row.optionTypeId)))
    : [];
  const typeById = new Map(types.map((type) => [type.id, type]));
  const values = assignments.length
    ? await ctx.tx
        .select()
        .from(optionValues)
        .where(inArray(optionValues.optionTypeId, assignments.map((row) => row.optionTypeId)))
        .orderBy(asc(optionValues.position), asc(optionValues.name))
    : [];
  return assignments.map((assignment) => ({
    ...assignment,
    optionType: typeById.get(assignment.optionTypeId) ?? null,
    selectedValueIds: selected
      .filter((row) => row.assignmentId === assignment.id)
      .map((row) => row.optionValueId),
    values: values.filter((value) => value.optionTypeId === assignment.optionTypeId),
  }));
}

function desiredCombinations(
  assignments: Awaited<ReturnType<typeof loadAssignments>>,
): Array<{ valueIds: string[]; fragments: string[]; labels: string[] }> {
  if (assignments.length === 0) return [];
  const groups = assignments.map((assignment) =>
    assignment.values.filter((value) => assignment.selectedValueIds.includes(value.id)),
  );
  if (groups.some((group) => group.length === 0)) return [];
  return cartesian(groups).map((combo) => ({
    valueIds: combo.map((value) => value.id),
    fragments: combo.map((value) => value.skuFragment),
    labels: combo.map((value) => value.name),
  }));
}

export const getProductVariants = defineService({
  name: "catalog.getProductVariants",
  summary: "Read assigned dimensions, selected values, variants and a reconciliation preview.",
  kind: "query",
  permission: "scoped",
  input: z.object({ productId }),
  output: z.object({
    product: productRow,
    assignments: listed(assignmentRow),
    variants: listed(variantRow.extend({ options: listed(variantOptionRow) })),
    preview: z.object({
      add: listed(matrixCombo),
      retain: listed(variantRow),
      archive: listed(variantRow),
      reactivate: listed(variantRow),
    }),
  }),
  handler: async (input, ctx) => {
    const [product] = await ctx.tx.select().from(products).where(eq(products.id, input.productId)).limit(1);
    if (!product) throw new ServiceError("not_found", "That product is not here.");
    const assignments = await loadAssignments(ctx, product.id);
    const variants = await ctx.tx
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, product.id))
      .orderBy(asc(productVariants.sku));
    const options = variants.length
      ? await ctx.tx
          .select()
          .from(productVariantOptions)
          .where(inArray(productVariantOptions.variantId, variants.map((row) => row.id)))
      : [];
    const desired = desiredCombinations(assignments);
    const desiredKeys = new Set(desired.map((row) => combinationKey(row.valueIds)));
    const existingByKey = new Map(variants.map((variant) => [variant.combinationKey, variant]));
    return {
      product,
      assignments,
      variants: variants.map((variant) => ({
        ...variant,
        options: options.filter((option) => option.variantId === variant.id),
      })),
      preview: {
        add: desired.filter((row) => !existingByKey.has(combinationKey(row.valueIds))),
        retain: desired
          .map((row) => existingByKey.get(combinationKey(row.valueIds)))
          .filter((row): row is NonNullable<typeof row> => Boolean(row)),
        archive: variants.filter(
          (variant) => variant.status === "active" && !desiredKeys.has(variant.combinationKey),
        ),
        reactivate: variants.filter(
          (variant) => variant.status === "archived" && desiredKeys.has(variant.combinationKey),
        ),
      },
    };
  },
});

export const assignProductOption = defineService({
  name: "catalog.assignProductOption",
  summary: "Attach a reusable option type to a product without generating variants yet.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ productId, expectedVersion, optionTypeId: productId }),
  output: productRow,
  handler: async (input, ctx) => {
    const product = await productForUpdate(ctx, input.productId, input.expectedVersion);
    const [type] = await ctx.tx.select().from(optionTypes).where(eq(optionTypes.id, input.optionTypeId));
    if (!type) throw new ServiceError("not_found", "That option type is not here.");
    const existing = await ctx.tx
      .select({ id: productOptionAssignments.id })
      .from(productOptionAssignments)
      .where(
        and(
          eq(productOptionAssignments.productId, product.id),
          eq(productOptionAssignments.optionTypeId, type.id),
        ),
      );
    if (existing[0]) {
      return bumpProduct(ctx, product.id, product.version);
    }
    const count = (
      await ctx.tx
        .select({ id: productOptionAssignments.id })
        .from(productOptionAssignments)
        .where(eq(productOptionAssignments.productId, product.id))
    ).length;
    await ctx.tx.insert(productOptionAssignments).values({
      productId: product.id,
      optionTypeId: type.id,
      position: count,
    });
    const updated = await bumpProduct(ctx, product.id, product.version);
    ctx.setSubject("product", updated.id);
    ctx.queueEvent("catalog.productOptionAssigned", { productId: updated.id, optionTypeId: type.id });
    return updated;
  },
});

export const setProductOptionValues = defineService({
  name: "catalog.setProductOptionValues",
  summary: "Choose which values of an assigned dimension participate in the matrix.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    productId,
    expectedVersion,
    optionTypeId: productId,
    optionValueIds: z.array(productId).max(200),
  }),
  output: productRow,
  handler: async (input, ctx) => {
    const product = await productForUpdate(ctx, input.productId, input.expectedVersion);
    const [assignment] = await ctx.tx
      .select()
      .from(productOptionAssignments)
      .where(
        and(
          eq(productOptionAssignments.productId, product.id),
          eq(productOptionAssignments.optionTypeId, input.optionTypeId),
        ),
      );
    if (!assignment) throw new ServiceError("not_found", "Assign that option type to this product first.");
    const uniqueIds = [...new Set(input.optionValueIds)];
    if (uniqueIds.length) {
      const values = await ctx.tx
        .select()
        .from(optionValues)
        .where(inArray(optionValues.id, uniqueIds));
      if (values.length !== uniqueIds.length || values.some((value) => value.optionTypeId !== input.optionTypeId)) {
        throw new ServiceError("validation", "Every selected value must belong to that option type.");
      }
    }
    await ctx.tx
      .delete(productOptionValueAssignments)
      .where(eq(productOptionValueAssignments.assignmentId, assignment.id));
    if (uniqueIds.length) {
      await ctx.tx.insert(productOptionValueAssignments).values(
        uniqueIds.map((optionValueId) => ({ assignmentId: assignment.id, optionValueId })),
      );
    }
    const updated = await bumpProduct(ctx, product.id, product.version);
    ctx.setSubject("product", updated.id);
    return updated;
  },
});

export const applyVariantMatrix = defineService({
  name: "catalog.applyVariantMatrix",
  summary: "Create, retain, reactivate and archive variants from the current option matrix without deleting identities.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ productId, expectedVersion }),
  output: productRow,
  handler: async (input, ctx) => {
    const product = await productForUpdate(ctx, input.productId, input.expectedVersion);
    const assignments = await loadAssignments(ctx, product.id);
    const desired = desiredCombinations(assignments);
    if (assignments.length > 0 && desired.length === 0) {
      throw new ServiceError(
        "validation",
        "Choose at least one value for every assigned option before generating variants.",
      );
    }
    const combos =
      assignments.length === 0
        ? [{ valueIds: [] as string[], fragments: [] as string[], key: "default", sku: product.slug }]
        : desired.map((row) => ({
            ...row,
            key: combinationKey(row.valueIds),
            sku: `${product.slug}-${row.fragments.join("-")}`,
          }));
    const existing = await ctx.tx
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, product.id));
    const byKey = new Map(existing.map((variant) => [variant.combinationKey, variant]));
    const desiredKeys = new Set(combos.map((row) => row.key));

    for (const combo of combos) {
      const found = byKey.get(combo.key);
      if (!found) {
        const [created] = await ctx.tx
          .insert(productVariants)
          .values({
            productId: product.id,
            combinationKey: combo.key,
            sku: combo.sku,
            status: "active",
            isDefault: false,
          })
          .returning()
          .catch((error: unknown) => {
            if (isUniqueViolation(error, "product_variants_sku_idx")) {
              throw new ServiceError("conflict", `Another variant already uses SKU ${combo.sku}.`);
            }
            throw error;
          });
        if (combo.valueIds.length) {
          await ctx.tx.insert(productVariantOptions).values(
            assignments.map((assignment, index) => ({
              variantId: created!.id,
              optionTypeId: assignment.optionTypeId,
              optionValueId: combo.valueIds[index]!,
            })),
          );
        }
      } else if (found.status === "archived") {
        await ctx.tx
          .update(productVariants)
          .set({ status: "active", sku: combo.sku, isDefault: false, updatedAt: sql`now()` })
          .where(eq(productVariants.id, found.id));
      } else if (found.sku !== combo.sku) {
        await ctx.tx
          .update(productVariants)
          .set({ sku: combo.sku, updatedAt: sql`now()` })
          .where(eq(productVariants.id, found.id))
          .catch((error: unknown) => {
            if (isUniqueViolation(error, "product_variants_sku_idx")) {
              throw new ServiceError("conflict", `Another variant already uses SKU ${combo.sku}.`);
            }
            throw error;
          });
      }
    }

    const toArchive = existing.filter(
      (variant) => variant.status === "active" && !desiredKeys.has(variant.combinationKey),
    );
    if (toArchive.length) {
      await ctx.tx
        .update(productVariants)
        .set({ status: "archived", isDefault: false, updatedAt: sql`now()` })
        .where(inArray(productVariants.id, toArchive.map((variant) => variant.id)));
    }

    const active = await ctx.tx
      .select()
      .from(productVariants)
      .where(and(eq(productVariants.productId, product.id), eq(productVariants.status, "active")))
      .orderBy(asc(productVariants.sku));
    if (active.length && !active.some((variant) => variant.isDefault)) {
      await ctx.tx
        .update(productVariants)
        .set({ isDefault: true, updatedAt: sql`now()` })
        .where(eq(productVariants.id, active[0]!.id));
    }

    const updated = await bumpProduct(ctx, product.id, product.version);
    ctx.setSubject("product", updated.id);
    ctx.queueEvent("catalog.variantMatrixApplied", {
      productId: updated.id,
      created: combos.filter((row) => !byKey.has(row.key)).length,
      archived: toArchive.length,
    });
    return updated;
  },
});

export const setDefaultVariant = defineService({
  name: "catalog.setDefaultVariant",
  summary: "Mark exactly one active variant as the product default.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ productId, expectedVersion, variantId: productId }),
  output: productRow,
  handler: async (input, ctx) => {
    const product = await productForUpdate(ctx, input.productId, input.expectedVersion);
    const [variant] = await ctx.tx
      .select()
      .from(productVariants)
      .where(and(eq(productVariants.id, input.variantId), eq(productVariants.productId, product.id)));
    if (!variant) throw new ServiceError("not_found", "That variant is not here.");
    if (variant.status !== "active") {
      throw new ServiceError("conflict", "Only an active variant can be the default.");
    }
    await ctx.tx
      .update(productVariants)
      .set({ isDefault: false, updatedAt: sql`now()` })
      .where(and(eq(productVariants.productId, product.id), eq(productVariants.isDefault, true)));
    await ctx.tx
      .update(productVariants)
      .set({ isDefault: true, updatedAt: sql`now()` })
      .where(eq(productVariants.id, variant.id));
    const updated = await bumpProduct(ctx, product.id, product.version);
    ctx.setSubject("product", updated.id);
    return updated;
  },
});

export default [
  listOptionTypes,
  createOptionType,
  addOptionValue,
  getProductVariants,
  assignProductOption,
  setProductOptionValues,
  applyVariantMatrix,
  setDefaultVariant,
];
