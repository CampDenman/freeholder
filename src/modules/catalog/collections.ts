// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Product taxonomy: collections group products for public browse at /c/<slug>
// (C3.25 slice 1, gap G1 of deploy/c324-storefront-parity-2026-09-29.md).
//
// Membership has two honest modes. `manual` collections are curated: the owner
// pins products one at a time and orders them by hand. `segment` collections
// are derived: the collection names one saved segment (§4.14's one definition
// of "who") and the recompute job fills the collection with the products those
// contacts actually bought, so the collection follows its audience. A segment
// collection refuses manual edits rather than letting a hand-applied row
// silently fight the next recompute.
//
// The derivation reuses the core segments engine — `segments.members` answers
// who is in the saved segment, and the SQL below turns that into what they
// bought. There is deliberately no second rule language for products: the
// moment a collection grows its own query syntax, "customers in Ontario who
// bought twice" means one thing in a price list and another on the storefront.
//
// Removal is trash, never deletion (C11.14). A trashed collection keeps its
// slug and its history; purging frees the slug and removes the membership
// rows, and the products themselves are untouched — the taxonomy points at
// products, it does not own them.

import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { isUniqueViolation } from "@/core/db";
import { recordRedirect } from "@/core/seo/service";
import { segmentIsLive, segmentMembership } from "@/core/segments/service";
import { makeTrashServices } from "@/core/trash";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { clipSnippet, matchesIlike, registerSearchSource } from "@/core/search/registry";
import { assets } from "@/core/media/schema";
import { COLLECTION_RULE_TYPES, COLLECTION_SORT_ORDERS } from "./contract";
import {
  collectionProducts,
  collections,
  orderItems,
  orders,
  productVariants,
  products,
} from "./schema";

const id = z.string().uuid();
const expectedVersion = z.number().int().positive().max(2_147_483_647);
const title = z.string().trim().min(1).max(240);
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

const ruleConfig = z
  .object({ segmentId: id.optional() })
  .default({});

const collectionRow = row({
  id: uuid,
  title: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  seo: z.unknown(),
  ruleType: z.enum(COLLECTION_RULE_TYPES),
  ruleConfig: z.unknown(),
  sortOrder: z.enum(COLLECTION_SORT_ORDERS),
  published: z.boolean(),
  imageId: uuid.nullable(),
  trashedAt: timestamp.nullable(),
  version: z.number().int(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

/** What the admin sees when curating membership: position included. */
const membershipRow = row({
  productId: uuid,
  name: z.string(),
  slug: z.string(),
  kind: z.string(),
  status: z.string(),
  subtitle: z.string().nullable(),
  position: z.number().int(),
});

/** What the storefront renders: no lifecycle internals. */
const publicMembershipRow = row({
  productId: uuid,
  name: z.string(),
  slug: z.string(),
  subtitle: z.string().nullable(),
  brand: z.string().nullable(),
});

const publicCollectionRow = row({
  id: uuid,
  title: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  seo: z.unknown(),
  sortOrder: z.enum(COLLECTION_SORT_ORDERS),
  updatedAt: timestamp,
});

function duplicateSlug(value: string): ServiceError {
  return new ServiceError(
    "conflict",
    `Another collection already uses /c/${value}. Choose a different address.`,
  );
}

async function rowForUpdate(ctx: ServiceContext, idValue: string) {
  const [collection] = await ctx.tx
    .select()
    .from(collections)
    .where(and(eq(collections.id, idValue), isNull(collections.trashedAt)))
    .for("update");
  if (!collection) throw new ServiceError("not_found", "That collection is not here.");
  return collection;
}

function assertVersion(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new ServiceError(
      "conflict",
      "This collection changed after you opened it. Refresh before applying another edit.",
    );
  }
}

/**
 * Live segment, or a refusal. Trashed segments do not count (C7.04): a
 * collection wired to an audience that no longer answers must fail at save
 * time, not widen the storefront the moment a job re-derives membership.
 */
async function requireSegment(ctx: ServiceContext, segmentId: string): Promise<void> {
  if (!(await segmentIsLive(ctx.tx, segmentId))) {
    throw new ServiceError("not_found", "That segment is not here.");
  }
}

/** The image asset, or a refusal — the column's FK would otherwise surface as a raw constraint name. */
async function requireImage(ctx: ServiceContext, imageId: string): Promise<void> {
  const [asset] = await ctx.tx
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.id, imageId))
    .limit(1);
  if (!asset) throw new ServiceError("not_found", "That image is not here.");
}

/** Display order for a read: stored positions, or derived at read time. */
function orderFor(sortOrder: (typeof COLLECTION_SORT_ORDERS)[number]) {
  switch (sortOrder) {
    case "title":
      return [asc(products.name)];
    case "newest":
      return [desc(products.updatedAt), asc(products.name)];
    default:
      return [asc(collectionProducts.position), asc(products.name)];
  }
}

export const createCollection = defineService({
  name: "catalog.createCollection",
  summary: "Create one collection, manual or segment-driven, unpublished by default.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    title,
    slug,
    description: optionalText(1_000).optional(),
    seo,
    ruleType: z.enum(COLLECTION_RULE_TYPES).default("manual"),
    ruleConfig: ruleConfig.optional(),
    sortOrder: z.enum(COLLECTION_SORT_ORDERS).default("manual"),
    imageId: id.nullable().optional(),
    published: z.boolean().default(false),
  }),
  output: collectionRow,
  handler: async (input, ctx) => {
    const config = input.ruleConfig ?? {};
    if (input.ruleType === "segment") {
      if (!config.segmentId) {
        throw new ServiceError("validation", "Choose the segment this collection follows.");
      }
      await requireSegment(ctx, config.segmentId);
    } else if (config.segmentId) {
      throw new ServiceError(
        "validation",
        "A manual collection does not follow a segment. Clear the segment or change the rule.",
      );
    }
    if (input.imageId) await requireImage(ctx, input.imageId);
    const [created] = await ctx.tx
      .insert(collections)
      .values({
        title: input.title,
        slug: input.slug,
        description: input.description ?? null,
        seo: input.seo,
        ruleType: input.ruleType,
        ruleConfig: input.ruleType === "segment" ? { segmentId: config.segmentId } : {},
        sortOrder: input.sortOrder,
        imageId: input.imageId ?? null,
        published: input.published,
      })
      .returning()
      .catch((error: unknown) => {
        if (isUniqueViolation(error, "collections_slug_idx")) throw duplicateSlug(input.slug);
        throw error;
      });
    ctx.setSubject("collection", created!.id);
    ctx.queueEvent("catalog.collectionCreated", { collectionId: created!.id });
    if (created!.published) {
      ctx.queueEvent("catalog.collectionPublished", { collectionId: created!.id });
    }
    return created!;
  },
});

const updateCollectionInput = z
  .object({
    id,
    expectedVersion,
    title: title.optional(),
    slug: slug.optional(),
    description: optionalText(1_000).optional(),
    seo: seo.optional(),
    ruleType: z.enum(COLLECTION_RULE_TYPES).optional(),
    ruleConfig: ruleConfig.optional(),
    sortOrder: z.enum(COLLECTION_SORT_ORDERS).optional(),
    imageId: id.nullable().optional(),
    published: z.boolean().optional(),
  })
  .refine(
    (value) =>
      [
        "title",
        "slug",
        "description",
        "seo",
        "ruleType",
        "ruleConfig",
        "sortOrder",
        "imageId",
        "published",
      ].some((key) => key in value),
    "Provide at least one collection field to update.",
  );

export const updateCollection = defineService({
  name: "catalog.updateCollection",
  summary: "Update collection identity, rules, ordering or publication with stale-write refusal.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: updateCollectionInput,
  output: collectionRow,
  handler: async (input, ctx) => {
    const existing = await rowForUpdate(ctx, input.id);
    assertVersion(existing.version, input.expectedVersion);

    const nextRuleType = input.ruleType ?? existing.ruleType;
    const nextConfig = input.ruleConfig ?? (existing.ruleConfig);
    if (nextRuleType === "segment") {
      if (!nextConfig.segmentId) {
        throw new ServiceError("validation", "Choose the segment this collection follows.");
      }
      await requireSegment(ctx, nextConfig.segmentId);
    } else if (nextConfig.segmentId) {
      throw new ServiceError(
        "validation",
        "A manual collection does not follow a segment. Clear the segment or change the rule.",
      );
    }
    if (input.imageId) await requireImage(ctx, input.imageId);

    const [updated] = await ctx.tx
      .update(collections)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.seo !== undefined ? { seo: input.seo } : {}),
        ruleType: nextRuleType,
        ruleConfig: nextRuleType === "segment" ? { segmentId: nextConfig.segmentId } : {},
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.imageId !== undefined ? { imageId: input.imageId } : {}),
        ...(input.published !== undefined ? { published: input.published } : {}),
        version: existing.version + 1,
      })
      .where(and(eq(collections.id, existing.id), eq(collections.version, existing.version)))
      .returning()
      .catch((error: unknown) => {
        if (isUniqueViolation(error, "collections_slug_idx")) {
          throw duplicateSlug(input.slug ?? existing.slug);
        }
        throw error;
      });
    if (!updated) {
      throw new ServiceError("conflict", "This collection changed while it was being saved.");
    }

    // §5: slugs never silently break. A live collection that moves addresses
    // leaves a permanent redirect behind, the same promise products make.
    if (existing.slug !== updated.slug && existing.published) {
      await ctx.callAsSystem(recordRedirect, {
        fromPath: `c/${existing.slug}`,
        toPath: `c/${updated.slug}`,
        status: "301",
        source: `catalog-collection:${updated.id}`,
      });
    }
    ctx.setSubject("collection", updated.id);
    ctx.queueEvent("catalog.collectionUpdated", {
      collectionId: updated.id,
      version: updated.version,
    });
    if (input.published !== undefined && input.published !== existing.published) {
      ctx.queueEvent(
        updated.published ? "catalog.collectionPublished" : "catalog.collectionUnpublished",
        { collectionId: updated.id },
      );
    }
    return updated;
  },
});

/**
 * Reversible removal (C11.14). Purging a collection deletes its membership
 * rows with it and frees the slug; the products that were grouped are never
 * touched, because the taxonomy points at products rather than owning them.
 * There is no hold guard: a collection holds no contact data a retention
 * exception could name.
 */
const trash = makeTrashServices({
  family: "collections",
  table: collections,
  rowSchema: collectionRow,
  subjectKind: "collection",
  gone: "That collection is not here.",
  purgeChildren: async (tx, ids) => {
    await tx.delete(collectionProducts).where(inArray(collectionProducts.collectionId, ids));
  },
});
export const {
  remove: removeCollection,
  restore: restoreCollection,
  purge: purgeCollection,
  purgeExpired: purgeExpiredCollections,
} = trash;

/**
 * Membership of one collection as stored rows joined to product identity.
 * `onlyPublic` filters to what a storefront may render; counting goes through
 * the same join so a total and a page can never disagree.
 */
async function readMembership(
  ctx: ServiceContext,
  collection: { id: string; sortOrder: (typeof COLLECTION_SORT_ORDERS)[number] },
  options: { onlyPublic: boolean; limit: number; offset: number },
) {
  const conditions = [
    eq(collectionProducts.collectionId, collection.id),
    options.onlyPublic
      ? and(eq(products.status, "active"), eq(products.visibility, "public"))
      : undefined,
  ].filter((value): value is NonNullable<typeof value> => Boolean(value));
  const where = and(...conditions);
  const total = async () => {
    const [counted] = await ctx.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(collectionProducts)
      .innerJoin(products, eq(products.id, collectionProducts.productId))
      .where(where);
    return counted?.n ?? 0;
  };
  const rows = await ctx.tx
    .select({
      productId: products.id,
      name: products.name,
      slug: products.slug,
      kind: products.kind,
      status: products.status,
      subtitle: products.subtitle,
      brand: products.brand,
      position: collectionProducts.position,
    })
    .from(collectionProducts)
    .innerJoin(products, eq(products.id, collectionProducts.productId))
    .where(where)
    .orderBy(...orderFor(collection.sortOrder))
    .limit(options.limit)
    .offset(options.offset);
  return { rows, total: await total() };
}

export const listCollections = defineService({
  name: "catalog.listCollections",
  summary: "Every collection for owner operations, filterable by a product's membership.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    /** Narrow to the collections one product belongs to. */
    productId: id.optional(),
    /** The recovery view: trashed collections only (C11.14). */
    trashedOnly: z.boolean().default(false),
  }),
  output: listed(collectionRow),
  handler: async (input, ctx) => {
    if (input.productId) {
      return ctx.tx
        .select({ collection: collections })
        .from(collectionProducts)
        .innerJoin(collections, eq(collections.id, collectionProducts.collectionId))
        .where(
          and(
            eq(collectionProducts.productId, input.productId),
            input.trashedOnly ? isNotNull(collections.trashedAt) : isNull(collections.trashedAt),
          ),
        )
        .orderBy(asc(collections.title))
        .then((rows) => rows.map((row) => row.collection));
    }
    return ctx.tx
      .select()
      .from(collections)
      .where(
        input.trashedOnly ? isNotNull(collections.trashedAt) : isNull(collections.trashedAt),
      )
      .orderBy(asc(collections.title));
  },
});

export const getCollection = defineService({
  name: "catalog.getCollection",
  summary: "Read one collection and a page of its membership, in the collection's order.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    id,
    limit: z.number().int().min(1).max(500).default(200),
    offset: z.number().int().min(0).max(100_000).default(0),
  }),
  output: row({
    collection: collectionRow,
    products: listed(membershipRow),
    total: z.number().int(),
  }),
  handler: async (input, ctx) => {
    const [collection] = await ctx.tx
      .select()
      .from(collections)
      .where(and(eq(collections.id, input.id), isNull(collections.trashedAt)))
      .limit(1);
    if (!collection) throw new ServiceError("not_found", "That collection is not here.");
    const { rows, total } = await readMembership(ctx, collection, {
      onlyPublic: false,
      limit: input.limit,
      offset: input.offset,
    });
    return {
      collection,
      products: rows.map((row) => ({
        productId: row.productId,
        name: row.name,
        slug: row.slug,
        kind: row.kind,
        status: row.status,
        subtitle: row.subtitle,
        position: row.position,
      })),
      total,
    };
  },
});

function publicCollection(collection: typeof collections.$inferSelect) {
  return {
    id: collection.id,
    title: collection.title,
    slug: collection.slug,
    description: collection.description,
    seo: collection.seo,
    sortOrder: collection.sortOrder,
    updatedAt: collection.updatedAt,
  };
}

export const resolvePublicCollection = defineService({
  name: "catalog.resolvePublicCollection",
  summary: "Resolve a published collection by slug for the public /c/<slug> page.",
  kind: "query",
  permission: "public",
  input: z.object({
    slug,
    limit: z.number().int().min(1).max(100).default(24),
    offset: z.number().int().min(0).max(100_000).default(0),
  }),
  output: row({
    collection: publicCollectionRow.nullable(),
    products: listed(publicMembershipRow),
    total: z.number().int(),
  }),
  handler: async (input, ctx) => {
    const [collection] = await ctx.tx
      .select()
      .from(collections)
      .where(
        and(
          eq(collections.slug, input.slug),
          eq(collections.published, true),
          isNull(collections.trashedAt),
        ),
      )
      .limit(1);
    if (!collection) return { collection: null, products: [], total: 0 };
    const { rows, total } = await readMembership(ctx, collection, {
      onlyPublic: true,
      limit: input.limit,
      offset: input.offset,
    });
    return {
      collection: publicCollection(collection),
      products: rows.map((row) => ({
        productId: row.productId,
        name: row.name,
        slug: row.slug,
        subtitle: row.subtitle,
        brand: row.brand,
      })),
      total,
    };
  },
});

/**
 * The sitemap half of the SEO contract (§5): a published collection is a URL
 * the crawler may fetch, advertised from the same read the page renders from.
 */
export const collectionPaths = defineService({
  name: "catalog.collectionPaths",
  summary: "Every published collection's path, for sitemaps and feeds.",
  kind: "query",
  permission: "public",
  input: z.object({ locale: z.string().default("en") }),
  output: listed(
    row({
      slug: z.string(),
      title: z.string(),
      description: z.string().optional(),
      updatedAt: timestamp,
      kind: z.literal("collection"),
    }),
  ),
  handler: async (_input, ctx) => {
    const rows = await ctx.tx
      .select({
        slug: collections.slug,
        title: collections.title,
        description: collections.description,
        seo: collections.seo,
        updatedAt: collections.updatedAt,
      })
      .from(collections)
      .where(and(eq(collections.published, true), isNull(collections.trashedAt)))
      .orderBy(asc(collections.slug));
    return rows.map((entry) => ({
      slug: `c/${entry.slug}`,
      title: entry.title,
      description: entry.seo.description ?? entry.description ?? undefined,
      updatedAt: entry.updatedAt,
      kind: "collection" as const,
    }));
  },
});

/** Manual membership refuses to edit a collection whose rows the job owns. */
async function assertManual(collection: { id: string; ruleType: string }): Promise<void> {
  if (collection.ruleType !== "manual") {
    throw new ServiceError(
      "conflict",
      "This collection follows a segment, so its membership is re-derived, not edited by hand.",
    );
  }
}

export const addCollectionProduct = defineService({
  name: "catalog.addCollectionProduct",
  summary: "Pin one product at the end of a manual collection.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ collectionId: id, productId: id }),
  output: row({ collectionId: uuid, productId: uuid, position: z.number().int() }),
  handler: async (input, ctx) => {
    const collection = await rowForUpdate(ctx, input.collectionId);
    await assertManual(collection);
    const [product] = await ctx.tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, input.productId))
      .limit(1);
    if (!product) throw new ServiceError("not_found", "That product is not here.");
    const [next] = await ctx.tx
      .select({ position: sql<number>`coalesce(max(${collectionProducts.position}), -1) + 1` })
      .from(collectionProducts)
      .where(eq(collectionProducts.collectionId, collection.id));
    const [added] = await ctx.tx
      .insert(collectionProducts)
      .values({ collectionId: collection.id, productId: product.id, position: next?.position ?? 0 })
      .onConflictDoNothing()
      .returning();
    if (!added) {
      throw new ServiceError("conflict", "That product is already in this collection.");
    }
    ctx.setSubject("collection", collection.id);
    ctx.queueEvent("catalog.collectionProductAdded", {
      collectionId: collection.id,
      productId: product.id,
    });
    return added;
  },
});

export const removeCollectionProduct = defineService({
  name: "catalog.removeCollectionProduct",
  summary: "Remove one product from a manual collection and close the ordering gap.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ collectionId: id, productId: id }),
  output: row({ collectionId: uuid, productId: uuid }),
  handler: async (input, ctx) => {
    const collection = await rowForUpdate(ctx, input.collectionId);
    await assertManual(collection);
    const [removed] = await ctx.tx
      .delete(collectionProducts)
      .where(
        and(
          eq(collectionProducts.collectionId, collection.id),
          eq(collectionProducts.productId, input.productId),
        ),
      )
      .returning({ collectionId: collectionProducts.collectionId, productId: collectionProducts.productId });
    if (!removed) {
      throw new ServiceError("not_found", "That product is not in this collection.");
    }
    // Compact positions so ordering stays dense: a gap would make reorder
    // forms carry positions the owner never chose.
    const remaining = await ctx.tx
      .select({ productId: collectionProducts.productId })
      .from(collectionProducts)
      .where(eq(collectionProducts.collectionId, collection.id))
      .orderBy(asc(collectionProducts.position));
    for (let index = 0; index < remaining.length; index += 1) {
      await ctx.tx
        .update(collectionProducts)
        .set({ position: index })
        .where(
          and(
            eq(collectionProducts.collectionId, collection.id),
            eq(collectionProducts.productId, remaining[index]!.productId),
          ),
        );
    }
    ctx.setSubject("collection", collection.id);
    ctx.queueEvent("catalog.collectionProductRemoved", {
      collectionId: collection.id,
      productId: input.productId,
    });
    return removed;
  },
});

export const reorderCollectionProducts = defineService({
  name: "catalog.reorderCollectionProducts",
  summary: "Set a manual collection's membership order exactly as given.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({
    collectionId: id,
    productIds: z.array(id).max(500),
  }),
  output: row({ collectionId: uuid, count: z.number().int() }),
  handler: async (input, ctx) => {
    const collection = await rowForUpdate(ctx, input.collectionId);
    await assertManual(collection);
    const current = await ctx.tx
      .select({ productId: collectionProducts.productId })
      .from(collectionProducts)
      .where(eq(collectionProducts.collectionId, collection.id));
    const currentIds = current.map((entry) => entry.productId).sort();
    const givenIds = [...input.productIds].sort();
    if (
      currentIds.length !== givenIds.length ||
      currentIds.some((productId, index) => productId !== givenIds[index])
    ) {
      throw new ServiceError(
        "validation",
        "The order must name exactly the products in this collection, no more and no fewer.",
      );
    }
    for (let index = 0; index < input.productIds.length; index += 1) {
      await ctx.tx
        .update(collectionProducts)
        .set({ position: index })
        .where(
          and(
            eq(collectionProducts.collectionId, collection.id),
            eq(collectionProducts.productId, input.productIds[index]!),
          ),
        );
    }
    ctx.setSubject("collection", collection.id);
    ctx.queueEvent("catalog.collectionProductsReordered", {
      collectionId: collection.id,
      count: input.productIds.length,
    });
    return { collectionId: collection.id, count: input.productIds.length };
  },
});

/**
 * Re-derive one segment collection's membership (C3.25 slice 1).
 *
 * Runs from the hourly job on nobody's behalf, and its whole contract is
 * idempotence: whatever the segment and the orders ledger say, the stored
 * rows afterwards say the same. The derivation asks the core segments engine
 * who is in the saved segment, then asks the orders ledger what those
 * contacts bought — a paid order is a purchase; a pending one is a basket
 * somebody walked away from. A segment that is gone or trashed derives
 * nobody (fail closed, C7.04): the rows are emptied rather than left stale.
 */
export const recomputeCollectionMembership = defineService({
  name: "catalog.recomputeCollectionMembership",
  summary: "Re-derive a segment collection's membership from its segment's purchases.",
  kind: "mutation",
  permission: "system",
  external: false,
  input: z.object({ id }),
  output: row({ id: uuid, matched: z.number().int() }),
  handler: async (input, ctx) => {
    const collection = await rowForUpdate(ctx, input.id);
    if (collection.ruleType !== "segment") {
      throw new ServiceError("validation", "Only segment-driven collections re-derive membership.");
    }
    const segmentId = (collection.ruleConfig).segmentId;
    if (!segmentId || !(await segmentIsLive(ctx.tx, segmentId))) {
      await ctx.tx
        .delete(collectionProducts)
        .where(eq(collectionProducts.collectionId, collection.id));
      return { id: collection.id, matched: 0 };
    }
    const members = await ctx.callAsSystem(segmentMembership, { id: segmentId, limit: 10_000 });
    const contactIds = members.map((member) => member.id);
    const derived =
      contactIds.length === 0
        ? []
        : await ctx.tx
            .select({ productId: products.id, name: products.name })
            .from(orders)
            .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
            .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
            .innerJoin(products, eq(products.id, productVariants.productId))
            .where(
              and(
                inArray(orders.contactId, contactIds),
                inArray(orders.status, ["paid", "fulfilling", "fulfilled"]),
              ),
            )
            .groupBy(products.id, products.name)
            .orderBy(asc(products.name));
    // Wholesale replacement in the same transaction is what makes the job
    // idempotent: a second run deletes exactly what the first wrote and
    // writes the same answer again.
    await ctx.tx
      .delete(collectionProducts)
      .where(eq(collectionProducts.collectionId, collection.id));
    if (derived.length > 0) {
      await ctx.tx.insert(collectionProducts).values(
        derived.map((entry, index) => ({
          collectionId: collection.id,
          productId: entry.productId,
          position: index,
        })),
      );
    }
    ctx.queueEvent("catalog.collectionMembershipRecomputed", {
      collectionId: collection.id,
      matched: derived.length,
    });
    return { id: collection.id, matched: derived.length };
  },
});

registerSearchSource({
  kind: "collection",
  readService: "catalog.listCollections",
  module: "catalog",
  tables: ["collections"],
  search: async ({ tx, pattern, limit }) => {
    const rows = await tx
      .select({ id: collections.id, title: collections.title, slug: collections.slug })
      .from(collections)
      .where(
        and(
          isNull(collections.trashedAt),
          matchesIlike(collections.title, pattern),
        ),
      )
      .orderBy(asc(collections.title))
      .limit(limit);
    return rows.map((entry) => ({
      kind: "collection",
      id: entry.id,
      title: entry.title,
      href: `/admin/collections/${entry.id}`,
      snippet: clipSnippet(entry.slug),
      contactId: null,
      module: "catalog",
    }));
  },
});

export default [
  createCollection,
  updateCollection,
  removeCollection,
  restoreCollection,
  purgeCollection,
  purgeExpiredCollections,
  listCollections,
  getCollection,
  resolvePublicCollection,
  collectionPaths,
  addCollectionProduct,
  removeCollectionProduct,
  reorderCollectionProducts,
  recomputeCollectionMembership,
];
