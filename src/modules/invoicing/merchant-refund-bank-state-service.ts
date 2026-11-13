// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: shared original bank-state read without importing I/O controllers.
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { merchantRefundRequests } from "./merchant-refund-schema";
import { refunds } from "./schema";
const providerStatus = z.enum(["pending", "requires_action", "succeeded", "failed", "canceled"]).nullable();

export const merchantRefundBankState = defineService({
  name: "invoicing.merchantRefundBankState", summary: "Read original refund cash projection and current-state proof for its own commercial source.",
  kind: "query", permission: "system", external: false, input: z.object({ refundId: z.uuid() }),
  output: z.object({ refundId: z.uuid(), invoiceId: z.uuid(), paymentId: z.uuid(), amountMinor: z.number().int().positive(), currency: z.string(),
    original: z.boolean(), verified: z.boolean(), resolvedSuccess: z.boolean(), retiredBeforeDispatch: z.boolean(), status: providerStatus, receiptId: z.uuid().nullable(), projectionStatus: z.enum(["created", "processing", "succeeded", "failed", "cancelled"]) }),
  handler: async ({ refundId }, ctx) => {
    const [refund] = await ctx.tx.select().from(refunds).where(eq(refunds.id, refundId));
    if (!refund) throw new ServiceError("not_found", "That original refund is not here.");
    const requests = await ctx.tx.select({ id: merchantRefundRequests.id }).from(merchantRefundRequests).where(eq(merchantRefundRequests.refundId, refundId)).limit(2);
    if (requests.length > 1) throw new ServiceError("conflict", "Restore this refund's one immutable original request.");
    const [state] = requests[0] ? await ctx.tx.execute<{ receipt_id: string | null; status: z.infer<typeof providerStatus> }>(sql`select receipt_id,status from freeholder_refund_current_state(${requests[0].id}::uuid)`) : [];
    const [success] = requests[0] && refund.providerRef ? await ctx.tx.execute<{ resolved: boolean }>(sql`select freeholder_original_refund_resolved(${requests[0].id}::uuid,'succeeded',${refund.providerRef}) as resolved`) : [];
    const [retired] = requests[0] ? await ctx.tx.execute<{ retired: boolean }>(sql`select exists(
      select 1 from merchant_refund_reservation_retirements t join merchant_refund_requests r on r.id=t.request_id
      where r.id=${requests[0].id}::uuid and t.request_digest=r.request_digest
        and not exists(select 1 from merchant_refund_dispatches d where d.request_id=r.id)) as retired`) : [];
    return { refundId, invoiceId: refund.invoiceId, paymentId: refund.paymentId, amountMinor: refund.amountMinor, currency: refund.currency,
      original: requests.length === 1, verified: Boolean(state?.receipt_id), resolvedSuccess: success?.resolved === true, retiredBeforeDispatch: retired?.retired === true,
      status: state?.status ?? null, receiptId: state?.receipt_id ?? null, projectionStatus: refund.status };
  },
});

export const publicRefundState = z.object({
  id: z.uuid(), amountMinor: z.number().int().positive(), currency: z.string(),
  status: z.enum(["pending", "requires_action", "succeeded", "failed", "canceled", "unknown"]),
  verified: z.boolean(), refundPromiseOpen: z.boolean(),
});

/** The parent service proves invoice access first. This projection deliberately
 * omits provider references, customer/bank details and private caller proofs. */
export async function invoiceRefundStateRows(ctx: ServiceContext, invoiceId: string) {
  const rows = await ctx.tx.select({ id: refunds.id, status: refunds.status }).from(refunds)
    .where(eq(refunds.invoiceId, invoiceId)).orderBy(asc(refunds.createdAt), asc(refunds.id)).limit(5001);
  if (rows.length > 5000) throw new ServiceError("conflict", "Restore this invoice's complete refund history before displaying its bank status.");
  const result: Array<z.infer<typeof publicRefundState> & { requestId: string | null }> = [];
  for (const refund of rows) {
    const actual = await ctx.callAsSystem(merchantRefundBankState, { refundId: refund.id });
    const [request] = await ctx.tx.select({ id: merchantRefundRequests.id }).from(merchantRefundRequests).where(eq(merchantRefundRequests.refundId, refund.id));
    const verified = actual.resolvedSuccess || actual.verified;
    const status = actual.original ? actual.retiredBeforeDispatch ? "canceled" as const : actual.resolvedSuccess ? "succeeded" as const : actual.verified ? actual.status ?? "unknown" : "unknown"
      : refund.status === "succeeded" ? "succeeded" as const : refund.status === "failed" ? "failed" as const : refund.status === "cancelled" ? "canceled" as const : "pending" as const;
    result.push({ id: refund.id, amountMinor: actual.amountMinor, currency: actual.currency, status,
      verified: actual.original ? verified : false, refundPromiseOpen: actual.original ? !actual.resolvedSuccess && !actual.retiredBeforeDispatch : !["succeeded", "cancelled"].includes(refund.status), requestId: actual.retiredBeforeDispatch ? null : request?.id ?? null });
  }
  return result;
}

export const invoiceRefundStates = defineService({
  name: "invoicing.invoiceRefundStates", summary: "Read an invoice's refund promises and verified bank states without altering original payments or credits.",
  kind: "query", permission: "scoped", input: z.object({ invoiceId: z.uuid() }),
  output: z.array(publicRefundState.extend({ requestId: z.uuid().nullable() })),
  handler: async ({ invoiceId }, ctx) => invoiceRefundStateRows(ctx, invoiceId),
});

export default [merchantRefundBankState, invoiceRefundStates];
