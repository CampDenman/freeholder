// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The member market (MASTER.md §44.8, C12.08): active, public listings sold by
// members, newest first. The site's own shop never includes them.
import { z } from "zod";
import { and, desc, eq, ilike, inArray, isNotNull, sql } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { PRODUCT_KINDS } from "./contract";
import { orderItems, orders, priceListEntries, priceLists, productVariants, products } from "./schema";

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

/**
 * §44.8: whether member listings may be sold right now. The members module
 * registers the answer (payouts configured, sellers ready, payout model);
 * the catalog only asks. With nothing registered, member listings are never
 * sold — money must not be collected for a seller the site cannot pay.
 */
export type SellerGate = (ctx: ServiceContext, sellerIds: (string | null)[]) => Promise<string | null>;
let gate: SellerGate | null = null;

export function registerSellerGate(next: SellerGate): void {
  gate = next;
}

/** Whether one seller's listings can be bought right now (null is the site). */
export async function sellerCanSell(ctx: ServiceContext, sellerUserId: string | null): Promise<boolean> {
  if (sellerUserId === null) return true;
  return gate ? (await gate(ctx, [sellerUserId])) === null : false;
}

/** Refuse with a ServiceError when these variants cannot be sold together. */
export async function assertSellable(ctx: ServiceContext, variantIds: string[]): Promise<void> {
  if (variantIds.length === 0) return;
  const rows = await ctx.tx
    .select({ sellerUserId: products.sellerUserId })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(productVariants.id, variantIds));
  const sellers = [...new Set(rows.map((r) => r.sellerUserId))];
  if (sellers.every((s) => s === null)) return;
  const refusal = gate ? await gate(ctx, sellers) : "Buying from members is not available on this site yet.";
  if (refusal) throw new ServiceError("conflict", refusal);
}

export const orderSellers = defineService({
  name: "catalog.orderSellers",
  summary: "Which member sold each line of an order, for the payout ledger.",
  kind: "query",
  permission: "system",
  input: z.object({ orderId: uuid }),
  output: z.object({
    orderId: uuid,
    invoiceId: uuid.nullable(),
    currency: z.string(),
    status: z.string(),
    lines: listed(row({ orderItemId: uuid, sellerUserId: uuid, lineTotalMinor: z.number().int() })),
  }),
  handler: async (input, ctx) => {
    const [order] = await ctx.tx.select().from(orders).where(eq(orders.id, input.orderId));
    if (!order) throw new ServiceError("not_found", "That order does not exist.");
    const lines = await ctx.tx
      .select({ orderItemId: orderItems.id, sellerUserId: products.sellerUserId, lineTotalMinor: orderItems.lineTotalMinor })
      .from(orderItems)
      .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(orderItems.orderId, order.id), isNotNull(products.sellerUserId)));
    return {
      orderId: order.id,
      invoiceId: order.invoiceId,
      currency: order.currency,
      status: order.status,
      lines: lines.map((l) => ({ ...l, sellerUserId: l.sellerUserId! })),
    };
  },
});

export const orderForInvoice = defineService({
  name: "catalog.orderForInvoice",
  summary: "The order an invoice belongs to, if any.",
  kind: "query",
  permission: "system",
  input: z.object({ invoiceId: uuid }),
  output: z.object({ orderId: uuid.nullable(), totalMinor: z.number().int().nullable() }),
  handler: async (input, ctx) => {
    const [order] = await ctx.tx.select({ id: orders.id, totalMinor: orders.totalMinor }).from(orders).where(eq(orders.invoiceId, input.invoiceId));
    return { orderId: order?.id ?? null, totalMinor: order?.totalMinor ?? null };
  },
});

export default [marketListings, orderSellers, orderForInvoice];
