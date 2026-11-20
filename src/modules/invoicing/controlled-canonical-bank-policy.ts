// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: frozen per-receipt fee epochs and route ownership, no authority grant.
import { ServiceError } from "@/core/service";
import type { MerchantReturnedCashEvidence } from "./merchant-returned-cash-proof";
export function controlledCanonicalBankReview(expected: { amountMinor: number; currency: string; refundedMinor: number; applicationFeeMinor: number; retainedFeeMinor: number | null;
  collectionKind: "direct" | "destination"; recipientAccountId: string; chargeRef: string; originalFeeRef: string | null; originalTransferRef?: string | null }, bank: MerchantReturnedCashEvidence) {
  const fee = bank.fee, transfer = bank.transfer;
  // An unknown ancillary GET cannot erase authenticated original route proof.
  // A positively observed foreign recipient/source is a real contradiction.
  const routeMatches = !bank.transferFieldObserved || transfer === null || expected.collectionKind === "destination"
    && transfer.destinationAccountId === expected.recipientAccountId && transfer.sourceChargeRef === expected.chargeRef && transfer.currency === expected.currency
    && (!expected.originalTransferRef || transfer.providerRef === expected.originalTransferRef);
  const feeMatches = bank.feeFieldObserved && expected.retainedFeeMinor !== null && (expected.applicationFeeMinor === 0 ? fee === null && expected.originalFeeRef === null
    : fee !== null && fee.providerRef === expected.originalFeeRef && fee.originatingChargeRef === expected.chargeRef && fee.accountId === expected.recipientAccountId
      && fee.currency === expected.currency && fee.amountMinor === expected.applicationFeeMinor && fee.refundedMinor === expected.applicationFeeMinor - expected.retainedFeeMinor);
  const transferMatches = bank.transferFieldObserved && (expected.collectionKind === "direct" ? transfer === null
    : transfer !== null && routeMatches && transfer.amountMinor === expected.amountMinor && transfer.reversedMinor === expected.refundedMinor
      && transfer.reversed === (expected.refundedMinor === expected.amountMinor));
  return { routeMatches, ancillaryDebtPending: !feeMatches || !transferMatches };
}

export type ControlledPrincipalPhysicalEntry = { table: string; id: string; fingerprint: string };
export function controlledPrincipalPhysicalUnion(groups: readonly (readonly ControlledPrincipalPhysicalEntry[])[]) {
  const entries = new Map<string, ControlledPrincipalPhysicalEntry>();
  for (const group of groups) for (const row of group) {
    const key = `${row.table}:${row.id}`, prior = entries.get(key);
    if (prior && prior.fingerprint !== row.fingerprint) throw new ServiceError("conflict", "Retain the contradictory full PostgreSQL source row before proving current controlled principal.");
    entries.set(key, row); if (entries.size > 5000) throw new ServiceError("conflict", "Restore the complete current controlled principal namespace and parent under one 5000-row bound.");
  }
  return [...entries.values()].sort((a, b) => a.table.localeCompare(b.table) || a.id.localeCompare(b.id));
}

/** Read-surface selection only. This never proves money or principal. The
 * reserved key is a NECESSARY immutable real-birth property in BOTH signed
 * protocols, not an owner selected by prefix. Unknown/known controlled rows
 * must still take the complete actual FK/HMAC/current-bank reader. */
export function controlledCanonicalLegacyEmpty(input: { paymentMethod: string; paymentIdempotencyKey: string; receiptIds: readonly string[];
  controlledReceiptIds: readonly string[]; routes: readonly { originKind: "attempt" | "provider_schedule"; receiptId: string | null }[] }) {
  if (input.routes.length > 1 || input.paymentMethod === "provider_schedule" && input.routes.length !== 1 || new Set(input.receiptIds).size !== input.receiptIds.length || new Set(input.controlledReceiptIds).size !== input.controlledReceiptIds.length
    || input.controlledReceiptIds.some(id => !input.receiptIds.includes(id))) throw new ServiceError("conflict", "Restore the exact existing original receipt and immutable route before selecting the legacy bank read surface.");
  for (const route of input.routes) if ((route.originKind === "provider_schedule") !== (input.paymentMethod === "provider_schedule")
    || route.originKind === "attempt" && (route.receiptId !== null || !["hosted_checkout", "saved_method"].includes(input.paymentMethod)) || route.originKind === "provider_schedule" && (route.receiptId === null || !input.receiptIds.includes(route.receiptId)))
    throw new ServiceError("conflict", "Retain missing or foreign original schedule receipt ownership; it cannot become an empty legacy source.");
  return input.receiptIds.length === 0 && input.controlledReceiptIds.length === 0 && input.routes.every(row => row.receiptId === null)
    && input.paymentMethod !== "provider_schedule" && !input.paymentIdempotencyKey.startsWith("controlled-receipt:");
}
