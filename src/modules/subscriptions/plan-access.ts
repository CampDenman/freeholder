// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.38/C12.38: shared offer eligibility without service-registry cycles.
import { and, desc, eq, isNull } from "drizzle-orm";
import type { ServiceContext } from "@/core/service";
import { products, productVariants } from "@/modules/catalog/schema";
import { plans } from "./schema";

/**
 * Plans a customer may choose for themselves: the same rule as public signup
 * (§C9.38) — an active plan on an active, public product with a live default
 * variant, sold by the same seller as the plan they are leaving. Hidden,
 * staff-only and other sellers' plans are never offered or accepted (C11.10).
 */
export async function selfServePlans(
  ctx: ServiceContext,
  sellerUserId: string | null,
): Promise<Array<typeof plans.$inferSelect>> {
  const { sellerCanSell } = await import("@/modules/catalog/market");
  if (!(await sellerCanSell(ctx, sellerUserId))) return [];
  const rows = await ctx.tx
    .select({ plan: plans })
    .from(plans)
    .innerJoin(products, eq(products.id, plans.productId))
    .innerJoin(
      productVariants,
      and(
        eq(productVariants.productId, products.id),
        eq(productVariants.isDefault, true),
        eq(productVariants.status, "active"),
      ),
    )
    .where(
      and(
        eq(plans.status, "active"),
        eq(products.status, "active"),
        eq(products.visibility, "public"),
        sellerUserId === null ? isNull(products.sellerUserId) : eq(products.sellerUserId, sellerUserId),
      ),
    )
    .orderBy(desc(plans.createdAt))
    .limit(200);
  return rows.map((entry) => entry.plan);
}

/** The seller behind a plan: null for the site's own plans. */
export async function planSeller(ctx: ServiceContext, planId: string): Promise<string | null> {
  const [found] = await ctx.tx
    .select({ sellerUserId: products.sellerUserId })
    .from(plans)
    .innerJoin(products, eq(products.id, plans.productId))
    .where(eq(plans.id, planId))
    .limit(1);
  return found?.sellerUserId ?? null;
}
