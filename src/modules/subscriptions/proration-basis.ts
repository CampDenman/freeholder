// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C12.38: only the actual paid original line and exact consideration fund unused credit.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getService, ServiceError, type ServiceContext } from "@/core/service";
import { invoices, invoiceLines, payments } from "@/modules/invoicing/schema";
import { invoiceCreditApplications, invoiceCreditFunding, invoiceCreditReservations } from "@/modules/invoicing/credit-application-schema";
import { invoiceSettled } from "@/modules/invoicing/invoice-balance";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { prorationMoneyWitnesses } from "@/modules/invoicing/proration-money-witnesses";
import { principalAuthorityResult } from "@/modules/invoicing/principal-authority-contract";
import { originalCreditFeeAllocation, type FeeCollectionState } from "@/modules/invoicing/credit-fee-origin";
import { subscriptionProrations } from "./proration-schema";
import type { subscriptions } from "./schema";
import { proratedAmounts } from "./proration-amounts";

type Parent = typeof subscriptions.$inferSelect;
export type ProrationPrincipal = { sourcePaymentId: string; sourceApplicationId: string | null; amountMinor: number;
  feeObligationMinor: number; feeProvenCollectedMinor: number; feeCollectionState: FeeCollectionState; feeEvidenceDigest: string; feeUnexpected: boolean };
export async function safeProrationPrincipal(ctx: ServiceContext, paymentId: string) {
  const authority = getService("invoicing.originalPrincipalAuthority");
  if (!authority) throw new ServiceError("conflict", "Restore the original principal recovery authority before promising unused paid credit.");
  const state = principalAuthorityResult.parse(await ctx.callAsSystem(authority, { paymentId }));
  if (!state.principalSafe || state.witness.paymentId !== paymentId) throw new ServiceError("conflict", "Resolve this exact original principal, actual callers and refund duties before quoting its unused value.");
  return state;
}

export async function paidProrationBasis(ctx: ServiceContext, parent: Parent, effectiveAt: Date) {
  if (!(effectiveAt > new Date()) || effectiveAt < parent.currentPeriodStart || effectiveAt >= parent.currentPeriodEnd)
    throw new ServiceError("conflict", "Choose a fresh future effective instant inside the actual original period; expired consent cannot backdate access or a charge.");
  if (parent.status === "trialing") {
    if (!parent.trialEndsAt || parent.trialEndsAt.getTime() !== parent.currentPeriodEnd.getTime()) throw new ServiceError("conflict", "Restore the actual accepted trial end before changing its plan.");
    return { invoice: null, line: null, periodStart: parent.currentPeriodStart, periodEnd: parent.currentPeriodEnd,
      creditNetMinor: 0, creditTaxMinor: 0, principal: [] as ProrationPrincipal[], sourceRevision: merchantTaxDigest({ parent, trialPolicy: "preserve_end_zero_paid_principal" }) };
  }
  if (parent.status !== "active") throw new ServiceError("conflict", "Resolve the actual current paid period before a mid-cycle change.");
  const [previous] = await ctx.tx.select().from(subscriptionProrations).where(and(eq(subscriptionProrations.subscriptionId, parent.id), eq(subscriptionProrations.state, "applied"),
    eq(subscriptionProrations.originalPeriodStart, parent.currentPeriodStart), eq(subscriptionProrations.originalPeriodEnd, parent.currentPeriodEnd)))
    .orderBy(desc(subscriptionProrations.effectiveAt), desc(subscriptionProrations.createdAt)).limit(1);
  if (previous && (previous.planId !== parent.planId || previous.effectiveAt > new Date() || !previous.debitInvoiceId))
    throw new ServiceError("conflict", "Restore the actual applied plan, canonical consideration and original paid interval before another change.");
  const [invoice] = previous?.debitInvoiceId
    ? await ctx.tx.select().from(invoices).where(eq(invoices.id, previous.debitInvoiceId)).limit(1)
    : await ctx.tx.select().from(invoices).where(and(eq(invoices.sourceType, "subscription"), eq(invoices.sourceId, `${parent.id}:${parent.currentPeriodStart.toISOString()}`))).limit(1);
  if (!invoice || invoice.contactId !== parent.contactId || invoice.currency !== parent.currency || invoice.status !== "paid" || !invoiceSettled(invoice) || invoice.refundedMinor !== 0)
    throw new ServiceError("conflict", "Only the exact fully settled, unreturned original invoice can fund unused-period credit.");
  const lines = await ctx.tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoice.id)).orderBy(invoiceLines.position).limit(3);
  const eligible = lines.filter(line => { const proof = line.snapshot as Record<string, unknown>;
    return line.sourceType === "subscription" && line.sourceId === parent.id && line.quantityMicros === 1000000 && line.discountMinor === 0
      && (previous ? proof.subscriptionProrationId === previous.id && proof.subscriptionComponent === "proration_debit" : proof.subscriptionComponent === "period"
        && proof.subscriptionPeriodStart === parent.currentPeriodStart.toISOString() && proof.subscriptionPeriodEnd === parent.currentPeriodEnd.toISOString()); });
  if (lines.length > 2 || eligible.length !== 1) throw new ServiceError("conflict", "Restore the one exact originally paid period line; setup or unrelated equal-price lines cannot fund its unused credit.");
  const line = eligible[0]!, periodStart = previous?.effectiveAt ?? parent.currentPeriodStart, periodEnd = parent.currentPeriodEnd;
  const creditNetMinor = proratedAmounts(line.subtotalMinor, 0, periodStart, periodEnd, effectiveAt).oldUnusedMinor;
  const creditTaxMinor = proratedAmounts(line.taxMinor, 0, periodStart, periodEnd, effectiveAt).oldUnusedMinor;
  const cash = await ctx.tx.select().from(payments).where(eq(payments.invoiceId, invoice.id)).orderBy(payments.createdAt, payments.id).limit(1001);
  const inherited = await ctx.tx.select({ application: invoiceCreditApplications, reservation: invoiceCreditReservations, funding: invoiceCreditFunding }).from(invoiceCreditApplications)
    .innerJoin(invoiceCreditReservations, eq(invoiceCreditReservations.id, invoiceCreditApplications.reservationId))
    .innerJoin(invoiceCreditFunding, eq(invoiceCreditFunding.id, invoiceCreditReservations.fundingId)).where(eq(invoiceCreditApplications.invoiceId, invoice.id))
    .orderBy(invoiceCreditApplications.createdAt, invoiceCreditApplications.reservationId).limit(1001);
  if (cash.length + inherited.length > 1000 || cash.some(row => ["created", "processing"].includes(row.status))
    || cash.filter(row => row.status === "succeeded").reduce((sum, row) => sum + BigInt(row.amountMinor), 0n) !== BigInt(invoice.paidMinor)
    || inherited.reduce((sum, row) => sum + BigInt(row.reservation.amountMinor), 0n) !== BigInt(invoice.creditedMinor))
    throw new ServiceError("conflict", "Restore the complete original cash and immutable noncash applications; an unknown caller or partial inventory cannot supply credit.");
  const { assertInvoiceMerchantCreatorsQuiesced } = await import("@/modules/invoicing/merchant-payment-request");
  const { assertNoUnappliedMerchantCharge } = await import("@/modules/invoicing/merchant-payment-observations");
  await assertInvoiceMerchantCreatorsQuiesced(ctx, invoice.id); await assertNoUnappliedMerchantCharge(ctx, invoice.id);
  const witness = await prorationMoneyWitnesses(ctx.tx, [invoice.id]);
  if (witness.incomplete) throw new ServiceError("conflict", "Restore the bounded complete original credit lineage before quoting another promise.");
  const principal: ProrationPrincipal[] = [], currentFacts: unknown[] = [];
  let remaining = BigInt(creditNetMinor) + BigInt(creditTaxMinor);
  for (const payment of cash.filter(row => row.status === "succeeded")) {
    if (payment.refundedMinor !== 0) throw new ServiceError("conflict", "Returned original principal cannot fund another unused credit.");
    currentFacts.push({ paymentId: payment.id, state: await safeProrationPrincipal(ctx, payment.id) });
    const [budget] = await ctx.tx.execute<{ available: string }>(sql`select freeholder_proration_principal_capacity(${payment.id}::uuid,null)::text as available`);
    const take = remaining < BigInt(budget?.available ?? "0") ? remaining : BigInt(budget?.available ?? "0");
    if (take > 0n) { const fee = await originalCreditFeeAllocation(ctx, payment.id, null, Number(take)); principal.push({ sourcePaymentId: payment.id, sourceApplicationId: null, amountMinor: Number(take),
      feeObligationMinor: fee.feeObligationMinor, feeProvenCollectedMinor: fee.provenCollectedMinor, feeCollectionState: fee.collectionState, feeEvidenceDigest: fee.evidenceDigest, feeUnexpected: fee.unexpectedFee }); remaining -= take; }
  }
  const inheritedIds = [...new Set(inherited.map(row => row.funding.sourcePaymentId))];
  const inheritedCash = inheritedIds.length ? await ctx.tx.select().from(payments).where(inArray(payments.id, inheritedIds)).limit(1001) : [];
  for (const row of inherited) {
    const payment = inheritedCash.find(value => value.id === row.funding.sourcePaymentId);
    if (!payment || payment.status !== "succeeded" || payment.refundedMinor !== 0 || payment.currency !== parent.currency) throw new ServiceError("conflict", "Restore the exact actual principal behind the original applied credit.");
    currentFacts.push({ paymentId: payment.id, applicationId: row.application.reservationId, state: await safeProrationPrincipal(ctx, payment.id) });
    const [budget] = await ctx.tx.execute<{ available: string }>(sql`select freeholder_proration_principal_capacity(${payment.id}::uuid,${row.application.reservationId}::uuid)::text as available`);
    const take = remaining < BigInt(budget?.available ?? "0") ? remaining : BigInt(budget?.available ?? "0");
    if (take > 0n) { const fee = await originalCreditFeeAllocation(ctx, payment.id, row.application.reservationId, Number(take)); principal.push({ sourcePaymentId: payment.id, sourceApplicationId: row.application.reservationId, amountMinor: Number(take),
      feeObligationMinor: fee.feeObligationMinor, feeProvenCollectedMinor: fee.provenCollectedMinor, feeCollectionState: fee.collectionState, feeEvidenceDigest: fee.evidenceDigest, feeUnexpected: fee.unexpectedFee }); remaining -= take; }
  }
  if (remaining) throw new ServiceError("conflict", "The original unused principal already backs another credit or refund promise; recover that exact ownership before another quote.");
  return { invoice, line, periodStart, periodEnd, creditNetMinor, creditTaxMinor, principal,
    sourceRevision: merchantTaxDigest({ parent, previous, invoice, line, cash, inherited, currentFacts, witness, principal, effectiveAt: effectiveAt.toISOString() }) };
}
