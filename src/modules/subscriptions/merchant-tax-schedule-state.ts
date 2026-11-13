// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.10/C12.38: ordinary state authority has no service-bundle/orchestrator edge.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getService, type ServiceContext } from "@/core/service";
import { subscriptionProviderScheduleErasures, subscriptionProviderScheduleResources } from "./provider-schedule-schema";
import { subscriptionMerchantScopes, subscriptions } from "./schema";
import { merchantScheduleCohortInventoryCovers } from "./provider-schedule-cohorts";
import { merchantAgreementScheduleState } from "./merchant-agreement-schedule-state";

/** No provider I/O; all positive money and current original receipts are checked. */
export async function merchantTaxScheduleState(ctx: ServiceContext, profileId: string): Promise<{ safe: boolean; external: boolean }> {
  // Original order and booking payment callers can still charge even when this
  // merchant has never owned a provider subscription. Missing recovery source
  // is unknown debt, not a zero-schedules proof.
  const paymentDebtService = getService("invoicing.merchantTaxPaymentDebt");
  if (!paymentDebtService) return { safe: false, external: true };
  const paymentDebt = z.object({ pending: z.boolean(), hasHistory: z.boolean(), paymentIds: z.array(z.uuid()).max(5000), incomplete: z.boolean() })
    .parse(await ctx.callAsSystem(paymentDebtService, { profileId }));
  if (paymentDebt.pending || paymentDebt.incomplete) return { safe: false, external: true };
  const agreements = await ctx.tx.select({ subscription: subscriptions, scope: subscriptionMerchantScopes, resource: subscriptionProviderScheduleResources })
    .from(subscriptionMerchantScopes).innerJoin(subscriptions, eq(subscriptions.id, subscriptionMerchantScopes.subscriptionId))
    .leftJoin(subscriptionProviderScheduleResources, eq(subscriptionProviderScheduleResources.subscriptionId, subscriptions.id))
    .where(eq(subscriptionMerchantScopes.taxProfileId, profileId)).orderBy(subscriptions.id).limit(5001);
  if (agreements.length > 5000) return { safe: false, external: true };
  const cohorts = await ctx.tx.select().from(subscriptionProviderScheduleErasures).where(eq(subscriptionProviderScheduleErasures.profileId, profileId)).limit(5001);
  if (cohorts.length > 5000) return { safe: false, external: true };
  const currentAgreementIds = new Set(agreements.map(agreement => agreement.subscription.id));
  for (const cohort of cohorts) if (!await merchantScheduleCohortInventoryCovers(ctx.tx, cohort, currentAgreementIds)) return { safe: false, external: true };
  let external = paymentDebt.hasHistory || cohorts.length > 0;
  for (const agreement of agreements) {
    const state=await merchantAgreementScheduleState(ctx,agreement);
    external=external||state.external;
    if(!state.safe)return {safe:false,external};
  }
  return { safe: true, external };
}
