// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: plain authenticated coverage for the parent-owned financial reader.
import { eq,inArray } from "drizzle-orm";
import { ServiceError,type Tx } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptionCommercialTerms,subscriptionProviderChargeReceipts } from "./schema";
import { subscriptionControlledResources } from "./controlled-provider-schema";
import { controlledProviderJournal } from "./controlled-provider-proof";
import { controlledProviderWitnesses } from "./controlled-provider-witnesses";
import { controlledCashEvidence,readOriginalControlledChargeAuthority } from "./controlled-provider-cash-origin";
import { controlledRawFinancialReview,type ControlledRawFinancialFact } from "./controlled-provider-raw-financial-review";
import { controlledZeroTransportProof } from "./controlled-provider-zero-policy";
function refuse():never{throw new ServiceError("conflict","Restore complete authentic controlled resource/caller/raw/cash-origin coverage. Only the exact same owned latest planned operation with zero actual children may be excluded before physical admission.");}
/** No parent/resource lock is acquired and no service is called. The caller
 * holds the existing controlled resource lock through admission. complete is
 * COVERAGE only: all debt below survives and still governs real money/consent.
 * The returned revision composes full physical SQL-row fingerprints AND the
 * verified original signatures/raw facts, not a latest successful projection. */
export async function controlledProviderCoverage(tx:Tx,input:{subscriptionId:string;excludeUnadmittedOperationId?:string}){
 const resources=await tx.select().from(subscriptionControlledResources).where(eq(subscriptionControlledResources.subscriptionId,input.subscriptionId)).orderBy(subscriptionControlledResources.generation).limit(5001);
 if(resources.length>5000)refuse();
 const witness=await controlledProviderWitnesses(tx,{subscriptionIds:[input.subscriptionId]});if(witness.incomplete||witness.resources.length!==resources.length)refuse();
 const journals=[];let count=0,excluded=false;const unfinishedCalls:Array<{resourceId:string;operationId:string;callId:string;kind:string}>=[],rawCashReviewFactIds:string[]=[],rawFinancialFacts:ControlledRawFinancialFact[]=[],receiptIds:string[]=[];
 for(const resource of resources){
  const[terms]=await tx.select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.id,resource.termsId)).limit(1);
  if(!terms||terms.subscriptionId!==input.subscriptionId||resource.originalScope.subscriptionId!==resource.subscriptionId||resource.originalScope.termsId!==terms.id||resource.originalScope.generation!==resource.generation)refuse();
  const history=await controlledProviderJournal(tx,resource.id);count+=history.count;if(count>5000)refuse();
  for(const operation of history.operations)if(operation.acceptedQuoteDigest!==terms.acceptedQuoteDigest||operation.originalRequest.scopeDigest!==merchantTaxDigest(resource.originalScope))refuse();
  for(const closure of history.closures){
   const previous={...history,closures:[],count:history.count-history.closures.length,revision:merchantTaxDigest({operations:history.operations,calls:history.calls,facts:history.facts,finishes:history.finishes,stops:history.stops,verifications:history.verifications,chargeOrigins:history.chargeOrigins,closures:[]})};
   const actual=controlledZeroTransportProof(previous,resource.originalScope.currency);
   if(!actual||closure.kind!=="zero_transport"||closure.originalEvidenceRevision!==previous.revision||merchantTaxDigest(actual)!==closure.proofDigest)refuse();
  }
  for(const call of history.calls)if(history.unfinished.includes(call.id)){const operation=history.operations.find(row=>row.id===call.operationId);if(!operation)refuse();unfinishedCalls.push({resourceId:resource.id,operationId:operation.id,callId:call.id,kind:operation.kind});}
  const origins=history.chargeOrigins,canonical=origins.length?await tx.select().from(subscriptionProviderChargeReceipts).where(inArray(subscriptionProviderChargeReceipts.id,origins.map(row=>row.receiptId))).limit(5001):[];
  if(canonical.length!==origins.length)refuse();
  for(const origin of origins){
   const fact=history.facts.find(row=>row.id===origin.factId),receipt=canonical.find(row=>row.id===origin.receiptId);if(!fact||!receipt)refuse();
   const cash=controlledCashEvidence.safeParse(fact.actual.raw.cash);if(!cash.success)refuse();
   const authority=await readOriginalControlledChargeAuthority(tx,cash.data,{resourceId:resource.id,callId:origin.callId,factId:origin.factId});
   if(authority.controlledOrigin.operationId!==origin.operationId||authority.controlledOrigin.originalEvidenceDigest!==origin.originalEvidenceDigest||receipt.subscriptionId!==resource.subscriptionId
    ||receipt.providerPlatformAccountId!==cash.data.providerPlatformAccountId||receipt.chargeAccountId!==(cash.data.providerAccountId??null)||receipt.providerSubscriptionRef!==cash.data.providerSubscriptionRef
    ||receipt.providerInvoiceRef!==cash.data.providerInvoiceRef||receipt.providerPaymentIntentRef!==cash.data.providerPaymentIntentRef||receipt.amountMinor!==cash.data.amountMinor||receipt.currency!==cash.data.currency)refuse();
   receiptIds.push(receipt.id);
  }
  // The zero-only protocol has no admitted positive collection. Actual raw
  // intent/invoice/payment/recurring facts remain review even if the SDK died
  // before cash_observed or its bridge. A later read cannot erase occurrence.
  const rawReview=controlledRawFinancialReview(resource,history);
  rawCashReviewFactIds.push(...rawReview.factIds);rawFinancialFacts.push(...rawReview.facts);
  let operations=history.operations;
  if(input.excludeUnadmittedOperationId){const own=history.operations.find(row=>row.id===input.excludeUnadmittedOperationId);
   if(own){
    if(excluded||own.resourceId!==resource.id||history.operations.at(-1)?.id!==own.id||history.closures.length||history.calls.some(row=>row.operationId===own.id)
     ||history.verifications.some(row=>row.operationId===own.id)||history.chargeOrigins.some(row=>row.operationId===own.id))refuse();
    // Facts/finishes/stops have actual caller FKs. Zero callers proves all of
    // those child families empty for this operation; independent origins are
    // checked explicitly too. No prior operation/resource is filtered.
    excluded=true;operations=operations.filter(row=>row.id!==own.id);
   }
  }
  journals.push({resourceId:resource.id,revision:merchantTaxDigest({operations,calls:history.calls,facts:history.facts,finishes:history.finishes,stops:history.stops,verifications:history.verifications,chargeOrigins:history.chargeOrigins,closures:history.closures})});
 }
 if(input.excludeUnadmittedOperationId&&!excluded)refuse();
 const selected={...witness,operations:witness.operations.filter(row=>row.id!==input.excludeUnadmittedOperationId)};
 return{complete:true as const,revision:merchantTaxDigest({witness:selected,journals}),inventoryCount:count-(excluded?1:0),excludedOperationId:excluded?input.excludeUnadmittedOperationId!:null,
  resourceIds:resources.map(row=>row.id),receiptIds,unfinishedCalls,rawCashReviewFactIds,rawFinancialFacts,witness:selected};
}
