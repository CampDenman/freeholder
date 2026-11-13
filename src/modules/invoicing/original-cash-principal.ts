// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: raw signed feedback precedes owner/GET/domain application.
import { eq } from "drizzle-orm";
import { ServiceError, type ServiceContext } from "@/core/service";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import { merchantRefundCashHistory } from "./merchant-refund-history";
import { originalMerchantRefundCash, type MerchantRefundSource } from "./merchant-refund-origin";
import { originalCashRecoveryFinancialWitness } from "./original-cash-recovery-store";
import { currentOriginalCashInventory } from "./original-cash-inventory-current";
import { merchantTaxDigest } from "./merchant-tax-store";
import { payments } from "./schema";
import type { MerchantReturnedCashEvidence } from "./merchant-returned-cash-proof";

/** Bank evidence is actual exact-source inventory, not an amount selected from
 * a callback. The caller independently proves the actual merchant route. */
export function currentBankPrincipalMatches(input: { amountMinor: number; currency: string; refundedMinor: number; apiVersion: string; platform: string; account: string | null; paymentRef: string; chargeRef?: string | null }, evidence: MerchantReturnedCashEvidence) {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || evidence.providerApiVersion !== input.apiVersion || evidence.providerPlatformAccountId !== input.platform || evidence.chargeAccountId !== input.account || evidence.paymentProviderRef !== input.paymentRef
    || input.chargeRef && evidence.providerChargeRef !== input.chargeRef || evidence.chargePaymentProviderRef !== input.paymentRef
    || evidence.paymentIntentStatus !== "succeeded" || evidence.amountCapturableMinor !== 0 || evidence.amountMinor !== input.amountMinor || evidence.currency !== input.currency
    || evidence.chargeAmountMinor !== input.amountMinor || evidence.chargeCurrency !== input.currency || !evidence.paid || !evidence.captured
    || !evidence.refundsComplete || !evidence.disputesComplete || evidence.disputes.some(row => row.chargeRef !== evidence.providerChargeRef || !["won", "warning_closed"].includes(row.status))) return false;
  if (new Set(evidence.disputes.map(row => row.providerRef)).size !== evidence.disputes.length) return false;
  const seen = new Set<string>(); let returned = 0n;
  for (const refund of evidence.refunds) {
    if (seen.has(refund.providerRef) || refund.paymentProviderRef !== input.paymentRef || refund.chargeRef !== evidence.providerChargeRef
      || refund.currency !== input.currency || refund.amountMinor === null || !Number.isSafeInteger(refund.amountMinor) || refund.amountMinor <= 0
      || !["succeeded", "failed", "canceled"].includes(refund.status ?? "")) return false;
    seen.add(refund.providerRef); if (refund.status === "succeeded") returned += BigInt(refund.amountMinor);
  }
  return Number.isSafeInteger(input.refundedMinor) && input.refundedMinor >= 0 && input.refundedMinor <= input.amountMinor
    && returned === BigInt(input.refundedMinor) && evidence.amountRefundedMinor === input.refundedMinor;
}

export async function readOriginalCashPrincipalHistory(ctx: ServiceContext, source: MerchantRefundSource) {
  const cash = await originalMerchantRefundCash(ctx, source);
  const aliases = source.kind === "payment" ? await ctx.tx.select({ id: merchantAgreementPaymentRoutes.originalChargeReceiptId })
    .from(merchantAgreementPaymentRoutes).where(eq(merchantAgreementPaymentRoutes.paymentId, source.paymentId)).limit(2) : [];
  const paymentIds = cash.paymentId ? [cash.paymentId] : [], receiptIds = [...new Set([
    ...(cash.subscriptionChargeReceiptId ? [cash.subscriptionChargeReceiptId] : []), ...aliases.flatMap(row => row.id ? [row.id] : []),
  ])];
  // This authenticates feedback even with no recovery owner and no normal
  // merchant observation/application for the refund callback yet.
  const witness = await originalCashRecoveryFinancialWitness(ctx.tx, paymentIds, receiptIds);
  const history = await merchantRefundCashHistory(ctx, cash);
  const [payment] = source.kind === "payment" ? await ctx.tx.select().from(payments).where(eq(payments.id, source.paymentId)).limit(1) : [];
  // The history already counts the exact namespace's owners/operations/raw
  // feedback and ordinary facts. Add only families deliberately excluded from
  // its revision digest plus the distinct canonical payment row, once.
  const inventoryCount = history.inventoryCount + witness.facts.filter(row => ["partial_closure", "unassigned_refund_review", "partial_target"].includes(row.kind)).length
    + witness.closures.length + (payment ? 1 : 0);
  const receiptOnly = source.kind === "subscription" || !payment || !cash.applied;
  let reviewRequired = receiptOnly || history.incomplete || inventoryCount > 5000 || !history.principalCreatorsQuiesced;
  let bankEvidenceDigest: string | null = null;
  const matchingOwner = (row: typeof witness.owners[number]) => row.owner.cash.providerPlatformAccountId === cash.providerPlatformAccountId
    && row.owner.cash.chargeAccountId === cash.chargeAccountId && row.owner.cash.providerRef === cash.providerRef
    && (row.paymentId !== null && paymentIds.includes(row.paymentId) || row.subscriptionChargeReceiptId !== null && receiptIds.includes(row.subscriptionChargeReceiptId));
  if (witness.owners.some(row => !matchingOwner(row)) || witness.feedback.some(row => row.namespace.providerPlatformAccountId !== cash.providerPlatformAccountId
    || row.namespace.chargeAccountId !== cash.chargeAccountId || row.namespace.originalPaymentRef !== cash.providerRef)) reviewRequired = true;
  // An existing owner or any signed callback requires its genuine current bank
  // read. No owner/GET yet is unknown debt, never canonical refundedMinor=0.
  if (witness.feedback.length || witness.owners.length || witness.operations.length || witness.facts.length) {
    const owners = witness.owners.filter(matchingOwner);
    if (owners.length !== 1) reviewRequired = true;
    else {
      const reads = witness.operations.filter(row => row.recoveryId === owners[0]!.id && row.kind === "inspection" && !row.request.auxiliaryOperationId)
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id));
      const latest = reads[0];
      if (!latest) reviewRequired = true;
      else {
        try {
          const current = await currentOriginalCashInventory(ctx, owners[0]!.id, latest.id);
          if (current.history.incomplete || current.history.inventoryCount > 5000 || !current.history.principalCreatorsQuiesced || !payment
            || !currentBankPrincipalMatches({ amountMinor: payment.amountMinor, currency: payment.currency, refundedMinor: payment.refundedMinor,
              apiVersion: cash.providerApiVersion, platform: cash.providerPlatformAccountId, account: cash.chargeAccountId, paymentRef: cash.providerRef, chargeRef: cash.originalChargeRef }, current.evidence)) reviewRequired = true;
          bankEvidenceDigest = merchantTaxDigest({ operationId: latest.id, currentRevision: current.revision, evidence: current.evidence });
        } catch (error) { if (error instanceof ServiceError && ["conflict", "permission", "not_found", "validation"].includes(error.code)) reviewRequired = true; else throw error; }
      }
    }
  }
  return { reviewRequired, receiptOnly, principalCallerDebt: !history.principalCreatorsQuiesced,
    ancillaryDebtPending: history.feeDebt || !history.creatorsQuiesced,
    currentPrincipalMinor: reviewRequired || !payment ? null : payment.amountMinor - payment.refundedMinor, inventoryCount,
    revision: merchantTaxDigest({ source, cash, aliases, witness, history, bankEvidenceDigest, receiptOnly, reviewRequired }) };
}
