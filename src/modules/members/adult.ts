// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Adult content (MASTER.md §44.9, C12.29).
//
// Off unless the site owner allows it. When allowed, an adult member may mark
// a post or listing as adult, and only adults who chose to see adult content
// receive it — from every service, not just the screens. Minors and visitors
// never do. Authors always see their own.
import { and, eq, inArray } from "drizzle-orm";
import { registerListingViewGate } from "@/modules/catalog/listing-gate";
import { ServiceError, type ServiceContext } from "@/core/service";
import { memberListings, memberProfiles, memberSettings } from "./schema";

export async function siteAllowsAdult(ctx: ServiceContext): Promise<boolean> {
  const [found] = await ctx.tx.select({ adultContent: memberSettings.adultContent }).from(memberSettings).where(eq(memberSettings.id, 1));
  return found?.adultContent ?? false;
}

/** Whether this viewer receives adult content. */
export async function seesAdult(ctx: ServiceContext, viewerId: string | null): Promise<boolean> {
  if (!viewerId || !(await siteAllowsAdult(ctx))) return false;
  const [me] = await ctx.tx
    .select({ isAdult: memberProfiles.isAdult, showAdult: memberProfiles.showAdult, status: memberProfiles.status })
    .from(memberProfiles)
    .where(eq(memberProfiles.userId, viewerId));
  return Boolean(me && me.status === "active" && me.isAdult && me.showAdult);
}

/** Refuse unless the site allows adult content and this member says they are an adult. */
export async function assertMayMarkAdult(ctx: ServiceContext, userId: string): Promise<void> {
  if (!(await siteAllowsAdult(ctx))) throw new ServiceError("validation", "This site does not allow adult content.");
  const [me] = await ctx.tx.select({ isAdult: memberProfiles.isAdult }).from(memberProfiles).where(eq(memberProfiles.userId, userId));
  if (!me?.isAdult) throw new ServiceError("permission", "Only adults can post adult content.");
}

registerListingViewGate(async (ctx, productIds) => {
  const adult = await ctx.tx
    .select({ productId: memberListings.productId, sellerId: memberListings.sellerId })
    .from(memberListings)
    .where(and(inArray(memberListings.productId, productIds), eq(memberListings.adult, true)));
  if (adult.length === 0) return new Set();
  const viewer = ctx.actor.kind === "user" ? ctx.actor.userId : null;
  if (await seesAdult(ctx, viewer)) return new Set();
  return new Set(adult.filter((l) => l.sellerId !== viewer).map((l) => l.productId));
});
