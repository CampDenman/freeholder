// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: positive exact-resource evidence, never a clock or new identity.
import type { LegacyBankOriginal } from "./legacy-bank-read-contract";
export type LegacyBankStatus = "pending" | "requires_action" | "succeeded" | "failed" | "canceled" | null;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const statuses = new Set(["pending", "requires_action", "succeeded", "failed", "canceled"]);
export function legacyBankCurrentVerdict(input: {
  original: LegacyBankOriginal; allOriginalCallersFinished?: boolean; knownRefunds?: readonly { providerRef: string; amountMinor: number; currency: string }[]; authenticOriginal: boolean; preparedRevision: string; currentPriorRevision: string;
  wrapperReturned: boolean; exactCallerFinished: boolean; factCount: number;
  facts: readonly { sequence: number; kind: string; evidence: Record<string, unknown> }[];
}): { state: "review"; reason: string } | { state: "verified"; status: LegacyBankStatus; rawStatus: string | null; requiresReview: boolean; replacementEligible: boolean } {
  const review = (reason: string) => ({ state: "review" as const, reason });
  if (!input.authenticOriginal || !input.wrapperReturned || !input.exactCallerFinished) return review("original_caller_or_authority");
  if (input.allOriginalCallersFinished === false) return review("unfinished_original_cash_caller");
  if (input.preparedRevision !== input.currentPriorRevision) return review("stale_original_revision");
  if (!input.facts.length || input.facts.length !== input.factCount || input.facts.length > 5005
    || input.facts.some((fact, index) => fact.sequence !== index + 1)) return review("incomplete_actual_inventory");
  const exact = input.facts.filter(fact => fact.kind === "exact_refund"), primary = input.facts.filter(fact => fact.kind === "primary_cash");
  const snapshots = input.facts.filter(fact => fact.kind === "cash_inventory");
  if (exact.length !== 1 || primary.length !== 1 || !snapshots.length) return review("missing_actual_resource");
  const original = input.original, refund = exact[0]!.evidence, cash = object(snapshots.at(-1)!.evidence.actual), paid = object(primary[0]!.evidence.actual);
  const platform = refund.readProviderPlatformAccountId;
  if (typeof platform !== "string" || !/^acct_[A-Za-z0-9]+$/.test(platform)
    || input.facts.some(fact => fact.evidence.readProviderPlatformAccountId !== platform
      || fact.evidence.readProtocolVersion !== "2026-02-25.clover" || fact.evidence.chargeAccountId !== original.originalChargeAccountId
      || fact.evidence.originalCreateProtocolVersion !== null || fact.evidence.originalCreatePlatformAccountId !== null)) return review("contradictory_read_namespace");
  if (refund.requestedRefundRef !== original.originalRefundRef || refund.observedRefundRef !== original.originalRefundRef
    || refund.observedPaymentRef !== original.originalPaymentRef || refund.amountMinor !== original.amountMinor || refund.currency !== original.currency
    || refund.originalBindingVerified !== true) return review("unbound_original_refund");
  if (paid.providerPlatformAccountId !== platform || paid.providerApiVersion !== "2026-02-25.clover" || (paid.providerAccountId ?? null) !== original.originalChargeAccountId
    || cash.providerPlatformAccountId !== platform || cash.providerApiVersion !== "2026-02-25.clover" || cash.chargeAccountId !== original.originalChargeAccountId
    || paid.providerRef !== original.originalPaymentRef || paid.providerChargeRef !== cash.providerChargeRef || paid.status !== "succeeded" || paid.amountMinor !== original.originalCashAmountMinor || paid.currency !== original.currency
    || cash.paymentProviderRef !== original.originalPaymentRef || cash.amountMinor !== original.originalCashAmountMinor || cash.currency !== original.currency
    || cash.chargePaymentProviderRef !== original.originalPaymentRef || cash.chargeAmountMinor !== original.originalCashAmountMinor || cash.chargeCurrency !== original.currency
    || cash.paymentIntentStatus !== "succeeded" || cash.amountCapturableMinor !== 0 || cash.paid !== true || cash.captured !== true
    || typeof cash.providerChargeRef !== "string" || refund.observedChargeRef !== cash.providerChargeRef
    || cash.refundsComplete !== true || cash.disputesComplete !== true || cash.feeFieldObserved !== true || cash.transferFieldObserved !== true
    || !Array.isArray(cash.refunds) || !Array.isArray(cash.disputes)) return review("incomplete_original_cash");
  const resources = cash.refunds.map(object), own = resources.filter(row => row.providerRef === original.originalRefundRef);
  if (resources.length > 1000 || new Set(resources.map(row => row.providerRef)).size !== resources.length || own.length !== 1
    || own[0]!.paymentProviderRef !== original.originalPaymentRef || own[0]!.chargeRef !== cash.providerChargeRef
    || own[0]!.amountMinor !== original.amountMinor || own[0]!.currency !== original.currency) return review("unbound_cash_resource");
  const rawStatus = typeof refund.rawProviderStatus === "string" ? refund.rawProviderStatus : null;
  const status = rawStatus && statuses.has(rawStatus) ? rawStatus as Exclude<LegacyBankStatus, null> : null;
  if ((own[0]!.status ?? null) !== status) return review("contradictory_current_reads");
  // Pending/unknown resources may still reserve returned cash. Their value is
  // an upper bound, never evidence that money reached the customer. Failed or
  // canceled resources cannot explain positive returned cash in a complete list.
  if (resources.some(row => typeof row.providerRef !== "string" || row.paymentProviderRef !== original.originalPaymentRef
    || row.chargeRef !== cash.providerChargeRef || row.currency !== original.currency
    || !Number.isSafeInteger(row.amountMinor) || Number(row.amountMinor) <= 0)) return review("unbound_cash_inventory");
  const confirmed = resources.filter(row => row.status === "succeeded").reduce((sum, row) => sum + BigInt(Number(row.amountMinor)), 0n);
  const possible = resources.filter(row => row.status !== "failed" && row.status !== "canceled").reduce((sum, row) => sum + BigInt(Number(row.amountMinor)), 0n);
  if (!Number.isSafeInteger(cash.amountRefundedMinor) || Number(cash.amountRefundedMinor) < 0
    || Number(cash.amountRefundedMinor) > original.originalCashAmountMinor
    || BigInt(Number(cash.amountRefundedMinor)) < confirmed || BigInt(Number(cash.amountRefundedMinor)) > possible
    || status === "succeeded" && Number(cash.amountRefundedMinor) < original.amountMinor) return review("contradictory_original_cash_total");
  const known = [{ providerRef: original.originalRefundRef, amountMinor: original.amountMinor, currency: original.currency }, ...(input.knownRefunds ?? [])];
  const inventoryReview = resources.some(row => !known.some(bound => bound.providerRef === row.providerRef && bound.amountMinor === row.amountMinor && bound.currency === row.currency)
    || row.providerRef !== original.originalRefundRef && row.status !== "succeeded" && row.status !== "failed" && row.status !== "canceled")
    || cash.disputes.length > 0 || cash.fee !== null || cash.transfer !== null;
  return { state: "verified", status, rawStatus, requiresReview: status !== "succeeded" || inventoryReview,
    replacementEligible: (status === "failed" || status === "canceled") && !inventoryReview };
}
