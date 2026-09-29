// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Faceted storefront browse over live catalog rows (C3.25 slice 2, gap G1 of
// deploy/c324-storefront-parity-2026-09-29.md).
//
// One service powers both public surfaces that need it: the collection page
// (/c/<slug>) and the storefront search page (/search). Both ask the same
// question — "which active, public products match this scope, and what do the
// facet dimensions look like" — so there is one answer, not two catalog
// dialects.
//
// The facet dimensions are derived from the catalog's existing primitives,
// deliberately adding no tables:
//
//   - optionTypes: an option type assigned to products in scope is a facet
//     dimension; its option values are the facet values. Within one dimension
//     a shopper's picks are OR; across dimensions AND.
//   - attributeDefinitions: a definition flagged isFilterable (C5.11's own
//     flag — the admin merchandising verb and the public facet read the same
//     contract) with values on in-scope products becomes a dimension. Text and
//     enum attributes count distinct values; bool counts true/false; number
//     and measure report their observed min/max for a ranged filter.
//   - price: one "from price" per product, computed in SQL. The basis is the
//     anonymous reading of catalog.resolvePrice: window-open active lists in
//     the business's base currency that an anonymous shopper qualifies for —
//     retail and sale always; wholesale/member lists only when they name no
//     audience at all (no group AND no segment); contract never (a contract
//     list names a contact). Per variant the winning list is the highest
//     rank, then priority, then name — exactly resolvePrice's ordering — and
//     the product's price is the minimum across its active variants. Sorting
//     and banding read the same number the product page would quote.
//   - availability: one boolean per product — any active variant that can
//     promise one unit, mirroring catalog.availability at quantity one:
//     untracked variants are always available, tracked variants need a
//     positive net balance (on hand minus unexpired reservations) somewhere,
//     and a backorder policy that promises (allow_silent, or allow_date with a
//     restock date) counts as available.
//
// Facet counts use the conjunctive convention: the count for a value is
// computed with every applied filter *except that value's own dimension*, so
// picking "Size: M" never wipes the size facet to zero and the shopper can
// switch values. Rows, total and every dimension come from the same scope
// builder, so a grid and its counts can never disagree.

import { and, asc, desc, eq, gte, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { listed, row, uuid } from "@/core/contract";
import { escapeIlike, ilikeContains, matchesIlike } from "@/core/search/registry";
import { defineService, type Tx } from "@/core/service";
import { getBusiness } from "@/core/settings/service";
import { ATTRIBUTE_KINDS, BROWSE_SORT_ORDERS, PRODUCT_KINDS } from "./contract";
import { publicCollectionRow } from "./collections";
import {
  attributeDefinitions,
  collections,
  collectionProducts,
  optionTypes,
  optionValues,
  productAttributes,
  productOptionAssignments,
  productOptionValueAssignments,
  products,
} from "./schema";

const id = z.string().uuid();
const decimal = z.string().trim().regex(/^-?[0-9]+(?:\.[0-9]+)?$/, "Use a number.");

const browseProductRow = row({
  productId: uuid,
  name: z.string(),
  slug: z.string(),
  kind: z.enum(PRODUCT_KINDS),
  subtitle: z.string().nullable(),
  brand: z.string().nullable(),
  priceFromMinor: z.number().int().nullable(),
  currency: z.string().nullable(),
  inStock: z.boolean(),
});

const facetValueRow = row({
  /** Machine value: option skuFragment, attribute text, or "true"/"false". */
  value: z.string(),
  /** Display value: the owner's own words for options and attributes. */
  label: z.string(),
  count: z.number().int(),
});

const attributeFacetRow = row({
  key: z.string(),
  label: z.string(),
  kind: z.enum(ATTRIBUTE_KINDS),
  unit: z.string().nullable(),
  values: listed(facetValueRow),
  /** Observed range for number/measure kinds; null on value-kind facets. */
  min: z.string().nullable(),
  max: z.string().nullable(),
});

const priceBandRow = row({
  /** Half-open band: fromMinor <= price < toMinor; null toMinor is open. */
  fromMinor: z.number().int(),
  toMinor: z.number().int().nullable(),
  count: z.number().int(),
});

const priceFacetRow = row({
  currency: z.string(),
  min: z.number().int(),
  max: z.number().int(),
  bands: listed(priceBandRow),
});

const browseOutputFacetRow = row({
  options: listed(row({ code: z.string(), name: z.string(), values: listed(facetValueRow) })),
  attributes: listed(attributeFacetRow),
  /** null when nothing in scope carries a price (or no currency is set). */
  price: priceFacetRow.nullable(),
  availability: row({ inStock: z.number().int(), outOfStock: z.number().int() }),
});

const browseOutput = row({
  collection: publicCollectionRow.nullable(),
  products: listed(browseProductRow),
  total: z.number().int(),
  facets: browseOutputFacetRow,
  /** The base currency the prices were computed in; null when unpriced. */
  currency: z.string().nullable(),
});

const browseFilters = z.object({
  options: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(40),
        values: z.array(z.string().trim().min(1).max(40)).min(1).max(30),
      }),
    )
    .max(12)
    .default([]),
  attributes: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(40),
        values: z.array(z.string().trim().min(1).max(500)).min(1).max(30).default([]),
        min: decimal.optional(),
        max: decimal.optional(),
      }),
    )
    .max(12)
    .default([]),
  /** Minor units of the business currency; half-open [min, max). */
  price: z
    .object({
      min: z.number().int().min(0).optional(),
      max: z.number().int().min(1).optional(),
    })
    .nullable()
    .default(null),
  availability: z.enum(["in_stock"]).optional(),
});

const FACET_VALUE_LIMIT = 20;

export const browseProducts = defineService({
  name: "catalog.browseProducts",
  summary:
    "Faceted storefront browse over active public products: filter, sort and facet counts for a collection or a search term.",
  kind: "query",
  permission: "public",
  input: z
    .object({
      /** Browsing one collection: resolved by id, or by public slug. */
      collectionId: id.optional(),
      collectionSlug: z.string().trim().toLowerCase().max(180).optional(),
      /**
       * Storefront search term. Matched against name, subtitle, brand,
       * attribute text values and option value names — the owner-facing
       * global search's live-row participation rules (active, public)
       * applied to a shopper-facing surface. Description blocks are typed
       * CMS trees; raw JSON text would match structural keys, so the term
       * deliberately does not search them.
       */
      term: z.string().trim().min(1).max(120).optional(),
      filters: browseFilters.default({ options: [], attributes: [], price: null }),
      sort: z.enum(BROWSE_SORT_ORDERS).default("featured"),
      limit: z.number().int().min(1).max(100).default(24),
      offset: z.number().int().min(0).max(100_000).default(0),
    })
    .refine((value) => !(value.collectionId && value.collectionSlug), {
      message: "Name the collection by id or by slug, not both.",
    })
    .refine(
      (value) =>
        !value.filters.price ||
        value.filters.price.min === undefined ||
        value.filters.price.max === undefined ||
        value.filters.price.min < value.filters.price.max,
      { message: "The price band's lower bound must sit below its upper bound." },
    ),
  output: browseOutput,
  handler: async (input, ctx): Promise<z.infer<typeof browseOutput>> => {
    const business = await ctx.callAsSystem(getBusiness, {});
    const currency = business?.baseCurrency ?? null;

    // A slug that does not resolve to a live published collection answers
    // empty rather than erroring inside a query service: the page layer owns
    // the 404 decision, and an empty answer is what lets it make that call.
    let collectionId = input.collectionId ?? null;
    let collection: z.infer<typeof publicCollectionRow> | null = null;
    if (input.collectionSlug) {
      const [found] = await ctx.tx
        .select()
        .from(collections)
        .where(
          and(
            eq(collections.slug, input.collectionSlug),
            eq(collections.published, true),
            isNull(collections.trashedAt),
          ),
        )
        .limit(1);
      if (!found) {
        return {
          collection: null,
          products: [],
          total: 0,
          facets: {
            options: [],
            attributes: [],
            price: null,
            availability: { inStock: 0, outOfStock: 0 },
          },
          currency,
        };
      }
      collectionId = found.id;
      collection = {
        id: found.id,
        title: found.title,
        slug: found.slug,
        description: found.description,
        seo: found.seo,
        sortOrder: found.sortOrder,
        updatedAt: found.updatedAt,
      };
    }

    const filters = input.filters;
    const scope = (except: ScopeExcept = {}) =>
      scopeConditions({ collectionId, term: input.term, currency, filters, except });
    const where = and(...scope());
    const order = orderFor(input.sort, input.term, collectionId !== null, currency);

    const [rows, counted, optionFacets, attributeFacets, priceFacet, availabilityCounts] =
      await Promise.all([
        readRows(ctx.tx, collectionId, where, order, input.limit, input.offset, currency),
        ctx.tx
          .select({ n: sql<number>`count(*)::int` })
          .from(products)
          .where(where)
          .then((result) => result[0]?.n ?? 0),
        readOptionFacets(ctx.tx, scope, filters),
        readAttributeFacets(ctx.tx, scope, filters),
        currency === null
          ? Promise.resolve(null)
          : readPriceFacet(ctx.tx, scope({ price: true }), priceExpression(currency), currency),
        readAvailabilityCounts(ctx.tx, scope({ availability: true })),
      ]);

    return {
      collection,
      products: rows.map((entry) => ({
        productId: entry.productId,
        name: entry.name,
        slug: entry.slug,
        kind: entry.kind,
        subtitle: entry.subtitle,
        brand: entry.brand,
        priceFromMinor: entry.priceFromMinor === null || entry.priceFromMinor === undefined ? null : Number(entry.priceFromMinor),
        currency: entry.currency,
        inStock: entry.inStock,
      })),
      total: counted,
      facets: {
        options: optionFacets,
        attributes: attributeFacets,
        price: priceFacet,
        availability: availabilityCounts,
      },
      currency,
    };
  },
});

type Filters = z.infer<typeof browseFilters>;

interface ScopeExcept {
  option?: string;
  attribute?: string;
  price?: boolean;
  availability?: boolean;
}

interface ScopeInput {
  collectionId: string | null;
  term: string | undefined;
  currency: string | null;
  filters: Filters;
  except: ScopeExcept;
}

function scopeConditions(input: ScopeInput): SQL[] {
  const conditions: SQL[] = [eq(products.status, "active"), eq(products.visibility, "public")];
  if (input.collectionId) {
    conditions.push(
      sql`${products.id} in (select "product_id" from "collection_products" where "collection_id" = ${input.collectionId})`,
    );
  }
  if (input.term) {
    const pattern = ilikeContains(input.term);
    conditions.push(
      or(
        matchesIlike(products.name, pattern),
        matchesIlike(products.subtitle, pattern),
        matchesIlike(products.brand, pattern),
        sql`exists (select 1 from "product_attributes" "pa_t" where "pa_t"."product_id" = ${products.id} and ${matchesIlike(sql`"pa_t"."text_value"`, pattern)})`,
        sql`exists (
          select 1 from "product_option_assignments" "poa_t"
          join "product_option_value_assignments" "pova_t" on "pova_t"."assignment_id" = "poa_t"."id"
          join "option_values" "ov_t" on "ov_t"."id" = "pova_t"."option_value_id"
          where "poa_t"."product_id" = ${products.id} and ${matchesIlike(sql`"ov_t"."name"`, pattern)}
        )`,
      )!,
    );
  }
  for (const option of input.filters.options) {
    if (option.code === input.except.option) continue;
    conditions.push(
      sql`${products.id} in (
        select "poa_f"."product_id" from "product_option_assignments" "poa_f"
        join "option_types" "ot_f" on "ot_f"."id" = "poa_f"."option_type_id"
        join "product_option_value_assignments" "pova_f" on "pova_f"."assignment_id" = "poa_f"."id"
        join "option_values" "ov_f" on "ov_f"."id" = "pova_f"."option_value_id"
        where "ot_f"."code" = ${option.code}
          and "ov_f"."sku_fragment" in (${sql.join(option.values.map((value) => sql`${value}`), sql`, `)})
      )`,
    );
  }
  for (const attribute of input.filters.attributes) {
    if (attribute.key === input.except.attribute) continue;
    const parts: SQL[] = [];
    const textValues = attribute.values.filter((value) => value !== "true" && value !== "false");
    const boolValues = attribute.values.filter((value) => value === "true" || value === "false");
    if (textValues.length > 0) {
      parts.push(
        sql`"pa_f"."text_value" in (${sql.join(textValues.map((value) => sql`${value}`), sql`, `)})`,
      );
    }
    if (boolValues.length > 0) {
      parts.push(
        sql`"pa_f"."bool_value" in (${sql.join(
          boolValues.map((value) => sql`${value === "true"}`),
          sql`, `,
        )})`,
      );
    }
    if (attribute.min !== undefined) {
      parts.push(sql`cast("pa_f"."number_value" as numeric) >= cast(${attribute.min} as numeric)`);
    }
    if (attribute.max !== undefined) {
      parts.push(sql`cast("pa_f"."number_value" as numeric) <= cast(${attribute.max} as numeric)`);
    }
    if (parts.length === 0) continue;
    conditions.push(
      sql`exists (
        select 1 from "product_attributes" "pa_f"
        join "attribute_definitions" "ad_f" on "ad_f"."id" = "pa_f"."attribute_id"
        where "pa_f"."product_id" = ${products.id} and "ad_f"."key" = ${attribute.key} and ${and(...parts)}
      )`,
    );
  }
  if (input.filters.price && !input.except.price && input.currency) {
    const expression = priceExpression(input.currency);
    if (input.filters.price.min !== undefined) {
      conditions.push(gte(expression, input.filters.price.min));
    }
    if (input.filters.price.max !== undefined) {
      conditions.push(lt(expression, input.filters.price.max));
    }
  }
  if (input.filters.availability === "in_stock" && !input.except.availability) {
    conditions.push(inStockExpression());
  }
  return conditions;
}

/**
 * The anonymous from-price for the product the surrounding query belongs to —
 * the file header states the contract this mirrors. The inner subquery picks
 * each variant's winning list entry once (rank by list kind, priority, name),
 * and the product takes the cheapest active variant. Unpriced products read
 * null and sort to the back of price orderings either way.
 */
function priceExpression(currency: string): SQL<number | null> {
  return sql<number | null>`(
    select min("vp"."amount_minor") from "product_variants" "pv"
    join (
      select "ple"."variant_id", "ple"."amount_minor",
        row_number() over (
          partition by "ple"."variant_id"
          order by case "pl"."kind"
            when 'contract' then 400 when 'wholesale' then 300 when 'member' then 300
            when 'sale' then 200 else 100 end desc,
            "pl"."priority" desc, "pl"."name" asc
        ) as "rn"
      from "price_list_entries" "ple"
      join "price_lists" "pl" on "pl"."id" = "ple"."price_list_id"
      where "pl"."active" and "pl"."currency" = ${currency}
        and ("pl"."starts_at" is null or "pl"."starts_at" <= now())
        and ("pl"."ends_at" is null or "pl"."ends_at" > now())
        and ("pl"."kind" in ('retail', 'sale')
          or ("pl"."kind" in ('wholesale', 'member') and "pl"."customer_group_id" is null and "pl"."segment_id" is null))
    ) "vp" on "vp"."variant_id" = "pv"."id" and "vp"."rn" = 1
    where "pv"."product_id" = ${products.id} and "pv"."status" = 'active'
  )`;
}

/**
 * One boolean per product: can any active variant promise one unit, mirroring
 * catalog.availability at quantity one (see the file header). EXISTS keeps it
 * a semi-join rather than a per-row stock recount.
 */
function inStockExpression(): SQL<boolean> {
  return sql<boolean>`exists (
    select 1 from "product_variants" "pv_s"
    where "pv_s"."product_id" = ${products.id} and "pv_s"."status" = 'active' and (
      not exists (select 1 from "inventory_items" "ii_s" where "ii_s"."variant_id" = "pv_s"."id")
      or "pv_s"."backorder_policy" = 'allow_silent'
      or ("pv_s"."backorder_policy" = 'allow_date' and "pv_s"."expected_restock_at" is not null)
      or exists (
        select 1 from "inventory_items" "ii_b"
        where "ii_b"."variant_id" = "pv_s"."id"
          and (select coalesce(sum("sm_b"."delta"), 0) from "stock_movements" "sm_b" where "sm_b"."inventory_item_id" = "ii_b"."id")
            - (select coalesce(sum("sr_b"."quantity"), 0) from "stock_reservations" "sr_b"
                where "sr_b"."inventory_item_id" = "ii_b"."id" and "sr_b"."status" = 'active' and "sr_b"."expires_at" > now())
            > 0
      )
    )
  )`;
}

function orderFor(
  sort: (typeof BROWSE_SORT_ORDERS)[number],
  term: string | undefined,
  inCollection: boolean,
  currency: string | null,
): SQL[] {
  switch (sort) {
    case "price-asc":
    case "price-desc": {
      if (!currency) return [asc(products.name)];
      const expression = priceExpression(currency);
      const direction = sort === "price-asc" ? asc(expression) : desc(expression);
      // Unpriced products never interleave: they close the list either way.
      return [sql`(${expression} is null)`, direction, asc(products.name)];
    }
    case "newest":
      return [desc(products.updatedAt), asc(products.name)];
    case "title":
      return [asc(products.name)];
    default: {
      if (inCollection) {
        // The collection scope joins stored positions in for exactly this.
        return [asc(collectionProducts.position), asc(products.name)];
      }
      if (term) {
        // Best name match first: exact, then prefix, then substring; the
        // term is escaped so a wildcard in it stays a literal.
        return [
          sql`case
            when lower(${products.name}) = lower(${term}) then 0
            when lower(${products.name}) like (${escapeIlike(term)} || '%') escape '\\' then 1
            else 2
          end`,
          asc(products.name),
        ];
      }
      return [asc(products.name)];
    }
  }
}

async function readRows(
  tx: Tx,
  collectionId: string | null,
  where: SQL | undefined,
  order: SQL[],
  limit: number,
  offset: number,
  currency: string | null,
): Promise<
  {
    productId: string;
    name: string;
    slug: string;
    kind: (typeof PRODUCT_KINDS)[number];
    subtitle: string | null;
    brand: string | null;
    priceFromMinor: string | null;
    currency: string | null;
    inStock: boolean;
  }[]
> {
  const base = {
    productId: products.id,
    name: products.name,
    slug: products.slug,
    kind: products.kind,
    subtitle: products.subtitle,
    brand: products.brand,
    // min(amount_minor) is int8, which postgres-js hands back as a string —
    // Number() it in the row mapping, as the reporting service does.
    priceFromMinor:
      currency === null
        ? sql<null>`null`
        : sql<string | null>`${priceExpression(currency)}`,
    currency: sql<string | null>`${currency}`,
    inStock: sql<boolean>`${inStockExpression()}`,
  };
  if (collectionId) {
    return tx
      .select(base)
      .from(products)
      .innerJoin(
        collectionProducts,
        and(
          eq(collectionProducts.productId, products.id),
          eq(collectionProducts.collectionId, collectionId),
        ),
      )
      .where(where)
      .orderBy(...order)
      .limit(limit)
      .offset(offset);
  }
  return tx
    .select(base)
    .from(products)
    .where(where)
    .orderBy(...order)
    .limit(limit)
    .offset(offset);
}

interface OptionFacet {
  code: string;
  name: string;
  values: Map<string, { value: string; label: string; count: number }>;
}

async function readOptionFacets(
  tx: Tx,
  scope: (except?: ScopeExcept) => SQL[],
  filters: Filters,
): Promise<z.infer<typeof browseOutputFacetRow>["options"]> {
  const dimensions = new Map<string, OptionFacet>();

  // Each run fully replaces the entries for the codes it returns: the
  // unfiltered run (all filters on) seeds every code, and a code's excepted
  // run then replaces it with self-free counts. Selected codes therefore
  // never mix their own-filtered and self-free numbers.
  const run = async (exceptCode: string | null) => {
    const rows = await tx
      .select({
        code: optionTypes.code,
        name: optionTypes.name,
        value: optionValues.skuFragment,
        label: optionValues.name,
        count: sql<number>`count(distinct ${products.id})::int`,
      })
      .from(products)
      .innerJoin(productOptionAssignments, eq(productOptionAssignments.productId, products.id))
      .innerJoin(optionTypes, eq(optionTypes.id, productOptionAssignments.optionTypeId))
      .innerJoin(
        productOptionValueAssignments,
        eq(productOptionValueAssignments.assignmentId, productOptionAssignments.id),
      )
      .innerJoin(optionValues, eq(optionValues.id, productOptionValueAssignments.optionValueId))
      .where(and(...scope(exceptCode ? { option: exceptCode } : {})))
      .groupBy(optionTypes.code, optionTypes.name, optionValues.skuFragment, optionValues.name);
    const perCode = new Map<string, Map<string, { value: string; label: string; count: number }>>();
    for (const row of rows) {
      const values = perCode.get(row.code) ?? new Map();
      values.set(row.value, { value: row.value, label: row.label, count: row.count });
      perCode.set(row.code, values);
    }
    for (const [code, values] of perCode) {
      // An excepted run still *sees* every code (it lacks only its own
      // filter) — it may replace only the code it was run for, or it would
      // clobber the other dimensions' full-filtered counts.
      if (exceptCode && code !== exceptCode) continue;
      const name = rows.find((row) => row.code === code)?.name ?? code;
      dimensions.set(code, { code, name, values });
    }
  };

  await run(null);
  for (const option of filters.options) await run(option.code);

  return [...dimensions.values()]
    .map((dimension) => ({
      code: dimension.code,
      name: dimension.name,
      values: [...dimension.values.values()]
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
        .slice(0, FACET_VALUE_LIMIT),
    }))
    .filter((dimension) => dimension.values.length > 0)
    .sort((left, right) => left.code.localeCompare(right.code));
}

interface AttributeFacetDraft {
  key: string;
  label: string;
  kind: (typeof ATTRIBUTE_KINDS)[number];
  unit: string | null;
  values: Map<string, z.infer<typeof facetValueRow>>;
  min: string | null;
  max: string | null;
}

async function readAttributeFacets(
  tx: Tx,
  scope: (except?: ScopeExcept) => SQL[],
  filters: Filters,
): Promise<z.infer<typeof attributeFacetRow>[]> {
  const dimensions = new Map<string, AttributeFacetDraft>();

  // Same replace-the-code discipline as the option reader: the unfiltered
  // run seeds every key, then each selected key's excepted run swaps in
  // self-free counts.
  const run = async (exceptKey: string | null) => {
    const scoped = scope(exceptKey ? { attribute: exceptKey } : {});
    const base = {
      key: attributeDefinitions.key,
      label: attributeDefinitions.label,
      kind: attributeDefinitions.kind,
      unit: attributeDefinitions.unit,
    };
    const valueRows = await tx
      .select({
        ...base,
        textValue: productAttributes.textValue,
        boolValue: productAttributes.boolValue,
        count: sql<number>`count(distinct ${products.id})::int`,
      })
      .from(products)
      .innerJoin(productAttributes, eq(productAttributes.productId, products.id))
      .innerJoin(attributeDefinitions, eq(attributeDefinitions.id, productAttributes.attributeId))
      .where(and(eq(attributeDefinitions.isFilterable, true), ...scoped))
      .groupBy(
        attributeDefinitions.key,
        attributeDefinitions.label,
        attributeDefinitions.kind,
        attributeDefinitions.unit,
        productAttributes.textValue,
        productAttributes.boolValue,
      );
    const rangeRows = await tx
      .select({
        ...base,
        min: sql<string | null>`min(cast(${productAttributes.numberValue} as numeric))::text`,
        max: sql<string | null>`max(cast(${productAttributes.numberValue} as numeric))::text`,
      })
      .from(products)
      .innerJoin(productAttributes, eq(productAttributes.productId, products.id))
      .innerJoin(attributeDefinitions, eq(attributeDefinitions.id, productAttributes.attributeId))
      .where(
        and(
          eq(attributeDefinitions.isFilterable, true),
          sql`${productAttributes.numberValue} is not null`,
          ...scoped,
        ),
      )
      .groupBy(
        attributeDefinitions.key,
        attributeDefinitions.label,
        attributeDefinitions.kind,
        attributeDefinitions.unit,
      );

    for (const row of valueRows) {
      if (row.kind === "number" || row.kind === "measure") continue;
      // See the option reader: an excepted run may only replace its own key.
      if (exceptKey && row.key !== exceptKey) continue;
      const value =
        row.kind === "bool"
          ? row.boolValue === null
            ? null
            : String(row.boolValue)
          : row.textValue;
      if (value === null) continue;
      const existing = dimensions.get(row.key);
      const values = new Map(existing?.values ?? []);
      values.set(value, { value, label: value, count: row.count });
      dimensions.set(row.key, {
        key: row.key,
        label: row.label,
        kind: row.kind,
        unit: row.unit,
        values,
        min: existing?.min ?? null,
        max: existing?.max ?? null,
      });
    }
    for (const row of rangeRows) {
      if (row.kind !== "number" && row.kind !== "measure") continue;
      if (exceptKey && row.key !== exceptKey) continue;
      const existing = dimensions.get(row.key);
      dimensions.set(row.key, {
        key: row.key,
        label: row.label,
        kind: row.kind,
        unit: row.unit,
        values: new Map(existing?.values ?? []),
        min: row.min,
        max: row.max,
      });
    }
  };

  await run(null);
  for (const attribute of filters.attributes) await run(attribute.key);

  return [...dimensions.values()]
    .map((dimension) => ({
      key: dimension.key,
      label: dimension.label,
      kind: dimension.kind,
      unit: dimension.unit,
      values: [...dimension.values.values()]
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
        .slice(0, FACET_VALUE_LIMIT),
      min: dimension.min,
      max: dimension.max,
    }))
    .filter(
      (dimension) =>
        dimension.values.length > 0 || (dimension.min !== null && dimension.max !== null),
    )
    .sort((left, right) => left.key.localeCompare(right.key));
}

/**
 * Split the observed price range into at most eight half-open bands on a
 * 1/2/5×10^k step, so the ladder stays legible in any currency. Bands are
 * derived from what is on the shelf, so an empty shelf is "no price facet",
 * not a row of zeroes.
 */
function ladder(lo: number, hi: number): { from: number; to: number | null }[] {
  if (lo >= hi) return [{ from: lo, to: null }];
  const target = (hi - lo) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const normalized = target / magnitude;
  const step = Math.max(
    1,
    Math.round((normalized < 1.5 ? 1 : normalized < 3.5 ? 2 : normalized < 7 ? 5 : 10) * magnitude),
  );
  const from0 = Math.floor(lo / step) * step;
  const bands: { from: number; to: number | null }[] = [];
  for (let from = from0; from < hi; from += step) {
    bands.push({ from, to: from + step });
    if (bands.length === 8) break;
  }
  // The shelf's top price must sit inside a band: half-open bands would
  // strand the maximum just past the final edge, so the last band runs open.
  if (bands.length > 0) bands[bands.length - 1]!.to = null;
  return bands;
}

async function readPriceFacet(
  tx: Tx,
  conditions: SQL[],
  price: SQL<number | null>,
  currency: string,
): Promise<z.infer<typeof priceFacetRow> | null> {
  const where = and(...conditions);
  const [agg] = await tx
    .select({ lo: sql<string | null>`min(${price})`, hi: sql<string | null>`max(${price})` })
    .from(products)
    .where(where);
  if (!agg || agg.lo === null || agg.hi === null) return null;
  const lo = Number(agg.lo);
  const hi = Number(agg.hi);
  const bands = ladder(lo, hi);
  if (bands.length === 0) return null;
  const counted = bands.map(
    (band, index) =>
      sql<number>`count(*) filter (where ${price} >= ${band.from}${
        band.to === null ? sql`` : sql` and ${price} < ${band.to}`
      })::int as ${sql.identifier(`b${index}`)}`,
  );
  const result = (await tx.execute(
    sql`select ${sql.join(counted, sql`, `)} from ${products} where ${where}`,
  )) as unknown as Record<string, number>[];
  const row = result[0] ?? {};
  return {
    currency,
    min: lo,
    max: hi,
    bands: bands.map((band, index) => ({
      fromMinor: band.from,
      toMinor: band.to,
      count: Number(row[`b${index}`] ?? 0),
    })),
  };
}

async function readAvailabilityCounts(
  tx: Tx,
  conditions: SQL[],
): Promise<{ inStock: number; outOfStock: number }> {
  const [row] = await tx
    .select({
      inStock: sql<number>`count(*) filter (where ${inStockExpression()})::int`,
      outOfStock: sql<number>`count(*) filter (where not ${inStockExpression()})::int`,
    })
    .from(products)
    .where(and(...conditions));
  return { inStock: row?.inStock ?? 0, outOfStock: row?.outOfStock ?? 0 };
}

export default [browseProducts];
