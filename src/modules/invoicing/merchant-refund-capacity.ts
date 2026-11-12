// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: customer refund capacity follows original physical cash, not invoice cap.
export interface MerchantRefundReservation {
  id: string;
  amountMinor: number;
  dispatched: boolean;
  creatorsQuiesced: boolean;
  /** Derived only from original strong-binding terminal/provider-refusal proof. */
  terminalFailureVerified: boolean;
}
export interface MerchantRefundCashFact {
  requestId: string | null;
  providerRef: string;
  amountMinor: number;
  currency: string;
  status: "pending" | "succeeded" | "failed";
  bindingVerified: boolean;
}
export type MerchantRefundDebt = "contradictory_provider_fact" | "unassigned_refund" | "unverified_binding" | "unfinished_creator" | "unknown_refund" | "over_refunded";
export function merchantRefundCapacity(input: {
  originalCashMinor: number;
  currency: string;
  reservations: readonly MerchantRefundReservation[];
  observations: readonly MerchantRefundCashFact[];
}): { refundedMinor: number | null; reservedMinor: number | null; availableMinor: number | null; debt: MerchantRefundDebt[] } {
  const valid = (amount: number) => Number.isSafeInteger(amount) && amount > 0;
  if (!valid(input.originalCashMinor) || !/^[A-Z]{3}$/.test(input.currency)) throw new RangeError("Use the actual original provider money amount and currency.");
  if (new Set(input.reservations.map(row => row.id)).size !== input.reservations.length || input.reservations.some(row => !valid(row.amountMinor))) throw new RangeError("Use unique exact original refund reservations.");
  const debt = new Set<MerchantRefundDebt>(), requests = new Map(input.reservations.map(row => [row.id, row]));
  const byRef = new Map<string, MerchantRefundCashFact[]>();
  for (const fact of input.observations) {
    if (!fact.providerRef || !valid(fact.amountMinor) || !/^[A-Z]{3}$/.test(fact.currency)) throw new RangeError("Retain actual refund money without inventing an amount or currency.");
    const group = byRef.get(fact.providerRef) ?? []; group.push(fact); byRef.set(fact.providerRef, group);
  }
  let refunded = 0n, externalReserved = 0n;
  const observedSuccess = new Map<string, bigint>(), observedPending = new Map<string, bigint>();
  for (const group of byRef.values()) {
    const first = group[0]!;
    if (group.some(fact => fact.amountMinor !== first.amountMinor || fact.currency !== first.currency) || first.currency !== input.currency) {
      debt.add("contradictory_provider_fact");
      continue; // No guessed FX or choice of one contradictory monetary fact.
    }
    const associations = new Set(group.map(fact => fact.requestId).filter((id): id is string => id !== null));
    if (associations.size > 1) debt.add("contradictory_provider_fact");
    const positive = group.some(fact => fact.status === "succeeded"), pending = !positive && group.some(fact => fact.status === "pending");
    if (positive && group.some(fact => fact.status === "failed")) debt.add("contradictory_provider_fact");
    const associatedId = [...associations][0];
    const request = associatedId ? requests.get(associatedId) : undefined;
    if (!request && (positive || pending)) debt.add("unassigned_refund");
    if (request && !group.some(fact => fact.bindingVerified && fact.requestId === associatedId)) debt.add("unverified_binding");
    if (positive) {
      refunded += BigInt(first.amountMinor);
      if (request) observedSuccess.set(request.id, (observedSuccess.get(request.id) ?? 0n) + BigInt(first.amountMinor));
    } else if (pending) {
      if (request) observedPending.set(request.id, (observedPending.get(request.id) ?? 0n) + BigInt(first.amountMinor)); else externalReserved += BigInt(first.amountMinor);
    }
  }
  let reserved = externalReserved;
  for (const request of requests.values()) {
    const paid = observedSuccess.get(request.id) ?? 0n;
    if (request.dispatched && !request.creatorsQuiesced) debt.add("unfinished_creator");
    if (paid > BigInt(request.amountMinor)) debt.add("over_refunded");
    // One exact successful resource satisfies customer cash; a second actual
    // resource remains visible above, even if it exceeds the logical amount.
    if (paid >= BigInt(request.amountMinor) && !observedPending.has(request.id)) continue;
    if (request.terminalFailureVerified && request.creatorsQuiesced && paid === 0n && !observedPending.has(request.id)) continue;
    const outstanding = BigInt(request.amountMinor) > paid ? BigInt(request.amountMinor) - paid : 0n;
    const actualPending = observedPending.get(request.id) ?? 0n;
    reserved += actualPending > outstanding ? actualPending : outstanding;
    if (request.dispatched) debt.add("unknown_refund");
  }
  if (refunded + reserved > BigInt(input.originalCashMinor) || reserved < 0n) debt.add("over_refunded");
  if (debt.has("contradictory_provider_fact") || refunded > BigInt(Number.MAX_SAFE_INTEGER) || reserved > BigInt(Number.MAX_SAFE_INTEGER) || reserved < 0n) return { refundedMinor: null, reservedMinor: null, availableMinor: null, debt: [...debt] };
  return { refundedMinor: Number(refunded), reservedMinor: Number(reserved), availableMinor: debt.has("over_refunded") ? null : Number(BigInt(input.originalCashMinor) - refunded - reserved), debt: [...debt] };
}
