// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Who subscribes to whom (C12.05). A leaf module: the graph asks it for every
// relation, so it imports only tables.
import { and, eq, inArray, sql } from "drizzle-orm";
import { contacts } from "@/core/contacts/schema";
import type { ServiceContext } from "@/core/service";
import { products } from "@/modules/catalog/schema";
import { plans, subscriptions } from "@/modules/subscriptions/schema";

/** Subscription states that still give access. */
const ACCESS = ["active", "trialing", "past_due"] as const;

/** Whether the viewer has a subscription that gives access to the subject's subscriber content. */
export async function subscribes(ctx: ServiceContext, viewerId: string, subjectId: string): Promise<boolean> {
  const [found] = await ctx.tx
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .innerJoin(contacts, eq(contacts.id, subscriptions.contactId))
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .innerJoin(products, eq(products.id, plans.productId))
    .where(and(eq(contacts.userId, viewerId), eq(products.sellerUserId, subjectId), inArray(subscriptions.status, [...ACCESS])))
    .limit(1);
  return Boolean(found);
}

/** SQL for "the viewer subscribes to the author of this row", for feeds. */
export function subscribesSql(viewerId: string, authorColumn: unknown) {
  return sql`exists (select 1 from ${subscriptions} s join ${contacts} c on c.id = s.contact_id join ${plans} p on p.id = s.plan_id join ${products} pr on pr.id = p.product_id where c.user_id = ${viewerId} and pr.seller_user_id = ${authorColumn} and s.status in ('active','trialing','past_due'))`;
}
