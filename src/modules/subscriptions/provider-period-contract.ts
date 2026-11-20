// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: actual provider lines/price/calendar must match an admitted period.
import { z } from "zod";
import type { MerchantProviderPhase } from "@/adapters/payments";
const ref = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9_]{1,195}$`));
const integer = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const providerPeriodLineEvidence = z.object({ providerLineRef: ref("il"), providerPriceRef: ref("price").nullable(), providerProductRef: ref("prod").nullable(),
  quantity: integer.nullable(), quantityDecimal: z.string().nullable(), amountMinor: integer.nullable(), currency: z.string().nullable(), periodStart: z.iso.datetime().nullable(), periodEnd: z.iso.datetime().nullable(),
  subscriptionLine: z.boolean(), proration: z.boolean().nullable(), unadjusted: z.boolean(), priceAmountMinor: integer.nullable(), priceCurrency: z.string().nullable(),
  priceInterval: z.string().nullable(), priceIntervalCount: integer.nullable(), licensed: z.boolean(), perUnit: z.boolean(), inclusive: z.boolean(), noTransform: z.boolean() }).strict();
export const providerPeriodInvoiceEvidence = z.object({ providerInvoiceRef: ref("in"), providerSubscriptionRef: ref("sub"), providerCustomerRef: ref("cus").nullable(),
  providerOperationId: z.uuid().nullable(), phaseDigest: sha.nullable(), termsId: z.uuid().nullable(), currency: z.string().nullable(), subtotalMinor: integer.nullable(), totalMinor: integer.nullable(),
  paidMinor: integer.nullable(), remainingMinor: integer.nullable(), paid: z.boolean(), unadjusted: z.boolean(), complete: z.literal(true),
  lines: z.array(providerPeriodLineEvidence).max(2000) }).strict();
export type ProviderPeriodInvoiceEvidence = z.infer<typeof providerPeriodInvoiceEvidence>;
/** The provider bills the one accepted gross recurring price. Freeholder's
 * canonical period/setup net lines and frozen tax must independently add to it. */
export function providerInvoiceMatchesPhase(actual: ProviderPeriodInvoiceEvidence, expected: MerchantProviderPhase & { providerProductRef: string; providerCustomerRef: string; operationId: string; providerPriceRef?: string }): boolean {
  const line = actual.lines[0];
  return actual.complete && actual.lines.length === 1 && !!line && actual.providerOperationId === expected.operationId && actual.phaseDigest === expected.phaseDigest && actual.termsId === expected.termsId
    && actual.providerCustomerRef === expected.providerCustomerRef && actual.currency === expected.currency && actual.paid && actual.unadjusted
    && actual.subtotalMinor === expected.totalMinor && actual.totalMinor === expected.totalMinor && actual.paidMinor === expected.totalMinor && actual.remainingMinor === 0
    && line.subscriptionLine && line.proration === false && line.unadjusted && line.quantity === 1 && typeof line.quantityDecimal === "string" && /^1(?:\.0{1,12})?$/.test(line.quantityDecimal)
    && line.amountMinor === expected.totalMinor && line.currency === expected.currency && line.periodStart === expected.start && line.periodEnd === expected.end
    && !!line.providerPriceRef && (!expected.providerPriceRef || line.providerPriceRef === expected.providerPriceRef) && line.providerProductRef === expected.providerProductRef
    && line.priceAmountMinor === expected.totalMinor && line.priceCurrency === expected.currency && line.priceInterval === expected.interval && line.priceIntervalCount === expected.intervalCount
    && line.licensed && line.perUnit && line.inclusive && line.noTransform;
}
