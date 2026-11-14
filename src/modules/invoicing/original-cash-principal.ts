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
import { controlledCashFinancialHistory } from "./controlled-provider-financial-witness";
import { readControlledCanonicalBankPrincipal } from "./controlled-canonical-bank-principal";
import { currentBankPrincipalMatches } from "./original-bank-principal-policy";
export { currentBankPrincipalMatches } from "./original-bank-principal-policy";

export async function readOriginalCashPrincipalHistory(ctx: ServiceContext, source: MerchantRefundSource) {
  const cash = await originalMerchantRefundCash(ctx, source);
  const aliases = source.kind === "payment" ? await ctx.tx.select({ id: merchantAgreementPaymentRoutes.originalChargeReceiptId })
    .from(merchantAgreementPaymentRoutes).where(eq(merchantAgreementPaymentRoutes.paymentId, source.paymentId)).limit(2) : [];
  const paymentIds = cash.paymentId ? [cash.paymentId] : [], receiptIds = [...new Set([
    ...(cash.subscriptionChargeReceiptId ? [cash.subscriptionChargeReceiptId] : []), ...aliases.flatMap(row => row.id ? [row.id] : []),
  ])];
  // This authenticates feedback even with no recovery owner and no normal
  // merchant observation/application for the refund callback yet.
  const controlledParents = cash.paymentId ? await ctx.tx.select({ id: merchantAgreementPaymentRoutes.subscriptionId }).from(merchantAgreementPaymentRoutes)
    .where(eq(merchantAgreementPaymentRoutes.paymentId, cash.paymentId)).limit(2) : [];
  const controlled = await controlledCashFinancialHistory(ctx.tx, receiptIds, controlledParents.map(row => row.id));
  const witness = await originalCashRecoveryFinancialWitness(ctx.tx, paymentIds, receiptIds);
  const history = await merchantRefundCashHistory(ctx, cash);
  const [payment] = source.kind === "payment" ? await ctx.tx.select().from(payments).where(eq(payments.id, source.paymentId)).limit(1) : [];
  // The history already counts the exact namespace's owners/operations/raw
  // feedback and ordinary facts. Add only families deliberately excluded from
  // its revision digest plus the distinct canonical payment row, once.
  let inventoryCount = history.inventoryCount + witness.facts.filter(row => ["partial_closure", "unassigned_refund_review", "partial_target"].includes(row.kind)).length
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
  // A bare controlled GET can report a later refund/dispute before any
  // recovery owner exists. Historical application is never a current bank
  // proof. Ordinary legacy/default namespace and digest bytes stay unchanged.
  let controlledBank: Awaited<ReturnType<typeof readControlledCanonicalBankPrincipal>> | null = null;
  let controlledBankUnknown = false;
  if(payment){
    try{
      controlledBank=await readControlledCanonicalBankPrincipal(ctx,payment,cash);
      if(controlledBank.applies){
        reviewRequired ||= !controlledBank.principalMatches;
        if(!history.physicalIdentities)reviewRequired=true;
        else{
          const identities=new Set([...history.physicalIdentities,...controlledBank.physicalEntries,
            ...witness.facts.map(row=>({table:"original_cash_recovery_facts",id:row.id})),
            ...witness.closures.map(row=>({table:"original_cash_recovery_closures",id:row.id})),{table:"payments",id:payment.id}].map(row=>`${row.table}:${row.id}`));
          inventoryCount=identities.size;if(inventoryCount>5000)reviewRequired=true;
        }
      }
    }catch(error){if(error instanceof ServiceError&&["conflict","permission","not_found","validation"].includes(error.code)){reviewRequired=true;controlledBankUnknown=true;}else throw error;}
  }
  // Independently committed callback ingress can race these ordinary reads.
  // Fence the authentic exact-source inventory again; later state cannot
  // silently supersede a callback that appeared after the first snapshot.
  const currentWitness = await originalCashRecoveryFinancialWitness(ctx.tx, paymentIds, receiptIds);
  if (merchantTaxDigest(currentWitness) !== merchantTaxDigest(witness)) reviewRequired = true;
  const currentControlled = await controlledCashFinancialHistory(ctx.tx, receiptIds, controlledParents.map(row => row.id));
  if (currentControlled.incomplete || merchantTaxDigest(currentControlled) !== merchantTaxDigest(controlled)) reviewRequired = true;
  let currentControlledBank: Awaited<ReturnType<typeof readControlledCanonicalBankPrincipal>> | null = null;
  if(payment&&controlledBank?.applies){
    try{currentControlledBank=await readControlledCanonicalBankPrincipal(ctx,payment,cash);if(merchantTaxDigest(currentControlledBank)!==merchantTaxDigest(controlledBank))reviewRequired=true;}
    catch(error){if(error instanceof ServiceError&&["conflict","permission","not_found","validation"].includes(error.code)){reviewRequired=true;controlledBankUnknown=true;}else throw error;}
  }
  return { reviewRequired, receiptOnly, principalCallerDebt: !history.principalCreatorsQuiesced,
    ancillaryDebtPending: history.feeDebt || !history.creatorsQuiesced || controlledBankUnknown || controlledBank?.applies === true && controlledBank.ancillaryDebtPending,
    currentPrincipalMinor: reviewRequired || !payment ? null : payment.amountMinor - payment.refundedMinor, inventoryCount,
    revision: merchantTaxDigest({ source, cash, aliases, witness, currentWitness, history, bankEvidenceDigest, receiptOnly, reviewRequired,
      ...(controlled.entries.length || controlled.namespaces.some(row => row.applies) ? { controlled, currentControlled } : {}),
      ...(controlledBank?.applies||controlledBankUnknown?{controlledBank,currentControlledBank,controlledBankUnknown}:{}) }) };
}
