// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C12.38: customer principal and ancillary settlement duties are separate facts.
import { z } from "zod";
export const principalHazard = z.enum(["original_scope", "original_principal", "customer_charge", "merchant_route", "unknown_caller", "unapplied_cash", "refund", "dispute", "inventory"]);
export const principalAuthorityResult = z.object({ origin: z.enum(["recorded_external", "provider", "unknown"]), principalSafe: z.boolean(), financialDebtPending: z.boolean(),
  currentPrincipalMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), reasons: z.array(principalHazard),
  witness: z.object({ paymentId: z.uuid(), revision: z.string().regex(/^[a-f0-9]{64}$/), originalRouteDigest: z.string().regex(/^[a-f0-9]{64}$/), observationId: z.uuid().nullable(),
    observationDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(), settlementVerified: z.boolean().nullable() }) });

export type ProviderPrincipalFacts = {
  payment: { status: string; providerRef: string | null; amountMinor: number; refundedMinor: number; currency: string };
  route: { platform: string | null; chargeAccount: string | null; recipient: string | null; settlementMerchant: string | null };
  observation: { providerRef: string; platform: string; chargeAccount: string | null; recipient: string | null; settlementMerchant: string | null;
    amountMinor: number; currency: string; customerChargeVerified: boolean; routeVerified: boolean; settlementVerified: boolean } | null;
  unknownCaller: boolean; unappliedCash: boolean; refundDebt: boolean; dispute: boolean; incomplete: boolean;
};
/** No debt strings are filtered, and settlementVerified is never rewritten.
 * A false ancillary settlement fact can coexist with proved customer cash
 * only after the exact recipient and merchant route are actually verified. */
export function evaluateProviderPrincipal(input: ProviderPrincipalFacts) {
  const reasons = new Set<z.infer<typeof principalHazard>>(), { payment, route, observation } = input;
  if (!route.platform || !route.recipient || !route.settlementMerchant) reasons.add("original_scope");
  if (payment.status !== "succeeded" || !payment.providerRef || !Number.isSafeInteger(payment.amountMinor) || payment.amountMinor <= 0 || !Number.isSafeInteger(payment.refundedMinor) || payment.refundedMinor < 0 || payment.refundedMinor > payment.amountMinor) reasons.add("original_principal");
  if (!observation || !observation.customerChargeVerified || observation.providerRef !== payment.providerRef || observation.amountMinor !== payment.amountMinor || observation.currency !== payment.currency
    || observation.platform !== route.platform || observation.chargeAccount !== route.chargeAccount) reasons.add("customer_charge");
  if (!observation || !observation.routeVerified || observation.recipient !== route.recipient || observation.settlementMerchant !== route.settlementMerchant) reasons.add("merchant_route");
  if (input.unknownCaller) reasons.add("unknown_caller");
  if (input.unappliedCash) reasons.add("unapplied_cash");
  if (input.refundDebt) reasons.add("refund");
  if (input.dispute) reasons.add("dispute");
  if (input.incomplete) reasons.add("inventory");
  return { principalSafe: reasons.size === 0, reasons: [...reasons], ancillarySettlementPending: observation?.settlementVerified !== true };
}
