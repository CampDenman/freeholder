// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: latest real bank evidence for an actually applied original receipt.
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ServiceError, type ServiceContext } from "@/core/service";
import { subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { subscriptionControlledChargeOrigins } from "@/modules/subscriptions/controlled-provider-schema";
import { readControlledReceiptNamespace } from "@/modules/subscriptions/controlled-provider-cash-namespace";
import { latestControlledCashInspectionLineage } from "@/modules/subscriptions/controlled-cash-inspection-lineage";
import { controlledCashApplicationBatches, controlledCashApplicationLinks, controlledCashApplicationReceipts } from "./controlled-cash-application-protocol-schema";
import { verifiedControlledCashBatch, verifiedControlledCashReceipt } from "./controlled-cash-application-protocol-proof";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import { originalCashInspectionBankFacts } from "./merchant-cash-inspection-bank-facts";
import { originalMerchantRefundCash, type MerchantRefundCashOrigin } from "./merchant-refund-origin";
import { originalMerchantFeeTarget } from "./merchant-line-fee-target";
import { routingForPayment } from "./merchant-charge";
import { currentBankPrincipalMatches } from "./original-bank-principal-policy";
import { controlledCanonicalBankReview, controlledPrincipalPhysicalUnion, controlledCanonicalLegacyEmpty } from "./controlled-canonical-bank-policy";
import { merchantTaxDigest } from "./merchant-tax-store";
import type { payments } from "./schema";
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const physical = z.object({ table: z.string().min(1), id: z.string().min(1), fingerprint: sha }).strict();
const parentShape = z.object({ entries: z.array(physical.extend({ hashDomain: z.literal("postgres_row") })).min(1).max(5000), revision: sha, physicalRowCount: z.number().int().min(1).max(5000) }).strict();
const bankShape = z.object({ actual_inspection_id: z.uuid(), actual_observation_id: z.uuid(), current_evidence: z.unknown(),
  bank_witness: z.array(physical).min(1).max(5000), bank_fingerprint: sha, immutable_bank_fingerprint: sha }).strict();
function refuse(): never { throw new ServiceError("conflict", "Restore the original controlled receipt's genuine committed application, latest finished bank inventory and complete current namespace. An older successful read or historical application cannot release current principal debt."); }
async function parentSnapshot(ctx: ServiceContext, collectionId: string) {
  const rows = await ctx.tx.execute<{ snapshot: unknown }>(sql`select freeholder_controlled_cash_parent_snapshot(${collectionId}::uuid) as snapshot`);
  if (rows.length !== 1) refuse(); const snapshot = parentShape.parse(rows[0]?.snapshot);
  if (snapshot.physicalRowCount !== snapshot.entries.length || controlledPrincipalPhysicalUnion([snapshot.entries]).length !== snapshot.entries.length) refuse(); return snapshot;
}
async function bankSnapshot(ctx: ServiceContext, collectionId: string, receiptId: string) {
  const rows = await ctx.tx.execute<{ actual_inspection_id: string; actual_observation_id: string; current_evidence: unknown; bank_witness: unknown; bank_fingerprint: string; immutable_bank_fingerprint: string }>(sql`
    select actual_inspection_id,actual_observation_id,current_evidence,bank_witness,bank_fingerprint,immutable_bank_fingerprint
    from freeholder_controlled_receipt_bank_observation(${collectionId}::uuid,${receiptId}::uuid)`);
  if (rows.length !== 1) refuse(); return bankShape.parse(rows[0]);
}
/** Plain real-context reader, no service registration, resource acquisition,
 * bank I/O, access grant, prospective b3 or same-TX application-stage reuse.
 * Existing principal/refund/caller authorities still run independently. */
export async function readControlledCanonicalBankPrincipal(ctx: ServiceContext, payment: typeof payments.$inferSelect, cash: MerchantRefundCashOrigin) {
  const receipts = await ctx.tx.select().from(subscriptionProviderChargeReceipts).where(and(
    eq(subscriptionProviderChargeReceipts.providerPlatformAccountId, cash.providerPlatformAccountId),
    sql`${subscriptionProviderChargeReceipts.chargeAccountId} is not distinct from ${cash.chargeAccountId}`,
    eq(subscriptionProviderChargeReceipts.providerPaymentIntentRef, cash.providerRef))).limit(2);
  const namespaces = [];
  for (const receipt of receipts) namespaces.push({ receipt, namespace: await readControlledReceiptNamespace(ctx.tx, receipt.id) });
  const candidates = namespaces.filter(row => row.namespace.applies);
  const routes = await ctx.tx.select().from(merchantAgreementPaymentRoutes).where(eq(merchantAgreementPaymentRoutes.paymentId, payment.id)).limit(2);
  // Read only existing source/receipt/route evidence first. A real controlled
  // birth necessarily retains its exact reserved key AND immutable receipt
  // alias; neither a missing alias nor zero namespace receipts alone suffices.
  if (controlledCanonicalLegacyEmpty({ paymentMethod: payment.method, paymentIdempotencyKey: payment.idempotencyKey,
    receiptIds: receipts.map(row => row.id), controlledReceiptIds: candidates.map(row => row.receipt.id),
    routes: routes.map(row => ({ originKind: row.originKind, receiptId: row.originalChargeReceiptId })) })) return { applies: false as const };
  const links = await ctx.tx.select().from(controlledCashApplicationLinks).where(eq(controlledCashApplicationLinks.paymentId, payment.id)).limit(2);
  if (!links.length && !candidates.length) {
    if(payment.idempotencyKey.startsWith("controlled-receipt:"))refuse();
    return { applies: false as const };
  }
  const selected = candidates[0], link = links[0];
  if (receipts.length !== 1 || candidates.length !== 1 || links.length !== 1 || !selected || !link || !selected.namespace.verified || !selected.namespace.resourceId
    || selected.namespace.principalCallerDebt || link.receiptId !== selected.receipt.id) refuse();
  const { receipt, namespace } = selected;
  const [proof] = await ctx.tx.select().from(controlledCashApplicationReceipts).where(eq(controlledCashApplicationReceipts.id, link.receiptProofId)).limit(1);
  const [batch] = await ctx.tx.select().from(controlledCashApplicationBatches).where(eq(controlledCashApplicationBatches.id, link.batchId)).limit(1);
  const [origin] = await ctx.tx.select().from(subscriptionControlledChargeOrigins).where(eq(subscriptionControlledChargeOrigins.receiptId, receipt.id)).limit(1);
  const route = routes[0];
  if (!proof || !batch || !origin || !route || routes.length !== 1 || !verifiedControlledCashBatch(batch) || !verifiedControlledCashReceipt(proof)
    || proof.batchId !== batch.id || link.batchId !== batch.id || proof.receiptId !== receipt.id || origin.resourceId !== namespace.resourceId
    || proof.originOperationId !== origin.operationId || proof.originCallId !== origin.callId || proof.originFactId !== origin.factId
    || batch.resourceId !== origin.resourceId || batch.subscriptionId !== receipt.subscriptionId || batch.invoiceId !== payment.invoiceId
    || !batch.requestedReceiptIds.includes(receipt.id) || proof.amountMinor !== receipt.amountMinor || proof.currency !== receipt.currency
    || payment.status !== "succeeded" || payment.provider !== "stripe" || payment.method !== "provider_schedule" || payment.providerRef !== receipt.providerPaymentIntentRef
    || payment.amountMinor !== receipt.amountMinor || payment.currency !== receipt.currency || payment.idempotencyKey !== proof.paymentIdempotencyKey || payment.requestHash !== proof.paymentRequestHash
    || route.originKind !== "provider_schedule" || route.originalChargeReceiptId !== receipt.id || route.subscriptionId !== receipt.subscriptionId
    || route.providerPlatformAccountId !== receipt.providerPlatformAccountId || route.chargeAccountId !== receipt.chargeAccountId
    || route.providerSubscriptionRef !== receipt.providerSubscriptionRef || route.providerInvoiceRef !== receipt.providerInvoiceRef || route.providerPaymentIntentRef !== receipt.providerPaymentIntentRef
    || route.providerChargeRef !== receipt.providerChargeRef || route.applicationFeeMinor !== proof.feeMinor || route.providerApiVersion !== receipt.providerApiVersion
    || route.recipientAccountId !== receipt.actualDestinationAccountId && route.recipientAccountId !== receipt.chargeAccountId
    || route.settlementMerchantAccountId !== receipt.actualSettlementMerchantAccountId && route.settlementMerchantAccountId !== receipt.chargeAccountId
    || !receipt.customerChargeVerified || !receipt.merchantRouteVerified || !receipt.providerChargeRef) refuse();
  // Identity equality only: this is independent post-commit principal, never
  // the currently executing application's staged same-transaction authority.
  // No transaction ID ordering/age is inferred.
  const transaction = await ctx.tx.execute<{ transaction_id: string | null }>(sql`select txid_current_if_assigned()::text as transaction_id`);
  if(transaction.length!==1||transaction[0]?.transaction_id===batch.admissionTransactionId)refuse();
  const before = await parentSnapshot(ctx, batch.collectionId), beforeBank = await bankSnapshot(ctx, batch.collectionId, receipt.id);
  const original = await originalMerchantRefundCash(ctx, { kind: "subscription", receiptId: receipt.id, observationId: proof.originalObservationId });
  const latest = await latestControlledCashInspectionLineage(ctx.tx, receipt.id), facts = await originalCashInspectionBankFacts(ctx.tx, latest.inspection, original);
  if (!facts || facts.observation.id !== beforeBank.actual_observation_id || latest.inspection.id !== beforeBank.actual_inspection_id
    || merchantTaxDigest(facts.evidence) !== merchantTaxDigest(beforeBank.current_evidence)) refuse();
  const routing = await routingForPayment(ctx, payment.id);
  if (routing.applicationFeeMinor !== route.applicationFeeMinor) refuse();
  // Existing original epoch policy is reused, including actual Fi on a valid
  // atomic application. A new endpoint or today's bps never reprices this row.
  const retainedFee = await originalMerchantFeeTarget(ctx, payment, routing);
  const review = controlledCanonicalBankReview({ amountMinor: payment.amountMinor, currency: payment.currency, refundedMinor: payment.refundedMinor,
    applicationFeeMinor: route.applicationFeeMinor, retainedFeeMinor: retainedFee, collectionKind: route.collectionKind, recipientAccountId: route.recipientAccountId,
    chargeRef: receipt.providerChargeRef, originalFeeRef: receipt.applicationFeeRef, originalTransferRef: cash.originalTransferRef }, facts.evidence);
  const principalMatches = review.routeMatches && currentBankPrincipalMatches({ amountMinor: payment.amountMinor, currency: payment.currency, refundedMinor: payment.refundedMinor,
    apiVersion: cash.providerApiVersion, platform: cash.providerPlatformAccountId, account: cash.chargeAccountId, paymentRef: cash.providerRef, chargeRef: cash.originalChargeRef }, facts.evidence);
  const after = await parentSnapshot(ctx, batch.collectionId), afterBank = await bankSnapshot(ctx, batch.collectionId, receipt.id);
  if (merchantTaxDigest(before) !== merchantTaxDigest(after) || merchantTaxDigest(beforeBank) !== merchantTaxDigest(afterBank)) refuse();
  const physicalEntries = controlledPrincipalPhysicalUnion([after.entries, afterBank.bank_witness]);
  return { applies: true as const, principalMatches, ancillaryDebtPending: review.ancillaryDebtPending || namespace.financialCallerDebt,
    collectionId: batch.collectionId, receiptId: receipt.id, inspectionId: latest.inspection.id, observationId: facts.observation.id, physicalEntries,
    revision: merchantTaxDigest({ payment, cash, route, proof, batch, link, origin, namespace, parentRevision: after.revision,
      immutableBankRevision: afterBank.immutable_bank_fingerprint, namespaceRevision: afterBank.bank_fingerprint, physicalEntries, principalMatches, review }) };
}
