// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: bounded child-effect fingerprints follow the invoice's real owner.
import { and, asc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { ServiceError, type Tx } from "@/core/service";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import { merchantFeeObservations, merchantFeeRefunds, merchantPaymentObservations, merchantPaymentRoutes } from "./merchant-collection-schema";
import { merchantInvoicePaymentRoutes } from "./merchant-invoice-scope-schema";
import { merchantPaymentCreationRefusals, merchantPaymentDispatches, merchantPaymentDispatchFinishes, merchantPaymentDispatchStops, merchantPaymentResourceBindings, merchantPaymentRequests, merchantPaymentRetirementAcks, merchantPaymentTerminalReceipts } from "./merchant-payment-recovery-schema";
import { legacyBankReads } from "./legacy-bank-read-schema";
import { legacyBankReadFinancialWitness } from "./legacy-bank-read-witness";
import { merchantRefundDependencyFingerprints } from "./merchant-refund-dependencies";
import { merchantTaxDigest } from "./merchant-tax-store";
import { exportOriginalCashHistory, originalCashForInvoice, originalCashInvoiceHistory } from "./original-cash-invoice-history";
import { invoices, paymentDisputes, payments, refunds } from "./schema";
import { controlledFinancialTables, controlledFinancialWitness, type ControlledFinancialEntry } from "./controlled-provider-financial-witness";
import { prorationFinancialWitness } from "./proration-financial-witness";
import { cashInspectionFinancialWitness, exportCashInspectionStops, exportControlledCashInspectionLineages } from "./merchant-cash-inspection-financial";

/** NULL makes the existing parent merge explicitly non-undoable.
 * The default is the buyer's complete invoice. A seller caller must derive
 * originalPaymentIds from its actual frozen routes, never a caller's filter.
 */
export async function invoiceMerchantDependencyFingerprints(tx: Tx, invoiceIds: readonly string[], originalPaymentIds?: readonly string[], additionalWitnessCount = 0, additionalControlledEntries: readonly ControlledFinancialEntry[] = []): Promise<Map<string, string> | null> {
  if (!Number.isSafeInteger(additionalWitnessCount) || additionalWitnessCount < 0 || additionalWitnessCount > 5000 || invoiceIds.length > 5000) return null;
  const externalControlled = new Map<string, string>();
  for (const row of additionalControlledEntries) {
    if (!z.uuid().safeParse(row.id).success || !Object.values(controlledFinancialTables).some(table => table === row.table) || !/^[a-f0-9]{64}$/.test(row.fingerprint)) return null;
    const key = `${row.table}:${row.id}`, previous = externalControlled.get(key);
    if (previous && previous !== row.fingerprint) return null; externalControlled.set(key, row.fingerprint);
  }
  if (externalControlled.size > additionalWitnessCount) return null;
  if (!invoiceIds.length) return new Map();
  if (originalPaymentIds && originalPaymentIds.length > 5000) return null;
  if (originalPaymentIds && !originalPaymentIds.length) return new Map();
  // Buyer-owned invoices include promises and attested money before any
  // provider route/payment exists. Merchant collection callers separately
  // select their exact frozen profile/allocation children; their payment
  // filter cannot authorize another merchant's whole invoice history.
  const prorationFinancial = originalPaymentIds === undefined
    ? await prorationFinancialWitness(tx, { kind: "invoice", ids: invoiceIds })
    : { version: 1 as const, entries: [], incomplete: false };
  if (prorationFinancial.incomplete) return null;
  const controlledFinancial = originalPaymentIds === undefined
    ? await controlledFinancialWitness(tx, { invoiceIds })
    : { entries: [], incomplete: false };
  if (controlledFinancial.incomplete) return null;
  if (controlledFinancial.entries.some(row => externalControlled.has(`${row.table}:${row.id}`) && externalControlled.get(`${row.table}:${row.id}`) !== row.fingerprint)) return null;
  let additionalCount = additionalWitnessCount + prorationFinancial.entries.length + controlledFinancial.entries.filter(row => !externalControlled.has(`${row.table}:${row.id}`)).length;
  let prorationInvoiceIds: string[] = [];
  const originalCash = await originalCashInvoiceHistory(tx, invoiceIds, originalPaymentIds);
  const inspectionStops = await cashInspectionFinancialWitness(tx, {
    paymentIds: originalCash.references.map(row => row.id),
    receiptIds: originalCash.receiptReferences.map(row => row.receiptId).filter((id): id is string => id !== null),
    resourceIds: "history" in controlledFinancial ? controlledFinancial.history.resources.map(row => row.id) : [],
  });
  additionalCount += inspectionStops.admissions.length + inspectionStops.entries.length + inspectionStops.lineageEntries.length;
  const inspectionHistoryKeys = new Set([...inspectionStops.entries.map(row => `${row.table}:${row.id}`),
    ...inspectionStops.lineageEntries.map(row => `${row.table}:${row.id}`),
    ...inspectionStops.admissions.map(row => `merchant_cash_return_inspections:${row.id}`)]);
  const cashCount = Object.values(originalCash.witness).reduce((sum, rows) => sum + rows.length, 0);
  if (cashCount + additionalCount > 5000) return null;
  // Controlled receipt-owned callbacks exist before any invoice payment route.
  // Keep their complete current graph independently of immutable read order.
  const controlledReceiptIds = [...new Set([
    ...("history" in controlledFinancial ? controlledFinancial.history.chargeOrigins.map(row => row.id) : []),
    ...inspectionStops.lineages.map(row => row.receiptId),
  ])];
  const controlledCashChildren = controlledFinancial.entries.length && controlledReceiptIds.length
    ? await merchantRefundDependencyFingerprints(tx, { paymentIds: [], subscriptionChargeReceiptIds: controlledReceiptIds })
    : { version: 1 as const, entries: [], incomplete: false };
  if (controlledCashChildren.incomplete) return null;
  const cashKeys = new Set([
    ...originalCash.witness.owners.map(row => `original_cash_recoveries:${row.id}`),
    ...originalCash.witness.operations.map(row => `original_cash_recovery_operations:${row.id}`),
    ...originalCash.witness.facts.map(row => `original_cash_recovery_facts:${row.id}`),
    ...originalCash.witness.closures.map(row => `original_cash_recovery_closures:${row.id}`),
    ...originalCash.witness.feedback.map(row => `original_cash_feedback:${merchantTaxDigest(row.namespace)}:${row.feedback.id}`),
  ]);
  const existingControlledKeys = new Set([...externalControlled.keys(), ...controlledFinancial.entries.map(row => `${row.table}:${row.id}`),
    ...inspectionHistoryKeys, ...cashKeys]);
  additionalCount += controlledCashChildren.entries.filter(row => !existingControlledKeys.has(`${row.table}:${row.id}`)).length;
  if (cashCount + additionalCount > 5000) return null;
  // Authentic feedback creates financial debt before the first GET. Select
  // through exact original payments, including feedback-owned legacy refunds,
  // while retaining the seller's frozen payment filter and old empty history.
  const legacyReferences = await tx.select({ refundId: refunds.id, invoiceId: payments.invoiceId }).from(refunds)
    .innerJoin(payments, eq(payments.id, refunds.paymentId))
    .where(and(inArray(payments.invoiceId, [...invoiceIds]), originalPaymentIds ? inArray(payments.id, [...originalPaymentIds]) : undefined,
      sql`(exists(select 1 from ${legacyBankReads} where ${legacyBankReads.refundId}=${refunds.id}) or freeholder_legacy_bank_feedback_review(${refunds.id}))`))
    .orderBy(asc(payments.invoiceId), asc(refunds.id)).limit(5001);
  if (legacyReferences.length > 5000) return null;
  const legacyFinancial = new Map<string, string>();
  let legacyCount = 0;
  if (legacyReferences.length) {
    const history = await legacyBankReadFinancialWitness(tx, legacyReferences.map(row => row.refundId));
    legacyCount = history.reads.length + history.facts.length + history.finishes.length + history.current.length + history.stops.length + history.replacements.length + history.feedback.length;
    if (cashCount + legacyCount + additionalCount > 5000) return null;
    for (const invoiceId of [...new Set(legacyReferences.map(row => row.invoiceId))]) {
      const refundIds = new Set(legacyReferences.filter(row => row.invoiceId === invoiceId).map(row => row.refundId));
      const reads = history.reads.filter(row => refundIds.has(row.refundId)), readIds = new Set(reads.map(row => row.id));
      const current = history.current.filter(row => readIds.has(row.readId));
      const stops = history.stops.filter(row => readIds.has(row.readId)), replacements = history.replacements.filter(row => refundIds.has(row.subjectId));
      const feedback = history.feedback.filter(row => refundIds.has(row.refundId));
      legacyFinancial.set(invoiceId, merchantTaxDigest({ reads, facts: history.facts.filter(row => readIds.has(row.readId)), finishes: history.finishes.filter(row => readIds.has(row.readId)),
        ...(current.length ? { current } : {}), ...(stops.length ? { stops } : {}), ...(replacements.length ? { replacements } : {}), ...(feedback.length ? { feedback } : {}) }));
    }
  }
  for (const invoiceId of [...new Set(originalCash.references.map(row => row.invoiceId))]) {
    const cash = originalCashForInvoice(originalCash, invoiceId);
    if (!Object.values(cash).some(rows => rows.length)) continue;
    const legacy = legacyFinancial.get(invoiceId);
    legacyFinancial.set(invoiceId, merchantTaxDigest({ ...(legacy ? { legacy } : {}), originalCash: cash }));
  }
  // A genuine stopped inspection also belongs to an unrouted original payment.
  // Follow exact invoice/payment/receipt ancestry before the no-route exit.
  for (const invoiceId of [...new Set(originalCash.references.map(row => row.invoiceId))]) {
    const originalPayments = new Set(originalCash.references.filter(row => row.invoiceId === invoiceId).map(row => row.id));
    const originalReceipts = new Set(originalCash.receiptReferences.filter(row => originalPayments.has(row.paymentId)).map(row => row.receiptId));
    const originalInspections = new Set(inspectionStops.admissions.filter(row => row.paymentId !== null && originalPayments.has(row.paymentId)
      || row.subscriptionChargeReceiptId !== null && originalReceipts.has(row.subscriptionChargeReceiptId)).map(row => row.id));
    const entries = inspectionStops.entries.filter(row => originalInspections.has(row.inspectionId)).map(({ table, id, fingerprint }) => ({ table, id, fingerprint }));
    const lineageEntries = inspectionStops.lineageEntries.filter(row => originalInspections.has(row.inspectionId)).map(({ table, id, fingerprint }) => ({ table, id, fingerprint }));
    if (entries.length || lineageEntries.length) {
      const legacy = legacyFinancial.get(invoiceId);
      legacyFinancial.set(invoiceId, merchantTaxDigest({ ...(legacy ? { legacy } : {}), ...(entries.length ? { originalCashInspectionStops: entries } : {}),
        ...(lineageEntries.length ? { originalCashInspectionLineages: lineageEntries } : {}) }));
    }
  }
  if (prorationFinancial.entries.length || controlledFinancial.entries.length) {
    // These actual invoices form one merge cohort, including linked original
    // credit ancestry. Fold its complete table-bound rows before the no-route
    // exit; an empty addition preserves historical fingerprints exactly.
    const originalInvoices = await tx.select({ id: invoices.id }).from(invoices)
      .where(inArray(invoices.id, [...invoiceIds])).orderBy(asc(invoices.id)).limit(5001);
    if (originalInvoices.length !== new Set(invoiceIds).size) return null;
    prorationInvoiceIds = originalInvoices.map(row => row.id);
    for (const invoiceId of prorationInvoiceIds) {
      const original = legacyFinancial.get(invoiceId);
      legacyFinancial.set(invoiceId, merchantTaxDigest({ ...(original ? { original } : {}), ...(prorationFinancial.entries.length ? { prorationFinancial } : {}), ...(controlledFinancial.entries.length ? { controlledFinancial } : {}),
        ...(controlledFinancial.entries.length && inspectionStops.lineageEntries.length ? { originalControlledCashInspectionLineages: inspectionStops.lineageEntries } : {}),
        ...(controlledCashChildren.entries.length ? { originalControlledCashHistory: controlledCashChildren } : {}) }));
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
  const routedInvoices = new Set(scoped.map(row => row.payment.invoiceId));
  additionalCount += prorationInvoiceIds.filter(id => !routedInvoices.has(id)).length;
  if (cashCount + legacyCount + additionalCount > 5000) return null;
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
  if (count + cashCount + legacyCount + additionalCount > 5000) return null;
  const refusals = dispatches.length ? await tx.select().from(merchantPaymentCreationRefusals).where(inArray(merchantPaymentCreationRefusals.dispatchId, dispatches.map(row => row.id))).orderBy(asc(merchantPaymentCreationRefusals.dispatchId)).limit(5001) : [];
  const finishes = dispatches.length ? await tx.select().from(merchantPaymentDispatchFinishes).where(inArray(merchantPaymentDispatchFinishes.dispatchId, dispatches.map(row => row.id))).orderBy(asc(merchantPaymentDispatchFinishes.dispatchId)).limit(5001) : [];
  const stops = dispatches.length ? await tx.select().from(merchantPaymentDispatchStops).where(inArray(merchantPaymentDispatchStops.dispatchId, dispatches.map(row => row.id))).orderBy(asc(merchantPaymentDispatchStops.dispatchId)).limit(5001) : [];
  const feeAcks = feeOperations.length ? await tx.select().from(merchantFeeObservations).where(inArray(merchantFeeObservations.operationId, feeOperations.map(row => row.id))).orderBy(asc(merchantFeeObservations.id)).limit(5001) : [];
  count += refusals.length + feeAcks.length + finishes.length + stops.length;
  if (count + cashCount + legacyCount + additionalCount > 5000) return null;
  // These invoices are one original contact-merge cohort. Any late financial
  // child makes the operation non-undoable, without adding unparsed fields to
  // the existing invoice reference receipt.
  const refundChildren = await merchantRefundDependencyFingerprints(tx, { paymentIds,
    subscriptionChargeReceiptIds: scoped.map(row => row.agreementRoute?.originalChargeReceiptId).filter((id): id is string => Boolean(id)) });
  const controlledKeys = new Set([...externalControlled.keys(), ...controlledFinancial.entries.map(row => `${row.table}:${row.id}`), ...inspectionHistoryKeys,
    ...controlledCashChildren.entries.map(row => `${row.table}:${row.id}`)]);
  if (refundChildren.entries.some(row => externalControlled.has(`${row.table}:${row.id}`) && externalControlled.get(`${row.table}:${row.id}`) !== row.fingerprint)) return null;
  const distinctRefundChildren = refundChildren.entries.filter(row => !controlledKeys.has(`${row.table}:${row.id}`));
  if (refundChildren.incomplete || count + cashCount + legacyCount + additionalCount + distinctRefundChildren.length > 5000) return null;
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
  const originalCash = await originalCashInvoiceHistory(tx, invoiceIds);
  const controlled = await controlledFinancialWitness(tx, { invoiceIds });
  if (controlled.incomplete) throw new ServiceError("conflict", "Restore the complete owned controlled financial graph before exporting original inspections.");
  const inspectionStops = await cashInspectionFinancialWitness(tx, {
    paymentIds: originalCash.references.map(row => row.id),
    receiptIds: originalCash.receiptReferences.map(row => row.receiptId).filter((id): id is string => id !== null),
    resourceIds: controlled.history.resources.map(row => row.id),
  });
  const history = {
    requests: await tx.select().from(merchantPaymentRequests).where(inArray(merchantPaymentRequests.paymentId, ownedPayments)).orderBy(asc(merchantPaymentRequests.paymentId)).limit(5001),
    dispatches: await tx.select({ id: merchantPaymentDispatches.id, paymentId: merchantPaymentDispatches.paymentId, ordinal: merchantPaymentDispatches.ordinal, requestDigest: merchantPaymentDispatches.requestDigest, dispatchedAt: merchantPaymentDispatches.dispatchedAt }).from(merchantPaymentDispatches).where(inArray(merchantPaymentDispatches.paymentId, ownedPayments)).orderBy(asc(merchantPaymentDispatches.id)).limit(5001),
    finishes: await tx.select({ dispatchId: merchantPaymentDispatchFinishes.dispatchId, outcome: merchantPaymentDispatchFinishes.outcome, finishedAt: merchantPaymentDispatchFinishes.finishedAt }).from(merchantPaymentDispatchFinishes).where(inArray(merchantPaymentDispatchFinishes.dispatchId, ownedDispatches)).orderBy(asc(merchantPaymentDispatchFinishes.dispatchId)).limit(5001),
    stoppedCallers: await tx.select({ dispatchId: merchantPaymentDispatchStops.dispatchId, reviewedAt: merchantPaymentDispatchStops.reviewedAt }).from(merchantPaymentDispatchStops).where(inArray(merchantPaymentDispatchStops.dispatchId, ownedDispatches)).orderBy(asc(merchantPaymentDispatchStops.dispatchId)).limit(5001),
    refusals: await tx.select().from(merchantPaymentCreationRefusals).where(inArray(merchantPaymentCreationRefusals.dispatchId, ownedDispatches)).orderBy(asc(merchantPaymentCreationRefusals.dispatchId)).limit(5001),
    retirementAcks: await tx.select().from(merchantPaymentRetirementAcks).where(inArray(merchantPaymentRetirementAcks.paymentId, ownedPayments)).orderBy(asc(merchantPaymentRetirementAcks.id)).limit(5001),
    terminalReceipts: await tx.select().from(merchantPaymentTerminalReceipts).where(inArray(merchantPaymentTerminalReceipts.paymentId, ownedPayments)).orderBy(asc(merchantPaymentTerminalReceipts.paymentId)).limit(5001),
    moneyObservations: await tx.select().from(merchantPaymentObservations).where(inArray(merchantPaymentObservations.paymentId, ownedPayments)).orderBy(asc(merchantPaymentObservations.id)).limit(5001),
    feeOperations: await tx.select().from(merchantFeeRefunds).where(inArray(merchantFeeRefunds.paymentId, ownedPayments)).orderBy(asc(merchantFeeRefunds.id)).limit(5001),
    feeAcknowledgements: await tx.select().from(merchantFeeObservations).where(inArray(merchantFeeObservations.operationId, ownedFees)).orderBy(asc(merchantFeeObservations.id)).limit(5001),
  };
  if (Object.values(history).reduce((sum, rows) => sum + rows.length, 0) + Object.values(originalCash.witness).reduce((sum, rows) => sum + rows.length, 0)
    + inspectionStops.admissions.length + inspectionStops.stops.length + inspectionStops.lineages.length > 5000)
    throw new ServiceError("conflict", "Restore the complete bounded original financial export before issuing the subject archive.");
  return { ...history, originalCash: exportOriginalCashHistory(originalCash.witness),
    ...(inspectionStops.stops.length ? { originalCashInspectionStops: exportCashInspectionStops(inspectionStops.stops) } : {}),
    ...(inspectionStops.lineages.length ? { originalCashInspectionLineages: exportControlledCashInspectionLineages(inspectionStops.lineages) } : {}) };
}
