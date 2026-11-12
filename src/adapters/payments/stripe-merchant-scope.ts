// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.26/C12.38: charge namespace and settlement recipient are distinct facts.
import { AdapterError } from "../types";
import { object, text } from "./http";
import type { MerchantChargeScope } from "./types";

function invalid(): never {
  throw new AdapterError("payments", "stripe", "invalid_request", "The original merchant charge accounts are inconsistent.");
}

export function validateMerchantChargeScope(scope: MerchantChargeScope): void {
  for (const account of [scope.providerAccountId, scope.providerPlatformAccountId, scope.destinationAccountId, scope.settlementMerchantAccountId]) {
    if (account !== undefined && (account.length > 200 || !/^acct_[A-Za-z0-9]+$/.test(account))) invalid();
  }
  if (scope.destinationAccountId) {
    // Destination objects belong to the platform. on_behalf_of changes the
    // settlement merchant, never the account used for reads/refunds/disputes.
    if (!scope.providerPlatformAccountId || scope.providerAccountId || scope.destinationAccountId === scope.providerPlatformAccountId
      || scope.settlementMerchantAccountId !== scope.destinationAccountId) invalid();
  } else if (scope.settlementMerchantAccountId) invalid();
  if (scope.providerAccountId && scope.providerAccountId === scope.providerPlatformAccountId) invalid();
}

export function merchantChargeScope(scope: MerchantChargeScope): MerchantChargeScope {
  return {
    ...(scope.providerAccountId ? { providerAccountId: scope.providerAccountId } : {}),
    ...(scope.providerPlatformAccountId ? { providerPlatformAccountId: scope.providerPlatformAccountId } : {}),
    ...(scope.destinationAccountId ? { destinationAccountId: scope.destinationAccountId } : {}),
    ...(scope.settlementMerchantAccountId ? { settlementMerchantAccountId: scope.settlementMerchantAccountId } : {}),
  };
}

export function applyDestinationCharge(form: URLSearchParams, nested: boolean, scope: MerchantChargeScope): void {
  validateMerchantChargeScope(scope);
  if (scope.destinationAccountId) {
    form.set(nested ? "payment_intent_data[transfer_data][destination]" : "transfer_data[destination]", scope.destinationAccountId);
    form.set(nested ? "payment_intent_data[on_behalf_of]" : "on_behalf_of", scope.settlementMerchantAccountId!);
  }
}

/** Successful collection must prove the immutable route on the actual intent. */
export function assertMerchantIntent(scope: MerchantChargeScope, intent: Record<string, unknown>): void {
  validateMerchantChargeScope(scope);
  if (!scope.providerPlatformAccountId) return; // Historical direct routes retain their existing evidence contract.
  if (!Object.hasOwn(intent, "transfer_data") || !Object.hasOwn(intent, "on_behalf_of")) {
    throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not return the original merchant route evidence.", true);
  }
  const destination = object(intent.transfer_data)?.destination;
  const actualDestination = typeof destination === "string" ? destination : text(object(destination)?.id);
  const transferAmount = object(intent.transfer_data)?.amount;
  const settlement = typeof intent.on_behalf_of === "string" ? intent.on_behalf_of : text(object(intent.on_behalf_of)?.id);
  if (actualDestination !== scope.destinationAccountId || settlement !== scope.settlementMerchantAccountId
    || (transferAmount !== undefined && transferAmount !== null && transferAmount !== intent.amount_received)) {
    throw new AdapterError("payments", "stripe", "provider_failure", "Stripe did not prove the original charge and settlement accounts.", true);
  }
}
