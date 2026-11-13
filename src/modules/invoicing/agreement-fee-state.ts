// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: original fee obligations and actual remittance are distinct.
import { eq, inArray } from "drizzle-orm";
import { ServiceError, type ServiceContext } from "@/core/service";
import { subscriptionProrations } from "@/modules/subscriptions/proration-schema";
import { agreementFeeCashAssignments, agreementFeeCreditAssignments, agreementFeeDuties, agreementFeeEligibility, agreementFeeRemittances } from "./agreement-fee-schema";
import { retainedAgreementFee } from "./agreement-fee-amounts";
import { invoiceCreditApplications, invoiceCreditFunding, invoiceCreditReservations } from "./credit-application-schema";
import { commercialPrincipalState } from "./commercial-attestations";
import { routingForPayment } from "./merchant-charge";
import { assertMerchantCreatorsQuiesced, assertMerchantPaymentTerminal } from "./merchant-payment-request";
import { assertNoUnappliedMerchantCharge } from "./merchant-payment-observations";
import { originalMerchantFeeTarget } from "./merchant-line-fee-target";
import { readOriginalPrincipalEvidence } from "./principal-authority";
import { invoiceLines, invoiceMarketPolicies, invoices, payments } from "./schema";
import { merchantTaxDigest } from "./merchant-tax-store";

export async function originalAgreementFeeState(ctx: ServiceContext, invoiceId: string) {
  const [duty] = await ctx.tx.select().from(agreementFeeDuties).where(eq(agreementFeeDuties.invoiceId, invoiceId)).limit(1);
  if (!duty) return null;
  const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  const [policy] = await ctx.tx.select().from(invoiceMarketPolicies).where(eq(invoiceMarketPolicies.invoiceId, invoiceId)).limit(1);
  const [eligibility] = await ctx.tx.select().from(agreementFeeEligibility).where(eq(agreementFeeEligibility.invoiceId, invoiceId)).limit(1);
  const lines = await ctx.tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId)).limit(2);
  const lineSnapshot = lines[0]?.snapshot as Record<string, unknown> | undefined;
  const cash = await ctx.tx.select({ payment: payments, assignment: agreementFeeCashAssignments }).from(payments)
    .leftJoin(agreementFeeCashAssignments, eq(agreementFeeCashAssignments.paymentId, payments.id)).where(eq(payments.invoiceId, invoiceId)).orderBy(payments.id).limit(1001);
  const credits = await ctx.tx.select({ assignment: agreementFeeCreditAssignments, application: invoiceCreditApplications,
    reservation: invoiceCreditReservations, funding: invoiceCreditFunding }).from(agreementFeeCreditAssignments)
    .innerJoin(invoiceCreditApplications, eq(invoiceCreditApplications.reservationId, agreementFeeCreditAssignments.applicationId))
    .innerJoin(invoiceCreditReservations, eq(invoiceCreditReservations.id, invoiceCreditApplications.reservationId))
    .innerJoin(invoiceCreditFunding, eq(invoiceCreditFunding.id, invoiceCreditReservations.fundingId))
    .where(eq(agreementFeeCreditAssignments.invoiceId, invoiceId)).orderBy(agreementFeeCreditAssignments.applicationId).limit(1001);
  const receipts = await ctx.tx.select().from(agreementFeeRemittances).where(eq(agreementFeeRemittances.invoiceId, invoiceId)).orderBy(agreementFeeRemittances.id).limit(1001);
  let reviewRequired = !invoice || invoice.sourceType !== "subscription" || invoice.sourceId?.split(":")[1] !== "proration"
    || invoice.sourceId?.split(":")[2] !== duty.acceptanceId || invoice.currency !== duty.currency || invoice.totalMinor !== duty.totalMinor
    || invoice.creditedMinor !== duty.creditedMinor || policy?.model !== "seller_merchant" || policy.feeMinor !== duty.targetFeeMinor
    || lines.length !== 1 || lineSnapshot?.subscriptionProrationId !== duty.acceptanceId || cash.length + credits.length + receipts.length > 1000;
  let retainedCash = 0n, originalGrossCash = 0n, returnedCash = 0n, retainedCashDuty = 0n, retainedCredit = 0n, retainedCarriedDuty = 0n;
  const currentEvidence: unknown[] = [];
  try { await assertNoUnappliedMerchantCharge(ctx, invoiceId); }
  catch (error) { if (error instanceof ServiceError && error.code === "conflict") reviewRequired = true; else throw error; }
  for (const row of cash) {
    try {
      await assertMerchantCreatorsQuiesced(ctx, row.payment.id);
      if (["failed", "cancelled"].includes(row.payment.status)) {
        if (row.assignment?.origin === "recorded_external") reviewRequired = true;
        else await assertMerchantPaymentTerminal(ctx, row.payment.id);
      }
    } catch (error) { if (error instanceof ServiceError && error.code === "conflict") reviewRequired = true; else throw error; }
    if (["created", "processing"].includes(row.payment.status)) { reviewRequired = true; continue; }
    if (row.payment.status !== "succeeded") continue;
    const principal = await readOriginalPrincipalEvidence(ctx, row.payment.id); currentEvidence.push(principal);
    if (!row.assignment || row.assignment.invoiceId !== invoiceId || row.assignment.amountMinor !== row.payment.amountMinor || row.payment.currency !== duty.currency || !principal.principalSafe) {
      reviewRequired = true; continue;
    }
    let currentDuty: number | null;
    if (row.assignment.origin === "recorded_external") {
      const recorded = await ctx.callAsSystem(commercialPrincipalState, { paymentId: row.payment.id });
      currentDuty = recorded.recorded && recorded.principalSafe ? recorded.feeOwedMinor : null;
    } else currentDuty = await originalMerchantFeeTarget(ctx, row.payment, await routingForPayment(ctx, row.payment.id));
    if (currentDuty === null || !Number.isSafeInteger(currentDuty) || currentDuty < 0 || currentDuty > row.assignment.feeObligationMinor) { reviewRequired = true; continue; }
    originalGrossCash += BigInt(row.payment.amountMinor); returnedCash += BigInt(row.payment.refundedMinor);
    retainedCash += BigInt(principal.currentPrincipalMinor); retainedCashDuty += BigInt(currentDuty);
  }
  const rootIds = [...new Set(credits.map(row => row.funding.sourcePaymentId))];
  const roots = rootIds.length ? await ctx.tx.select().from(payments).where(inArray(payments.id, rootIds)).limit(1001) : [];
  if (roots.length !== rootIds.length) reviewRequired = true;
  currentEvidence.push({ originalCreditPrincipal: roots });
  for (const row of credits) {
    const root = roots.find(value => value.id === row.funding.sourcePaymentId);
    const principal = await readOriginalPrincipalEvidence(ctx, row.funding.sourcePaymentId); currentEvidence.push(principal);
    // There is no admitted noncash reversal writer in this source lineage.
    // An absent/conflicting original application is debt, never reduced credit.
    if (row.application.invoiceId !== invoiceId || row.reservation.targetSourceId !== invoice?.sourceId || row.assignment.amountMinor !== row.reservation.amountMinor
      || row.assignment.feeObligationMinor !== row.application.feeObligationMinor || row.assignment.provenCollectedMinor !== row.application.feeProvenCollectedMinor
      || row.assignment.originalEvidenceDigest !== merchantTaxDigest({ application: row.application, reservation: row.reservation })
      || !root || root.refundedMinor !== 0 || !principal.principalSafe || principal.currentPrincipalMinor < row.assignment.amountMinor) { reviewRequired = true; continue; }
    retainedCredit += BigInt(row.assignment.amountMinor); retainedCarriedDuty += BigInt(row.assignment.feeObligationMinor);
  }
  if (originalGrossCash !== BigInt(invoice?.paidMinor ?? -1) || returnedCash !== BigInt(invoice?.refundedMinor ?? -1) || retainedCredit !== BigInt(duty.creditedMinor)) reviewRequired = true;
  if (eligibility && (eligibility.cashPaymentIds.join(":") !== cash.filter(row => row.payment.status === "succeeded").map(row => row.payment.id).sort().join(":")
    || eligibility.creditApplicationIds.join(":") !== credits.map(row => row.assignment.applicationId).join(":"))) reviewRequired = true;
  const remitted = receipts.reduce((sum, row) => sum + BigInt(row.amountMinor) * (row.direction === "returned" ? -1n : 1n), 0n);
  if (remitted < 0n || remitted > BigInt(Number.MAX_SAFE_INTEGER) || receipts.some(row => row.currency !== duty.currency
    || row.direction === "returned" && !receipts.some(original => original.id === row.originalRemittanceId && original.direction === "remitted" && original.invoiceId === row.invoiceId))
    || receipts.filter(row => row.direction === "remitted").some(original => receipts.filter(row => row.originalRemittanceId === original.id).reduce((sum, row) => sum + BigInt(row.amountMinor), 0n) > BigInt(original.amountMinor))) reviewRequired = true;
  let disposition: ReturnType<typeof retainedAgreementFee> | null = null;
  if (!reviewRequired && eligibility) {
    try { disposition = retainedAgreementFee({ totalMinor: duty.totalMinor, targetFeeMinor: duty.targetFeeMinor, retainedCashMinor: Number(retainedCash),
      retainedCreditMinor: Number(retainedCredit), retainedCarriedDutyMinor: Number(retainedCarriedDuty), retainedCashDutyMinor: Number(retainedCashDuty) }); }
    catch (error) { if (error instanceof ServiceError && error.code === "conflict") reviewRequired = true; else throw error; }
  }
  const owedMinor = reviewRequired ? null : disposition?.receivableOwedMinor ?? 0;
  const recordedMinor = remitted >= 0n && remitted <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(remitted) : null;
  const returnDueMinor = owedMinor !== null && recordedMinor !== null ? Math.max(0, recordedMinor - owedMinor) : null;
  return { invoiceId, currency: duty.currency, eligible: Boolean(eligibility), expectedReceivableMinor: duty.expectedReceivableMinor,
    owedMinor, recordedMinor, returnDueMinor, originalSourceExcessMinor: disposition?.originalSourceExcessMinor ?? null, reviewRequired,
    pending: reviewRequired || !eligibility || owedMinor !== recordedMinor || (disposition?.originalSourceExcessMinor ?? 0) > 0,
    witness: { revision: merchantTaxDigest({ duty, invoice, policy, lines, cash, credits, eligibility, receipts, currentEvidence }), duty, cash, credits, eligibility, receipts } };
}

/** Original profile and subscription owners include duties with no payment. */
export async function agreementFeeProfileDebt(ctx: ServiceContext, profileId: string) {
  const rows = await ctx.tx.select({ invoiceId: agreementFeeDuties.invoiceId }).from(agreementFeeDuties).where(eq(agreementFeeDuties.merchantProfileId, profileId)).orderBy(agreementFeeDuties.invoiceId).limit(1001);
  if (rows.length > 1000) return { pending: true, hasHistory: true, incomplete: true };
  let pending = false;
  for (const row of rows) { const state = await originalAgreementFeeState(ctx, row.invoiceId); pending ||= !state || state.pending; }
  return { pending, hasHistory: rows.length > 0, incomplete: false };
}
export async function agreementFeeSubscriptionDebt(ctx: ServiceContext, subscriptionId: string) {
  const targets = await ctx.tx.select({ invoiceId: subscriptionProrations.debitInvoiceId }).from(subscriptionProrations).where(eq(subscriptionProrations.subscriptionId, subscriptionId)).limit(1001);
  if (targets.length > 1000) return true;
  const invoiceIds = targets.flatMap(row => row.invoiceId ? [row.invoiceId] : []);
  const duties = invoiceIds.length ? await ctx.tx.select({ invoiceId: agreementFeeDuties.invoiceId }).from(agreementFeeDuties).where(inArray(agreementFeeDuties.invoiceId, invoiceIds)).limit(1001) : [];
  if (duties.length > 1000) return true;
  for (const row of duties) { const state = await originalAgreementFeeState(ctx, row.invoiceId); if (!state || state.pending) return true; }
  return false;
}
export async function agreementFeePaymentDebt(ctx: ServiceContext, paymentId: string) {
  const [assignment] = await ctx.tx.select().from(agreementFeeCashAssignments).where(eq(agreementFeeCashAssignments.paymentId, paymentId)).limit(1);
  if (!assignment) return false;
  const state = await originalAgreementFeeState(ctx, assignment.invoiceId);
  return !state || state.pending;
}
