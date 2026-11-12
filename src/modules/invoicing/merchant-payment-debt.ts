// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: lifecycle jobs read durable debt; no provider I/O or attestation.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { defineService, ServiceError } from "@/core/service";
import { routingForPayment } from "./merchant-charge";
import { merchantFeeObservations, merchantFeeRefunds, merchantPaymentObservations } from "./merchant-collection-schema";
import { assertNoUnappliedMerchantCharge } from "./merchant-payment-observations";
import { assertMerchantPaymentTerminal } from "./merchant-payment-request";
import { paymentDisputes, payments, refunds } from "./schema";

const reason = z.enum(["original_scope", "unknown_payment", "unapplied_money", "provider_settlement", "commission", "refund", "dispute"]);
export const merchantPaymentRecoveryDebt = defineService({
  name: "invoicing.merchantPaymentRecoveryDebt", summary: "Report remaining recorded original customer, settlement, commission and recovery debt before a lifecycle can claim completion.",
  kind: "query", permission: "system", external: false, input: z.object({ paymentId: z.uuid() }), output: z.object({ pending: z.boolean(), reasons: z.array(reason) }),
  handler: async ({ paymentId }, ctx) => {
    const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, paymentId));
    if (!payment) return { pending: true, reasons: ["original_scope" as const] };
    const routing = await routingForPayment(ctx, paymentId), reasons = new Set<z.infer<typeof reason>>();
    if (!routing.providerPlatformAccountId || routing.applicationFeeMinor === undefined || !Number.isSafeInteger(payment.amountMinor) || payment.amountMinor <= 0
      || !Number.isSafeInteger(payment.refundedMinor) || payment.refundedMinor < 0 || payment.refundedMinor > payment.amountMinor
      || !Number.isSafeInteger(routing.applicationFeeMinor) || routing.applicationFeeMinor < 0 || routing.applicationFeeMinor > payment.amountMinor) return { pending: true, reasons: ["original_scope" as const] };
    try { await assertNoUnappliedMerchantCharge(ctx, payment.invoiceId); }
    catch (error) { if (error instanceof ServiceError && error.code === "conflict") reasons.add("unapplied_money"); else throw error; }
    if (["created", "processing"].includes(payment.status)) reasons.add("unknown_payment");
    if (["failed", "cancelled"].includes(payment.status)) {
      try { await assertMerchantPaymentTerminal(ctx, paymentId); }
      catch (error) { if (error instanceof ServiceError && error.code === "conflict") reasons.add("unknown_payment"); else throw error; }
    }
    const [refundState] = await ctx.tx.select({ returned: sql<string>`coalesce(sum(${refunds.amountMinor}) filter(where ${refunds.status}='succeeded'),0)::text`,
      pending: sql<boolean>`coalesce(bool_or(${refunds.status} in ('created','processing') or (${refunds.status}='failed' and ${refunds.failureCode}='provider_already_refunded')),false)` })
      .from(refunds).where(eq(refunds.paymentId, paymentId));
    if (refundState?.pending || BigInt(refundState?.returned ?? "0") !== BigInt(payment.refundedMinor)) reasons.add("refund");
    const unresolvedDispute = await ctx.tx.select({ id: paymentDisputes.id }).from(paymentDisputes).where(and(eq(paymentDisputes.paymentId, paymentId), inArray(paymentDisputes.status, ["open", "lost"]))).limit(1);
    if (unresolvedDispute.length) reasons.add("dispute");
    const [feeState] = await ctx.tx.select({ returned: sql<string>`coalesce(sum(${merchantFeeRefunds.amountMinor}) filter(where ${merchantFeeRefunds.status}='accepted'),0)::text`,
      pending: sql<boolean>`coalesce(bool_or(${merchantFeeRefunds.status} in ('reserved','dispatching','unknown')),false)`,
      unmatched: sql<boolean>`coalesce(bool_or(${merchantFeeRefunds.status}='accepted' and not exists(select 1 from merchant_fee_observations a where a.operation_id=${merchantFeeRefunds.id} and a.binding_verified and a.provider_ref=${merchantFeeRefunds.providerRef} and a.amount_minor=${merchantFeeRefunds.amountMinor} and a.currency=${merchantFeeRefunds.currency} and a.application_fee_ref=${merchantFeeRefunds.applicationFeeRef})),false)` })
      .from(merchantFeeRefunds).where(eq(merchantFeeRefunds.paymentId, paymentId));
    const unattachedFeeAck = await ctx.tx.select({ id: merchantFeeObservations.id }).from(merchantFeeObservations).innerJoin(merchantFeeRefunds, eq(merchantFeeRefunds.id, merchantFeeObservations.operationId))
      .where(and(eq(merchantFeeRefunds.paymentId, paymentId), sql`${merchantFeeRefunds.status}<>'accepted'`)).limit(1);
    if (feeState?.pending || feeState?.unmatched || unattachedFeeAck.length) reasons.add("commission");
    if (payment.status === "succeeded") {
      const [proof] = await ctx.tx.select().from(merchantPaymentObservations).where(and(eq(merchantPaymentObservations.paymentId, paymentId), eq(merchantPaymentObservations.providerRef, payment.providerRef ?? ""), eq(merchantPaymentObservations.status, "succeeded")))
        .orderBy(desc(merchantPaymentObservations.observedAt), desc(merchantPaymentObservations.id)).limit(1);
      if (!proof || !proof.customerChargeVerified || proof.amountMinor !== payment.amountMinor || proof.currency !== payment.currency
        || proof.providerPlatformAccountId !== routing.providerPlatformAccountId || proof.chargeAccountId !== (routing.providerAccountId ?? null)) reasons.add("unapplied_money");
      if (!proof?.routeVerified || !proof.settlementVerified) reasons.add("provider_settlement");
      const returned = BigInt(feeState?.returned ?? "0");
      const mismatchedOriginalFee = await ctx.tx.select({ id: merchantFeeRefunds.id }).from(merchantFeeRefunds).where(and(eq(merchantFeeRefunds.paymentId, paymentId), eq(merchantFeeRefunds.status, "accepted"), sql`${merchantFeeRefunds.applicationFeeRef} is distinct from ${proof?.applicationFeeRef ?? null}`)).limit(1);
      if (mismatchedOriginalFee.length) reasons.add("commission");
      const target = BigInt(routing.applicationFeeMinor) * BigInt(payment.amountMinor - payment.refundedMinor) / BigInt(payment.amountMinor);
      const zeroFee = proof?.settlementVerified && proof.applicationFeeMinor === 0 && routing.applicationFeeMinor === 0 && !proof.applicationFeeRef && returned === 0n;
      if (!zeroFee && (!proof?.applicationFeeRef || proof.observedApplicationFeeMinor === null || proof.observedFeeRefundedMinor === null || !Number.isSafeInteger(proof.observedApplicationFeeMinor) || !Number.isSafeInteger(proof.observedFeeRefundedMinor) || proof.applicationFeeCurrency !== payment.currency
        || BigInt(proof.observedFeeRefundedMinor) !== returned || BigInt(proof.observedApplicationFeeMinor) - returned !== target)) reasons.add("commission");
      // Destination refund/debit closure needs an actual reversal witness.
      // The current capture-only proof deliberately refuses to infer it.
      if (routing.destinationAccountId && payment.refundedMinor > 0) reasons.add("refund");
    }
    return { pending: reasons.size > 0, reasons: [...reasons] };
  },
});
export default [merchantPaymentRecoveryDebt];
