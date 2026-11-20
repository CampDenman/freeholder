// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: retain exact accepted fee epochs before any target collection.
import { eq, sql } from "drizzle-orm";
import { ServiceError, type ServiceContext } from "@/core/service";
import { subscriptionProrations } from "@/modules/subscriptions/proration-schema";
import { agreementFeeCashAssignments, agreementFeeCreditAssignments, agreementFeeDuties, agreementFeeEligibility } from "./agreement-fee-schema";
import { plannedAgreementFee } from "./agreement-fee-amounts";
import { invoiceCreditApplications, invoiceCreditReservations } from "./credit-application-schema";
import { invoiceLines, invoiceMarketPolicies, invoices, payments } from "./schema";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import { commercialPaymentAttestations } from "./commercial-attestation-schema";
import { merchantTaxDigest } from "./merchant-tax-store";

export async function requireAgreementFeeSchema(ctx: ServiceContext) {
  const [ready] = await ctx.tx.execute<{ ready: boolean }>(sql`select count(*)=8 as ready from pg_trigger where not tgisinternal and tgenabled in('O','A') and(tgrelid,tgname) in
    ((to_regclass('agreement_fee_duties'),'agreement_fee_duties_guard'),(to_regclass('agreement_fee_credit_assignments'),'agreement_fee_credit_assignments_guard'),
     (to_regclass('agreement_fee_cash_assignments'),'agreement_fee_cash_assignments_guard'),(to_regclass('agreement_fee_eligibility'),'agreement_fee_eligibility_guard'),
     (to_regclass('agreement_fee_remittances'),'agreement_fee_remittances_guard'),(to_regclass('agreement_fee_duties'),'agreement_fee_duties_complete'),
     (to_regclass('payments'),'agreement_fee_payment_assignment_complete'),(to_regclass('subscription_prorations'),'agreement_fee_acceptance_complete'))`);
  if (!ready?.ready) throw new ServiceError("conflict", "Install all original commission duty, assignment, eligibility and actual-remittance guards before accepting another gross target.");
}
export async function agreementFeeWriter(ctx: ServiceContext) {
  await requireAgreementFeeSchema(ctx);
  await ctx.tx.execute(sql`select set_config('freeholder.agreement_fee_v1','1',true)`);
}
export function isGrossAgreementInvoice(invoice: Pick<typeof invoices.$inferSelect, "sourceType" | "sourceId">) {
  return invoice.sourceType === "subscription" && invoice.sourceId?.split(":")[1] === "proration";
}

/** Called in the exact original acceptance transaction after canonical credit
 * application and before committing the accepted target or a payment caller. */
export async function captureAgreementFeeDuty(ctx: ServiceContext, acceptanceId: string, invoiceId: string) {
  await agreementFeeWriter(ctx);
  const [accepted] = await ctx.tx.select().from(subscriptionProrations).where(eq(subscriptionProrations.id, acceptanceId)).limit(1);
  const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  const [policy] = await ctx.tx.select().from(invoiceMarketPolicies).where(eq(invoiceMarketPolicies.invoiceId, invoiceId)).limit(1);
  const lines = await ctx.tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId)).limit(2);
  const lineSnapshot = lines[0]?.snapshot as Record<string, unknown> | undefined;
  const credits = await ctx.tx.select({ application: invoiceCreditApplications, reservation: invoiceCreditReservations }).from(invoiceCreditApplications)
    .innerJoin(invoiceCreditReservations, eq(invoiceCreditReservations.id, invoiceCreditApplications.reservationId)).where(eq(invoiceCreditApplications.invoiceId, invoiceId))
    .orderBy(invoiceCreditApplications.reservationId).limit(1001);
  if (!accepted || !invoice || accepted.debitInvoiceId !== invoice.id || accepted.state !== "accepted" || accepted.originalTrialEndsAt || !isGrossAgreementInvoice(invoice)
    || invoice.sourceId !== `${accepted.subscriptionId}:proration:${accepted.id}` || invoice.currency !== accepted.snapshot.currency || invoice.status === "draft" || invoice.status === "void"
    || invoice.totalMinor !== accepted.debitNetMinor + accepted.debitTaxMinor || invoice.paidMinor !== 0 || policy?.model !== "seller_merchant" || policy.feeMinor !== accepted.debitFeeObligationMinor
    || lines.length !== 1 || lineSnapshot?.subscriptionProrationId !== accepted.id || lineSnapshot?.subscriptionTermsId !== accepted.termsId
    || credits.length > 1000 || credits.some(row => !row.application.feeEvidenceDigest || row.reservation.targetSourceId !== invoice.sourceId)
    || credits.reduce((sum, row) => sum + BigInt(row.reservation.amountMinor), 0n) !== BigInt(invoice.creditedMinor)
    || credits.reduce((sum, row) => sum + BigInt(row.application.feeObligationMinor), 0n) !== BigInt(accepted.appliedFeeObligationMinor)
    || credits.reduce((sum, row) => sum + BigInt(row.application.feeProvenCollectedMinor), 0n) !== BigInt(accepted.appliedFeeProvenCollectedMinor))
    throw new ServiceError("conflict", "Freeze the exact one-line accepted debit, original noncash applications and original commission epoch before admitting its target.");
  const plan = plannedAgreementFee({ totalMinor: invoice.totalMinor, targetFeeMinor: policy.feeMinor, creditedMinor: invoice.creditedMinor, carriedFeeMinor: accepted.appliedFeeObligationMinor });
  const originalOwnerDigest = merchantTaxDigest({ acceptanceId: accepted.id, quoteDigest: accepted.acceptedQuoteDigest, snapshot: accepted.snapshot,
    invoiceId, originalLine: lines[0], policy, originalProfileId: accepted.profileId, originalProfileVersion: accepted.profileVersion, credits, plan });
  await ctx.tx.insert(agreementFeeDuties).values({ invoiceId, acceptanceId, merchantProfileId: accepted.profileId, profileVersion: accepted.profileVersion,
    currency: invoice.currency, totalMinor: invoice.totalMinor, targetFeeMinor: policy.feeMinor, creditedMinor: invoice.creditedMinor,
    carriedFeeMinor: accepted.appliedFeeObligationMinor, cashPrincipalMinor: plan.cashPrincipalMinor, cashFeeTargetMinor: plan.cashFeeTargetMinor,
    expectedReceivableMinor: plan.expectedReceivableMinor, acceptedQuoteDigest: accepted.acceptedQuoteDigest, originalOwnerDigest });
  if (credits.length) await ctx.tx.insert(agreementFeeCreditAssignments).values(credits.map(row => ({ applicationId: row.application.reservationId, invoiceId,
    amountMinor: row.reservation.amountMinor, feeObligationMinor: row.application.feeObligationMinor, provenCollectedMinor: row.application.feeProvenCollectedMinor,
    originalEvidenceDigest: merchantTaxDigest(row) })));
}

/** Manual capture runs only after the real authorized attestation exists;
 * provider capture runs after the real immutable original route is inserted. */
export async function captureAgreementFeeCashAssignment(ctx: ServiceContext, paymentId: string) {
  const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  const [invoice] = payment ? await ctx.tx.select().from(invoices).where(eq(invoices.id, payment.invoiceId)).limit(1) : [];
  if (!invoice || !isGrossAgreementInvoice(invoice)) return;
  await agreementFeeWriter(ctx);
  const [duty] = await ctx.tx.select().from(agreementFeeDuties).where(eq(agreementFeeDuties.invoiceId, invoice.id)).limit(1);
  const [record] = await ctx.tx.select().from(commercialPaymentAttestations).where(eq(commercialPaymentAttestations.paymentId, paymentId)).limit(1);
  const [route] = await ctx.tx.select().from(merchantAgreementPaymentRoutes).where(eq(merchantAgreementPaymentRoutes.paymentId, paymentId)).limit(1);
  const [previous] = await ctx.tx.select().from(agreementFeeCashAssignments).where(eq(agreementFeeCashAssignments.paymentId, paymentId)).limit(1);
  if (!duty || !payment || Boolean(record) === Boolean(route) || payment.currency !== duty.currency || payment.status !== "created"
    || record && (payment.provider !== "manual" || record.merchantProfileId !== duty.merchantProfileId || record.profileVersion !== duty.profileVersion || record.amountMinor !== payment.amountMinor || record.currency !== payment.currency)
    || route && payment.provider !== "stripe") throw new ServiceError("conflict", "Retain the exact new principal attempt and one actual original merchant fee owner before collection.");
  const feeObligationMinor = record?.feeOwedMinor ?? route!.applicationFeeMinor;
  const originalEvidenceDigest = merchantTaxDigest({ originalOwnerDigest: duty.originalOwnerDigest,
    payment: { id: payment.id, invoiceId: payment.invoiceId, provider: payment.provider, method: payment.method, currency: payment.currency, amountMinor: payment.amountMinor, requestHash: payment.requestHash, createdAt: payment.createdAt }, record, route });
  if (previous) {
    if (previous.invoiceId !== invoice.id || previous.amountMinor !== payment.amountMinor || previous.feeObligationMinor !== feeObligationMinor || previous.originalEvidenceDigest !== originalEvidenceDigest)
      throw new ServiceError("conflict", "Never rebind the original commission assignment to another attempt or owner.");
    return;
  }
  const prior = await ctx.tx.select({ payment: payments, assignment: agreementFeeCashAssignments }).from(payments)
    .leftJoin(agreementFeeCashAssignments, eq(agreementFeeCashAssignments.paymentId, payments.id)).where(eq(payments.invoiceId, invoice.id)).limit(1001);
  const successful = prior.filter(row => row.payment.id !== paymentId && row.payment.status === "succeeded");
  const priorCash = successful.reduce((sum, row) => sum + BigInt(row.payment.amountMinor), 0n), priorFee = successful.reduce((sum, row) => sum + BigInt(row.assignment?.feeObligationMinor ?? 0), 0n);
  const{controlledAtomicPaymentFee}=await import("./controlled-cash-atomic-fee-stage");
  const atomicFee=route?await controlledAtomicPaymentFee(ctx,{paymentId,invoice,originalFeeMinor:duty.targetFeeMinor,priorCashMinor:Number(priorCash),priorAllocatedFeeMinor:Number(priorFee)}):null;
  if (prior.length > 1000 || duty.cashPrincipalMinor <= 0 || successful.some(row => !row.assignment || row.payment.refundedMinor !== 0)
    || prior.some(row => row.payment.id !== paymentId && ["created", "processing"].includes(row.payment.status))
    || priorCash !== BigInt(invoice.paidMinor) || priorCash + BigInt(payment.amountMinor) > BigInt(duty.cashPrincipalMinor)
    || (atomicFee===null?BigInt(feeObligationMinor) !== BigInt(duty.cashFeeTargetMinor) * (priorCash + BigInt(payment.amountMinor)) / BigInt(duty.cashPrincipalMinor) - priorFee:feeObligationMinor!==atomicFee))
    throw new ServiceError("conflict", "Restore every original target cash assignment and its cumulative frozen fee residual before admitting another caller.");
  await ctx.tx.insert(agreementFeeCashAssignments).values({ paymentId, invoiceId: invoice.id, amountMinor: payment.amountMinor, feeObligationMinor,
    origin: record ? "recorded_external" : "provider", originalEvidenceDigest });
}

/** Principal and every original caller are proved by the actual shared paid
 * completion before this immutable eligibility receipt. No remittance is implied. */
export async function retainAgreementFeeEligibility(ctx: ServiceContext, invoice: typeof invoices.$inferSelect, principalEvidence: unknown) {
  if (!isGrossAgreementInvoice(invoice)) return;
  await agreementFeeWriter(ctx);
  const [prior] = await ctx.tx.select().from(agreementFeeEligibility).where(eq(agreementFeeEligibility.invoiceId, invoice.id)).limit(1);
  if (prior) return;
  const [duty] = await ctx.tx.select().from(agreementFeeDuties).where(eq(agreementFeeDuties.invoiceId, invoice.id)).limit(1);
  const cash = await ctx.tx.select({ id: payments.id, amountMinor: payments.amountMinor, status: payments.status, refundedMinor: payments.refundedMinor, assignment: agreementFeeCashAssignments }).from(payments)
    .leftJoin(agreementFeeCashAssignments, eq(agreementFeeCashAssignments.paymentId, payments.id)).where(eq(payments.invoiceId, invoice.id)).limit(1001);
  const credits = await ctx.tx.select().from(agreementFeeCreditAssignments).where(eq(agreementFeeCreditAssignments.invoiceId, invoice.id)).orderBy(agreementFeeCreditAssignments.applicationId).limit(1001);
  if (!duty || invoice.status !== "paid" || !invoice.paidAt || invoice.refundedMinor !== 0 || cash.length + credits.length > 1000
    || cash.some(row => ["created", "processing"].includes(row.status) || row.status === "succeeded" && (!row.assignment || row.refundedMinor !== 0))
    || cash.filter(row => row.status === "succeeded").reduce((sum, row) => sum + BigInt(row.amountMinor), 0n) !== BigInt(duty.cashPrincipalMinor)
    || credits.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n) !== BigInt(duty.creditedMinor)) throw new ServiceError("conflict", "Actual full canonical settlement and all original cash/noncash assignments are required before commission eligibility.");
  await ctx.tx.insert(agreementFeeEligibility).values({ invoiceId: invoice.id, paidAt: invoice.paidAt,
    cashPaymentIds: cash.filter(row => row.status === "succeeded").map(row => row.id).sort(), creditApplicationIds: credits.map(row => row.applicationId),
    principalEvidenceDigest: merchantTaxDigest({ invoice, duty, cash, credits, principalEvidence }) });
}
