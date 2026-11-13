// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Parent-owned financial composition consumes authentic six-family coverage.
import { eq,inArray } from "drizzle-orm";
import { ServiceError,type Tx } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptionControlledResources } from "./controlled-provider-schema";
import { subscriptionControlledQuotes } from "./controlled-provider-collection-schema";
import { controlledProviderJournal } from "./controlled-provider-proof";
import { controlledProviderCoverage } from "./controlled-provider-coverage";
import { controlledCollectionWitnesses } from "./controlled-provider-collection-witnesses";
import { authenticatedControlledQuote } from "./controlled-provider-quote-proof";
import { controlledCollectionState } from "./controlled-provider-collection-state";
function refuse():never{throw new ServiceError("conflict","Restore the complete authenticated original controlled quote/target/component/creator/item/read graph. No own quote, admitted caller, positive occurrence or prior target may disappear from financial coverage.");}
/** Caller holds resource then parent money locks. Pure read, no mutations or
 * parent->resource locking. complete means COVERAGE ONLY. It never supplies
 * money quiescence, paid principal, fee remittance, consent or collection access.
 * One aggregate5000 includes all nine original families plus these six. */
export async function controlledCollectionCoverage(tx:Tx,input:{subscriptionId:string;excludeUnadmittedOperationId?:string}){
 const transport=await controlledProviderCoverage(tx,input),witness=await controlledCollectionWitnesses(tx,{subscriptionIds:[input.subscriptionId]});
 const count=witness.quotes.length+witness.collections.length+witness.components.length+witness.invoiceBindings.length+witness.itemReceipts.length+witness.invoiceProofs.length;
 if(witness.incomplete||count+transport.inventoryCount>5000)refuse();
 const excluded=input.excludeUnadmittedOperationId;
 if(excluded&&(witness.quotes.some(q=>[q.calendarReadOperationId,q.customerFinancialOperationId,q.nativePreviewOperationId,q.updatePreviewOperationId].includes(excluded))
  ||witness.invoiceBindings.some(b=>b.operationId===excluded||b.creatorOperationId===excluded)||witness.itemReceipts.some(b=>b.operationId===excluded||b.creatorOperationId===excluded)||witness.invoiceProofs.some(b=>b.operationId===excluded)))refuse();
 const resources=await tx.select().from(subscriptionControlledResources).where(eq(subscriptionControlledResources.subscriptionId,input.subscriptionId)).limit(5001);
 const quotes=witness.quotes.length?await tx.select().from(subscriptionControlledQuotes).where(inArray(subscriptionControlledQuotes.id,witness.quotes.map(row=>row.id))).limit(5001):[];
 if(quotes.length!==witness.quotes.length||resources.length!==transport.resourceIds.length)refuse();
 const actualQuotes=[],actualTargets=[],redactedQuoteIds:string[]=[];
 for(const quote of quotes){const resource=resources.find(r=>r.id===quote.resourceId);if(!resource)refuse();const history=await controlledProviderJournal(tx,resource.id);
  if(quote.redactedAt){
   // An erased unaccepted quote cannot become a usable consent. Only actual
   // authenticated closed zero-resource ancestry permits its opaque retained
   // financial IDs/digests; no positive target can use this narrow branch.
   if(quote.input!==null||quote.review!==null||witness.collections.some(c=>c.quoteId===quote.id)||history.closures.length!==1||history.closures[0]?.kind!=="zero_transport")refuse();
   redactedQuoteIds.push(quote.id);actualQuotes.push({id:quote.id,redacted:true,inputDigest:quote.inputDigest,reviewDigest:quote.reviewDigest,quoteDigest:quote.quoteDigest,closureDigest:history.closures[0].proofDigest});continue;
  }
  const actual=authenticatedControlledQuote(quote,resource,history);
  actualQuotes.push({id:quote.id,quoteDigest:quote.quoteDigest,inputDigest:quote.inputDigest,reviewDigest:quote.reviewDigest,
   calendarResultDigest:actual.calendar.verification.actualResultDigest,customerResultDigest:actual.customer.verification.actualResultDigest,nativeResultDigest:actual.native.verification.actualResultDigest,updateResultDigest:actual.update.verification.actualResultDigest});
 }
 for(const collection of witness.collections){
  if(!collection.invoiceId){
   // A zero uncharged trial change has no paid-period invoice, no old paid
   // credit and no bank debit. It is not a fabricated ordinary period.
   const quote=quotes.find(q=>q.id===collection.quoteId),resource=quote?resources.find(r=>r.id===quote.resourceId):null;
   if(!quote||!resource||collection.kind!=="proration"||collection.creditNoteId!==null||witness.components.some(c=>c.collectionId===collection.id)||witness.invoiceBindings.some(b=>b.collectionId===collection.id))refuse();
   const review=authenticatedControlledQuote(quote,resource,await controlledProviderJournal(tx,resource.id)).review;
   if(!review.originalTrialEndsAt||review.debitNetMinor+review.debitTaxMinor+review.creditNetMinor+review.creditTaxMinor+review.cashDueMinor!==0)refuse();
   actualTargets.push({id:collection.id,kind:"uncharged_trial",prorationId:collection.prorationId,invoiceId:null,canonicalTargetDigest:null});continue;
  }
  const actual=await controlledCollectionState(tx,collection.id);
  actualTargets.push({id:collection.id,kind:collection.kind,prorationId:collection.prorationId,invoiceId:collection.invoiceId,canonicalTargetDigest:actual.canonical.digest,
   invoiceStatus:actual.canonical.invoice.status,currentCollectible:actual.canonical.currentCollectible,paidMinor:actual.canonical.invoice.paidMinor,refundedMinor:actual.canonical.invoice.refundedMinor,
   bindingDigest:actual.binding?.originalEvidenceDigest??null,itemDigests:actual.itemReceipts.map(row=>row.originalEvidenceDigest),readDigests:actual.proofs.map(row=>row.resultDigest)});
 }
 return{complete:true as const,protocol:"controlled_net_gross.v1" as const,revision:merchantTaxDigest({transportRevision:transport.revision,witness,actualQuotes,actualTargets}),inventoryCount:count+transport.inventoryCount,
  transport,witness,actualQuotes,actualTargets,redactedQuoteIds};
}
