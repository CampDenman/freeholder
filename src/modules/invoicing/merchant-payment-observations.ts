// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.26/C12.38: commit physical charge facts before balance reconciliation.
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { invoiceMerchantCollections, merchantPaymentObservations, merchantPaymentRoutes } from "./merchant-collection-schema";
import { payments } from "./schema";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";

const account = z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200);
const reference = z.string().min(1).max(500);
export const merchantPaymentEvidence = z.object({
  providerAccountId: account.optional(), providerPlatformAccountId: account.optional(),
  destinationAccountId: account.optional(), settlementMerchantAccountId: account.optional(),
  providerRef: reference, status: z.enum(["pending", "succeeded", "failed"]),
  amountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  occurredAt: z.string().datetime().optional(), applicationFeeMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  providerChargeRef: reference.optional(), applicationFeeRef: reference.optional(), transferRef: reference.optional(),
  merchantRouteVerified: z.boolean().optional(),
  customerChargeVerified: z.boolean().optional(),
  applicationFeeCurrency: z.string().regex(/^[A-Z]{3}$/).optional(), observedApplicationFeeMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  merchantSettlementVerified: z.boolean().optional(), observedFeeRefundedMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
});

export function merchantObservationRef(evidence: z.infer<typeof merchantPaymentEvidence>): string {
  return `provider-read:${createHash("sha256").update(JSON.stringify(merchantPaymentEvidence.parse(evidence))).digest("hex")}`;
}

export async function assertNoUnappliedMerchantCharge(ctx: ServiceContext, invoiceId: string): Promise<void> {
  const [debt] = await ctx.tx.select({ id: merchantPaymentObservations.id }).from(merchantPaymentObservations)
    .innerJoin(payments, eq(payments.id, merchantPaymentObservations.paymentId)).where(and(eq(payments.invoiceId, invoiceId), eq(merchantPaymentObservations.status, "succeeded"), sql`(${payments.status} <> 'succeeded' or ${merchantPaymentObservations.amountMinor} <> ${payments.amountMinor} or ${merchantPaymentObservations.currency} <> ${payments.currency} or (${merchantPaymentObservations.providerRef} is distinct from ${payments.providerRef} and ${merchantPaymentObservations.providerRef} is distinct from ${payments.providerCheckoutRef}))`)).limit(1);
  if (debt) throw new ServiceError("conflict", "Reconcile the recorded positive provider charge before creating another payment attempt.");
}

export const recordMerchantPaymentObservation = defineService({
  name: "invoicing.recordMerchantPaymentObservation", summary: "Retain an authenticated original payment observation independently of settlement-policy agreement.",
  kind: "mutation", permission: "system", external: false, writeClass: "money",
  input: z.object({ paymentId: z.uuid(), providerEventRef: reference, evidence: merchantPaymentEvidence }),
  output: z.object({ recorded: z.boolean(), routeVerified: z.boolean() }),
  handler: async ({ paymentId, providerEventRef, evidence }, ctx) => {
    const [orderSource] = await ctx.tx.select({ route: merchantPaymentRoutes, collection: invoiceMerchantCollections, payment: payments })
      .from(merchantPaymentRoutes).innerJoin(invoiceMerchantCollections, eq(invoiceMerchantCollections.allocationId, merchantPaymentRoutes.allocationId))
      .innerJoin(payments, eq(payments.id, merchantPaymentRoutes.paymentId)).where(eq(merchantPaymentRoutes.paymentId, paymentId));
    const [agreementSource] = orderSource ? [] : await ctx.tx.select({ route: merchantAgreementPaymentRoutes, payment: payments })
      .from(merchantAgreementPaymentRoutes).innerJoin(payments, eq(payments.id, merchantAgreementPaymentRoutes.paymentId)).where(eq(merchantAgreementPaymentRoutes.paymentId, paymentId));
    const source = orderSource ?? (agreementSource ? { ...agreementSource, collection: agreementSource.route } : undefined);
    if (!source) return { recorded: false, routeVerified: false }; // A historical payment is never silently adopted.
    if (source.payment.provider !== "stripe" || !evidence.providerPlatformAccountId || evidence.amountMinor === undefined || !evidence.currency) throw new ServiceError("conflict", "Retain complete original provider evidence before reconciling this merchant payment.");
    const recipientAccountId = evidence.destinationAccountId ?? evidence.providerAccountId ?? null;
    const settlementMerchantAccountId = evidence.settlementMerchantAccountId ?? evidence.providerAccountId ?? null;
    const routeVerified = evidence.customerChargeVerified === true && evidence.merchantRouteVerified === true
      && evidence.providerPlatformAccountId === source.collection.providerPlatformAccountId
      && (evidence.providerAccountId ?? null) === source.collection.chargeAccountId
      && recipientAccountId === source.collection.recipientAccountId
      && settlementMerchantAccountId === source.collection.settlementMerchantAccountId;
    const values = {
      paymentId, providerEventRef, providerRef: evidence.providerRef, status: evidence.status, amountMinor: evidence.amountMinor, currency: evidence.currency,
      providerPlatformAccountId: evidence.providerPlatformAccountId, chargeAccountId: evidence.providerAccountId ?? null,
      recipientAccountId, settlementMerchantAccountId, applicationFeeMinor: evidence.applicationFeeMinor ?? null,
      providerChargeRef: evidence.providerChargeRef ?? null, applicationFeeRef: evidence.applicationFeeRef ?? null, transferRef: evidence.transferRef ?? null, routeVerified,
      customerChargeVerified: evidence.customerChargeVerified === true,
      applicationFeeCurrency: evidence.applicationFeeCurrency ?? null, observedApplicationFeeMinor: evidence.observedApplicationFeeMinor ?? null, observedFeeRefundedMinor: evidence.observedFeeRefundedMinor ?? null,
      settlementVerified: routeVerified && evidence.merchantSettlementVerified === true,
    };
    const [existing] = await ctx.tx.select().from(merchantPaymentObservations).where(and(eq(merchantPaymentObservations.paymentId, paymentId), eq(merchantPaymentObservations.providerEventRef, providerEventRef)));
    if (existing) {
      if (Object.entries(values).some(([key, value]) => existing[key as keyof typeof existing] !== value)) throw new ServiceError("conflict", "This provider observation reference already records different original facts.");
      return { recorded: true, routeVerified: existing.routeVerified };
    }
    await ctx.tx.insert(merchantPaymentObservations).values(values).onConflictDoNothing();
    // Resolve the unique-row race using the same comparison, never overwrite
    // an already recorded positive observation with a later interpretation.
    const [saved] = await ctx.tx.select().from(merchantPaymentObservations).where(and(eq(merchantPaymentObservations.paymentId, paymentId), eq(merchantPaymentObservations.providerEventRef, providerEventRef)));
    if (!saved || Object.entries(values).some(([key, value]) => saved[key as keyof typeof saved] !== value)) throw new ServiceError("conflict", "The original provider observation needs reconciliation.");
    ctx.setSubject("payment", paymentId);
    return { recorded: true, routeVerified };
  },
});

export default [recordMerchantPaymentObservation];
