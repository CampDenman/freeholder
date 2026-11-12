// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner review includes unapplied physical money, never just settled balances.
import { createHash } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { defineService, ServiceError } from "@/core/service";
import { paymentRow } from "./contract";
import { merchantFeeObservations, merchantFeeRefunds, merchantPaymentObservations } from "./merchant-collection-schema";
import { paymentRouting, routingForPayment } from "./merchant-charge";
import { payments } from "./schema";

export function merchantPaymentWitness(payment: z.infer<typeof paymentRow>, routing: z.infer<typeof paymentRouting>): string {
  return createHash("sha256").update(JSON.stringify({ id: payment.id, invoiceId: payment.invoiceId, provider: payment.provider, method: payment.method,
    status: payment.status, amountMinor: payment.amountMinor, currency: payment.currency, refundedMinor: payment.refundedMinor,
    providerRef: payment.providerRef, providerCheckoutRef: payment.providerCheckoutRef, createdAt: payment.createdAt.toISOString(), routing: paymentRouting.parse(routing) })).digest("hex");
}
const amount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const observed = z.object({ id: z.uuid(), providerApiVersion: z.string().nullable(), providerRef: z.string(), status: z.enum(["pending", "succeeded", "failed"]), amountMinor: amount, currency: z.string(),
  providerPlatformAccountId: z.string(), chargeAccountId: z.string().nullable(), recipientAccountId: z.string().nullable(), settlementMerchantAccountId: z.string().nullable(),
  applicationFeeMinor: amount.nullable(), providerChargeRef: z.string().nullable(), applicationFeeRef: z.string().nullable(), transferRef: z.string().nullable(),
  applicationFeeCurrency: z.string().nullable(), observedApplicationFeeMinor: amount.nullable(), observedFeeRefundedMinor: amount.nullable(),
  customerChargeVerified: z.boolean(), routeVerified: z.boolean(), settlementVerified: z.boolean(), observedAt: z.date() });
const feeOperation = z.object({ id: z.uuid(), amountMinor: amount, currency: z.string(), status: z.string(), providerRef: z.string().nullable(),
  applicationFeeRef: z.string(), targetRetainedFeeMinor: amount, observedOriginalFeeMinor: amount, createdAt: z.date() });
const feeObserved = z.object({ id: z.uuid(), operationId: z.uuid(), providerRef: z.string(), applicationFeeRef: z.string(), amountMinor: amount, currency: z.string(), bindingVerified: z.boolean(), observedAt: z.date() });

export const merchantPaymentReview = defineService({
  name: "invoicing.merchantPaymentReview", summary: "Review expected original accounts, every retained positive charge and independent fee recovery for one merchant payment.",
  kind: "query", permission: "scoped", input: z.object({ paymentId: z.uuid(), offset: z.number().int().min(0).max(100000).default(0) }).strict(),
  output: z.object({ payment: paymentRow, routing: paymentRouting, witness: z.string().length(64), observations: z.array(observed), feeOperations: z.array(feeOperation), feeObservations: z.array(feeObserved), hasMore: z.boolean(), nextOffset: z.number().int().nullable() }).nullable(),
  handler: async ({ paymentId, offset }, ctx) => {
    const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, paymentId));
    if (!payment) throw new ServiceError("not_found", "That original payment is not here.");
    const routing = await routingForPayment(ctx, paymentId);
    if (!routing.providerPlatformAccountId) return null;
    const observations = await ctx.tx.select().from(merchantPaymentObservations).where(eq(merchantPaymentObservations.paymentId, paymentId)).orderBy(asc(merchantPaymentObservations.observedAt), asc(merchantPaymentObservations.id)).limit(201).offset(offset);
    const feeOperations = await ctx.tx.select().from(merchantFeeRefunds).where(eq(merchantFeeRefunds.paymentId, paymentId)).orderBy(asc(merchantFeeRefunds.createdAt), asc(merchantFeeRefunds.id)).limit(201).offset(offset);
    const feeObservations = await ctx.tx.select({ observation: merchantFeeObservations }).from(merchantFeeObservations).innerJoin(merchantFeeRefunds, eq(merchantFeeRefunds.id, merchantFeeObservations.operationId))
      .where(eq(merchantFeeRefunds.paymentId, paymentId)).orderBy(asc(merchantFeeObservations.observedAt), asc(merchantFeeObservations.id)).limit(201).offset(offset);
    const hasMore = observations.length > 200 || feeOperations.length > 200 || feeObservations.length > 200;
    return { payment, routing, witness: merchantPaymentWitness(payment, routing), observations: observations.slice(0, 200), feeOperations: feeOperations.slice(0, 200), feeObservations: feeObservations.slice(0, 200).map(row => row.observation), hasMore, nextOffset: hasMore ? offset + 200 : null };
  },
});

export default [merchantPaymentReview];
