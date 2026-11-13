// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: existing offline-recording authority, explicit attestation and fee liability.
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { actorString, defineService, ServiceError, type ServiceContext } from "@/core/service";
import { invoices, invoiceMarketPolicies, paymentDisputes, payments, refunds } from "./schema";
import { invoiceMerchantTaxQuotes } from "./merchant-tax-schema";
import { merchantTaxDigest } from "./merchant-tax-store";
import { commercialFeeAttestations, commercialPaymentAttestations, commercialRefundAttestations } from "./commercial-attestation-schema";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import { paymentMerchantRoutes } from "./schema";
import { recordedCommercialFeeTarget } from "./commercial-attestation-amounts";
import { invoiceCashFeeAllocation } from "./invoice-credit-cash-fee";

/** Invoice lock is held by the shared payment creator. The absent Stripe
 * route is deliberate: this is a record of money outside the provider. */
export async function reserveCommercialOfflineRecord(ctx: ServiceContext, invoice: typeof invoices.$inferSelect, request: { provider: string; method: string; amountMinor: number }) {
  const [policy] = await ctx.tx.select().from(invoiceMarketPolicies).where(eq(invoiceMarketPolicies.invoiceId, invoice.id)).limit(1);
  const parties = await ctx.tx.select().from(invoiceMerchantTaxQuotes).where(eq(invoiceMerchantTaxQuotes.invoiceId, invoice.id)).limit(2);
  if (request.provider !== "manual" || !["cash", "bank_transfer", "cheque", "external_card", "other"].includes(request.method)
    || invoice.sourceType !== "subscription" || !invoice.sourceId || !invoice.issuedAt || policy?.model !== "seller_merchant" || policy.collectionVersion === 1
    || parties.length !== 1 || parties[0]!.sellerUserId !== policy.sellerUserId)
    throw new ServiceError("conflict", "Record commercial external money against its exact original issued subscription invoice and declared merchant.");
  const history = await commercialInvoiceCashHistory(ctx, invoice);
  const { assertNoUnappliedMerchantCharge } = await import("./merchant-payment-observations");
  await assertNoUnappliedMerchantCharge(ctx, invoice.id);
  if (history.pending) throw new ServiceError("conflict", "Resolve the original payment attempt before recording another external amount.");
  if (BigInt(invoice.paidMinor) + BigInt(invoice.creditedMinor) + BigInt(request.amountMinor) > BigInt(invoice.totalMinor))
    throw new ServiceError("conflict", "This external record exceeds the exact invoice's remaining consideration.");
  await attestationWriter(ctx);
}

/** Each original successful principal has one fee allocation, either the
 * original provider route or the recorded external obligation. Mixing payment
 * origins never guesses a fee from an unowned amount. */
export async function commercialInvoiceCashHistory(ctx: ServiceContext, invoice: typeof invoices.$inferSelect, excludePaymentId?: string) {
  const rows = await ctx.tx.select({ payment: payments, recorded: commercialPaymentAttestations, agreement: merchantAgreementPaymentRoutes, legacy: paymentMerchantRoutes }).from(payments)
    .leftJoin(commercialPaymentAttestations, eq(commercialPaymentAttestations.paymentId, payments.id))
    .leftJoin(merchantAgreementPaymentRoutes, eq(merchantAgreementPaymentRoutes.paymentId, payments.id))
    .leftJoin(paymentMerchantRoutes, eq(paymentMerchantRoutes.paymentId, payments.id)).where(eq(payments.invoiceId, invoice.id)).limit(5001);
  if (rows.length > 5000) throw new ServiceError("conflict", "Restore the bounded complete original commercial payment inventory.");
  let cash = 0n, allocatedFee = 0n, pending = false;
  for (const row of rows) {
    if (row.payment.id === excludePaymentId) continue;
    pending ||= ["created", "processing"].includes(row.payment.status);
    if (row.payment.status !== "succeeded") continue;
    const owners = [row.recorded, row.agreement, row.legacy].filter(Boolean);
    if (owners.length !== 1 || row.payment.currency !== invoice.currency || row.recorded && (row.payment.provider !== "manual" || row.recorded.amountMinor !== row.payment.amountMinor || row.recorded.currency !== row.payment.currency))
      throw new ServiceError("conflict", "Restore each exact original commercial principal and its one fee ownership receipt.");
    cash += BigInt(row.payment.amountMinor);
    allocatedFee += BigInt(row.recorded?.feeOwedMinor ?? row.agreement?.applicationFeeMinor ?? row.legacy!.applicationFeeMinor);
  }
  // Refunded original amounts still own their original fee allocation. A
  // refund's later fee disposition is a separate retained obligation.
  const refunded = rows.filter(row => row.payment.id !== excludePaymentId && row.payment.status === "succeeded").reduce((sum, row) => sum + BigInt(row.payment.refundedMinor), 0n);
  if (cash !== BigInt(invoice.paidMinor) || refunded !== BigInt(invoice.refundedMinor)) throw new ServiceError("conflict", "The actual recorded invoice cash/refund projections and original principal inventory disagree.");
  return { cash, refunded, allocatedFee, pending };
}
async function attestationWriter(ctx: ServiceContext) {
  const [ready] = await ctx.tx.execute<{ ready: boolean }>(sql`select count(*)=3 as ready from pg_trigger where not tgisinternal and tgenabled in('O','A') and(tgrelid,tgname) in
   ((to_regclass('commercial_payment_attestations'),'commercial_payment_attestations_guard'),(to_regclass('commercial_refund_attestations'),'commercial_refund_attestations_guard'),(to_regclass('commercial_fee_attestations'),'commercial_fee_attestations_guard'))`);
  if (!ready?.ready) throw new ServiceError("conflict", "Install the complete guarded commercial attestation schema before recording external money.");
  await ctx.tx.execute(sql`select set_config('freeholder.commercial_attestation_v1','1',true)`);
}
/** Called by recordOfflinePayment in its ordinary one transaction, after the
 * real manual payment attempt exists and before its actual recorded settlement. */
export async function captureCommercialPaymentAttestation(ctx: ServiceContext, payment: typeof payments.$inferSelect, evidence: { evidence: string; reference?: string }) {
  const [policy] = await ctx.tx.select().from(invoiceMarketPolicies).where(eq(invoiceMarketPolicies.invoiceId, payment.invoiceId)).limit(1);
  if (policy?.model !== "seller_merchant") return;
  if (payment.provider !== "manual" || !["cash", "bank_transfer", "cheque", "external_card", "other"].includes(payment.method))
    throw new ServiceError("permission", "Use the existing authorized offline-payment recording flow for commercial external money.");
  const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, payment.invoiceId)).limit(1);
  const parties = await ctx.tx.select().from(invoiceMerchantTaxQuotes).where(eq(invoiceMerchantTaxQuotes.invoiceId, payment.invoiceId)).limit(2);
  if (!invoice || invoice.sourceType !== "subscription" || !invoice.issuedAt || parties.length !== 1 || parties[0]!.sellerUserId !== policy.sellerUserId || invoice.currency !== payment.currency)
    throw new ServiceError("conflict", "Record this transfer against its exact original issued agreement, buyer, currency and declared merchant.");
  const [previous] = await ctx.tx.select().from(commercialPaymentAttestations).where(eq(commercialPaymentAttestations.paymentId, payment.id)).limit(1);
  const referenceDigest = merchantTaxDigest(evidence.reference ?? `manual:${payment.id}`), evidenceDigest = merchantTaxDigest(evidence.evidence);
  if (previous) {
    if (previous.invoiceId !== invoice.id || previous.amountMinor !== payment.amountMinor || previous.currency !== payment.currency || previous.referenceDigest !== referenceDigest || previous.evidenceDigest !== evidenceDigest)
      throw new ServiceError("conflict", "Preserve the first exact recorded external-payment attestation.");
    return;
  }
  const history = await commercialInvoiceCashHistory(ctx, invoice, payment.id);
  if (history.pending || invoice.totalMinor <= 0 || history.cash !== BigInt(invoice.paidMinor)) throw new ServiceError("conflict", "Resolve original refunded or outstanding commercial money before recording another principal against this invoice.");
  // This is a shared frozen policy obligation, not evidence of a collected
  // Stripe fee. Credited consideration remains a separately owned disposition.
  const { feeMinor: feeOwedMinor } = await invoiceCashFeeAllocation(ctx, invoice, policy.feeMinor, { amountMinor: payment.amountMinor, priorCashMinor: Number(history.cash), priorAllocatedFeeMinor: Number(history.allocatedFee) });
  if (!Number.isSafeInteger(feeOwedMinor) || feeOwedMinor < 0 || feeOwedMinor > payment.amountMinor) throw new ServiceError("conflict", "Reconcile the original shared commercial fee liability before another external record.");
  await attestationWriter(ctx);
  await ctx.tx.insert(commercialPaymentAttestations).values({ paymentId: payment.id, invoiceId: invoice.id, merchantProfileId: parties[0]!.profileId, profileVersion: parties[0]!.profileVersion,
    amountMinor: payment.amountMinor, currency: payment.currency, feeOwedMinor, originalOwnerDigest: merchantTaxDigest({ invoiceId: invoice.id, buyerId: invoice.contactId, policy, party: parties[0] }),
    referenceDigest, evidenceDigest, recordedBy: actorString(ctx.actor) });
}
export async function commercialPaymentRecorded(ctx: ServiceContext, paymentId: string) {
  const [record] = await ctx.tx.select().from(commercialPaymentAttestations).where(eq(commercialPaymentAttestations.paymentId, paymentId)).limit(1);
  return record ?? null;
}
export async function captureCommercialRefundAttestation(ctx: ServiceContext, refund: typeof refunds.$inferSelect, evidence: { reason: string; reference?: string }) {
  const record = await commercialPaymentRecorded(ctx, refund.paymentId); if (!record) return;
  if (refund.provider !== "manual" || refund.currency !== record.currency) throw new ServiceError("permission", "The actual authorized offline refund record must retain its original commercial payment origin.");
  const evidenceDigest = merchantTaxDigest(evidence), [existing] = await ctx.tx.select().from(commercialRefundAttestations).where(eq(commercialRefundAttestations.refundId, refund.id)).limit(1);
  if (existing) { if (existing.amountMinor !== refund.amountMinor || existing.evidenceDigest !== evidenceDigest) throw new ServiceError("conflict", "Preserve the first actual external refund record."); return; }
  await attestationWriter(ctx); await ctx.tx.insert(commercialRefundAttestations).values({ refundId: refund.id, paymentId: refund.paymentId, amountMinor: refund.amountMinor, currency: refund.currency, evidenceDigest, recordedBy: actorString(ctx.actor) });
}
export async function commercialRefundRecorded(ctx: ServiceContext, refund: typeof refunds.$inferSelect) {
  const [record] = await ctx.tx.select().from(commercialRefundAttestations).where(eq(commercialRefundAttestations.refundId, refund.id)).limit(1);
  return Boolean(record && refund.provider === "manual" && record.paymentId === refund.paymentId && record.amountMinor === refund.amountMinor && record.currency === refund.currency);
}
export const commercialPrincipalState = defineService({ name: "invoicing.commercialPrincipalState", summary: "Distinguish owner-recorded commercial principal and fee owed from independently verified provider settlement.",
  kind: "query", permission: "system", external: false, input: z.object({ paymentId: z.uuid() }),
  output: z.object({ recorded: z.boolean(), principalSafe: z.boolean(), feeOwedMinor: z.number().int().nonnegative(), feeRecordedMinor: z.number().int(), reviewRequired: z.boolean() }),
  handler: async ({ paymentId }, ctx) => {
    const record = await commercialPaymentRecorded(ctx, paymentId);
    if (!record) return { recorded: false, principalSafe: false, feeOwedMinor: 0, feeRecordedMinor: 0, reviewRequired: false };
    const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
    const returned = await ctx.tx.select().from(refunds).where(eq(refunds.paymentId, paymentId)).limit(5001);
    const recordedRefunds = await ctx.tx.select().from(commercialRefundAttestations).where(eq(commercialRefundAttestations.paymentId, paymentId)).limit(5001);
    const fees = await ctx.tx.select().from(commercialFeeAttestations).where(eq(commercialFeeAttestations.paymentId, paymentId)).limit(5001);
    const disputed = await ctx.tx.select({ id: paymentDisputes.id }).from(paymentDisputes).where(and(eq(paymentDisputes.paymentId, paymentId), inArray(paymentDisputes.status, ["open", "lost"]))).limit(1);
    const overflow = returned.length + recordedRefunds.length + fees.length > 5000;
    const returnedMinor = returned.filter(row => row.status === "succeeded").reduce((sum, row) => sum + BigInt(row.amountMinor), 0n);
    const feeRecordedMinor = fees.reduce((sum, row) => sum + BigInt(row.amountMinor) * (row.direction === "returned" ? -1n : 1n), 0n);
    const principalReview = overflow || disputed.length > 0 || !payment || payment.provider !== "manual" || payment.status !== "succeeded" || payment.amountMinor !== record.amountMinor || payment.currency !== record.currency
      || returned.some(row => ["created", "processing"].includes(row.status) || row.status === "succeeded" && !recordedRefunds.some(proof => proof.refundId === row.id && proof.amountMinor === row.amountMinor && proof.currency === row.currency))
      || returnedMinor !== BigInt(payment?.refundedMinor ?? 0);
    const feeOwedMinor = principalReview ? record.feeOwedMinor : recordedCommercialFeeTarget(record.amountMinor, record.feeOwedMinor, payment!.refundedMinor);
    const feeReview = feeRecordedMinor < 0n || feeRecordedMinor > BigInt(feeOwedMinor) || fees.some(row => row.direction === "returned" && !fees.some(original => original.id === row.originalRemittanceId && original.direction === "remitted" && original.paymentId === row.paymentId))
      || fees.filter(row => row.direction === "remitted").some(original => fees.filter(row => row.originalRemittanceId === original.id).reduce((sum, row) => sum + BigInt(row.amountMinor), 0n) > BigInt(original.amountMinor));
    return { recorded: true, principalSafe: !principalReview, feeOwedMinor, feeRecordedMinor: Number(feeRecordedMinor), reviewRequired: principalReview || feeReview };
  },
});
export const recordCommercialFee = defineService({ name: "invoicing.recordCommercialFee", summary: "Record an actual external merchant fee remittance against its original bounded liability; this is an attestation, not independent bank verification.",
  kind: "mutation", permission: "scoped", stepUp: true, writeClass: "money", auditInputFields: ["paymentId", "amountMinor", "direction", "originalRemittanceId"],
  input: z.object({ paymentId: z.uuid(), amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), direction: z.enum(["remitted", "returned"]).default("remitted"), originalRemittanceId: z.uuid().optional(), idempotencyKey: z.string().min(1).max(200), reference: z.string().min(1).max(300), evidence: z.string().min(3).max(1000) }).refine(value => value.direction === "returned" ? Boolean(value.originalRemittanceId) : !value.originalRemittanceId, "A fee return names its exact original recorded remittance."), output: z.object({ recorded: z.literal(true) }),
  handler: async (input, ctx) => {
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payment:${input.paymentId}`}))`);
    const original = await commercialPaymentRecorded(ctx, input.paymentId); if (!original) throw new ServiceError("not_found", "The original recorded commercial payment is unavailable.");
    const principal = await ctx.callAsSystem(commercialPrincipalState, { paymentId: input.paymentId });
    if (!principal.principalSafe) throw new ServiceError("conflict", "Reconcile this exact recorded principal and its original refund obligations before recording a fee remittance.");
    const hash = merchantTaxDigest(input), [prior] = await ctx.tx.select().from(commercialFeeAttestations).where(eq(commercialFeeAttestations.idempotencyKey, input.idempotencyKey)).limit(1);
    if (prior) { if (prior.paymentId !== input.paymentId || prior.requestDigest !== hash) throw new ServiceError("conflict", "Preserve this exact original fee remittance record."); return { recorded: true as const }; }
    const fees = await ctx.tx.select().from(commercialFeeAttestations).where(eq(commercialFeeAttestations.paymentId, input.paymentId)).limit(5001);
    const current = fees.reduce((sum, row) => sum + BigInt(row.amountMinor) * (row.direction === "returned" ? -1n : 1n), 0n);
    const originalRemittance = fees.find(row => row.id === input.originalRemittanceId && row.direction === "remitted");
    if (fees.length > 5000 || input.direction === "remitted" && current + BigInt(input.amountMinor) > BigInt(principal.feeOwedMinor)
      || input.direction === "returned" && (!originalRemittance || fees.filter(row => row.originalRemittanceId === originalRemittance.id).reduce((sum, row) => sum + BigInt(row.amountMinor), 0n) + BigInt(input.amountMinor) > BigInt(originalRemittance.amountMinor)))
      throw new ServiceError("conflict", "Record only the remaining original fee liability, or an actual return against its exact original remittance.");
    await attestationWriter(ctx); await ctx.tx.insert(commercialFeeAttestations).values({ id: randomUUID(), paymentId: input.paymentId, amountMinor: input.amountMinor, direction: input.direction, originalRemittanceId: input.originalRemittanceId ?? null, idempotencyKey: input.idempotencyKey, requestDigest: hash,
      evidenceDigest: merchantTaxDigest({ reference: input.reference, evidence: input.evidence }), recordedBy: actorString(ctx.actor) });
    ctx.setSubject("payment", input.paymentId); return { recorded: true as const };
  },
});
export const reviewCommercialPayment = defineService({ name: "invoicing.reviewCommercialPayment", summary: "Review original recorded external principal, actual fee remittance receipts and remaining original liability without claiming independent bank verification.",
  kind: "query", permission: "scoped", input: z.object({ paymentId: z.uuid() }),
  output: commercialPrincipalState.def.output.extend({ paymentId: z.uuid(), invoiceId: z.uuid(), currency: z.string(), amountMinor: z.number().int().positive(),
    receipts: z.array(z.object({ id: z.uuid(), direction: z.enum(["remitted", "returned"]), originalRemittanceId: z.uuid().nullable(), amountMinor: z.number().int().positive(), recordedBy: z.string(), createdAt: z.date() })) }),
  handler: async ({ paymentId }, ctx) => {
    const original = await commercialPaymentRecorded(ctx, paymentId); if (!original) throw new ServiceError("not_found", "This payment has no original recorded commercial principal.");
    const receipts = await ctx.tx.select({ id: commercialFeeAttestations.id, direction: commercialFeeAttestations.direction, originalRemittanceId: commercialFeeAttestations.originalRemittanceId,
      amountMinor: commercialFeeAttestations.amountMinor, recordedBy: commercialFeeAttestations.recordedBy, createdAt: commercialFeeAttestations.createdAt }).from(commercialFeeAttestations).where(eq(commercialFeeAttestations.paymentId, paymentId)).limit(5001);
    if (receipts.length > 5000) throw new ServiceError("conflict", "Restore the bounded complete original fee record inventory before review.");
    return { ...await ctx.callAsSystem(commercialPrincipalState, { paymentId }), paymentId, invoiceId: original.invoiceId, currency: original.currency, amountMinor: original.amountMinor, receipts };
  },
});
export const listCommercialRecordedPayments = defineService({ name: "invoicing.listCommercialRecordedPayments", summary: "List original attested external commercial principal and its remaining bounded fee duty for authorized review.",
  kind: "query", permission: "scoped", input: z.object({ limit: z.number().int().min(1).max(500).default(100) }),
  output: z.array(z.object({ paymentId: z.uuid(), invoiceNumber: z.string().nullable(), currency: z.string(), amountMinor: z.number().int().positive(),
    principalSafe: z.boolean(), feeOwedMinor: z.number().int().nonnegative(), feeRecordedMinor: z.number().int(), reviewRequired: z.boolean() })),
  handler: async ({ limit }, ctx) => {
    const rows = await ctx.tx.select({ paymentId: commercialPaymentAttestations.paymentId, invoiceNumber: invoices.number, currency: commercialPaymentAttestations.currency, amountMinor: commercialPaymentAttestations.amountMinor })
      .from(commercialPaymentAttestations).innerJoin(invoices, eq(invoices.id, commercialPaymentAttestations.invoiceId)).orderBy(commercialPaymentAttestations.createdAt, commercialPaymentAttestations.paymentId).limit(limit);
    const result = [];
    for (const row of rows) result.push({ ...row, ...await ctx.callAsSystem(commercialPrincipalState, { paymentId: row.paymentId }) });
    return result;
  },
});
export default [commercialPrincipalState, recordCommercialFee, reviewCommercialPayment, listCommercialRecordedPayments];
