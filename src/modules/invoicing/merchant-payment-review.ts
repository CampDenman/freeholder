// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner review includes unapplied physical money, never just settled balances.
import { createHash } from "node:crypto";
import { and, asc, eq, isNotNull, or } from "drizzle-orm";
import { z } from "zod";
import { defineService, ServiceError } from "@/core/service";
import { paymentRow } from "./contract";
import { merchantFeeObservations, merchantFeeRefunds, merchantPaymentObservations, merchantPaymentRoutes } from "./merchant-collection-schema";
import { merchantInvoicePaymentRoutes } from "./merchant-invoice-scope-schema";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import { paymentRouting, routingForPayment } from "./merchant-charge";
import { payments } from "./schema";
import { merchantPaymentRequests, merchantPaymentDispatches, merchantPaymentDispatchFinishes, merchantPaymentDispatchStops, merchantPaymentResourceBindings, merchantPaymentCreationRefusals, merchantPaymentRetirementAcks, merchantPaymentTerminalReceipts } from "./merchant-payment-recovery-schema";
import { merchantCallerLiveness } from "./merchant-physical-caller";

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
const caller = z.object({ id: z.uuid(), pid: z.number().int().positive(), host: z.string(), startedAt: z.string(), bootId: z.string().nullable(), pidNamespace: z.string().nullable(), startTicks: z.string().nullable() });
const dispatch = z.object({ id: z.uuid(), ordinal: z.number().int().positive(), requestDigest: z.string(), dispatchedAt: z.date(), refusalCode: z.string().nullable(),
  caller, finishedAt: z.date().nullable(), stopReviewedAt: z.date().nullable(), liveness: z.enum(["live", "absent", "unobservable"]) });
const resourceBinding = z.object({ id: z.uuid(), dispatchId: z.uuid(), resourceRef: z.string(), resourceKind: z.enum(["checkout", "intent"]), origin: z.enum(["physical_ack", "human_request_review"]), observedAt: z.date() });
const retirementAck = z.object({ id: z.uuid(), checkoutRef: z.string().nullable(), paymentRef: z.string().nullable(), kind: z.enum(["session_expired", "intent_canceled"]), observedAt: z.date() });
const terminalReceipt = z.object({ checkoutRef: z.string().nullable(), paymentRef: z.string().nullable(), sessionStatus: z.enum(["expired", "complete"]).nullable(), intentStatus: z.string().nullable(), amountReceivedMinor: z.literal(0), observedAt: z.date() });

export const merchantPaymentReview = defineService({
  name: "invoicing.merchantPaymentReview", summary: "Review expected original accounts, every retained positive charge and independent fee recovery for one merchant payment.",
  kind: "query", permission: "scoped", input: z.object({ paymentId: z.uuid(), offset: z.number().int().min(0).max(100000).default(0) }).strict(),
  output: z.object({ payment: paymentRow, routing: paymentRouting, witness: z.string().length(64), observations: z.array(observed), feeOperations: z.array(feeOperation), feeObservations: z.array(feeObserved),
    originalRequest: z.object({ providerInvoiceRef: z.uuid(), providerContactRef: z.uuid(), requestDigest: z.string() }).nullable(), dispatches: z.array(dispatch), resourceBindings: z.array(resourceBinding), retirementAcks: z.array(retirementAck), terminalReceipt: terminalReceipt.nullable(),
    hasMore: z.boolean(), nextOffset: z.number().int().nullable() }).nullable(),
  handler: async ({ paymentId, offset }, ctx) => {
    const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, paymentId));
    if (!payment) throw new ServiceError("not_found", "That original payment is not here.");
    const routing = await routingForPayment(ctx, paymentId);
    if (!routing.providerPlatformAccountId) return null;
    const observations = await ctx.tx.select().from(merchantPaymentObservations).where(eq(merchantPaymentObservations.paymentId, paymentId)).orderBy(asc(merchantPaymentObservations.observedAt), asc(merchantPaymentObservations.id)).limit(201).offset(offset);
    const feeOperations = await ctx.tx.select().from(merchantFeeRefunds).where(eq(merchantFeeRefunds.paymentId, paymentId)).orderBy(asc(merchantFeeRefunds.createdAt), asc(merchantFeeRefunds.id)).limit(201).offset(offset);
    const feeObservations = await ctx.tx.select({ observation: merchantFeeObservations }).from(merchantFeeObservations).innerJoin(merchantFeeRefunds, eq(merchantFeeRefunds.id, merchantFeeObservations.operationId))
      .where(eq(merchantFeeRefunds.paymentId, paymentId)).orderBy(asc(merchantFeeObservations.observedAt), asc(merchantFeeObservations.id)).limit(201).offset(offset);
    const [request] = await ctx.tx.select().from(merchantPaymentRequests).where(eq(merchantPaymentRequests.paymentId, paymentId));
    const physical = await ctx.tx.select({ id: merchantPaymentDispatches.id, ordinal: merchantPaymentDispatches.ordinal, requestDigest: merchantPaymentDispatches.requestDigest, dispatchedAt: merchantPaymentDispatches.dispatchedAt, refusalCode: merchantPaymentCreationRefusals.providerCode,
      caller: merchantPaymentDispatches.caller, finishedAt: merchantPaymentDispatchFinishes.finishedAt, stopReviewedAt: merchantPaymentDispatchStops.reviewedAt })
      .from(merchantPaymentDispatches).leftJoin(merchantPaymentCreationRefusals, eq(merchantPaymentCreationRefusals.dispatchId, merchantPaymentDispatches.id))
      .leftJoin(merchantPaymentDispatchFinishes, eq(merchantPaymentDispatchFinishes.dispatchId, merchantPaymentDispatches.id)).leftJoin(merchantPaymentDispatchStops, eq(merchantPaymentDispatchStops.dispatchId, merchantPaymentDispatches.id))
      .where(eq(merchantPaymentDispatches.paymentId, paymentId)).orderBy(asc(merchantPaymentDispatches.ordinal)).limit(201).offset(offset);
    const dispatches = physical.map(value => ({ ...value, liveness: merchantCallerLiveness(value.caller) }));
    const resourceBindings = await ctx.tx.select({ id: merchantPaymentResourceBindings.id, dispatchId: merchantPaymentResourceBindings.dispatchId, resourceRef: merchantPaymentResourceBindings.resourceRef,
      resourceKind: merchantPaymentResourceBindings.resourceKind, origin: merchantPaymentResourceBindings.origin, observedAt: merchantPaymentResourceBindings.observedAt }).from(merchantPaymentResourceBindings)
      .where(eq(merchantPaymentResourceBindings.paymentId, paymentId)).orderBy(asc(merchantPaymentResourceBindings.observedAt), asc(merchantPaymentResourceBindings.id)).limit(201).offset(offset);
    const retirementAcks = await ctx.tx.select().from(merchantPaymentRetirementAcks).where(eq(merchantPaymentRetirementAcks.paymentId, paymentId)).orderBy(asc(merchantPaymentRetirementAcks.observedAt), asc(merchantPaymentRetirementAcks.id)).limit(201).offset(offset);
    const [terminal] = await ctx.tx.select().from(merchantPaymentTerminalReceipts).where(eq(merchantPaymentTerminalReceipts.paymentId, paymentId));
    const hasMore = observations.length > 200 || feeOperations.length > 200 || feeObservations.length > 200 || dispatches.length > 200 || resourceBindings.length > 200 || retirementAcks.length > 200;
    return { payment, routing, witness: merchantPaymentWitness(payment, routing), observations: observations.slice(0, 200), feeOperations: feeOperations.slice(0, 200), feeObservations: feeObservations.slice(0, 200).map(row => row.observation),
      originalRequest: request ?? null, dispatches: dispatches.slice(0, 200), resourceBindings: resourceBindings.slice(0, 200), retirementAcks: retirementAcks.slice(0, 200), terminalReceipt: terminal ? terminalReceipt.parse(terminal) : null, hasMore, nextOffset: hasMore ? offset + 200 : null };
  },
});

export const listInvoiceMerchantPayments = defineService({
  name: "invoicing.invoiceMerchantPayments", summary: "List the actual original merchant payment routes attached to one invoice for owner reconciliation.",
  kind: "query", permission: "scoped", input: z.object({ invoiceId: z.uuid() }), output: z.array(z.uuid()),
  handler: async ({ invoiceId }, ctx) => {
    const rows = await ctx.tx.select({ id: payments.id }).from(payments)
      .leftJoin(merchantPaymentRoutes, eq(merchantPaymentRoutes.paymentId, payments.id))
      .leftJoin(merchantInvoicePaymentRoutes, eq(merchantInvoicePaymentRoutes.paymentId, payments.id))
      .leftJoin(merchantAgreementPaymentRoutes, eq(merchantAgreementPaymentRoutes.paymentId, payments.id))
      .where(and(eq(payments.invoiceId, invoiceId), or(isNotNull(merchantPaymentRoutes.paymentId), isNotNull(merchantInvoicePaymentRoutes.paymentId), isNotNull(merchantAgreementPaymentRoutes.paymentId))))
      .orderBy(asc(payments.createdAt), asc(payments.id));
    return rows.map(row => row.id);
  },
});
export default [merchantPaymentReview, listInvoiceMerchantPayments];
