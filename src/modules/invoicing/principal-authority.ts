// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C12.38: exact actual source receipts, never imagined fee or transfer settlement.
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { defineService, getService, ServiceError, type ServiceContext } from "@/core/service";
import { merchantTaxDigest } from "./merchant-tax-store";
import { commercialPaymentRecorded, commercialPrincipalState } from "./commercial-attestations";
import { commercialFeeAttestations, commercialRefundAttestations } from "./commercial-attestation-schema";
import { merchantPaymentObservations } from "./merchant-collection-schema";
import { routingForPayment } from "./merchant-charge";
import { assertMerchantCreatorsQuiesced } from "./merchant-payment-request";
import { assertNoUnappliedMerchantCharge } from "./merchant-payment-observations";
import { originalMerchantRefundDebt } from "./merchant-refund-debt";
import { invoices, paymentDisputes, payments, refunds } from "./schema";
import { readOriginalCashPrincipalHistory } from "./original-cash-principal";
import { evaluateProviderPrincipal, principalAuthorityResult } from "./principal-authority-contract";

/** Principal evidence is independent of ancillary fee-debt queries. Reusers
 * must not recursively ask the full debt service while proving its sources. */
export async function readOriginalPrincipalEvidence(ctx: ServiceContext, paymentId: string) {
    const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
    if (!payment) throw new ServiceError("not_found", "The original customer principal is unavailable.");
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, payment.invoiceId)).limit(1);
    const routing = await routingForPayment(ctx, paymentId), originalRouteDigest = merchantTaxDigest({ invoiceId: payment.invoiceId, originalBuyerId: invoice?.contactId, currency: payment.currency, routing });
    if (routing.moneyOrigin === "recorded_external") {
      const receipt = await commercialPaymentRecorded(ctx, paymentId), state = await ctx.callAsSystem(commercialPrincipalState, { paymentId });
      const returned = await ctx.tx.select().from(commercialRefundAttestations).where(eq(commercialRefundAttestations.paymentId, paymentId)).orderBy(commercialRefundAttestations.refundId).limit(5001);
      const fees = await ctx.tx.select().from(commercialFeeAttestations).where(eq(commercialFeeAttestations.paymentId, paymentId)).orderBy(commercialFeeAttestations.id).limit(5001);
      const complete = Boolean(invoice && receipt && returned.length + fees.length <= 5000 && state.recorded && state.principalSafe);
      return { origin: "recorded_external" as const, principalSafe: complete, additionalFinancialDebtPending: false,
        currentPrincipalMinor: complete ? payment.amountMinor - payment.refundedMinor : 0, reasons: complete ? [] : ["original_principal" as const],
        witness: { paymentId, originalRouteDigest, revision: merchantTaxDigest({ payment, receipt, state, returned, fees, originalRouteDigest }), observationId: null, observationDigest: null, settlementVerified: null } };
    }
    const [observation] = await ctx.tx.select().from(merchantPaymentObservations).where(and(eq(merchantPaymentObservations.paymentId, paymentId), eq(merchantPaymentObservations.providerRef, payment.providerRef ?? ""), eq(merchantPaymentObservations.status, "succeeded")))
      .orderBy(desc(merchantPaymentObservations.observedAt), desc(merchantPaymentObservations.id)).limit(1);
    let unknownCaller = false, unappliedCash = false;
    try { await assertMerchantCreatorsQuiesced(ctx, paymentId); } catch (error) { if (error instanceof ServiceError && error.code === "conflict") unknownCaller = true; else throw error; }
    try { await assertNoUnappliedMerchantCharge(ctx, payment.invoiceId); } catch (error) { if (error instanceof ServiceError && error.code === "conflict") unappliedCash = true; else throw error; }
    const returned = await ctx.tx.select().from(refunds).where(eq(refunds.paymentId, paymentId)).orderBy(refunds.id).limit(5001);
    const disputes = await ctx.tx.select().from(paymentDisputes).where(and(eq(paymentDisputes.paymentId, paymentId), inArray(paymentDisputes.status, ["open", "lost"]))).limit(5001);
    const originalRefundDebt = await originalMerchantRefundDebt(ctx, paymentId);
    const refundDebt = originalRefundDebt || returned.some(row => ["created", "processing"].includes(row.status) || row.status === "failed" && row.failureCode === "provider_already_refunded")
      || returned.filter(row => row.status === "succeeded").reduce((sum, row) => sum + BigInt(row.amountMinor), 0n) !== BigInt(payment.refundedMinor);
    let raw: Awaited<ReturnType<typeof readOriginalCashPrincipalHistory>> | null = null, rawUnknown = false;
    try { raw = await readOriginalCashPrincipalHistory(ctx, { kind: "payment", paymentId }); }
    catch (error) { if (error instanceof ServiceError && ["conflict", "not_found", "permission", "validation"].includes(error.code)) rawUnknown = true; else throw error; }
    const facts = { payment, route: { platform: routing.providerPlatformAccountId ?? null, chargeAccount: routing.providerAccountId ?? null, recipient: routing.destinationAccountId ?? routing.providerAccountId ?? null,
      settlementMerchant: routing.settlementMerchantAccountId ?? routing.providerAccountId ?? null },
      observation: observation ? { providerRef: observation.providerRef, platform: observation.providerPlatformAccountId, chargeAccount: observation.chargeAccountId, recipient: observation.recipientAccountId,
        settlementMerchant: observation.settlementMerchantAccountId, amountMinor: observation.amountMinor, currency: observation.currency,
        customerChargeVerified: observation.customerChargeVerified, routeVerified: observation.routeVerified, settlementVerified: observation.settlementVerified } : null,
      unknownCaller: unknownCaller || raw?.principalCallerDebt === true, unappliedCash: unappliedCash || raw?.receiptOnly === true, refundDebt, dispute: disputes.length > 0, incomplete: !invoice || rawUnknown || raw?.reviewRequired === true || returned.length + disputes.length + (raw?.inventoryCount ?? 0) > 5000 };
    const evaluated = evaluateProviderPrincipal(facts);
    return { origin: routing.providerPlatformAccountId ? "provider" as const : "unknown" as const, principalSafe: evaluated.principalSafe, additionalFinancialDebtPending: rawUnknown || raw?.reviewRequired === true || raw?.ancillaryDebtPending === true,
      currentPrincipalMinor: evaluated.principalSafe ? payment.amountMinor - payment.refundedMinor : 0, reasons: evaluated.reasons,
      witness: { paymentId, originalRouteDigest, revision: merchantTaxDigest({ payment, observation, facts, returned, disputes, originalRefundDebt, originalRouteDigest, raw }),
        observationId: observation?.id ?? null, observationDigest: observation ? merchantTaxDigest(observation) : null, settlementVerified: observation?.settlementVerified ?? null } };
}
export const originalPrincipalAuthority = defineService({ name: "invoicing.originalPrincipalAuthority", summary: "Prove original customer principal and actual merchant route independently from still-owed fee or ancillary transfer settlement duties.",
  kind: "query", permission: "system", external: false, input: z.object({ paymentId: z.uuid() }), output: principalAuthorityResult,
  handler: async ({ paymentId }, ctx) => {
    const { additionalFinancialDebtPending, ...proof } = await readOriginalPrincipalEvidence(ctx, paymentId);
    const debt = getService("invoicing.merchantPaymentRecoveryDebt");
    const financialDebtPending = !debt || z.object({ pending: z.boolean() }).passthrough().parse(await ctx.callAsSystem(debt, { paymentId })).pending;
    return { ...proof, financialDebtPending: financialDebtPending || additionalFinancialDebtPending };
  },
});
export const originalReceiptPrincipalReview = defineService({ name: "invoicing.originalReceiptPrincipalReview", summary: "Retain the authentic original NULL-payment receipt's raw cash/caller review without inventing a canonical payment or credit/access principal.",
  kind: "query", permission: "system", external: false, input: z.object({ receiptId: z.uuid(), observationId: z.uuid() }),
  output: z.object({ receiptId: z.uuid(), paymentId: z.null(), principalSafe: z.literal(false), currentPrincipalMinor: z.null(), reviewRequired: z.literal(true),
    receiptOnly: z.literal(true), historyRevision: z.string().regex(/^[a-f0-9]{64}$/), inventoryCount: z.number().int().nonnegative() }),
  handler: async (input, ctx) => {
    const current = await readOriginalCashPrincipalHistory(ctx, { kind: "subscription", ...input });
    return { receiptId: input.receiptId, paymentId: null, principalSafe: false as const, currentPrincipalMinor: null, reviewRequired: true as const,
      receiptOnly: true as const, historyRevision: current.revision, inventoryCount: current.inventoryCount };
  },
});
export default [originalPrincipalAuthority, originalReceiptPrincipalReview];
