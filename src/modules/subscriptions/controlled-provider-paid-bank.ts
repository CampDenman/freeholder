// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: committed real principal + current bank, never a stale batch grant.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getService, ServiceError, type ServiceContext } from "@/core/service";
import { payments } from "@/modules/invoicing/schema";
import { invoiceSettled } from "@/modules/invoicing/invoice-balance";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { merchantAgreementPaymentRoutes } from "@/modules/invoicing/merchant-agreement-schema";
import { merchantPaymentObservations } from "@/modules/invoicing/merchant-collection-schema";
import { principalAuthorityResult } from "@/modules/invoicing/principal-authority-contract";
import { currentBankPrincipalMatches } from "@/modules/invoicing/original-bank-principal-policy";
import { originalMerchantRefundCash } from "@/modules/invoicing/merchant-refund-origin";
import { originalCashInspectionBankFacts } from "@/modules/invoicing/merchant-cash-inspection-bank-facts";
import { controlledCashApplicationBatches, controlledCashApplicationReceipts, controlledCashApplicationLinks } from "@/modules/invoicing/controlled-cash-application-protocol-schema";
import { verifiedControlledCashBatch, verifiedControlledCashReceipt } from "@/modules/invoicing/controlled-cash-application-protocol-proof";
import { assertInvoiceMerchantCreatorsQuiesced } from "@/modules/invoicing/merchant-payment-request";
import { requireHeldControlledCashResource } from "@/modules/invoicing/controlled-cash-inspection-observation-context";
import { controlledCollectionState } from "./controlled-provider-collection-state";
import { controlledCashManifest } from "./controlled-provider-collection-cash-manifest";
import { latestControlledCashInspectionLineage } from "./controlled-cash-inspection-lineage";
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const physical = z.object({ table: z.string(), id: z.string(), fingerprint: sha, hashDomain: z.literal("postgres_row") }).strict();
const snapshot = z.object({ entries: z.array(physical).min(1).max(5000), revision: sha, physicalRowCount: z.number().int().min(1).max(5000) }).strict();
const scope = z.object({ payments: z.array(z.uuid()).max(5000), invoices: z.array(z.uuid()).max(5000), notes: z.array(z.uuid()).max(5000), namespaces: z.array(z.object({ platform: z.string().min(1), account: z.string().nullable(), intent: z.string().min(1) }).passthrough()).max(5000) }).passthrough();
export function refuseControlledPaid(): never { throw new ServiceError("conflict", "Preserve the actual paid invoice and every original receipt/caller/refund/dispute. Restore complete current original bank and principal ownership before changing the accepted calendar or access."); }
export async function controlledPaidParentSnapshot(ctx: ServiceContext, collectionId: string) {
  const [row] = await ctx.tx.execute<{ snapshot: unknown }>(sql`select freeholder_controlled_paid_period_parent(${collectionId}::uuid,null,false) as snapshot`);
  const current = snapshot.parse(row?.snapshot);
  if (current.physicalRowCount !== current.entries.length || new Set(current.entries.map(row => `${row.table}:${row.id}`)).size !== current.entries.length) refuseControlledPaid();
  return current;
}
/** The caller already holds contact→resource→parent. Discover and acquire the
 * complete actual canonical/source cash prefix before any current money read.
 * No bank I/O, application context, marker or past transaction ID is reused. */
export async function lockControlledPaidSources(ctx: ServiceContext, collectionId: string) {
  const [row] = await ctx.tx.execute<{ scope: unknown }>(sql`select freeholder_controlled_cash_scope(${collectionId}::uuid) as scope`);
  const selected = scope.parse(row?.scope);
  if (selected.payments.length + selected.invoices.length + selected.notes.length + selected.namespaces.length > 5000) refuseControlledPaid();
  for (const [prefix, ids] of [["payment", selected.payments], ["invoice", selected.invoices], ["credit-note", selected.notes]] as const)
    for (const id of [...new Set(ids)].sort()) await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${prefix}:${id}`}))`);
  for (const key of [...new Set(selected.namespaces.map(row => `subscription-cash:${row.platform}:${row.account ?? ""}:${row.intent}`))].sort())
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
}
/** Actual fully settled canonical receipts plus the latest genuine RETURNED
 * bank inspection. b3 is deliberately NOT called: it is prospective and must
 * refuse a fully paid target. Historical batch HMAC authenticates original
 * ownership only; independent current bank/parent evidence supplies safety. */
export async function readControlledPaidBank(ctx: ServiceContext, collectionId: string) {
  const state = await controlledCollectionState(ctx.tx, collectionId), { collection, canonical, resource, history } = state;
  await requireHeldControlledCashResource(ctx, resource.id);
  if (!canonical.invoice.issuedAt || canonical.invoice.status !== "paid" || !invoiceSettled(canonical.invoice) || canonical.invoice.refundedMinor !== 0
    || history.unfinished.length || history.closures.length) refuseControlledPaid();
  const bank = controlledCashManifest(state);
  if (bank.remainingMinor !== 0 || bank.paidMinor !== state.manifest.cashDueMinor) refuseControlledPaid();
  await assertInvoiceMerchantCreatorsQuiesced(ctx, canonical.invoice.id);
  const before = await controlledPaidParentSnapshot(ctx, collectionId);
  const money = await ctx.tx.select().from(payments).where(eq(payments.invoiceId, canonical.invoice.id)).limit(5001);
  if (money.length > 5000 || money.some(row => ["created", "processing"].includes(row.status))
    || money.filter(row => row.status === "succeeded").reduce((sum, row) => sum + BigInt(row.amountMinor), 0n) !== BigInt(canonical.invoice.paidMinor)) refuseControlledPaid();
  const succeeded = money.filter(row => row.status === "succeeded");
  const links = succeeded.length ? await ctx.tx.select().from(controlledCashApplicationLinks).where(inArray(controlledCashApplicationLinks.paymentId, succeeded.map(row => row.id))).limit(5001) : [];
  if (links.length !== succeeded.length || links.length !== bank.cash.length) refuseControlledPaid();
  let financialReviewPending = false;
  const latestBank: Array<{ paymentId: string; receiptId: string; inspectionId: string; observationId: string; revision: string }> = [];
  for (const payment of succeeded) {
    const link = links.find(row => row.paymentId === payment.id);
    const [proof] = link ? await ctx.tx.select().from(controlledCashApplicationReceipts).where(eq(controlledCashApplicationReceipts.id, link.receiptProofId)).limit(1) : [];
    const [batch] = link ? await ctx.tx.select().from(controlledCashApplicationBatches).where(eq(controlledCashApplicationBatches.id, link.batchId)).limit(1) : [];
    const [route] = await ctx.tx.select().from(merchantAgreementPaymentRoutes).where(eq(merchantAgreementPaymentRoutes.paymentId, payment.id)).limit(1);
    if (!link || !proof || !batch || !route || !verifiedControlledCashBatch(batch) || !verifiedControlledCashReceipt(proof)
      || proof.batchId !== batch.id || batch.collectionId !== collection.id || batch.invoiceId !== payment.invoiceId || batch.resourceId !== resource.id
      || proof.receiptId !== link.receiptId || route.originalChargeReceiptId !== link.receiptId || route.originKind !== "provider_schedule"
      || payment.provider !== "stripe" || payment.method !== "provider_schedule" || payment.refundedMinor !== 0 || payment.amountMinor !== proof.amountMinor
      || payment.currency !== proof.currency || payment.idempotencyKey !== proof.paymentIdempotencyKey || payment.requestHash !== proof.paymentRequestHash) refuseControlledPaid();
    const reader = getService("invoicing.originalPrincipalAuthority");
    if (reader.def.kind !== "query" || reader.def.permission !== "system" || reader.def.external !== false) refuseControlledPaid();
    const principal = principalAuthorityResult.parse(await ctx.callAsSystem(reader, { paymentId: payment.id }));
    if (!principal.principalSafe || principal.currentPrincipalMinor !== payment.amountMinor) refuseControlledPaid();
    financialReviewPending ||= principal.financialDebtPending;
    const cash = await originalMerchantRefundCash(ctx, { kind: "subscription", receiptId: link.receiptId, observationId: proof.originalObservationId });
    const latest = await latestControlledCashInspectionLineage(ctx.tx, link.receiptId);
    const facts = await originalCashInspectionBankFacts(ctx.tx, latest.inspection, cash);
    const actual = bank.cash.find(row => row.providerPaymentIntentRef === payment.providerRef);
    if (!facts || !actual || actual.amountMinor !== payment.amountMinor || actual.providerChargeRef !== route.providerChargeRef
      || !currentBankPrincipalMatches({ amountMinor: payment.amountMinor, currency: payment.currency, refundedMinor: 0,
        apiVersion: cash.providerApiVersion, platform: cash.providerPlatformAccountId, account: cash.chargeAccountId,
        paymentRef: cash.providerRef, chargeRef: cash.originalChargeRef }, facts.evidence)) refuseControlledPaid();
    // Unknown ancillary fee/transfer remains owed/review. A KNOWN contradictory
    // merchant route cannot be relabelled as merely an ancillary GET failure.
    const transfer = facts.evidence.transfer;
    if (facts.evidence.transferFieldObserved && (route.collectionKind === "direct" ? transfer !== null : transfer !== null
      && (transfer.destinationAccountId !== route.recipientAccountId || transfer.sourceChargeRef !== route.providerChargeRef
        || transfer.amountMinor !== payment.amountMinor || transfer.currency !== payment.currency || transfer.reversed !== false || transfer.reversedMinor !== 0))) refuseControlledPaid();
    const fee = facts.evidence.fee;
    const [originalObservation] = await ctx.tx.select().from(merchantPaymentObservations).where(and(eq(merchantPaymentObservations.paymentId, payment.id),
      eq(merchantPaymentObservations.providerRef, cash.providerRef), eq(merchantPaymentObservations.status, "succeeded")))
      .orderBy(desc(merchantPaymentObservations.observedAt), desc(merchantPaymentObservations.id)).limit(1);
    if (!originalObservation) refuseControlledPaid();
    financialReviewPending ||= !facts.evidence.feeFieldObserved || !facts.evidence.transferFieldObserved
      || (route.applicationFeeMinor === 0 ? fee !== null : fee === null || fee.amountMinor !== route.applicationFeeMinor || fee.currency !== payment.currency || fee.refundedMinor !== 0
        || fee.originatingChargeRef !== route.providerChargeRef || fee.accountId !== route.recipientAccountId || fee.providerRef !== originalObservation.applicationFeeRef)
      || route.collectionKind === "destination" && transfer === null;
    const [currentBank] = await ctx.tx.execute<{ actual_inspection_id: string; actual_observation_id: string; bank_fingerprint: string }>(sql`select actual_inspection_id,actual_observation_id,bank_fingerprint from freeholder_controlled_receipt_bank_observation(${collection.id}::uuid,${link.receiptId}::uuid)`);
    if (!currentBank || currentBank.actual_inspection_id !== latest.inspection.id || currentBank.actual_observation_id !== facts.observation.id || !sha.safeParse(currentBank.bank_fingerprint).success) refuseControlledPaid();
    latestBank.push({ paymentId: payment.id, receiptId: link.receiptId, inspectionId: latest.inspection.id, observationId: facts.observation.id, revision: currentBank.bank_fingerprint });
  }
  const after = await controlledPaidParentSnapshot(ctx, collectionId);
  if (after.revision !== before.revision || JSON.stringify(after.entries) !== JSON.stringify(before.entries)) refuseControlledPaid();
  return { state, financialReviewPending, parentRevision: after.revision,
    revision: merchantTaxDigest({ parentRevision: after.revision, latestBank, canonicalTargetDigest: canonical.digest, invoiceId: canonical.invoice.id }), latestBank };
}
