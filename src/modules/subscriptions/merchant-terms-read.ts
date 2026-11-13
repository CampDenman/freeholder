// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: an accepted agreement reads its original promises, not today's offer.
import { and, desc, eq, lte, sql } from "drizzle-orm";
import { ServiceError, type ServiceContext } from "@/core/service";
import { subscriptionCommercialAmendments } from "./commercial-amendment-schema";
import { subscriptionCommercialSnapshot } from "./merchant-terms-contract";
import { subscriptionCommercialTerms, subscriptionMarketPolicies } from "./schema";
import type { subscriptions } from "./schema";

type Subscription = typeof subscriptions.$inferSelect;

/** The period chooses the explicitly effective acceptance. A later amendment
 * cannot rewrite an already-started period or its invoice. Historical epoch0
 * rows never receive an inferred commercial snapshot. */
export async function originalMerchantTerms(ctx: ServiceContext, subscription: Subscription, periodStart = subscription.currentPeriodStart) {
  if (subscription.merchantScopeVersion !== 1) return null;
  const [policy] = await ctx.tx.select({ model: subscriptionMarketPolicies.model }).from(subscriptionMarketPolicies)
    .where(eq(subscriptionMarketPolicies.subscriptionId, subscription.id)).limit(1);
  if (policy?.model !== "seller_merchant") return null;
  const [terms] = await ctx.tx.select().from(subscriptionCommercialTerms).where(and(
    eq(subscriptionCommercialTerms.subscriptionId, subscription.id), lte(subscriptionCommercialTerms.effectivePeriodStart, periodStart),
    sql`not exists(select 1 from subscription_prorations p where p.terms_id=${subscriptionCommercialTerms.id} and p.state<>'applied')`,
    sql`not exists(select 1 from ${subscriptionCommercialAmendments} where ${subscriptionCommercialAmendments.termsId}=${subscriptionCommercialTerms.id} and ${subscriptionCommercialAmendments.state}<>'activated')`))
    .orderBy(desc(subscriptionCommercialTerms.revision)).limit(1).for("share");
  if (!terms) throw new ServiceError("conflict", "Restore the explicitly accepted original commercial terms before billing this merchant agreement.");
  const snapshot = subscriptionCommercialSnapshot.parse(terms.snapshot);
  if (snapshot.currency !== subscription.currency || snapshot.billingMode !== subscription.billingMode) {
    throw new ServiceError("conflict", "The agreement differs from its accepted currency or billing calendar. Review an explicit amendment before billing.");
  }
  return { ...terms, snapshot };
}

/** Calendar/control callers keep their existing plan shape while taking every
 * commercial field from the acceptance for this exact period. */
export async function originalMerchantPlan<T extends { name: string; interval: string; intervalCount: number; trialDays: number;
  trialRequiresCard: boolean; cancelBehaviour: string; proration: string; billingMode?: string; setupFeeMinor: number }>(
  ctx: ServiceContext, subscription: Subscription, plan: T, periodStart = subscription.currentPeriodStart,
) {
  const accepted = await originalMerchantTerms(ctx, subscription, periodStart);
  return accepted ? { ...plan, name: accepted.snapshot.name, interval: accepted.snapshot.interval, intervalCount: accepted.snapshot.intervalCount,
    trialDays: accepted.snapshot.trialDays, trialRequiresCard: accepted.snapshot.trialRequiresCard, cancelBehaviour: accepted.snapshot.cancelBehaviour,
    proration: accepted.snapshot.proration, setupFeeMinor: accepted.snapshot.setupFeeMinor,
    ...(plan.billingMode === undefined ? {} : { billingMode: accepted.snapshot.billingMode }) } : plan;
}
