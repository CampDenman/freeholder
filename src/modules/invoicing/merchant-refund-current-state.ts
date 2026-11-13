// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: only a complete SQL-verified original read supersedes bank history.
import { sql } from "drizzle-orm";
import { ServiceError, type ServiceContext } from "@/core/service";
import type { MerchantRefundVerifiedCurrentState } from "./merchant-refund-capacity";
import type { merchantRefundObservations } from "./merchant-refund-schema";

export interface MerchantRefundCurrentBinding extends MerchantRefundVerifiedCurrentState {
  receiptId: string; observationId: string; providerPlatformAccountId: string; chargeAccountId: string | null;
  providerApiVersion: string; originalPaymentRef: string; amountMinor: number; currency: string;
}
export async function originalMerchantRefundCurrentStates(ctx: ServiceContext, requestIds: readonly string[]): Promise<{
  states: MerchantRefundCurrentBinding[]; unresolvedRequestIds: string[];
}> {
  const ids = [...new Set(requestIds)];
  if (ids.length > 5000) throw new ServiceError("conflict", "Restore the complete original refund current-state inventory.");
  if (!ids.length) return { states: [], unresolvedRequestIds: [] };
  const rows = await ctx.tx.execute<{ request_id: string; receipt_id: string | null; observation_id: string | null;
    status: MerchantRefundVerifiedCurrentState["status"]; provider_ref: string | null; provider_platform_account_id: string;
    charge_account_id: string | null; provider_api_version: string; original_payment_ref: string; amount_minor: string; currency: string }>(sql`
    select r.id as request_id,s.receipt_id,s.observation_id,s.status,o.provider_ref,r.provider_platform_account_id,
      r.charge_account_id,r.provider_api_version,r.original_payment_ref,r.amount_minor::text,r.currency
    from merchant_refund_requests r cross join lateral freeholder_refund_current_state(r.id) s
    left join merchant_refund_observations o on o.id=s.observation_id
    where r.id in (${sql.join(ids.map(id => sql`${id}::uuid`), sql`,`)})
      and exists(select 1 from merchant_refund_current_receipts c where c.request_id=r.id)
    limit 5001`);
  if (rows.length > 5000) throw new ServiceError("conflict", "Restore the complete current-state receipt set before computing refundable cash.");
  const states: MerchantRefundCurrentBinding[] = [], unresolvedRequestIds: string[] = [];
  for (const row of rows) {
    if (!row.receipt_id || !row.observation_id || !row.provider_ref) { unresolvedRequestIds.push(row.request_id); continue; }
    const amountMinor = Number(row.amount_minor);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new ServiceError("conflict", "Restore the original current-state amount without rounding its money.");
    states.push({ requestId: row.request_id, receiptId: row.receipt_id, observationId: row.observation_id, providerRef: row.provider_ref,
      status: row.status, providerPlatformAccountId: row.provider_platform_account_id, chargeAccountId: row.charge_account_id,
      providerApiVersion: row.provider_api_version, originalPaymentRef: row.original_payment_ref, amountMinor, currency: row.currency });
  }
  return { states, unresolvedRequestIds };
}

/** A nullable old linkage/protocol may be resolved by the exact current resource
 * ACK/GET, not by equal invoice totals. Foreign scope or money remains debt.
 */
export function refundObservationHasCurrentBinding(observation: typeof merchantRefundObservations.$inferSelect, state: MerchantRefundCurrentBinding): boolean {
  return observation.providerRef === state.providerRef && observation.providerPlatformAccountId === state.providerPlatformAccountId
    && observation.chargeAccountId === state.chargeAccountId && (observation.paymentProviderRef === null || observation.paymentProviderRef === state.originalPaymentRef)
    && observation.amountMinor === state.amountMinor && observation.currency === state.currency
    && (observation.requestId === null || observation.requestId === state.requestId
      // Older inventory readers copied a claimed source into this FK even
      // when unverified. The unique current ACK/read can resolve that claim
      // in a derived view; the original row/FK is never rewritten.
      || !observation.bindingVerified && observation.claimedRequestId === observation.requestId);
}
