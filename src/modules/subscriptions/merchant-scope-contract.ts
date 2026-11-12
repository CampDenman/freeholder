// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: new agreement facts distinguish charge, recipient and tax ownership.
import { z } from "zod";
import type { MerchantChargeScope, PaymentAccountScope } from "@/adapters/payments";
import { ServiceError } from "@/core/service";

const account = z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200);
export const subscriptionTaxDestination = z.object({
  country: z.string().regex(/^[A-Z]{2}$/),
  region: z.string().trim().min(1).max(100).optional(),
  postalCode: z.string().trim().min(1).max(32).optional(),
  city: z.string().trim().min(1).max(200).optional(),
}).strict();

export const subscriptionMerchantScope = z.object({
  subscriptionId: z.uuid(),
  agreementRoutingVersion: z.literal(1),
  collectionKind: z.enum(["direct", "destination"]),
  providerPlatformAccountId: account,
  chargeAccountId: account.nullable(),
  recipientAccountId: account,
  settlementMerchantAccountId: account,
  taxProfileId: z.uuid(),
  taxProfileVersion: z.number().int().positive(),
  taxLiability: z.enum(["platform", "seller"]),
  taxDestination: subscriptionTaxDestination.nullable(),
}).superRefine((scope, ctx) => {
  const invalid = scope.recipientAccountId === scope.providerPlatformAccountId
    || scope.settlementMerchantAccountId !== scope.recipientAccountId
    || (scope.collectionKind === "direct" ? scope.chargeAccountId !== scope.recipientAccountId : scope.chargeAccountId !== null);
  if (invalid) ctx.addIssue({ code: "custom", message: "The original agreement's charge and settlement accounts conflict." });
});
export type SubscriptionMerchantScope = z.infer<typeof subscriptionMerchantScope>;

/** Current configuration and a plan's later owner are deliberately not inputs. */
export function subscriptionChargeScope(original: SubscriptionMerchantScope): MerchantChargeScope {
  const scope = subscriptionMerchantScope.parse(original);
  return {
    providerPlatformAccountId: scope.providerPlatformAccountId,
    ...(scope.collectionKind === "direct" ? { providerAccountId: scope.chargeAccountId! } : {
      destinationAccountId: scope.recipientAccountId,
      settlementMerchantAccountId: scope.settlementMerchantAccountId,
    }),
  };
}

/** A legacy unknown platform is its own namespace, never a current-platform alias. */
export function subscriptionMethodScopeMatches(scope: PaymentAccountScope, method: {
  providerAccountId: string;
  providerPlatformAccountId: string | null;
}): boolean {
  return (scope.providerAccountId ?? "") === method.providerAccountId
    && (scope.providerPlatformAccountId ?? null) === method.providerPlatformAccountId;
}

export function originalSubscriptionTaxDestination(scope: SubscriptionMerchantScope) {
  if (!scope.taxDestination) throw new ServiceError("conflict", "This agreement's original tax destination was erased. A new agreement is required before further billing.");
  return subscriptionTaxDestination.parse(scope.taxDestination);
}
