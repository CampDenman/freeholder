// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Member listings (MASTER.md §44.8, C12.08).
//
// A listing is an ordinary catalog product with a seller. It is created
// through the catalog's own services, so it gets the same variants, prices,
// lifecycle and public product page as anything the site sells. Until
// seller payouts exist (C12.09) the catalog refuses to put a member's
// listing in a cart; buyers reach the seller by message instead.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { listed, okResult, row, timestamp, uuid } from "@/core/contract";
import { getBusiness } from "@/core/settings/service";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import {
  activateProduct,
  archiveProduct,
  createProduct,
  getProduct,
  restoreProduct,
} from "@/modules/catalog/service";
import { applyVariantMatrix, getProductVariants, setVariantShipping } from "@/modules/catalog/variants";
import { createPriceList, listPriceLists, setPriceListEntry } from "@/modules/catalog/pricing";
import { marketListings } from "@/modules/catalog/market";
import { listProductTaxCategories } from "@/modules/catalog/service";
import { createTaxCategory } from "@/modules/invoicing/tax-service";
import { assertMayMarkAdult } from "./adult";
import { requireAcceptedPolicy } from "./policy";
import { memberListings, memberProfiles, memberSettings } from "./schema";

export const LISTING_KINDS = ["physical", "service", "digital", "rental"] as const;

async function rules(ctx: ServiceContext) {
  const [found] = await ctx.tx.select().from(memberSettings).where(eq(memberSettings.id, 1));
  return { enabled: found?.marketplaceEnabled ?? false, review: found?.listingReview ?? true };
}

async function activeSeller(ctx: ServiceContext) {
  if (ctx.actor.kind !== "user") throw new ServiceError("permission", "Sign in to continue.");
  const [me] = await ctx.tx.select().from(memberProfiles).where(eq(memberProfiles.userId, ctx.actor.userId));
  if (!me || me.status !== "active") throw new ServiceError("permission", "Your membership is not active.");
  if (!(await rules(ctx)).enabled) throw new ServiceError("permission", "This site does not have a member market.");
  return me;
}

async function ownListing(ctx: ServiceContext, productId: string, sellerId: string) {
  const [found] = await ctx.tx
    .select()
    .from(memberListings)
    .where(and(eq(memberListings.productId, productId), eq(memberListings.sellerId, sellerId)));
  if (!found) throw new ServiceError("not_found", "That listing is not available.");
  return found;
}

function slugFor(handle: string, title: string): string {
  const base = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "listing";
  return `${handle.replace(/_/g, "-")}-${base}-${randomBytes(3).toString("hex")}`.replace(/-+/g, "-");
}

/** The site's standard tax category; member sales are taxed like the site's own. */
async function standardTaxCategory(ctx: ServiceContext): Promise<string> {
  const categories = await ctx.callAsSystem(listProductTaxCategories, {});
  const standard = categories.find((c) => c.active && c.code === "standard");
  if (standard) return standard.id;
  return (await ctx.callAsSystem(createTaxCategory, { code: "standard", name: "Standard" })).id;
}

async function priceListFor(ctx: ServiceContext, currency: string): Promise<string> {
  const lists = await ctx.callAsSystem(listPriceLists, { currency, kind: "retail" });
  const usable = lists.find((l) => l.active && !l.customerGroupId);
  if (usable) return usable.id;
  const created = await ctx.callAsSystem(createPriceList, { name: `Member listings (${currency})`, currency });
  return created.id;
}

const listingRow = row({
  productId: uuid,
  name: z.string(),
  slug: z.string(),
  kind: z.string(),
  status: z.enum(["draft", "active", "archived"]),
  review: z.enum(["pending", "approved", "rejected"]),
  reviewNote: z.string().nullable(),
  adult: z.boolean(),
  createdAt: timestamp,
});

async function present(ctx: ServiceContext, listing: typeof memberListings.$inferSelect) {
  const { product } = await ctx.callAsSystem(getProduct, { id: listing.productId });
  return {
    productId: listing.productId,
    name: product.name,
    slug: product.slug,
    kind: product.kind,
    status: product.status,
    review: listing.review,
    reviewNote: listing.reviewNote,
    adult: listing.adult,
    createdAt: listing.createdAt,
  };
}

export const createListing = defineService({
  name: "members.createListing",
  summary: "List something you sell: a physical item, a service, a digital download or a rental, with a price.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  rateLimit: { limit: 30, windowSeconds: 3600, message: "You are listing very quickly. Please slow down.", subject: (_i, actor) => (actor.kind === "user" ? actor.userId : undefined) },
  input: z.object({
    title: z.string().trim().min(2).max(120),
    kind: z.enum(LISTING_KINDS),
    description: z.string().trim().max(5000).default(""),
    price: z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/, "Use a price like 25 or 25.50."),
    currency: z.string().trim().length(3).toUpperCase().optional(),
    /** Adult content (C12.29): only adults may mark it, and only where the site allows it. */
    adult: z.boolean().default(false),
    /** C12.28: accepts the current market policy, needed once per policy version. */
    acceptPolicy: z.boolean().default(false),
  }),
  output: listingRow,
  handler: async (input, ctx) => {
    const me = await activeSeller(ctx);
    if (input.adult) await assertMayMarkAdult(ctx, me.userId);
    await requireAcceptedPolicy(ctx, me.userId, input.acceptPolicy);
    const policy = await rules(ctx);
    const business = await ctx.callAsSystem(getBusiness, {});
    const currency = input.currency ?? business?.baseCurrency ?? "USD";
    const product = await ctx.callAsSystem(createProduct, {
      name: input.title,
      slug: slugFor(me.handle, input.title),
      kind: input.kind,
      visibility: "public",
      taxCategoryId: await standardTaxCategory(ctx),
      description: input.description ? [{ type: "text", props: { body: input.description } }] : [],
      sellerUserId: me.userId,
    });
    const withVariant = await ctx.callAsSystem(applyVariantMatrix, { productId: product.id, expectedVersion: product.version });
    const variants = await ctx.callAsSystem(getProductVariants, { productId: product.id });
    const variant = variants.variants.find((v) => v.isDefault) ?? variants.variants[0];
    if (!variant) throw new Error("A listing was created without a variant.");
    // Only physical items travel; downloads, services and rentals need no address.
    if (input.kind !== "physical") {
      await ctx.callAsSystem(setVariantShipping, { variantId: variant.id, requiresShipping: false });
    }
    await ctx.callAsSystem(setPriceListEntry, { priceListId: await priceListFor(ctx, currency), variantId: variant.id, amount: input.price });
    const review = policy.review ? "pending" : "approved";
    const [listing] = await ctx.tx
      .insert(memberListings)
      .values({ productId: product.id, sellerId: me.userId, review, adult: input.adult, reviewedAt: policy.review ? null : new Date() })
      .returning();
    if (review === "approved") await ctx.callAsSystem(activateProduct, { id: product.id, expectedVersion: withVariant.version });
    ctx.setSubject("member_listing", product.id);
    ctx.queueEvent("member.listingCreated", { productId: product.id, sellerId: me.userId, review });
    return present(ctx, listing!);
  },
});

export const myListings = defineService({
  name: "members.myListings",
  summary: "Everything you have listed, with its review and sale status.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  output: listed(listingRow),
  handler: async (_input, ctx) => {
    if (ctx.actor.kind !== "user") throw new ServiceError("permission", "Sign in to continue.");
    const rows = await ctx.tx
      .select()
      .from(memberListings)
      .where(eq(memberListings.sellerId, ctx.actor.userId))
      .orderBy(desc(memberListings.createdAt))
      .limit(200);
    const out = [];
    for (const r of rows) out.push(await present(ctx, r));
    return out;
  },
});

export const archiveListing = defineService({
  name: "members.archiveListing",
  summary: "Take one of your listings down, or put an archived one back up.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: z.object({ productId: uuid, archived: z.boolean() }),
  output: listingRow,
  handler: async (input, ctx) => {
    const me = await activeSeller(ctx);
    const listing = await ownListing(ctx, input.productId, me.userId);
    const { product } = await ctx.callAsSystem(getProduct, { id: listing.productId });
    if (input.archived && product.status !== "archived") {
      await ctx.callAsSystem(archiveProduct, { id: product.id, expectedVersion: product.version, reason: "Archived by the seller." });
    } else if (!input.archived && product.status === "archived") {
      const restored = await ctx.callAsSystem(restoreProduct, { id: product.id, expectedVersion: product.version, reason: "Restored by the seller." });
      if (listing.review === "approved") await ctx.callAsSystem(activateProduct, { id: restored.id, expectedVersion: restored.version });
    }
    ctx.setSubject("member_listing", listing.productId);
    return present(ctx, listing);
  },
});

export const pendingListings = defineService({
  name: "members.pendingListings",
  summary: "Member listings waiting for the site's review.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(listingRow.extend({ sellerHandle: z.string(), sellerName: z.string() })),
  handler: async (_input, ctx) => {
    const rows = await ctx.tx
      .select({ listing: memberListings, handle: memberProfiles.handle, displayName: memberProfiles.displayName })
      .from(memberListings)
      .innerJoin(memberProfiles, eq(memberProfiles.userId, memberListings.sellerId))
      .where(eq(memberListings.review, "pending"))
      .orderBy(memberListings.createdAt)
      .limit(200);
    const out = [];
    for (const r of rows) out.push({ ...(await present(ctx, r.listing)), sellerHandle: r.handle, sellerName: r.displayName });
    return out;
  },
});

export const reviewListing = defineService({
  name: "members.reviewListing",
  summary: "Approve a member's listing so it goes public, or reject it with a note the seller sees.",
  kind: "mutation",
  permission: "scoped",
  writeClass: "write",
  input: z.object({ productId: uuid, approve: z.boolean(), note: z.string().trim().max(500).optional() }),
  output: okResult,
  handler: async (input, ctx) => {
    if (!input.approve && !input.note) throw new ServiceError("validation", "Tell the seller why the listing was not approved.");
    const [listing] = await ctx.tx.select().from(memberListings).where(eq(memberListings.productId, input.productId)).for("update");
    if (!listing) throw new ServiceError("not_found", "That listing is not available.");
    await ctx.tx
      .update(memberListings)
      .set({ review: input.approve ? "approved" : "rejected", reviewNote: input.note ?? null, reviewedAt: new Date() })
      .where(eq(memberListings.productId, listing.productId));
    const { product } = await ctx.callAsSystem(getProduct, { id: listing.productId });
    if (input.approve && product.status === "draft") {
      await ctx.callAsSystem(activateProduct, { id: product.id, expectedVersion: product.version });
    }
    ctx.setSubject("member_listing", listing.productId);
    ctx.queueEvent("member.listingReviewed", { productId: listing.productId, approved: input.approve });
    return { ok: true as const };
  },
});

export const storefront = defineService({
  name: "members.storefront",
  summary: "A member's public listings.",
  kind: "query",
  permission: "public",
  input: z.object({ handle: z.string().trim().toLowerCase().max(60) }),
  output: listed(row({ id: uuid, name: z.string(), slug: z.string(), kind: z.string(), priceMinor: z.number().int().nullable(), currency: z.string().nullable() })),
  handler: async (input, ctx) => {
    const [seller] = await ctx.tx
      .select({ userId: memberProfiles.userId })
      .from(memberProfiles)
      .where(and(eq(memberProfiles.handle, input.handle), eq(memberProfiles.status, "active")));
    if (!seller) return [];
    const rows = await ctx.callAsSystem(marketListings, { sellerUserId: seller.userId, limit: 100 });
    return rows.map(({ id, name, slug, kind, priceMinor, currency }) => ({ id, name, slug, kind, priceMinor, currency }));
  },
});

export default [createListing, myListings, archiveListing, pendingListings, reviewListing, storefront];
