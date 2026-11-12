// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Exact commission recovery never rolls back a successful customer refund.
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { paymentAdapter } from "@/adapters/payments";
import { AdapterError } from "@/adapters/types";
import { defineJob, enqueueJob } from "@/core/jobs";
import { actorString, defineOrchestratedService, defineService, ServiceError, type ServiceContext } from "@/core/service";
import { merchantFeeObservations, merchantFeeRefunds, merchantPaymentObservations } from "./merchant-collection-schema";
import { paymentRouting, routingForPayment } from "./merchant-charge";
import { remainingMerchantFeeRefund } from "./merchant-fee-amounts";
import { originalMerchantFeeTarget } from "./merchant-line-fee-target";
import { merchantObservationRef, recordMerchantPaymentObservation } from "./merchant-payment-observations";
import { paymentRow } from "./contract";
import { payments } from "./schema";

const reference = z.string().min(1).max(500);
const minor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const physicalFee = z.object({ providerRef: reference, applicationFeeRef: reference, amountMinor: minor, currency: z.string().regex(/^[A-Z]{3}$/), bindingVerified: z.boolean() });
const operation = z.object({ id: z.uuid(), paymentId: z.uuid(), applicationFeeRef: reference, providerChargeRef: reference, amountMinor: minor, currency: z.string(), idempotencyKey: reference, status: z.enum(["reserved", "dispatching", "accepted", "unknown", "refused"]) });
const claim = z.object({ state: z.enum(["satisfied", "pending", "ready", "review", "accepted"]), operation: operation.nullable(), routing: paymentRouting });

export const merchantFeeSource = defineService({
  name: "invoicing.merchantFeeSource", summary: "Read immutable original money and routing before commission inspection.",
  kind: "query", permission: "system", external: false, input: z.object({ paymentId: z.uuid() }), output: z.object({ payment: paymentRow, routing: paymentRouting }),
  handler: async ({ paymentId }, ctx) => {
    const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, paymentId));
    if (!payment) throw new ServiceError("not_found", "That original payment is not here.");
    const routing = await routingForPayment(ctx, paymentId);
    if (!routing.providerPlatformAccountId || payment.provider !== "stripe") throw new ServiceError("conflict", "This reconciliation requires an original versioned merchant charge.");
    return { payment, routing };
  },
});

export const claimMerchantFeeReconciliation = defineService({
  name: "invoicing.claimMerchantFeeReconciliation", summary: "Reserve the remaining exact commission refund against retained original provider evidence.",
  kind: "mutation", permission: "system", external: false, writeClass: "money",
  input: z.object({ paymentId: z.uuid(), initiatedBy: z.string().min(1).max(300) }), output: claim,
  handler: async ({ paymentId }, ctx) => {
    const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    if (!payment) throw new ServiceError("not_found", "That original payment is not here.");
    const routing = await routingForPayment(ctx, paymentId);
    if (!routing.providerPlatformAccountId || routing.applicationFeeMinor === undefined || payment.amountMinor <= 0) throw new ServiceError("conflict", "The original merchant commission needs review.");
    const operations = await ctx.tx.select().from(merchantFeeRefunds).where(eq(merchantFeeRefunds.paymentId, paymentId)).orderBy(desc(merchantFeeRefunds.createdAt));
    const pending = operations.find(row => ["reserved", "dispatching", "unknown"].includes(row.status));
    const targetRetainedFeeMinor = await originalMerchantFeeTarget(ctx, payment, routing);
    if (pending) {
      if (pending.status === "reserved" && (targetRetainedFeeMinor === null || pending.targetRetainedFeeMinor !== targetRetainedFeeMinor)) return { state: "review" as const, operation: null, routing };
      return { state: "pending" as const, operation: pending, routing };
    }
    if (targetRetainedFeeMinor === null) return { state: "review" as const, operation: null, routing };
    const [unapplied] = await ctx.tx.select({ id: merchantFeeObservations.id }).from(merchantFeeObservations)
      .innerJoin(merchantFeeRefunds, eq(merchantFeeRefunds.id, merchantFeeObservations.operationId))
      .where(and(eq(merchantFeeRefunds.paymentId, paymentId), sql`${merchantFeeRefunds.status} <> 'accepted'`)).limit(1);
    if (unapplied) return { state: "review" as const, operation: null, routing };
    const [proof] = await ctx.tx.select().from(merchantPaymentObservations).where(and(eq(merchantPaymentObservations.paymentId, paymentId), eq(merchantPaymentObservations.customerChargeVerified, true), eq(merchantPaymentObservations.routeVerified, true)))
      .orderBy(desc(merchantPaymentObservations.observedAt), desc(merchantPaymentObservations.id)).limit(1);
    if (!proof) return { state: "review" as const, operation: null, routing };
    if (!proof.applicationFeeRef && proof.applicationFeeMinor === 0 && routing.applicationFeeMinor === 0 && proof.settlementVerified) return { state: "satisfied" as const, operation: null, routing };
    if (!proof.providerChargeRef || !proof.applicationFeeRef || proof.observedApplicationFeeMinor === null || proof.applicationFeeCurrency !== payment.currency || proof.observedFeeRefundedMinor === null) return { state: "review" as const, operation: null, routing };
    const history = operations.filter(row => row.applicationFeeRef === proof.applicationFeeRef);
    const knownReturned = history.filter(row => row.status === "accepted").reduce((sum, row) => sum + BigInt(row.amountMinor), 0n);
    // A dashboard/manual refund is an actual fact, but it is not silently
    // adopted as our missing operation or ignored before another dispatch.
    if (knownReturned !== BigInt(proof.observedFeeRefundedMinor)) return { state: "review" as const, operation: null, routing };
    const next = remainingMerchantFeeRefund({ observedOriginalFeeMinor: proof.observedApplicationFeeMinor, targetRetainedFeeMinor, operations: history });
    if (next.state !== "ready") return { state: next.state === "pending" ? "pending" as const : "review" as const, operation: null, routing };
    if (next.amountMinor === 0) return { state: "satisfied" as const, operation: null, routing };
    const sourceKey = `merchant-fee:${paymentId}:${targetRetainedFeeMinor}`;
    const prior = operations.filter(row => row.sourceKey === sourceKey).sort((left, right) => right.attemptNumber - left.attemptNumber)[0];
    const attemptNumber = (prior?.attemptNumber ?? 0) + 1;
    const [saved] = await ctx.tx.insert(merchantFeeRefunds).values({ paymentId, providerPlatformAccountId: routing.providerPlatformAccountId, refundId: null, sourceKey, purpose: "commission_reconciliation", originalChargeReceiptId: routing.originalChargeReceiptId,
      applicationFeeRef: proof.applicationFeeRef, providerChargeRef: proof.providerChargeRef, observedOriginalFeeMinor: proof.observedApplicationFeeMinor, targetRetainedFeeMinor,
      amountMinor: next.amountMinor, currency: proof.applicationFeeCurrency, attemptNumber, idempotencyKey: `${sourceKey}:${attemptNumber}` }).returning();
    ctx.setSubject("payment", paymentId);
    return { state: "ready" as const, operation: saved!, routing };
  },
});

export const recordMerchantFeeObservation = defineService({
  name: "invoicing.recordMerchantFeeObservation", summary: "Retain the actual physical fee-refund acknowledgement before logical reconciliation.",
  kind: "mutation", permission: "system", external: false, writeClass: "money",
  input: z.object({ operationId: z.uuid(), observation: physicalFee }), output: z.object({ retained: z.literal(true) }),
  handler: async ({ operationId, observation }, ctx) => {
    const [original] = await ctx.tx.select().from(merchantFeeRefunds).where(eq(merchantFeeRefunds.id, operationId));
    if (!original) throw new ServiceError("conflict", "Retain the original commission operation before its physical acknowledgement.");
    const bindingVerified = observation.bindingVerified && observation.applicationFeeRef === original.applicationFeeRef && observation.amountMinor === original.amountMinor && observation.currency === original.currency;
    await ctx.tx.insert(merchantFeeObservations).values({ operationId, ...observation, bindingVerified }).onConflictDoNothing();
    ctx.setSubject("payment", original.paymentId);
    return { retained: true as const };
  },
});

export const applyMerchantFeeResult = defineService({
  name: "invoicing.applyMerchantFeeResult", summary: "Apply an original fee-operation state while retaining unknown outcomes and physical proof.",
  kind: "mutation", permission: "system", external: false, writeClass: "money",
  input: z.object({ operationId: z.uuid(), outcome: z.enum(["dispatching", "accepted", "unknown", "refused"]), providerRef: reference.optional() }), output: operation,
  handler: async ({ operationId, outcome, providerRef }, ctx) => {
    const [original] = await ctx.tx.select().from(merchantFeeRefunds).where(eq(merchantFeeRefunds.id, operationId)).for("update");
    if (!original) throw new ServiceError("not_found", "That original fee operation is not here.");
    if (original.status === "accepted" || original.status === "refused") return original;
    if (outcome === "dispatching" && original.status !== "reserved") throw new ServiceError("conflict", "Reconcile the original fee operation without dispatching it again.");
    if (outcome === "dispatching") {
      const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, original.paymentId));
      const target = payment ? await originalMerchantFeeTarget(ctx, payment, await routingForPayment(ctx, payment.id)) : null;
      if (target === null || target !== original.targetRetainedFeeMinor) throw new ServiceError("conflict", "The original line commission changed before dispatch. Keep this reservation for review without sending it.");
    }
    if (outcome === "accepted" && !providerRef) throw new ServiceError("conflict", "The actual original fee acknowledgement is required.");
    if (outcome === "refused" && original.status === "unknown") throw new ServiceError("conflict", "A missing fee lookup cannot release an unknown original operation.");
    const [saved] = await ctx.tx.update(merchantFeeRefunds).set({ status: outcome, ...(outcome === "dispatching" ? { dispatchedAt: new Date() } : {}), ...(outcome === "accepted" ? { providerRef, acceptedAt: new Date() } : {}), updatedAt: new Date() }).where(eq(merchantFeeRefunds.id, operationId)).returning();
    ctx.setSubject("payment", original.paymentId);
    return saved!;
  },
});

export const reconcileMerchantApplicationFee = defineOrchestratedService({
  name: "invoicing.reconcileMerchantApplicationFee", summary: "Verify and refund only remaining original commission, independently of customer payment and refund outcomes.",
  kind: "mutation", permission: "scoped", stepUp: true, writeClass: "money", input: z.object({ paymentId: z.uuid() }).strict(), output: claim,
  handler: async ({ paymentId }, caller) => {
    const system = { kind: "system", request: caller.request } as const;
    const source = await merchantFeeSource.call({ paymentId }, system);
    const adapter = paymentAdapter(source.payment.provider);
    if (!adapter.inspectMerchantPayment || !adapter.refundMerchantFee || !adapter.recoverMerchantFeeRefund || !source.payment.providerRef) throw new ServiceError("conflict", "The original provider cannot yet reconcile this fee.");
    const { routing } = source;
    const subscriptionOrigin = routing.originalChargeReceiptId ? { providerApiVersion: routing.providerApiVersion as "2026-10-28.endive", providerSubscriptionRef: routing.providerSubscriptionRef!, providerInvoiceRef: routing.providerInvoiceRef!, providerPaymentIntentRef: routing.providerPaymentIntentRef! } : undefined;
    await adapter.inspectMerchantPayment({ ...routing, providerPlatformAccountId: routing.providerPlatformAccountId!, providerRef: source.payment.providerRef,
      ...(subscriptionOrigin ? { subscriptionOrigin } : { paymentAttemptId: paymentId }),
      onPaymentObserved: async evidence => { await recordMerchantPaymentObservation.call({ paymentId, providerEventRef: merchantObservationRef(evidence), evidence }, system); } });
    const reserved = await claimMerchantFeeReconciliation.call({ paymentId, initiatedBy: actorString(caller) }, system);
    if (!reserved.operation) return reserved;
    const original = reserved.operation;
    const request = { ...reserved.routing, providerPlatformAccountId: reserved.routing.providerPlatformAccountId!, operationId: original.id,
      applicationFeeRef: original.applicationFeeRef, providerChargeRef: original.providerChargeRef, amountMinor: original.amountMinor, currency: original.currency, idempotencyKey: original.idempotencyKey,
      onFeeRefundObserved: async (observation: z.infer<typeof physicalFee>) => { await recordMerchantFeeObservation.call({ operationId: original.id, observation }, system); } };
    const dispatch = original.status === "reserved";
    if (dispatch) await applyMerchantFeeResult.call({ operationId: original.id, outcome: "dispatching" }, system);
    try {
      const actual = dispatch ? await adapter.refundMerchantFee(request) : await adapter.recoverMerchantFeeRefund(request);
      if (!actual) {
        const unknown = await applyMerchantFeeResult.call({ operationId: original.id, outcome: "unknown" }, system);
        return { ...reserved, state: "pending" as const, operation: unknown };
      }
      // The adapter callback has already committed physical evidence in its
      // own phase, so a later row transition cannot erase a positive ACK.
      const accepted = await applyMerchantFeeResult.call({ operationId: original.id, outcome: "accepted", providerRef: actual.providerRef }, system);
      return { ...reserved, state: "accepted" as const, operation: accepted };
    } catch (error) {
      const refused = dispatch && error instanceof AdapterError && !error.retryable && !["unavailable"].includes(error.code);
      await applyMerchantFeeResult.call({ operationId: original.id, outcome: refused ? "refused" : "unknown" }, system);
      throw error;
    }
  },
});

export const reconcileOriginalMerchantFeeJob = defineJob({
  name: "invoicing.reconcileOriginalMerchantFee", summary: "Recover the original merchant fee separately from a completed customer payment or refund.",
  concurrency: 1, leaseSeconds: 300, retry: { limit: 40, delaySeconds: 30, backoff: true, maxDelaySeconds: 3600 },
  handler: async data => {
    const { paymentId } = z.object({ paymentId: z.uuid() }).parse(data);
    const result = await reconcileMerchantApplicationFee.call({ paymentId }, { kind: "system" });
    if (result.state !== "satisfied") throw new Error(result.state === "review" ? "Original commission evidence needs owner review; the customer outcome remains recorded." : "Original commission reconciliation is pending its verified provider outcome.");
    return { reconciled: true };
  },
});

/** Enqueued in the customer-money TX; all provider I/O starts after commit. */
export async function queueMerchantFeeReconciliation(ctx: ServiceContext, paymentId: string): Promise<void> {
  const routing = await routingForPayment(ctx, paymentId);
  if (!routing.providerPlatformAccountId) return;
  const [payment] = await ctx.tx.select({ refundedMinor: payments.refundedMinor }).from(payments).where(eq(payments.id, paymentId));
  if (!payment) throw new ServiceError("conflict", "The original fee source payment is missing.");
  await enqueueJob(ctx.tx, reconcileOriginalMerchantFeeJob.name, { paymentId }, { idempotencyKey: `merchant-fee:${paymentId}:${payment.refundedMinor}`, startAfter: 5 });
}

export default [merchantFeeSource, claimMerchantFeeReconciliation, recordMerchantFeeObservation, applyMerchantFeeResult, reconcileMerchantApplicationFee];
