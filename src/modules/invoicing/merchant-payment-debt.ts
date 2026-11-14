// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: lifecycle jobs read durable debt; no provider I/O or attestation.
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { defineService, ServiceError } from "@/core/service";
import { originalMerchantRefundDebt } from "./merchant-refund-debt";
import { originalMerchantFeeTarget } from "./merchant-line-fee-target";
import { routingForPayment } from "./merchant-charge";
import { invoiceMerchantCollections, merchantFeeObservations, merchantFeeRefunds, merchantPaymentObservations, merchantPaymentRoutes } from "./merchant-collection-schema";
import { assertNoUnappliedMerchantCharge } from "./merchant-payment-observations";
import { assertMerchantCreatorsQuiesced, assertMerchantPaymentTerminal } from "./merchant-payment-request";
import { invoiceMerchantScopes, merchantInvoicePaymentRoutes } from "./merchant-invoice-scope-schema";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import { invoiceMerchantTaxQuotes } from "./merchant-tax-schema";
import { subscriptionMerchantScopes } from "@/modules/subscriptions/schema";
import { paymentDisputes, payments, refunds } from "./schema";
import { originalCashFullReturnCurrent } from "./original-cash-recovery-current";
import { originalCashPartialReturnCurrent } from "./original-cash-partial-current";
import { agreementFeePaymentDebt, agreementFeeProfileDebt } from "./agreement-fee-state";
import { commercialPrincipalState } from "./commercial-attestations";
import { controlledCashFinancialHistory, controlledFinancialWitness } from "./controlled-provider-financial-witness";
import { controlledProviderCoverage } from "@/modules/subscriptions/controlled-provider-coverage";
import { controlledCollectionCoverage } from "@/modules/subscriptions/controlled-provider-collection-coverage";
import { commercialPaymentAttestations } from "./commercial-attestation-schema";

const reason = z.enum(["original_scope", "unknown_payment", "unapplied_money", "provider_settlement", "commission", "refund", "dispute"]);
export const merchantPaymentRecoveryDebt = defineService({
  name: "invoicing.merchantPaymentRecoveryDebt", summary: "Report remaining recorded original customer, settlement, commission and recovery debt before a lifecycle can claim completion.",
  kind: "query", permission: "system", external: false, input: z.object({ paymentId: z.uuid() }), output: z.object({ pending: z.boolean(), reasons: z.array(reason) }),
  handler: async ({ paymentId }, ctx) => {
    const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, paymentId));
    if (!payment) return { pending: true, reasons: ["original_scope" as const] };
    if (payment.provider === "manual") {
      const principal = await ctx.callAsSystem(commercialPrincipalState, { paymentId });
      if (!principal.recorded) return { pending: true, reasons: ["original_scope" as const] };
      const recordedReasons: z.infer<typeof reason>[] = [];
      if (!principal.principalSafe) recordedReasons.push("refund");
      if (principal.feeRecordedMinor !== principal.feeOwedMinor || principal.reviewRequired && principal.principalSafe || await agreementFeePaymentDebt(ctx, paymentId)) recordedReasons.push("commission");
      return { pending: recordedReasons.length > 0, reasons: recordedReasons };
    }
    const routing = await routingForPayment(ctx, paymentId), reasons = new Set<z.infer<typeof reason>>();
    const controlledAliases = await ctx.tx.select({ id: merchantAgreementPaymentRoutes.originalChargeReceiptId }).from(merchantAgreementPaymentRoutes)
      .where(eq(merchantAgreementPaymentRoutes.paymentId, paymentId)).limit(2);
    const controlledRows = await controlledFinancialWitness(ctx.tx, { paymentIds: [paymentId] });
    const controlled = await controlledCashFinancialHistory(ctx.tx, [...new Set([...controlledAliases.flatMap(row => row.id ? [row.id] : []), ...controlledRows.receiptIds])], controlledRows.history.resources.map(row => row.subscriptionId));
    if (controlledAliases.length > 1 || controlled.incomplete || controlledRows.incomplete) reasons.add("original_scope");
    if (controlled.principalCallerDebt) reasons.add("unknown_payment");
    if (controlled.financialCallerDebt) reasons.add("commission");
    if (!routing.providerPlatformAccountId || routing.applicationFeeMinor === undefined || !Number.isSafeInteger(payment.amountMinor) || payment.amountMinor <= 0
      || !Number.isSafeInteger(payment.refundedMinor) || payment.refundedMinor < 0 || payment.refundedMinor > payment.amountMinor
      || !Number.isSafeInteger(routing.applicationFeeMinor) || routing.applicationFeeMinor < 0 || routing.applicationFeeMinor > payment.amountMinor) return { pending: true, reasons: ["original_scope" as const] };
    const fullOriginalReturn = payment.refundedMinor === payment.amountMinor && await originalCashFullReturnCurrent(ctx, paymentId);
    const partialOriginalReturn = await originalCashPartialReturnCurrent(ctx, paymentId);
    const auxiliaryReturnCurrent = fullOriginalReturn || partialOriginalReturn !== null;
    try { await assertNoUnappliedMerchantCharge(ctx, payment.invoiceId); }
    catch (error) { if (error instanceof ServiceError && error.code === "conflict") reasons.add("unapplied_money"); else throw error; }
    if (["created", "processing"].includes(payment.status)) reasons.add("unknown_payment");
    try { await assertMerchantCreatorsQuiesced(ctx, paymentId); }
    catch (error) { if (error instanceof ServiceError && error.code === "conflict") reasons.add("unknown_payment"); else throw error; }
    if (["failed", "cancelled"].includes(payment.status)) {
      try { await assertMerchantPaymentTerminal(ctx, paymentId); }
      catch (error) { if (error instanceof ServiceError && error.code === "conflict") reasons.add("unknown_payment"); else throw error; }
    }
    const [refundState] = await ctx.tx.select({ returned: sql<string>`coalesce(sum(${refunds.amountMinor}) filter(where ${refunds.status}='succeeded'),0)::text`,
      pending: sql<boolean>`coalesce(bool_or(${refunds.status} in ('created','processing') or (${refunds.status}='failed' and ${refunds.failureCode}='provider_already_refunded')),false)` })
      .from(refunds).where(eq(refunds.paymentId, paymentId));
    if (refundState?.pending || BigInt(refundState?.returned ?? "0") !== BigInt(payment.refundedMinor) || await originalMerchantRefundDebt(ctx, paymentId)) reasons.add("refund");
    const unresolvedDispute = await ctx.tx.select({ id: paymentDisputes.id }).from(paymentDisputes).where(and(eq(paymentDisputes.paymentId, paymentId), inArray(paymentDisputes.status, ["open", "lost"]))).limit(1);
    if (unresolvedDispute.length) reasons.add("dispute");
    const [feeState] = await ctx.tx.select({ returned: sql<string>`coalesce(sum(${merchantFeeRefunds.amountMinor}) filter(where ${merchantFeeRefunds.status}='accepted'),0)::text`,
      pending: sql<boolean>`coalesce(bool_or(${merchantFeeRefunds.status} in ('reserved','dispatching','unknown')),false)`,
      unmatched: sql<boolean>`coalesce(bool_or(${merchantFeeRefunds.status}='accepted' and not exists(select 1 from merchant_fee_observations a where a.operation_id=${merchantFeeRefunds.id} and a.binding_verified and a.provider_ref=${merchantFeeRefunds.providerRef} and a.amount_minor=${merchantFeeRefunds.amountMinor} and a.currency=${merchantFeeRefunds.currency} and a.application_fee_ref=${merchantFeeRefunds.applicationFeeRef})),false)` })
      .from(merchantFeeRefunds).where(eq(merchantFeeRefunds.paymentId, paymentId));
    const unattachedFeeAck = await ctx.tx.select({ id: merchantFeeObservations.id }).from(merchantFeeObservations).innerJoin(merchantFeeRefunds, eq(merchantFeeRefunds.id, merchantFeeObservations.operationId))
      .where(and(eq(merchantFeeRefunds.paymentId, paymentId), sql`${merchantFeeRefunds.status}<>'accepted'`)).limit(1);
    if (!auxiliaryReturnCurrent && (feeState?.pending || feeState?.unmatched || unattachedFeeAck.length)) reasons.add("commission");
    if (payment.status === "succeeded") {
      const [proof] = await ctx.tx.select().from(merchantPaymentObservations).where(and(eq(merchantPaymentObservations.paymentId, paymentId), eq(merchantPaymentObservations.providerRef, payment.providerRef ?? ""), eq(merchantPaymentObservations.status, "succeeded")))
        .orderBy(desc(merchantPaymentObservations.observedAt), desc(merchantPaymentObservations.id)).limit(1);
      if (!proof || !proof.customerChargeVerified || proof.amountMinor !== payment.amountMinor || proof.currency !== payment.currency
        || proof.providerPlatformAccountId !== routing.providerPlatformAccountId || proof.chargeAccountId !== (routing.providerAccountId ?? null)) reasons.add("unapplied_money");
      if (!proof?.routeVerified || !proof.settlementVerified) reasons.add("provider_settlement");
      const returned = BigInt(feeState?.returned ?? "0");
      const mismatchedOriginalFee = await ctx.tx.select({ id: merchantFeeRefunds.id }).from(merchantFeeRefunds).where(and(eq(merchantFeeRefunds.paymentId, paymentId), eq(merchantFeeRefunds.status, "accepted"), sql`${merchantFeeRefunds.applicationFeeRef} is distinct from ${proof?.applicationFeeRef ?? null}`)).limit(1);
      if (!auxiliaryReturnCurrent && mismatchedOriginalFee.length) reasons.add("commission");
      const target = await originalMerchantFeeTarget(ctx, payment, routing);
      if (!auxiliaryReturnCurrent && target === null) reasons.add("commission");
      const zeroFee = proof?.settlementVerified && proof.applicationFeeMinor === 0 && routing.applicationFeeMinor === 0 && !proof.applicationFeeRef && returned === 0n;
      if (!auxiliaryReturnCurrent && !zeroFee && (!proof?.applicationFeeRef || proof.observedApplicationFeeMinor === null || proof.observedFeeRefundedMinor === null || !Number.isSafeInteger(proof.observedApplicationFeeMinor) || !Number.isSafeInteger(proof.observedFeeRefundedMinor) || proof.applicationFeeCurrency !== payment.currency
        || BigInt(proof.observedFeeRefundedMinor) !== returned || target === null || BigInt(proof.observedApplicationFeeMinor) - returned !== BigInt(target))) reasons.add("commission");
      // Destination refund/debit closure needs an actual reversal witness.
      // The current capture-only proof deliberately refuses to infer it.
      if (routing.destinationAccountId && payment.refundedMinor > 0 && !auxiliaryReturnCurrent) reasons.add("refund");
    }
    if (await agreementFeePaymentDebt(ctx, paymentId)) reasons.add("commission");
    return { pending: reasons.size > 0, reasons: [...reasons] };
  },
});
/** Original quote/collection witnesses survive contact merges and profile minimization. */
export const merchantTaxPaymentDebt = defineService({
  name: "invoicing.merchantTaxPaymentDebt", summary: "Read actual original profile payment debt before minimizing an order, booking or subscription merchant.",
  kind: "query", permission: "system", external: false, input: z.object({ profileId: z.uuid() }),
  output: z.object({ pending: z.boolean(), hasHistory: z.boolean(), paymentIds: z.array(z.uuid()), incomplete: z.boolean() }),
  handler: async ({ profileId }, ctx) => {
    const quotes = await ctx.tx.select({ invoiceId: invoiceMerchantTaxQuotes.invoiceId }).from(invoiceMerchantTaxQuotes)
      .where(eq(invoiceMerchantTaxQuotes.profileId, profileId)).limit(5001);
    if (quotes.length > 5000) return { pending: true, hasHistory: true, paymentIds: [], incomplete: true };
    const invoices = [...new Set(quotes.map(quote => quote.invoiceId))];
    const rows = await ctx.tx.select({ paymentId: payments.id, invoiceId: payments.invoiceId,
      orderId: merchantPaymentRoutes.paymentId, orderProfile: invoiceMerchantCollections.taxPolicy,
      bookingId: merchantInvoicePaymentRoutes.paymentId, bookingProfile: invoiceMerchantScopes.taxPolicy,
      agreementId: merchantAgreementPaymentRoutes.paymentId, agreementProfile: subscriptionMerchantScopes.taxProfileId,
      recordedId: commercialPaymentAttestations.paymentId, recordedProfile: commercialPaymentAttestations.merchantProfileId }).from(payments)
      .leftJoin(commercialPaymentAttestations, eq(commercialPaymentAttestations.paymentId, payments.id))
      .leftJoin(merchantPaymentRoutes, eq(merchantPaymentRoutes.paymentId, payments.id))
      .leftJoin(invoiceMerchantCollections, eq(invoiceMerchantCollections.allocationId, merchantPaymentRoutes.allocationId))
      .leftJoin(merchantInvoicePaymentRoutes, eq(merchantInvoicePaymentRoutes.paymentId, payments.id))
      .leftJoin(invoiceMerchantScopes, eq(invoiceMerchantScopes.invoiceId, merchantInvoicePaymentRoutes.invoiceId))
      .leftJoin(merchantAgreementPaymentRoutes, eq(merchantAgreementPaymentRoutes.paymentId, payments.id))
      .leftJoin(subscriptionMerchantScopes, eq(subscriptionMerchantScopes.subscriptionId, merchantAgreementPaymentRoutes.subscriptionId))
      .where(or(sql`${invoiceMerchantCollections.taxPolicy}->>'profileId' = ${profileId}`,
        sql`${invoiceMerchantScopes.taxPolicy}->>'profileId' = ${profileId}`, eq(subscriptionMerchantScopes.taxProfileId, profileId), eq(commercialPaymentAttestations.merchantProfileId, profileId),
        ...(invoices.length ? [inArray(payments.invoiceId, invoices)] : []))).limit(5001);
    if (rows.length > 5000) return { pending: true, hasHistory: true, paymentIds: [], incomplete: true };
    const anchored = new Set(invoices), ids = new Set<string>();
    let incomplete = false;
    for (const row of rows) {
      const profiles = [row.orderProfile?.profileId, row.bookingProfile?.profileId, row.agreementProfile, row.recordedProfile].filter((id): id is string => Boolean(id));
      const scopes = [row.orderId, row.bookingId, row.agreementId, row.recordedId].filter(Boolean).length;
      // A missing original owner is debt, not proof that a partial restore
      // erased its payment. A known other seller's portion stays independent.
      if (scopes > 1 || profiles.some(id => !z.uuid().safeParse(id).success) || anchored.has(row.invoiceId) && (scopes !== 1 || profiles.length !== 1)) incomplete = true;
      if (profiles.includes(profileId)) {
        ids.add(row.paymentId);
        if (!anchored.has(row.invoiceId)) incomplete = true;
      }
    }
    const paymentIds = [...ids];
    let pending = incomplete;
    for (const paymentId of paymentIds) {
      try {
        const debt = await ctx.callAsSystem(merchantPaymentRecoveryDebt, { paymentId });
        pending ||= debt.pending;
      } catch (error) {
        if (!(error instanceof ServiceError) || !["conflict", "not_found", "validation"].includes(error.code)) throw error;
        pending = true; incomplete = true;
      }
    }
    const fee = await agreementFeeProfileDebt(ctx, profileId);
    const controlled = await controlledFinancialWitness(ctx.tx, { profileIds: [profileId] });
    if (controlled.incomplete || controlled.entries.length + rows.length + quotes.length > 5000) incomplete = true;
    // A paused zero calendar is still ACTIVE. Privacy quiescence requires its
    // separate authenticated terminal closure; coverage alone cannot erase it.
    let controlledPending = controlled.incomplete;
    for (const subscriptionId of [...new Set(controlled.history.resources.map(row => row.subscriptionId))]) {
      try {
        const targets=controlled.targets?.quotes.filter(row=>row.subscriptionId===subscriptionId);
        const targetCoverage=targets?.length?await controlledCollectionCoverage(ctx.tx,{subscriptionId}):null;
        // Zero transport closure cannot discharge an accepted canonical target.
        // Its genuine positive-target closure/unwind remains separately required.
        controlledPending ||= Boolean(targetCoverage?.witness.collections.length);
        const coverage = targetCoverage?.transport ?? await controlledProviderCoverage(ctx.tx, { subscriptionId });
        controlledPending ||= coverage.unfinishedCalls.length > 0 || coverage.rawCashReviewFactIds.length > 0
          || coverage.witness.resources.some(resource => !coverage.witness.closures.some(closure => closure.id === resource.id));
      } catch (error) {
        if (!(error instanceof ServiceError) || !["conflict", "not_found", "permission", "validation"].includes(error.code)) throw error;
        controlledPending = true; incomplete = true;
      }
    }
    return { pending: pending || fee.pending || controlledPending || incomplete, hasHistory: paymentIds.length > 0 || incomplete || fee.hasHistory || controlled.entries.length > 0, paymentIds, incomplete: incomplete || fee.incomplete };
  },
});

export default [merchantPaymentRecoveryDebt, merchantTaxPaymentDebt];
