// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: a local pause cannot stop an independently running provider schedule.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { defineService, ServiceError } from "@/core/service";
import { subscriptionMerchantScopes, subscriptions } from "./schema";

/** No status, missing reference, deadline or current configuration proves quiescence. */
export function assertNoExternalTaxDependencies(hasExternalAgreement: boolean): void {
  if (hasExternalAgreement) throw new ServiceError("conflict", "Reconcile and stop the original external subscription schedules before changing this merchant tax profile.");
}

// Invoicing registers this guard even when the optional subscriptions module is
// disabled. Until original provider quiescence receipts exist, every external
// agreement remains a dependency, including a locally cancelled or paused one.
export const assertMerchantTaxRevisionSafe = defineService({
  name: "subscriptions.assertMerchantTaxRevisionSafe",
  summary: "Refuse a tax revision while original external subscription schedules can still bill.",
  kind: "query",
  permission: "system",
  external: false,
  input: z.object({ profileId: z.uuid() }),
  output: z.object({ safe: z.literal(true) }),
  handler: async ({ profileId }, ctx) => {
    const dependencies = await ctx.tx.select({ id: subscriptions.id }).from(subscriptionMerchantScopes)
      .innerJoin(subscriptions, eq(subscriptions.id, subscriptionMerchantScopes.subscriptionId))
      .where(and(eq(subscriptionMerchantScopes.taxProfileId, profileId), eq(subscriptions.merchantScopeVersion, 1), eq(subscriptions.billingMode, "provider")))
      .limit(1);
    assertNoExternalTaxDependencies(dependencies.length > 0);
    return { safe: true as const };
  },
});
