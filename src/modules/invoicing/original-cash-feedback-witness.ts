// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: signed unassigned feedback owns review before a first cash GET.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { env } from "@/core/env";
import { ServiceError, type Tx } from "@/core/service";
import { subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { merchantPaymentObservations } from "./merchant-collection-schema";
import { legacyBankFeedback } from "./legacy-bank-feedback-schema";
import { verifyLegacyBankFeedback } from "./legacy-bank-feedback-proof";
import { cashNamespaceKey,verifyOriginalCashRecovery } from "./original-cash-recovery-proof";
import { merchantRefundResourceBindings, merchantRefundRequests } from "./merchant-refund-schema";
import { originalChargeFeedbackAncestry } from "./original-cash-charge-ancestry";
import { originalCashRecoveries, originalCashRecoveryFacts } from "./original-cash-recovery-schema";
export interface OriginalCashFeedbackNamespace {
  paymentId: string | null; subscriptionChargeReceiptId: string | null; originalObservationIds: string[];
  providerPlatformAccountId: string; chargeAccountId: string | null; originalPaymentRef: string; providerApiVersion: string | null; originalResourceRefs:string[];
}
export async function originalCashFeedbackFinancialWitness(tx: Tx, paymentIds: readonly string[], receiptIds: readonly string[], excludeOperationId?:string) {
  const payment = [...new Set(paymentIds)].sort(), receipts = [...new Set(receiptIds)].sort();
  if (payment.length + receipts.length > 5000) throw new ServiceError("conflict", "Restore a bounded exact original cash namespace inventory.");
  const observed = payment.length ? await tx.select().from(merchantPaymentObservations).where(and(inArray(merchantPaymentObservations.paymentId, payment), eq(merchantPaymentObservations.status,"succeeded"),sql`${merchantPaymentObservations.amountMinor}>0`)).limit(5001) : [];
  const original = receipts.length ? await tx.select().from(subscriptionProviderChargeReceipts).where(inArray(subscriptionProviderChargeReceipts.id,receipts)).limit(5001) : [];
  if (observed.length + original.length > 5000) throw new ServiceError("conflict", "Restore every actual original cash receipt before feedback ownership review.");
  // Charge ancestry is private selection data. Do not change historical
  // namespace bodies/digests or their composite feedback UUID identities.
  const identities=new Set<string>();const record=(table:string,id:string)=>{identities.add(`${table}:${id}`);if(identities.size>5000)throw new ServiceError("conflict","Restore the complete combined original cash/charge feedback ancestry before financial undo.");};
  for(const cash of observed)record("merchant_payment_observations",cash.id);for(const cash of original)record("subscription_provider_charge_receipts",cash.id);
  const namespaces: OriginalCashFeedbackNamespace[] = [];
  const chargeRefs=new Map<OriginalCashFeedbackNamespace,Set<string>>();
  const addCharge=(scope:OriginalCashFeedbackNamespace,charge:string|null)=>{if(charge){const values=chargeRefs.get(scope)??new Set<string>();values.add(charge);chargeRefs.set(scope,values);}};
  for (const cash of observed) {
    const prior = namespaces.find(scope => scope.paymentId===cash.paymentId && scope.providerPlatformAccountId===cash.providerPlatformAccountId && scope.chargeAccountId===cash.chargeAccountId && scope.originalPaymentRef===cash.providerRef && scope.providerApiVersion===cash.providerApiVersion);
    if (prior) {prior.originalObservationIds.push(cash.id);addCharge(prior,cash.providerChargeRef);}
    else {const scope={paymentId:cash.paymentId,subscriptionChargeReceiptId:null,originalObservationIds:[cash.id],providerPlatformAccountId:cash.providerPlatformAccountId,chargeAccountId:cash.chargeAccountId,originalPaymentRef:cash.providerRef,providerApiVersion:cash.providerApiVersion,originalResourceRefs:[]};namespaces.push(scope);addCharge(scope,cash.providerChargeRef);}
  }
  for (const cash of original) {const scope={paymentId:null,subscriptionChargeReceiptId:cash.id,originalObservationIds:[],providerPlatformAccountId:cash.providerPlatformAccountId,chargeAccountId:cash.chargeAccountId,originalPaymentRef:cash.providerPaymentIntentRef,providerApiVersion:cash.providerApiVersion,originalResourceRefs:[]};namespaces.push(scope);addCharge(scope,cash.providerChargeRef);}
  const e=env(),keys=[e.CREDENTIAL_KEY,e.CREDENTIAL_KEY_PREVIOUS,e.SESSION_SECRET].filter((key):key is string=>Boolean(key));
  const result: Array<{namespace:OriginalCashFeedbackNamespace;feedback:typeof legacyBankFeedback.$inferSelect}>=[];
  for(const namespace of namespaces)namespace.originalObservationIds.sort();
  for(const namespace of namespaces.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))) {
    const bindings=await tx.select({id:merchantRefundResourceBindings.id,ref:merchantRefundResourceBindings.providerRef}).from(merchantRefundResourceBindings).innerJoin(merchantRefundRequests,eq(merchantRefundRequests.id,merchantRefundResourceBindings.requestId))
      .where(and(eq(merchantRefundRequests.providerPlatformAccountId,namespace.providerPlatformAccountId),sql`${merchantRefundRequests.chargeAccountId} is not distinct from ${namespace.chargeAccountId}`,eq(merchantRefundRequests.originalPaymentRef,namespace.originalPaymentRef))).limit(5001);
    const captured=await tx.select({fact:originalCashRecoveryFacts,owner:originalCashRecoveries}).from(originalCashRecoveryFacts).innerJoin(originalCashRecoveries,eq(originalCashRecoveries.id,originalCashRecoveryFacts.recoveryId))
      .where(and(eq(originalCashRecoveryFacts.kind,"refund"),sql`${originalCashRecoveries.owner}->'cash'->>'providerPlatformAccountId'=${namespace.providerPlatformAccountId}`,
        sql`${originalCashRecoveries.owner}->'cash'->>'chargeAccountId' is not distinct from ${namespace.chargeAccountId}`,sql`${originalCashRecoveries.owner}->'cash'->>'providerRef'=${namespace.originalPaymentRef}`,
        sql`${originalCashRecoveryFacts.evidence}->>'paymentProviderRef'=${namespace.originalPaymentRef}`,excludeOperationId?sql`${originalCashRecoveryFacts.operationId} is distinct from ${excludeOperationId}::uuid`:undefined)).limit(5001);
    for(const binding of bindings)record("merchant_refund_resource_bindings",binding.id);
    for(const row of captured){record("original_cash_recoveries",row.owner.id);record("original_cash_recovery_facts",row.fact.id);}
    if(bindings.length+captured.length>5000)throw new ServiceError("conflict","Restore the complete actual original resource-reference inventory before signed feedback reconciliation.");
    for(const {fact,owner} of captured) {
      if(!verifyOriginalCashRecovery("owner",owner,{namespaceKey:owner.namespaceKey,paymentId:owner.paymentId,subscriptionChargeReceiptId:owner.subscriptionChargeReceiptId,owner:owner.owner},keys)
        ||owner.namespaceKey!==cashNamespaceKey(owner.owner.cash)||!verifyOriginalCashRecovery("fact",fact,{recoveryId:fact.recoveryId,operationId:fact.operationId,sequence:fact.sequence,kind:fact.kind,evidence:fact.evidence},keys)
        ||typeof fact.evidence.providerRef!=="string")throw new ServiceError("conflict","Restore authentic original cash callback ownership before using its bank resource references.");
    }
    namespace.originalResourceRefs=[...new Set([...bindings.map(row=>row.ref),...captured.map(row=>String(row.fact.evidence.providerRef))])].sort();
    const charges=[...(chargeRefs.get(namespace)??[])].sort();
    const rows=await tx.select().from(legacyBankFeedback).where(and(sql`${legacyBankFeedback.evidence}->>'observedChargeAccountId' is not distinct from ${namespace.chargeAccountId}`,
      sql`(${legacyBankFeedback.evidence}->>'observedPaymentRef'=${namespace.originalPaymentRef}${namespace.originalResourceRefs.length?sql` or ${legacyBankFeedback.evidence}->>'observedRefundRef' in (${sql.join(namespace.originalResourceRefs.map(ref=>sql`${ref}`),sql`,`)})`:sql``}${charges.length?sql` or (${legacyBankFeedback.evidence}->>'observedPaymentRef' is null and ${legacyBankFeedback.evidence}->>'observedChargeRef' in (${sql.join(charges.map(ref=>sql`${ref}`),sql`,`)}))`:sql``})`,
      sql`(${legacyBankFeedback.evidence}->>'observedPlatformAccountId' is null or ${legacyBankFeedback.evidence}->>'observedPlatformAccountId'=${namespace.providerPlatformAccountId})`)).orderBy(asc(legacyBankFeedback.id)).limit(5001);
    if(result.length+rows.length>5000)throw new ServiceError("conflict","Retain original cash feedback debt; a truncated callback inventory cannot authorize financial undo.");
    for(const feedback of rows){const verified=verifyLegacyBankFeedback(feedback,keys);if(!verified)throw new ServiceError("conflict","Preserve the corrupt raw financial feedback and restore its authentic original receipt before current money or financial undo.");
      record("legacy_bank_feedback",feedback.id);
      if(verified.observedPaymentRef===null&&verified.observedChargeRef&&charges.includes(verified.observedChargeRef)&&!namespace.originalResourceRefs.includes(verified.observedRefundRef)){
        const ancestry=await originalChargeFeedbackAncestry(tx,verified);
        if(ancestry){for(const identity of ancestry.identities)record(identity.table,identity.id);
          if(!ancestry.candidates.some(source=>source.platform===namespace.providerPlatformAccountId&&source.account===namespace.chargeAccountId&&source.paymentRef===namespace.originalPaymentRef
            &&(source.paymentId===namespace.paymentId&&namespace.paymentId!==null||source.subscriptionChargeReceiptId===namespace.subscriptionChargeReceiptId&&namespace.subscriptionChargeReceiptId!==null)))
            throw new ServiceError("conflict","Restore the exact selected original charge namespace before assigning its retained feedback review.");
        }
      }
      result.push({namespace,feedback});
    }
  }
  return result;
}
