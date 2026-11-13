// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: bounded child-effect fingerprints follow the invoice's real owner.
import { and, asc, eq, inArray, isNotNull, or } from "drizzle-orm";
import type { Tx } from "@/core/service";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import { merchantFeeObservations, merchantFeeRefunds, merchantPaymentObservations, merchantPaymentRoutes } from "./merchant-collection-schema";
import { merchantInvoicePaymentRoutes } from "./merchant-invoice-scope-schema";
import { merchantPaymentCreationRefusals, merchantPaymentDispatches, merchantPaymentDispatchFinishes, merchantPaymentDispatchStops, merchantPaymentResourceBindings, merchantPaymentRequests, merchantPaymentRetirementAcks, merchantPaymentTerminalReceipts } from "./merchant-payment-recovery-schema";
import { legacyBankReads } from "./legacy-bank-read-schema";
import { legacyBankReadFinancialWitness } from "./legacy-bank-read-witness";
import { merchantRefundDependencyFingerprints } from "./merchant-refund-dependencies";
import { merchantTaxDigest } from "./merchant-tax-store";
import { invoices, paymentDisputes, payments, refunds } from "./schema";

/** NULL makes the existing parent merge explicitly non-undoable.
 * The default is the buyer's complete invoice. A seller caller must derive
 * originalPaymentIds from its actual frozen routes, never a caller's filter.
 */
export async function invoiceMerchantDependencyFingerprints(tx: Tx, invoiceIds: readonly string[], originalPaymentIds?: readonly string[]): Promise<Map<string, string> | null> {
  if (!invoiceIds.length) return new Map();
  if (originalPaymentIds && originalPaymentIds.length > 5000) return null;
  if (originalPaymentIds && !originalPaymentIds.length) return new Map();
  // New authenticated legacy read children also belong to ordinary invoices
  // that have no new-model route. Existing history with no such read keeps
  // its prior undo contract. Seller callers retain their exact payment filter.
  const legacyReferences = await tx.select({ refundId: refunds.id, invoiceId: payments.invoiceId }).from(legacyBankReads)
    .innerJoin(refunds, eq(refunds.id, legacyBankReads.refundId)).innerJoin(payments, eq(payments.id, refunds.paymentId))
    .where(and(inArray(payments.invoiceId, [...invoiceIds]), originalPaymentIds ? inArray(payments.id, [...originalPaymentIds]) : undefined))
    .orderBy(asc(payments.invoiceId), asc(refunds.id)).limit(5001);
  if (legacyReferences.length > 5000) return null;
  const legacyFinancial = new Map<string, string>();
  if (legacyReferences.length) {
    const history = await legacyBankReadFinancialWitness(tx, legacyReferences.map(row => row.refundId));
    if (history.reads.length + history.facts.length + history.finishes.length + history.current.length > 5000) return null;
    for (const invoiceId of [...new Set(legacyReferences.map(row => row.invoiceId))]) {
      const refundIds = new Set(legacyReferences.filter(row => row.invoiceId === invoiceId).map(row => row.refundId));
      const reads = history.reads.filter(row => refundIds.has(row.refundId)), readIds = new Set(reads.map(row => row.id));
      const current = history.current.filter(row => readIds.has(row.readId));
      legacyFinancial.set(invoiceId, merchantTaxDigest({ reads, facts: history.facts.filter(row => readIds.has(row.readId)), finishes: history.finishes.filter(row => readIds.has(row.readId)),
        ...(current.length ? { current } : {}) }));
    }
  }
  const owned = await tx.select({ payment: payments, orderRoute: merchantPaymentRoutes, singleRoute: merchantInvoicePaymentRoutes, agreementRoute: merchantAgreementPaymentRoutes }).from(payments)
    .leftJoin(merchantPaymentRoutes, eq(merchantPaymentRoutes.paymentId, payments.id)).leftJoin(merchantInvoicePaymentRoutes, eq(merchantInvoicePaymentRoutes.paymentId, payments.id))
    .leftJoin(merchantAgreementPaymentRoutes, eq(merchantAgreementPaymentRoutes.paymentId, payments.id))
    .where(and(inArray(payments.invoiceId, [...invoiceIds]), originalPaymentIds ? inArray(payments.id, [...originalPaymentIds]) : undefined,
      or(isNotNull(merchantPaymentRoutes.paymentId), isNotNull(merchantInvoicePaymentRoutes.paymentId), isNotNull(merchantAgreementPaymentRoutes.paymentId)))).orderBy(asc(payments.id)).limit(5001);
  // Ordinary legacy invoice history retains its existing undo contract.
  const scoped = owned.filter(row => row.orderRoute || row.singleRoute || row.agreementRoute);
  if (owned.length > 5000) return null;
  if (!scoped.length) return legacyFinancial;
  const paymentIds = scoped.map(row => row.payment.id), scopedInvoiceIds = [...new Set(scoped.map(row => row.payment.invoiceId))];
  const parent = await tx.select().from(invoices).where(inArray(invoices.id, scopedInvoiceIds)).orderBy(asc(invoices.id));
  const requests = await tx.select().from(merchantPaymentRequests).where(inArray(merchantPaymentRequests.paymentId, paymentIds)).orderBy(asc(merchantPaymentRequests.paymentId)).limit(5001);
  const dispatches = await tx.select().from(merchantPaymentDispatches).where(inArray(merchantPaymentDispatches.paymentId, paymentIds)).orderBy(asc(merchantPaymentDispatches.id)).limit(5001);
  const bindings = await tx.select().from(merchantPaymentResourceBindings).where(inArray(merchantPaymentResourceBindings.paymentId, paymentIds)).orderBy(asc(merchantPaymentResourceBindings.id)).limit(5001);
  const acks = await tx.select().from(merchantPaymentRetirementAcks).where(inArray(merchantPaymentRetirementAcks.paymentId, paymentIds)).orderBy(asc(merchantPaymentRetirementAcks.id)).limit(5001);
  const terminals = await tx.select().from(merchantPaymentTerminalReceipts).where(inArray(merchantPaymentTerminalReceipts.paymentId, paymentIds)).orderBy(asc(merchantPaymentTerminalReceipts.paymentId)).limit(5001);
  const observed = await tx.select().from(merchantPaymentObservations).where(inArray(merchantPaymentObservations.paymentId, paymentIds)).orderBy(asc(merchantPaymentObservations.id)).limit(5001);
  const feeOperations = await tx.select().from(merchantFeeRefunds).where(inArray(merchantFeeRefunds.paymentId, paymentIds)).orderBy(asc(merchantFeeRefunds.id)).limit(5001);
  const customerRefunds = await tx.select().from(refunds).where(inArray(refunds.paymentId, paymentIds)).orderBy(asc(refunds.id)).limit(5001);
  const disputes = await tx.select().from(paymentDisputes).where(inArray(paymentDisputes.paymentId, paymentIds)).orderBy(asc(paymentDisputes.id)).limit(5001);
  let count = scoped.length + parent.length + requests.length + dispatches.length + bindings.length + acks.length + terminals.length + observed.length + feeOperations.length + customerRefunds.length + disputes.length;
  if (count > 5000) return null;
  const refusals = dispatches.length ? await tx.select().from(merchantPaymentCreationRefusals).where(inArray(merchantPaymentCreationRefusals.dispatchId, dispatches.map(row => row.id))).orderBy(asc(merchantPaymentCreationRefusals.dispatchId)).limit(5001) : [];
  const finishes = dispatches.length ? await tx.select().from(merchantPaymentDispatchFinishes).where(inArray(merchantPaymentDispatchFinishes.dispatchId, dispatches.map(row => row.id))).orderBy(asc(merchantPaymentDispatchFinishes.dispatchId)).limit(5001) : [];
  const stops = dispatches.length ? await tx.select().from(merchantPaymentDispatchStops).where(inArray(merchantPaymentDispatchStops.dispatchId, dispatches.map(row => row.id))).orderBy(asc(merchantPaymentDispatchStops.dispatchId)).limit(5001) : [];
  const feeAcks = feeOperations.length ? await tx.select().from(merchantFeeObservations).where(inArray(merchantFeeObservations.operationId, feeOperations.map(row => row.id))).orderBy(asc(merchantFeeObservations.id)).limit(5001) : [];
  count += refusals.length + feeAcks.length + finishes.length + stops.length;
  if (count > 5000) return null;
  // These invoices are one original contact-merge cohort. Any late financial
  // child makes the operation non-undoable, without adding unparsed fields to
  // the existing invoice reference receipt.
  const refundChildren = await merchantRefundDependencyFingerprints(tx, { paymentIds,
    subscriptionChargeReceiptIds: scoped.map(row => row.agreementRoute?.originalChargeReceiptId).filter((id): id is string => Boolean(id)) });
  if (refundChildren.incomplete || count + refundChildren.entries.length > 5000) return null;
  const result = new Map(parent.map(invoice => {
    const money = scoped.filter(row => row.payment.invoiceId === invoice.id), ids = new Set(money.map(row => row.payment.id));
    const sends = dispatches.filter(row => ids.has(row.paymentId)), sendIds = new Set(sends.map(row => row.id));
    const fees = feeOperations.filter(row => ids.has(row.paymentId)), feeIds = new Set(fees.map(row => row.id));
    // Aggregate refunded/paid totals and the buyer's personal fields cover
    // every merchant. They cannot become another seller's financial history.
    const originalInvoice = originalPaymentIds ? { id: invoice.id, sourceType: invoice.sourceType, sourceId: invoice.sourceId, currency: invoice.currency } : invoice;
    return [invoice.id, merchantTaxDigest({ invoice: originalInvoice, money, refundChildren, requests: requests.filter(row => ids.has(row.paymentId)), dispatches: sends, bindings: bindings.filter(row => ids.has(row.paymentId)),
      refusals: refusals.filter(row => sendIds.has(row.dispatchId)), finishes: finishes.filter(row => sendIds.has(row.dispatchId)), stops: stops.filter(row => sendIds.has(row.dispatchId)), acks: acks.filter(row => ids.has(row.paymentId)), terminals: terminals.filter(row => ids.has(row.paymentId)),
      observed: observed.filter(row => ids.has(row.paymentId)), fees, feeAcks: feeAcks.filter(row => feeIds.has(row.operationId)),
      customerRefunds: customerRefunds.filter(row => ids.has(row.paymentId)), disputes: disputes.filter(row => ids.has(row.paymentId)) })];
  }));
  for (const [invoiceId, legacy] of legacyFinancial) {
    const current = result.get(invoiceId);
    result.set(invoiceId, current ? merchantTaxDigest({ financial: current, legacy }) : legacy);
  }
  return result;
}

/** The privacy parent already proved ownership through invoices.contact_id. */
export async function exportMerchantRecoveryHistory(tx: Tx, invoiceIds: readonly string[]) {
  if (!invoiceIds.length) return { requests: [], dispatches: [], finishes: [], stoppedCallers: [], refusals: [], retirementAcks: [], terminalReceipts: [], moneyObservations: [], feeOperations: [], feeAcknowledgements: [] };
  const ownedPayments = tx.select({ id: payments.id }).from(payments).where(inArray(payments.invoiceId, [...invoiceIds]));
  const ownedDispatches = tx.select({ id: merchantPaymentDispatches.id }).from(merchantPaymentDispatches).where(inArray(merchantPaymentDispatches.paymentId, ownedPayments));
  const ownedFees = tx.select({ id: merchantFeeRefunds.id }).from(merchantFeeRefunds).where(inArray(merchantFeeRefunds.paymentId, ownedPayments));
  return {
    requests: await tx.select().from(merchantPaymentRequests).where(inArray(merchantPaymentRequests.paymentId, ownedPayments)).orderBy(asc(merchantPaymentRequests.paymentId)),
    dispatches: await tx.select({ id: merchantPaymentDispatches.id, paymentId: merchantPaymentDispatches.paymentId, ordinal: merchantPaymentDispatches.ordinal, requestDigest: merchantPaymentDispatches.requestDigest, dispatchedAt: merchantPaymentDispatches.dispatchedAt }).from(merchantPaymentDispatches).where(inArray(merchantPaymentDispatches.paymentId, ownedPayments)).orderBy(asc(merchantPaymentDispatches.id)),
    finishes: await tx.select({ dispatchId: merchantPaymentDispatchFinishes.dispatchId, outcome: merchantPaymentDispatchFinishes.outcome, finishedAt: merchantPaymentDispatchFinishes.finishedAt }).from(merchantPaymentDispatchFinishes).where(inArray(merchantPaymentDispatchFinishes.dispatchId, ownedDispatches)).orderBy(asc(merchantPaymentDispatchFinishes.dispatchId)),
    stoppedCallers: await tx.select({ dispatchId: merchantPaymentDispatchStops.dispatchId, reviewedAt: merchantPaymentDispatchStops.reviewedAt }).from(merchantPaymentDispatchStops).where(inArray(merchantPaymentDispatchStops.dispatchId, ownedDispatches)).orderBy(asc(merchantPaymentDispatchStops.dispatchId)),
    refusals: await tx.select().from(merchantPaymentCreationRefusals).where(inArray(merchantPaymentCreationRefusals.dispatchId, ownedDispatches)).orderBy(asc(merchantPaymentCreationRefusals.dispatchId)),
    retirementAcks: await tx.select().from(merchantPaymentRetirementAcks).where(inArray(merchantPaymentRetirementAcks.paymentId, ownedPayments)).orderBy(asc(merchantPaymentRetirementAcks.id)),
    terminalReceipts: await tx.select().from(merchantPaymentTerminalReceipts).where(inArray(merchantPaymentTerminalReceipts.paymentId, ownedPayments)).orderBy(asc(merchantPaymentTerminalReceipts.paymentId)),
    moneyObservations: await tx.select().from(merchantPaymentObservations).where(inArray(merchantPaymentObservations.paymentId, ownedPayments)).orderBy(asc(merchantPaymentObservations.id)),
    feeOperations: await tx.select().from(merchantFeeRefunds).where(inArray(merchantFeeRefunds.paymentId, ownedPayments)).orderBy(asc(merchantFeeRefunds.id)),
    feeAcknowledgements: await tx.select().from(merchantFeeObservations).where(inArray(merchantFeeObservations.operationId, ownedFees)).orderBy(asc(merchantFeeObservations.id)),
  };
}
