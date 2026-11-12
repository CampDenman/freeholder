// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: an agreement fixes its merchant before a trial or first invoice.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { invoiceMarketPolicy } from "@/modules/invoicing/market-policy";
import { subscriptionMarketPolicies, subscriptions } from "./schema";

export const subscriptionMarketPolicy = invoiceMarketPolicy.omit({ feeMinor: true });
export type SubscriptionMarketPolicy = z.infer<typeof subscriptionMarketPolicy>;
type Resolver = (subscriptionId: string, ctx: ServiceContext) => Promise<SubscriptionMarketPolicy | null>;
let resolver: Resolver | undefined;
let planResolver: Resolver | undefined;
let verifier: ((subscriptionId: string, ctx: ServiceContext) => Promise<void>) | undefined;

/** Trusted startup composition only; the callback must use shared services. */
export function registerSubscriptionMarketResolver(next: Resolver): void { resolver = next; }
export function registerSubscriptionPlanMarketResolver(next: Resolver): void { planResolver = next; }
export async function resolveSubscriptionPlanMarketPolicy(ctx: ServiceContext, planId: string): Promise<SubscriptionMarketPolicy | null> { return await planResolver?.(planId, ctx) ?? null; }
export function registerSubscriptionMerchantVerifier(next: (subscriptionId: string, ctx: ServiceContext) => Promise<void>): void { verifier = next; }

export async function subscriptionPaymentScope(ctx: ServiceContext, subscriptionId: string, verify = false): Promise<{ providerAccountId?: string; applicationFeePercent?: number }> {
  const policy = await ctx.callAsSystem(getSubscriptionMarketPolicy, { subscriptionId });
  if (policy?.model !== "seller_merchant") return {};
  if (!policy.providerAccountId || policy.adapter !== "stripe_connect") throw new ServiceError("conflict", "The original subscription merchant needs reconciliation.");
  if (verify) {
    if (!verifier) throw new ServiceError("conflict", "Seller subscription payments are unavailable in this build.");
    await verifier(subscriptionId, ctx);
  }
  return { providerAccountId: policy.providerAccountId, applicationFeePercent: policy.siteFeeBps / 100 };
}

export const captureSubscriptionMarketPolicy = defineService({
  name: "subscriptions.captureMarketPolicy", summary: "Freeze a member agreement's original collection policy before billing or trial access.",
  kind: "mutation", permission: "system", external: false,
  input: z.object({ subscriptionId: z.uuid() }), output: z.object({ captured: z.boolean() }),
  handler: async ({ subscriptionId }, ctx) => {
    await lockContactIdentityForRead(ctx.tx);
    const [subscription] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1).for("update");
    if (!subscription) throw new ServiceError("not_found", "That subscription is not here.");
    const [existing] = await ctx.tx.select().from(subscriptionMarketPolicies).where(eq(subscriptionMarketPolicies.subscriptionId, subscriptionId));
    if (existing) return { captured: true };
    const supplied = await resolver?.(subscriptionId, ctx);
    if (!supplied) return { captured: false };
    const policy = subscriptionMarketPolicy.parse(supplied);
    if (policy.model === "seller_merchant" && (policy.adapter !== "stripe_connect" || !policy.sellerUserId || !policy.merchantName || !policy.providerAccountId)) throw new ServiceError("conflict", "This agreement needs a verified seller merchant account.");
    await ctx.tx.insert(subscriptionMarketPolicies).values({ subscriptionId, ...policy });
    ctx.setSubject("subscription", subscriptionId);
    return { captured: true };
  },
});

export const getSubscriptionMarketPolicy = defineService({
  name: "subscriptions.marketPolicy", summary: "Read the private original merchant policy for subscription billing.",
  kind: "query", permission: "system", external: false,
  input: z.object({ subscriptionId: z.uuid() }), output: subscriptionMarketPolicy.nullable(),
  handler: async ({ subscriptionId }, ctx) => {
    const [policy] = await ctx.tx.select().from(subscriptionMarketPolicies).where(eq(subscriptionMarketPolicies.subscriptionId, subscriptionId));
    return policy ? subscriptionMarketPolicy.parse(policy) : null;
  },
});

export const getSubscriptionPaymentScope = defineService({
  name: "subscriptions.paymentScope", summary: "Read and optionally verify the original merchant for a provider operation.",
  kind: "query", permission: "system", external: false,
  input: z.object({ subscriptionId: z.uuid(), verify: z.boolean().default(false) }),
  output: z.object({ providerAccountId: z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200).optional(), applicationFeePercent: z.number().min(0).max(100).optional() }),
  handler: ({ subscriptionId, verify }, ctx) => subscriptionPaymentScope(ctx, subscriptionId, verify),
});

export default [captureSubscriptionMarketPolicy, getSubscriptionMarketPolicy, getSubscriptionPaymentScope];
