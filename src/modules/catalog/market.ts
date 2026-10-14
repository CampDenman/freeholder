// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The member market (MASTER.md §44.8, C12.08): active, public listings sold by
// members, newest first. The site's own shop never includes them.
import { z } from "zod";
import { and, desc, eq, ilike, isNotNull, sql } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { defineService } from "@/core/service";
import { PRODUCT_KINDS } from "./contract";
import { priceListEntries, priceLists, productVariants, products } from "./schema";

const listing = row({
  id: uuid,
  name: z.string(),
  slug: z.string(),
  kind: z.enum(PRODUCT_KINDS),
  sellerUserId: uuid,
  priceMinor: z.number().int().nullable(),
  currency: z.string().nullable(),
  publishedAt: timestamp.nullable(),
});

export const marketListings = defineService({
  name: "catalog.marketListings",
  summary: "Public listings sold by members, newest first, optionally by seller, kind or search text.",
  kind: "query",
  permission: "public",
  input: z.object({
    sellerUserId: uuid.optional(),
    kind: z.enum(PRODUCT_KINDS).optional(),
    term: z.string().trim().max(100).optional(),
    limit: z.number().int().min(1).max(100).default(48),
  }),
  output: listed(listing),
  handler: async (input, ctx) => {
    const price = sql<number | null>`(
      select min(${priceListEntries.amountMinor})::int from ${priceListEntries}
      join ${priceLists} on ${priceLists.id} = ${priceListEntries.priceListId} and ${priceLists.active}
      where ${priceListEntries.variantId} = ${productVariants.id})`;
    const currency = sql<string | null>`(
      select ${priceLists.currency} from ${priceListEntries}
      join ${priceLists} on ${priceLists.id} = ${priceListEntries.priceListId} and ${priceLists.active}
      where ${priceListEntries.variantId} = ${productVariants.id} order by ${priceListEntries.amountMinor} limit 1)`;
    const rows = await ctx.tx
      .select({
        id: products.id,
        name: products.name,
        slug: products.slug,
        kind: products.kind,
        sellerUserId: products.sellerUserId,
        priceMinor: price,
        currency,
        publishedAt: products.publishedAt,
      })
      .from(products)
      .leftJoin(productVariants, and(eq(productVariants.productId, products.id), eq(productVariants.isDefault, true)))
      .where(
        and(
          eq(products.status, "active"),
          eq(products.visibility, "public"),
          isNotNull(products.sellerUserId),
          input.sellerUserId ? eq(products.sellerUserId, input.sellerUserId) : undefined,
          input.kind ? eq(products.kind, input.kind) : undefined,
          input.term ? ilike(products.name, `%${input.term.replace(/[%_\\]/g, (m) => `\\${m}`)}%`) : undefined,
        ),
      )
      .orderBy(desc(products.publishedAt), desc(products.id))
      .limit(input.limit);
    return rows.map((r) => ({ ...r, sellerUserId: r.sellerUserId! }));
  },
});

export default [marketListings];
