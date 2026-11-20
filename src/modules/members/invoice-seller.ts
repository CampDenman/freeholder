// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: shared seller ancestry must not import member/catalog service barrels.
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { ServiceContext } from "@/core/service";
import { bookings } from "@/core/scheduling/schema";
import { products, serviceOfferings } from "@/modules/catalog/schema";
import type { invoices } from "@/modules/invoicing/schema";
import { plans, subscriptions } from "@/modules/subscriptions/schema";

/** The member a paid invoice is owed to: a subscription to their plan (C12.05) or a booking of their service (C12.25). */
export async function sellerForInvoice(ctx: ServiceContext, invoice: typeof invoices.$inferSelect): Promise<string | null> {
  if (!invoice.sourceId) return null;
  if (!z.uuid().safeParse(invoice.sourceId.split(":")[0]).success) return null;
  if (invoice.sourceType === "subscription") {
    const [row] = await ctx.tx
      .select({ sellerUserId: products.sellerUserId })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .innerJoin(products, eq(products.id, plans.productId))
      .where(eq(subscriptions.id, invoice.sourceId.split(":")[0]!));
    return row?.sellerUserId ?? null;
  }
  if (invoice.sourceType === "booking") {
    const [row] = await ctx.tx
      .select({ sellerUserId: products.sellerUserId })
      .from(bookings)
      .innerJoin(serviceOfferings, eq(serviceOfferings.id, bookings.serviceOfferingId))
      .innerJoin(products, eq(products.id, serviceOfferings.productId))
      .where(eq(bookings.id, invoice.sourceId));
    return row?.sellerUserId ?? null;
  }
  return null;
}

