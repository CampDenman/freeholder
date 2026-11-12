// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: accepted prices and calendar promises do not follow later plan edits.
import { z } from "zod";

const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const subscriptionCommercialSnapshot = z.object({
  version: z.literal(1),
  name: z.string().trim().min(1).max(500),
  description: z.string().max(16000).nullable(),
  productVariantId: z.uuid(),
  taxCategoryCode: z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/).max(80),
  requiresShipping: z.boolean(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  periodAmountMinor: minor,
  setupFeeMinor: minor,
  interval: z.enum(["day", "week", "month", "year"]),
  intervalCount: z.number().int().positive().max(52),
  trialDays: z.number().int().nonnegative().max(365),
  trialRequiresCard: z.boolean(),
  cancelBehaviour: z.enum(["immediate", "period_end"]),
  proration: z.enum(["create_prorations", "none"]),
  billingMode: z.enum(["manual", "platform", "provider"]),
}).strict();
export type SubscriptionCommercialSnapshot = z.infer<typeof subscriptionCommercialSnapshot>;

export const subscriptionInitialTaxQuote = z.object({
  quoteDigest: z.string().regex(/^[a-f0-9]{64}$/),
  subtotalMinor: minor, taxMinor: minor, totalMinor: minor,
}).strict();
export type SubscriptionInitialTaxQuote = z.infer<typeof subscriptionInitialTaxQuote>;

/** Both inputs come from the server's actual selected method/signup phase.
 * A missing card is not an accepted trial start or an automatic free period. */
export function initialMerchantInvoiceAmounts(snapshot: SubscriptionCommercialSnapshot, phase: {
  deferFirstPayment: boolean; hasSavedMethod: boolean;
}): { periodAmountMinor: number; setupFeeMinor: number; firstPaidSetupFeeMinor: number; awaitingCard: boolean; trialing: boolean } {
  const accepted = subscriptionCommercialSnapshot.parse(snapshot);
  const awaitingCard = phase.deferFirstPayment && accepted.trialDays > 0 && accepted.trialRequiresCard && !phase.hasSavedMethod;
  const trialing = accepted.trialDays > 0 && !awaitingCard;
  return { periodAmountMinor: awaitingCard || trialing ? 0 : accepted.periodAmountMinor,
    setupFeeMinor: trialing ? 0 : accepted.setupFeeMinor,
    firstPaidSetupFeeMinor: trialing ? accepted.setupFeeMinor : 0, awaitingCard, trialing };
}
