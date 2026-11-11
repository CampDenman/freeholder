// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: seller policy is resolved through the same transaction as issue.
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { okResult } from "@/core/contract";
import { invoices } from "@/modules/invoicing/schema";
import { getInvoiceMarketPolicy, invoiceMarketPolicy, marketFeeMinor, registerInvoiceMarketResolver, registerInvoiceMerchantVerifier } from "@/modules/invoicing/market-policy";
import { orderSellers } from "@/modules/catalog/market";
import { products } from "@/modules/catalog/schema";
import { plans, subscriptions } from "@/modules/subscriptions/schema";
import { getSubscriptionMarketPolicy, registerSubscriptionMarketResolver, registerSubscriptionPlanMarketResolver, registerSubscriptionMerchantVerifier, subscriptionMarketPolicy, type SubscriptionMarketPolicy } from "@/modules/subscriptions/market-policy";
import { sellerForInvoice } from "./member-subscriptions";
import { marketRules } from "./payouts";
import { memberPayoutAccounts, memberProfiles, memberSettings } from "./schema";

async function policyForSellers(sellerIds: string[], containsSiteItems: boolean, ctx: ServiceContext): Promise<SubscriptionMarketPolicy> {
  // A signup/issue transaction keeps its displayed terms stable through
  // capture. Owner updates wait until this transaction commits.
  await ctx.tx.select({ id: memberSettings.id }).from(memberSettings).where(eq(memberSettings.id, 1)).for("share");
  const rules = await marketRules(ctx);
  const base = { model: rules.model, adapter: rules.adapter, siteFeeBps: rules.siteFeeBps, holdDays: rules.holdDays };
  if (rules.model !== "seller_merchant") return { ...base, sellerUserId: sellerIds.length === 1 ? sellerIds[0]! : null, merchantName: null, providerAccountId: null };
  if (rules.adapter !== "stripe_connect" || sellerIds.length !== 1 || containsSiteItems) throw new ServiceError("conflict", "Direct seller checkout requires one seller and Stripe Connect.");
  const [seller] = await ctx.tx.select({ account: memberPayoutAccounts, profile: memberProfiles })
    .from(memberPayoutAccounts).innerJoin(memberProfiles, eq(memberProfiles.userId, memberPayoutAccounts.userId))
    .where(inArray(memberPayoutAccounts.userId, sellerIds)).for("share");
  if (!seller || seller.profile.status !== "active" || seller.account.adapter !== "stripe_connect" || seller.account.status !== "ready" || !seller.account.chargesReady || !seller.account.externalAccountId || !seller.account.merchantName) throw new ServiceError("conflict", "This seller must finish direct-payment setup before an agreement or invoice can be issued.");
  return { ...base, sellerUserId: seller.profile.userId, merchantName: seller.account.merchantName, providerAccountId: seller.account.externalAccountId };
}

export const resolveSubscriptionPlanMarketPolicy = defineService({
  name: "members.resolveSubscriptionPlanMarketPolicy", summary: "Resolve a plan's seller and current collection terms before agreement consent.",
  kind: "query", permission: "system", external: false,
  input: z.object({ planId: z.uuid() }), output: subscriptionMarketPolicy.nullable(),
  handler: async ({ planId }, ctx) => {
    const [plan] = await ctx.tx.select({ sellerUserId: products.sellerUserId }).from(plans).innerJoin(products, eq(products.id, plans.productId)).where(eq(plans.id, planId)).limit(1);
    return plan?.sellerUserId ? policyForSellers([plan.sellerUserId], false, ctx) : null;
  },
});
registerSubscriptionPlanMarketResolver((planId, ctx) => ctx.callAsSystem(resolveSubscriptionPlanMarketPolicy, { planId }));

export const resolveSubscriptionMarketPolicy = defineService({
  name: "members.resolveSubscriptionMarketPolicy", summary: "Resolve the seller and collection terms when an agreement starts.",
  kind: "query", permission: "system", external: false,
  input: z.object({ subscriptionId: z.uuid() }), output: subscriptionMarketPolicy.nullable(),
  handler: async ({ subscriptionId }, ctx) => {
    const [subscription] = await ctx.tx.select({ planId: subscriptions.planId }).from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1);
    return subscription ? ctx.callAsSystem(resolveSubscriptionPlanMarketPolicy, { planId: subscription.planId }) : null;
  },
});
registerSubscriptionMarketResolver((subscriptionId, ctx) => ctx.callAsSystem(resolveSubscriptionMarketPolicy, { subscriptionId }));

export const resolveInvoiceMarketPolicy = defineService({
  name: "members.resolveInvoiceMarketPolicy", summary: "Resolve the sellers and collection policy for a new invoice.",
  kind: "query", permission: "system", external: false,
  input: z.object({ invoiceId: z.uuid() }), output: invoiceMarketPolicy.nullable(),
  handler: async ({ invoiceId }, ctx) => {
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    if (!invoice || !invoice.sourceId) return null;
    if (invoice.sourceType === "subscription" && z.uuid().safeParse(invoice.sourceId.split(":")[0]).success) {
      const policy = await ctx.callAsSystem(getSubscriptionMarketPolicy, { subscriptionId: invoice.sourceId.split(":")[0]! });
      const seller = await sellerForInvoice(ctx, invoice);
      if (!policy && !seller) return null;
      if (!policy || policy.sellerUserId !== seller) throw new ServiceError("conflict", "The agreement's original seller needs reconciliation before billing.");
      return { ...policy, feeMinor: marketFeeMinor(invoice.totalMinor - invoice.taxMinor, policy.siteFeeBps) };
    }
    const rules = await marketRules(ctx);
    let sellerIds: string[];
    let feeMinor: number;
    let containsSiteItems = false;
    if (invoice.sourceType === "order" && z.uuid().safeParse(invoice.sourceId).success) {
      let order;
      try { order = await ctx.callAsSystem(orderSellers, { orderId: invoice.sourceId }); }
      catch (error) { if (error instanceof ServiceError && error.code === "not_found") return null; throw error; }
      sellerIds = [...new Set(order.lines.map(line => line.sellerUserId))];
      containsSiteItems = order.containsSiteItems;
      feeMinor = order.lines.reduce((total, line) => total + marketFeeMinor(line.lineTotalMinor, rules.siteFeeBps), 0);
    } else {
      const seller = await sellerForInvoice(ctx, invoice);
      sellerIds = seller ? [seller] : [];
      feeMinor = marketFeeMinor(invoice.totalMinor - invoice.taxMinor, rules.siteFeeBps);
    }
    if (sellerIds.length === 0) return null;
    return { ...await policyForSellers(sellerIds, containsSiteItems, ctx), feeMinor };
  },
});

registerInvoiceMarketResolver((invoiceId, ctx) => ctx.callAsSystem(resolveInvoiceMarketPolicy, { invoiceId }));

export const verifyInvoiceMerchantAccount = defineService({
  name: "members.verifyInvoiceMerchantAccount", summary: "Verify that an issued invoice's original seller account remains authorized.",
  kind: "query", permission: "system", external: false,
  input: z.object({ invoiceId: z.uuid() }), output: okResult,
  handler: async ({ invoiceId }, ctx) => {
    const policy = await ctx.callAsSystem(getInvoiceMarketPolicy, { invoiceId });
    if (!policy || policy.model !== "seller_merchant" || !policy.sellerUserId) throw new ServiceError("conflict", "This invoice has no direct seller policy.");
    await verifyMerchantPolicy(policy, ctx);
    return { ok: true as const };
  },
});
registerInvoiceMerchantVerifier(async (invoiceId, ctx) => { await ctx.callAsSystem(verifyInvoiceMerchantAccount, { invoiceId }); });

async function verifyMerchantPolicy(policy: SubscriptionMarketPolicy, ctx: ServiceContext): Promise<void> {
  if (!policy.sellerUserId) throw new ServiceError("conflict", "The original seller is missing.");
  const [seller] = await ctx.tx.select({ account: memberPayoutAccounts, profile: memberProfiles })
    .from(memberPayoutAccounts).innerJoin(memberProfiles, eq(memberProfiles.userId, memberPayoutAccounts.userId))
    .where(eq(memberPayoutAccounts.userId, policy.sellerUserId)).limit(1);
  if (!seller || seller.profile.status !== "active" || seller.account.adapter !== policy.adapter || seller.account.status !== "ready" || !seller.account.chargesReady || seller.account.externalAccountId !== policy.providerAccountId || seller.account.merchantName !== policy.merchantName) throw new ServiceError("conflict", "The seller's payment details changed. Review the original agreement before collecting payment.");
}

export const verifySubscriptionMerchantAccount = defineService({
  name: "members.verifySubscriptionMerchantAccount", summary: "Verify the original merchant before saving a card or scheduling seller renewals.",
  kind: "query", permission: "system", external: false,
  input: z.object({ subscriptionId: z.uuid() }), output: okResult,
  handler: async ({ subscriptionId }, ctx) => {
    const policy = await ctx.callAsSystem(getSubscriptionMarketPolicy, { subscriptionId });
    if (!policy || policy.model !== "seller_merchant") throw new ServiceError("conflict", "This agreement has no direct seller merchant.");
    await verifyMerchantPolicy(policy, ctx);
    return { ok: true as const };
  },
});
registerSubscriptionMerchantVerifier(async (subscriptionId, ctx) => { await ctx.callAsSystem(verifySubscriptionMerchantAccount, { subscriptionId }); });
export default [resolveInvoiceMarketPolicy, resolveSubscriptionMarketPolicy, resolveSubscriptionPlanMarketPolicy, verifyInvoiceMerchantAccount, verifySubscriptionMerchantAccount];
