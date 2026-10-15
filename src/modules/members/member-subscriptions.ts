// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Member subscriptions (MASTER.md §44.5, C12.05).
//
// A member's subscription is an ordinary subscription plan (§4.15) on a
// product the member sells, so signing up, renewals, dunning, cancelling and
// refunds are the site's existing machinery. What this adds: a member can
// offer plans, people subscribed to them see that member's "subscribers"
// posts and sections, and every paid subscription invoice becomes a payout
// owed to the member through the same ledger as sales (§44.8).
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { getBusiness } from "@/core/settings/service";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { activateProduct, createProduct } from "@/modules/catalog/service";
import { applyVariantMatrix, getProductVariants, setVariantShipping } from "@/modules/catalog/variants";
import { setPriceListEntry } from "@/modules/catalog/pricing";
import { products } from "@/modules/catalog/schema";
import { invoices } from "@/modules/invoicing/schema";
import { savePlan } from "@/modules/subscriptions/service";
import { publicMembershipPlans } from "@/modules/subscriptions/public-signup";
import { plans, subscriptions } from "@/modules/subscriptions/schema";
import { marketRules } from "./payouts";
import { subscribes } from "./subscriber-check";
import { notifyMember } from "./notify";
import { priceListFor, slugFor, standardTaxCategory } from "./listings";
import { memberPayouts, memberProfiles, memberSettings } from "./schema";

async function activeSeller(ctx: ServiceContext) {
  if (ctx.actor.kind !== "user") throw new ServiceError("permission", "Sign in to continue.");
  const [me] = await ctx.tx.select().from(memberProfiles).where(eq(memberProfiles.userId, ctx.actor.userId));
  if (me?.status !== "active") throw new ServiceError("permission", "Your membership is not active.");
  const [settings] = await ctx.tx.select({ enabled: memberSettings.marketplaceEnabled }).from(memberSettings).where(eq(memberSettings.id, 1));
  if (!settings?.enabled) throw new ServiceError("permission", "This site does not let members sell yet.");
  return me;
}

const planShape = row({
  id: uuid,
  name: z.string(),
  interval: z.enum(["month", "year"]),
  status: z.string(),
  subscribers: z.number().int(),
  createdAt: timestamp,
});

export const createMemberPlan = defineService({
  name: "members.createSubscriptionPlan",
  summary: "Offer a paid subscription to your subscriber-only posts and sections, monthly or yearly.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "money",
  rateLimit: { limit: 10, windowSeconds: 3600, message: "You are creating plans very quickly. Please slow down.", subject: (_i, actor) => (actor.kind === "user" ? actor.userId : undefined) },
  input: z.object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).default(""),
    price: z.string().trim().regex(/^\d{1,7}(\.\d{1,2})?$/, "Use a price like 5 or 4.99."),
    interval: z.enum(["month", "year"]).default("month"),
  }),
  output: z.object({ planId: uuid }),
  handler: async (input, ctx) => {
    const me = await activeSeller(ctx);
    const business = await ctx.callAsSystem(getBusiness, {});
    const currency = business?.baseCurrency ?? "USD";
    const product = await ctx.callAsSystem(createProduct, {
      name: input.name,
      slug: slugFor(me.handle, input.name),
      kind: "digital",
      visibility: "public",
      subtitle: input.description || undefined,
      taxCategoryId: await standardTaxCategory(ctx),
      sellerUserId: me.userId,
    });
    const withVariant = await ctx.callAsSystem(applyVariantMatrix, { productId: product.id, expectedVersion: product.version });
    const variant = (await ctx.callAsSystem(getProductVariants, { productId: product.id })).variants[0];
    if (!variant) throw new Error("A plan product was created without a variant.");
    await ctx.callAsSystem(setVariantShipping, { variantId: variant.id, requiresShipping: false });
    await ctx.callAsSystem(setPriceListEntry, { priceListId: await priceListFor(ctx, currency), variantId: variant.id, amount: input.price });
    await ctx.callAsSystem(activateProduct, { id: product.id, expectedVersion: withVariant.version });
    // Manual billing works without a payment provider: each period is an
    // invoice the subscriber pays; the site may switch a plan to card billing.
    const plan = await ctx.callAsSystem(savePlan, {
      productId: product.id,
      name: input.name,
      interval: input.interval,
      status: "active",
      billingMode: "manual",
      cancelBehaviour: "period_end",
    });
    ctx.setSubject("subscription_plan", plan.id);
    return { planId: plan.id };
  },
});

export const myMemberPlans = defineService({
  name: "members.mySubscriptionPlans",
  summary: "The subscription plans you offer, with how many people subscribe to each.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  output: listed(planShape),
  handler: async (_input, ctx) => {
    if (ctx.actor.kind !== "user") throw new ServiceError("permission", "Sign in to continue.");
    const rows = await ctx.tx
      .select({
        plan: plans,
        subscribers: sql<number>`(select count(*)::int from ${subscriptions} s where s.plan_id = ${plans.id} and s.status in ('active','trialing','past_due'))`,
      })
      .from(plans)
      .innerJoin(products, eq(products.id, plans.productId))
      .where(eq(products.sellerUserId, ctx.actor.userId));
    return rows.map(({ plan, subscribers }) => ({
      id: plan.id,
      name: plan.name,
      interval: plan.interval === "year" ? ("year" as const) : ("month" as const),
      status: plan.status,
      subscribers,
      createdAt: plan.createdAt,
    }));
  },
});

export const setMemberPlanStatus = defineService({
  name: "members.setSubscriptionPlanStatus",
  summary: "Stop offering one of your plans to new subscribers, or offer it again. Existing subscribers keep it until they cancel.",
  kind: "mutation",
  permission: "authenticated",
  writeClass: "write",
  input: z.object({ planId: uuid, offered: z.boolean() }),
  output: z.object({ status: z.string() }),
  handler: async (input, ctx) => {
    if (ctx.actor.kind !== "user") throw new ServiceError("permission", "Sign in to continue.");
    const [owned] = await ctx.tx
      .select({ plan: plans })
      .from(plans)
      .innerJoin(products, eq(products.id, plans.productId))
      .where(and(eq(plans.id, input.planId), eq(products.sellerUserId, ctx.actor.userId)));
    if (!owned) throw new ServiceError("not_found", "That plan is not yours.");
    const plan = await ctx.callAsSystem(savePlan, {
      id: owned.plan.id,
      productId: owned.plan.productId,
      name: owned.plan.name,
      interval: owned.plan.interval,
      intervalCount: owned.plan.intervalCount,
      billingMode: owned.plan.billingMode,
      cancelBehaviour: owned.plan.cancelBehaviour,
      status: input.offered ? "active" : "archived",
    });
    return { status: plan.status };
  },
});

export const memberPlans = defineService({
  name: "members.subscriptionPlans",
  summary: "A member's subscription plans you can sign up for.",
  kind: "query",
  permission: "public",
  input: z.object({ handle: z.string().trim().toLowerCase().max(60) }),
  output: z.object({ plans: z.array(z.unknown()), subscribed: z.boolean() }),
  handler: async (input, ctx) => {
    const [seller] = await ctx.tx
      .select({ userId: memberProfiles.userId })
      .from(memberProfiles)
      .where(and(eq(memberProfiles.handle, input.handle), eq(memberProfiles.status, "active")));
    if (!seller) return { plans: [], subscribed: false };
    const viewer = ctx.actor.kind === "user" ? ctx.actor.userId : null;
    return {
      plans: await ctx.call(publicMembershipPlans, { sellerUserId: seller.userId }),
      subscribed: viewer ? viewer === seller.userId || (await subscribes(ctx, viewer, seller.userId)) : false,
    };
  },
});

export const recordSubscriptionPayout = defineService({
  name: "members.recordSubscriptionPayout",
  summary: "Record what a member is owed for one paid subscription invoice.",
  kind: "mutation",
  permission: "system",
  writeClass: "money",
  input: z.object({ invoiceId: uuid }),
  output: z.object({ recorded: z.boolean() }),
  handler: async (input, ctx) => {
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, input.invoiceId));
    if (!invoice || invoice.sourceType !== "subscription" || invoice.status !== "paid" || !invoice.sourceId) return { recorded: false };
    const subscriptionId = invoice.sourceId.split(":")[0]!;
    const [seller] = await ctx.tx
      .select({ sellerUserId: products.sellerUserId })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .innerJoin(products, eq(products.id, plans.productId))
      .where(eq(subscriptions.id, subscriptionId));
    if (!seller?.sellerUserId) return { recorded: false };
    const rules = await marketRules(ctx);
    // Tax collected belongs to the site, which files it; the seller's share is the pre-tax amount.
    const gross = invoice.totalMinor - invoice.taxMinor;
    const fee = Math.floor((gross * rules.siteFeeBps) / 10_000);
    const now = new Date();
    const [created] = await ctx.tx
      .insert(memberPayouts)
      .values({
        invoiceId: invoice.id,
        sellerId: seller.sellerUserId,
        currency: invoice.currency,
        grossMinor: gross,
        feeMinor: fee,
        netMinor: gross - fee,
        model: rules.model,
        state: rules.model === "hold" ? "held" : "due",
        releaseAt: rules.model === "hold" ? new Date(now.getTime() + rules.holdDays * 86_400_000) : null,
        releasedAt: rules.model === "hold" ? null : now,
      })
      .onConflictDoNothing()
      .returning({ id: memberPayouts.id });
    if (!created) return { recorded: false };
    await notifyMember(ctx, {
      to: seller.sellerUserId,
      from: seller.sellerUserId,
      topic: "members.sale",
      key: "members.notify.subscriptionPaid",
      href: "/portal/payouts",
      idempotencyKey: `member-subscription-paid:${invoice.id}`,
    });
    ctx.setSubject("member_payout", created.id);
    return { recorded: true };
  },
});

export async function onInvoicePaid(payload: unknown): Promise<void> {
  const invoiceId = (payload as { invoiceId?: string } | null)?.invoiceId;
  if (!invoiceId) return;
  await recordSubscriptionPayout.call({ invoiceId }, { kind: "system" });
}

export default [createMemberPlan, myMemberPlans, setMemberPlanStatus, memberPlans, recordSubscriptionPayout];
