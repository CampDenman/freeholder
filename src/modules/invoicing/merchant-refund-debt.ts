// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: logical refund status never hides unfinished original evidence.
import { eq, sql } from "drizzle-orm";
import type { ServiceContext } from "@/core/service";
import { merchantRefundObservations, merchantRefundRequests } from "./merchant-refund-schema";
import { refunds } from "./schema";

export async function originalMerchantRefundDebt(ctx: ServiceContext, paymentId: string): Promise<boolean> {
  const requests = await ctx.tx.select({ id: merchantRefundRequests.id, purpose: merchantRefundRequests.purpose,
    status: refunds.status,
    resolved: sql<boolean>`case
      when ${refunds.status}='succeeded' then freeholder_original_refund_resolved(${merchantRefundRequests.id},'succeeded',${refunds.providerRef})
      when ${refunds.status}='failed' then freeholder_original_refund_resolved(${merchantRefundRequests.id},'failed')
      when ${refunds.status}='cancelled' then exists(select 1 from merchant_refund_reservation_retirements r where r.request_id=${merchantRefundRequests.id} and r.request_digest=${merchantRefundRequests.requestDigest})
        and not exists(select 1 from merchant_refund_dispatches d where d.request_id=${merchantRefundRequests.id})
      else false end` }).from(merchantRefundRequests)
    .leftJoin(refunds, eq(refunds.id, merchantRefundRequests.refundId)).where(eq(merchantRefundRequests.paymentId, paymentId)).limit(5001);
  const observations = await ctx.tx.select({ requestId: merchantRefundObservations.requestId, bindingVerified: merchantRefundObservations.bindingVerified })
    .from(merchantRefundObservations).where(eq(merchantRefundObservations.paymentId, paymentId)).limit(5001);
  if (requests.length > 5000 || observations.length > 5000) return true;
  const ids = new Set(requests.map(row => row.id));
  if (observations.some(row => !row.bindingVerified || !row.requestId || !ids.has(row.requestId))) return true;
  // Receipt-owned unapplied returns use their own canonical disposition.
  // Until that full payment-side disposition is integrated, keep the debt
  // visible rather than treating a missing logical refund as completion.
  return requests.some(row => row.purpose !== "invoice_refund" || row.resolved !== true);
}
