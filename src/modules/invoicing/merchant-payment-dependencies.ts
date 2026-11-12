// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: bounded child-effect fingerprints follow the invoice's real owner.
import { and, asc, eq, inArray, isNotNull, or } from "drizzle-orm";
import type { Tx } from "@/core/service";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import { merchantFeeObservations, merchantFeeRefunds, merchantPaymentObservations, merchantPaymentRoutes } from "./merchant-collection-schema";
import { merchantInvoicePaymentRoutes } from "./merchant-invoice-scope-schema";
import { merchantPaymentCreationRefusals, merchantPaymentDispatches, merchantPaymentRequests, merchantPaymentRetirementAcks, merchantPaymentTerminalReceipts } from "./merchant-payment-recovery-schema";
import { merchantTaxDigest } from "./merchant-tax-store";
import { invoices, paymentDisputes, payments, refunds } from "./schema";

/** NULL makes the existing parent merge explicitly non-undoable. */
export async function invoiceMerchantDependencyFingerprints(tx: Tx, invoiceIds: readonly string[]): Promise<Map<string, string> | null> {
  if (!invoiceIds.length) return new Map();
  const owned = await tx.select({ payment: payments, orderRoute: merchantPaymentRoutes, singleRoute: merchantInvoicePaymentRoutes, agreementRoute: merchantAgreementPaymentRoutes }).from(payments)
    .leftJoin(merchantPaymentRoutes, eq(merchantPaymentRoutes.paymentId, payments.id)).leftJoin(merchantInvoicePaymentRoutes, eq(merchantInvoicePaymentRoutes.paymentId, payments.id))
    .leftJoin(merchantAgreementPaymentRoutes, eq(merchantAgreementPaymentRoutes.paymentId, payments.id))
    .where(and(inArray(payments.invoiceId, [...invoiceIds]), or(isNotNull(merchantPaymentRoutes.paymentId), isNotNull(merchantInvoicePaymentRoutes.paymentId), isNotNull(merchantAgreementPaymentRoutes.paymentId)))).orderBy(asc(payments.id)).limit(5001);
  // Ordinary legacy invoice history retains its existing undo contract.
  const scoped = owned.filter(row => row.orderRoute || row.singleRoute || row.agreementRoute);
  if (owned.length > 5000) return null;
  if (!scoped.length) return new Map();
  const paymentIds = scoped.map(row => row.payment.id), scopedInvoiceIds = [...new Set(scoped.map(row => row.payment.invoiceId))];
  const parent = await tx.select().from(invoices).where(inArray(invoices.id, scopedInvoiceIds)).orderBy(asc(invoices.id));
  const requests = await tx.select().from(merchantPaymentRequests).where(inArray(merchantPaymentRequests.paymentId, paymentIds)).orderBy(asc(merchantPaymentRequests.paymentId)).limit(5001);
  const dispatches = await tx.select().from(merchantPaymentDispatches).where(inArray(merchantPaymentDispatches.paymentId, paymentIds)).orderBy(asc(merchantPaymentDispatches.id)).limit(5001);
  const acks = await tx.select().from(merchantPaymentRetirementAcks).where(inArray(merchantPaymentRetirementAcks.paymentId, paymentIds)).orderBy(asc(merchantPaymentRetirementAcks.id)).limit(5001);
  const terminals = await tx.select().from(merchantPaymentTerminalReceipts).where(inArray(merchantPaymentTerminalReceipts.paymentId, paymentIds)).orderBy(asc(merchantPaymentTerminalReceipts.paymentId)).limit(5001);
  const observed = await tx.select().from(merchantPaymentObservations).where(inArray(merchantPaymentObservations.paymentId, paymentIds)).orderBy(asc(merchantPaymentObservations.id)).limit(5001);
  const feeOperations = await tx.select().from(merchantFeeRefunds).where(inArray(merchantFeeRefunds.paymentId, paymentIds)).orderBy(asc(merchantFeeRefunds.id)).limit(5001);
  const customerRefunds = await tx.select().from(refunds).where(inArray(refunds.paymentId, paymentIds)).orderBy(asc(refunds.id)).limit(5001);
  const disputes = await tx.select().from(paymentDisputes).where(inArray(paymentDisputes.paymentId, paymentIds)).orderBy(asc(paymentDisputes.id)).limit(5001);
  let count = scoped.length + parent.length + requests.length + dispatches.length + acks.length + terminals.length + observed.length + feeOperations.length + customerRefunds.length + disputes.length;
  if (count > 5000) return null;
  const refusals = dispatches.length ? await tx.select().from(merchantPaymentCreationRefusals).where(inArray(merchantPaymentCreationRefusals.dispatchId, dispatches.map(row => row.id))).orderBy(asc(merchantPaymentCreationRefusals.dispatchId)).limit(5001) : [];
  const feeAcks = feeOperations.length ? await tx.select().from(merchantFeeObservations).where(inArray(merchantFeeObservations.operationId, feeOperations.map(row => row.id))).orderBy(asc(merchantFeeObservations.id)).limit(5001) : [];
  count += refusals.length + feeAcks.length;
  if (count > 5000) return null;
  return new Map(parent.map(invoice => {
    const money = scoped.filter(row => row.payment.invoiceId === invoice.id), ids = new Set(money.map(row => row.payment.id));
    const sends = dispatches.filter(row => ids.has(row.paymentId)), sendIds = new Set(sends.map(row => row.id));
    const fees = feeOperations.filter(row => ids.has(row.paymentId)), feeIds = new Set(fees.map(row => row.id));
    return [invoice.id, merchantTaxDigest({ invoice, money, requests: requests.filter(row => ids.has(row.paymentId)), dispatches: sends,
      refusals: refusals.filter(row => sendIds.has(row.dispatchId)), acks: acks.filter(row => ids.has(row.paymentId)), terminals: terminals.filter(row => ids.has(row.paymentId)),
      observed: observed.filter(row => ids.has(row.paymentId)), fees, feeAcks: feeAcks.filter(row => feeIds.has(row.operationId)),
      customerRefunds: customerRefunds.filter(row => ids.has(row.paymentId)), disputes: disputes.filter(row => ids.has(row.paymentId)) })];
  }));
}

/** The privacy parent already proved ownership through invoices.contact_id. */
export async function exportMerchantRecoveryHistory(tx: Tx, invoiceIds: readonly string[]) {
  if (!invoiceIds.length) return { requests: [], dispatches: [], refusals: [], retirementAcks: [], terminalReceipts: [], moneyObservations: [], feeOperations: [], feeAcknowledgements: [] };
  const ownedPayments = tx.select({ id: payments.id }).from(payments).where(inArray(payments.invoiceId, [...invoiceIds]));
  const ownedDispatches = tx.select({ id: merchantPaymentDispatches.id }).from(merchantPaymentDispatches).where(inArray(merchantPaymentDispatches.paymentId, ownedPayments));
  const ownedFees = tx.select({ id: merchantFeeRefunds.id }).from(merchantFeeRefunds).where(inArray(merchantFeeRefunds.paymentId, ownedPayments));
  return {
    requests: await tx.select().from(merchantPaymentRequests).where(inArray(merchantPaymentRequests.paymentId, ownedPayments)).orderBy(asc(merchantPaymentRequests.paymentId)),
    dispatches: await tx.select().from(merchantPaymentDispatches).where(inArray(merchantPaymentDispatches.paymentId, ownedPayments)).orderBy(asc(merchantPaymentDispatches.id)),
    refusals: await tx.select().from(merchantPaymentCreationRefusals).where(inArray(merchantPaymentCreationRefusals.dispatchId, ownedDispatches)).orderBy(asc(merchantPaymentCreationRefusals.dispatchId)),
    retirementAcks: await tx.select().from(merchantPaymentRetirementAcks).where(inArray(merchantPaymentRetirementAcks.paymentId, ownedPayments)).orderBy(asc(merchantPaymentRetirementAcks.id)),
    terminalReceipts: await tx.select().from(merchantPaymentTerminalReceipts).where(inArray(merchantPaymentTerminalReceipts.paymentId, ownedPayments)).orderBy(asc(merchantPaymentTerminalReceipts.paymentId)),
    moneyObservations: await tx.select().from(merchantPaymentObservations).where(inArray(merchantPaymentObservations.paymentId, ownedPayments)).orderBy(asc(merchantPaymentObservations.id)),
    feeOperations: await tx.select().from(merchantFeeRefunds).where(inArray(merchantFeeRefunds.paymentId, ownedPayments)).orderBy(asc(merchantFeeRefunds.id)),
    feeAcknowledgements: await tx.select().from(merchantFeeObservations).where(inArray(merchantFeeObservations.operationId, ownedFees)).orderBy(asc(merchantFeeObservations.id)),
  };
}
