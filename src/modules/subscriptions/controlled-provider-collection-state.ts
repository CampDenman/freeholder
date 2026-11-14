// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Real accepted canonical target and immutable bank creator/observation ancestry.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ServiceError,type Tx } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptionCommercialTerms,subscriptionMarketPolicies,subscriptions } from "./schema";
import { subscriptionControlledResources } from "./controlled-provider-schema";
import { subscriptionControlledQuotes,subscriptionControlledCollections,subscriptionControlledComponents,subscriptionControlledInvoiceBindings,subscriptionControlledItemReceipts,subscriptionControlledInvoiceProofs } from "./controlled-provider-collection-schema";
import { controlledComponentProvenance,controlledTargetReview } from "./controlled-provider-collection-contract";
import { controlledCollectionManifest } from "./controlled-provider-adapter-contract";
import { controlledProviderJournal } from "./controlled-provider-proof";
import { authenticatedControlledQuote } from "./controlled-provider-quote-proof";
import { assertControlledOriginalConsent } from "./controlled-provider-original-consent";
import { controlledCanonicalTarget } from "./controlled-provider-canonical-target";
import { assertControlledInvoiceOrigin,assertControlledComponentLine } from "./controlled-provider-collection-origin";
function refuse():never{throw new ServiceError("conflict","Restore the whole exact accepted canonical target, dated tax, original fee/credit epochs and genuine bank creator/caller/fact lineage before another collection operation.");}
const ref=(value:unknown)=>typeof value==="string"?value:value&&typeof value==="object"&&"id"in value&&typeof value.id==="string"?value.id:null;
/** Pure read, with no service call and no lock-order reversal. This validates
 * signed actual caller/raw evidence but does NOT release outstanding callers,
 * declare current principal safe, or waive any financial obligation. */
export async function controlledCollectionState(tx:Tx,collectionId:string){
 const[collection]=await tx.select().from(subscriptionControlledCollections).where(eq(subscriptionControlledCollections.id,collectionId)).limit(1);
 const[quote]=collection?await tx.select().from(subscriptionControlledQuotes).where(eq(subscriptionControlledQuotes.id,collection.quoteId)).limit(1):[];
 const[resource]=quote?await tx.select().from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,quote.resourceId)).limit(1):[];
 const[parent]=resource?await tx.select().from(subscriptions).where(eq(subscriptions.id,resource.subscriptionId)).limit(1):[];
 const[terms]=collection?await tx.select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.id,collection.termsId)).limit(1):[];
 if(!collection||!quote||!resource||!parent||!terms||!collection.invoiceId)refuse();
 const review=controlledTargetReview.parse(quote.review);
 if(collection.kind!==quote.kind||collection.kind!==review.kind||review.subscriptionId!==parent.id||review.previousTermsId!==quote.previousTermsId
  ||review.controlled.resourceId!==resource.id||review.controlled.quoteId!==quote.id||review.controlled.plannedCollectionId!==collection.id
  ||review.controlled.plannedProrationId!==collection.prorationId||quote.plannedProrationId!==collection.prorationId||quote.plannedCollectionId!==collection.id
  ||quote.quoteDigest!==review.quoteDigest||collection.acceptedQuoteDigest!==review.quoteDigest
  ||quote.sourceRevision!==review.sourceRevision||quote.quotedParentRevision!==review.controlled.quotedParentRevision||terms.subscriptionId!==parent.id
  ||merchantTaxDigest(terms.snapshot)!==merchantTaxDigest(review.quote.snapshot)||collection.kind==="proration"&&terms.acceptedQuoteDigest!==review.quoteDigest
  ||collection.kind==="period"&&collection.acceptanceKind!=="original_period_mandate"||collection.kind==="proration"&&collection.acceptanceKind!=="explicit_change")refuse();
 assertControlledOriginalConsent(collection,review,terms);
 const history=await controlledProviderJournal(tx,resource.id);authenticatedControlledQuote(quote,resource,history);
 const canonical=await controlledCanonicalTarget(tx,collection.invoiceId,collection.creditNoteId);
 const[market]=await tx.select().from(subscriptionMarketPolicies).where(eq(subscriptionMarketPolicies.subscriptionId,parent.id)).limit(1);
 if(!market||market.model!=="seller_merchant"||canonical.marketPolicy.sellerUserId!==market.sellerUserId||canonical.marketPolicy.siteFeeBps!==market.siteFeeBps
  ||canonical.marketPolicy.merchantContactId!==market.merchantContactId||canonical.marketPolicy.providerAccountId!==market.providerAccountId)refuse();
 const components=await tx.select().from(subscriptionControlledComponents).where(eq(subscriptionControlledComponents.collectionId,collection.id)).orderBy(subscriptionControlledComponents.position).limit(5001);
 const[binding]=await tx.select().from(subscriptionControlledInvoiceBindings).where(eq(subscriptionControlledInvoiceBindings.collectionId,collection.id)).limit(1);
 const itemReceipts=[];
 for(const component of components){const[item]=await tx.select().from(subscriptionControlledItemReceipts).where(eq(subscriptionControlledItemReceipts.componentId,component.id)).limit(1);if(item)itemReceipts.push(item);}
 const proofs=await tx.select().from(subscriptionControlledInvoiceProofs).where(eq(subscriptionControlledInvoiceProofs.collectionId,collection.id)).orderBy(subscriptionControlledInvoiceProofs.id).limit(5001);
 if(history.count+canonical.count+components.length+itemReceipts.length+proofs.length+5+(binding?1:0)>5000||!components.length||components.length>250
  ||canonical.digest!==collection.canonicalTargetDigest||canonical.invoice.contactId!==parent.contactId||canonical.invoice.currency!==parent.currency||canonical.invoice.sourceId!==quote.canonicalSourceId
  ||canonical.invoice.subtotalMinor-canonical.invoice.discountMinor!==review.debitNetMinor||canonical.invoice.shippingMinor!==0||canonical.invoice.taxMinor!==review.debitTaxMinor
  ||canonical.invoice.totalMinor!==review.debitNetMinor+review.debitTaxMinor||canonical.invoice.creditedMinor!==review.creditAppliedMinor
  ||canonical.taxes[0]?.profileId!==quote.profileId||canonical.taxes[0]?.profileVersion!==quote.profileVersion)refuse();
 const actualComponents=components.map(row=>{const provenance=controlledComponentProvenance.parse(row.provenance);
  if(row.kind!==provenance.kind||row.currency!==parent.currency||merchantTaxDigest(provenance)!==row.provenanceDigest)refuse();
  const base={id:row.id,position:row.position,kind:row.kind,amountMinor:row.amountMinor,periodStart:row.periodStart.toISOString(),periodEnd:row.periodEnd.toISOString(),provenanceDigest:row.provenanceDigest};
  if(provenance.kind==="locked_canonical_credit"){
   if(provenance.creditNoteId!==collection.creditNoteId||provenance.applicationIds.some(id=>!canonical.applications.some(app=>app.reservationId===id))
    ||new Set(provenance.applicationIds).size!==provenance.applicationIds.length)refuse();
   const reservations=canonical.reservations.filter(row=>provenance.applicationIds.includes(row.id));
   if(reservations.length!==provenance.applicationIds.length||reservations.reduce((sum,row)=>sum+BigInt(row.amountMinor),0n)!==-BigInt(row.amountMinor)
    ||reservations.some(row=>canonical.funding.find(f=>f.id===row.fundingId)?.creditNoteId!==provenance.creditNoteId))refuse();
   return{...base,creditNoteId:provenance.creditNoteId,applicationIds:provenance.applicationIds};
  }
  if(provenance.kind==="merchant_declared_tax_collection"){
   if(provenance.profileId!==quote.profileId||provenance.profileVersion!==quote.profileVersion||row.amountMinor!==review.debitTaxMinor)refuse();
   return{...base,providerProductRef:provenance.providerProductRef,taxQuoteDigest:provenance.taxQuoteDigest,profileId:provenance.profileId,profileVersion:provenance.profileVersion};
  }
  if(collection.kind==="period"){
   const line=canonical.lines.find(line=>line.id===provenance.canonicalInvoiceLineId),snapshot=line?z.record(z.string(),z.unknown()).parse(line.snapshot):null;
   if(!line||!snapshot||!provenance.canonicalComponent||line.unitAmountMinor!==row.amountMinor||line.quantityMicros!==1000000||line.discountMinor!==0
    ||line.sourceType!=="subscription"||line.sourceId!==parent.id||snapshot.subscriptionTermsId!==terms.id||snapshot.subscriptionComponent!==provenance.canonicalComponent
    ||snapshot.subscriptionPeriodStart!==row.periodStart.toISOString()||snapshot.subscriptionPeriodEnd!==row.periodEnd.toISOString()
    ||row.periodStart.toISOString()!==review.calendar.proposedPeriodStart||row.periodEnd.toISOString()!==review.calendar.proposedPeriodEnd)refuse();
  }
  return{...base,providerProductRef:provenance.providerProductRef};
 });
 if(collection.kind==="period"){
  const net=components.filter(row=>row.kind==="net"),ids=net.map(row=>controlledComponentProvenance.parse(row.provenance)).filter(row=>row.kind==="net").map(row=>row.canonicalInvoiceLineId);
  if(ids.length!==canonical.lines.length||new Set(ids).size!==ids.length||canonical.lines.some(line=>!ids.includes(line.id)))refuse();
 }
 const manifest=controlledCollectionManifest.parse({protocol:"controlled_net_gross.v1",collectionId:collection.id,quoteId:quote.id,canonicalInvoiceId:canonical.invoice.id,termsId:terms.id,
  acceptedQuoteDigest:collection.acceptedQuoteDigest,canonicalTargetDigest:canonical.digest,currency:parent.currency,grossMinor:canonical.invoice.totalMinor,creditedMinor:review.creditAppliedMinor,cashDueMinor:review.cashDueMinor,
  applicationFeeMinor:canonical.feeDuty?.cashFeeTargetMinor??canonical.marketPolicy.feeMinor,components:actualComponents});
 const sum=(kind:string)=>actualComponents.filter(row=>row.kind===kind).reduce((n,row)=>n+BigInt(row.amountMinor),0n);
 if(sum("net")!==BigInt(review.debitNetMinor)||sum("merchant_declared_tax_collection")!==BigInt(review.debitTaxMinor)||sum("locked_canonical_credit")!==-BigInt(review.creditAppliedMinor)
  ||review.cashDueMinor!==canonical.invoice.totalMinor-review.creditAppliedMinor||review.controlled.economicTargetDigest!==merchantTaxDigest({debitNetMinor:review.debitNetMinor,debitTaxMinor:review.debitTaxMinor,
   creditAppliedMinor:review.creditAppliedMinor,cashDueMinor:review.cashDueMinor,calendar:review.calendar,feeReview:review.feeReview}))refuse();
 function actual(operationId:string,callId:string,factId:string){const operation=history.operations.find(row=>row.id===operationId),call=history.calls.find(row=>row.id===callId),fact=history.facts.find(row=>row.id===factId);
  if(!operation||!call||call.operationId!==operation.id||!fact||fact.callId!==call.id)refuse();return{operation,call,fact};}
 if(binding){
  const source=actual(binding.operationId,binding.callId,binding.factId),creator=history.operations.find(row=>row.id===binding.creatorOperationId);
  if(binding.resourceId!==resource.id||!creator||!history.calls.some(row=>row.operationId===creator.id)||!["controlled_draft_created","invoice_read","invoice_list_read"].includes(source.fact.actual.kind))refuse();
  const parsedRows=z.array(z.unknown()).safeParse(source.fact.actual.kind==="invoice_list_read"?source.fact.actual.raw.data:[source.fact.actual.raw]);
  if(!parsedRows.success)refuse();const rows=parsedRows.data;
  if(!rows.some(row=>ref(row)===binding.providerInvoiceRef)||binding.originalEvidenceDigest!==merchantTaxDigest({collectionId:collection.id,creator,operation:source.operation,call:source.call,fact:source.fact,providerInvoiceRef:binding.providerInvoiceRef}))refuse();
  const raw=rows.find(row=>ref(row)===binding.providerInvoiceRef);
  if(!raw||typeof raw!=="object"||Array.isArray(raw))refuse();
  assertControlledInvoiceOrigin({resource,manifest,review,history,binding},binding.originKind,creator,source.operation,z.record(z.string(),z.unknown()).parse(raw));
 }
 for(const item of itemReceipts){const source=actual(item.operationId,item.callId,item.factId),creator=history.operations.find(row=>row.id===item.creatorOperationId);
  const parsedRows=z.array(z.unknown()).safeParse(source.fact.actual.raw.data);if(!parsedRows.success)refuse();const rows=parsedRows.data;
  if(item.resourceId!==resource.id||!binding||!creator||!history.calls.some(row=>row.operationId===creator.id)||source.fact.actual.kind!=="invoice_lines_read"
   ||!rows.some(row=>ref(row)===item.providerInvoiceLineRef)||item.originalEvidenceDigest!==merchantTaxDigest({componentId:item.componentId,creator,operation:source.operation,call:source.call,fact:source.fact,
    providerInvoiceRef:binding.providerInvoiceRef,providerInvoiceItemRef:item.providerInvoiceItemRef,providerInvoiceLineRef:item.providerInvoiceLineRef,providerPriceRef:item.providerPriceRef}))refuse();
  const component=components.find(row=>row.id===item.componentId),raw=rows.find(row=>ref(row)===item.providerInvoiceLineRef);
  if(!component||!raw||typeof raw!=="object"||Array.isArray(raw))refuse();
  const lineage=assertControlledComponentLine({resource,manifest,review,history,binding},component,creator,source.operation,z.record(z.string(),z.unknown()).parse(raw));
  if(lineage.originKind!==item.originKind||lineage.providerInvoiceItemRef!==item.providerInvoiceItemRef||lineage.providerPriceRef!==item.providerPriceRef)refuse();
 }
 // Physical operation ordinal orders actual causal reads; transaction clocks
 // and random UUIDs cannot choose a current bank manifest.
 proofs.sort((first,second)=>(history.operations.find(op=>op.id===first.operationId)?.ordinal??-1)-(history.operations.find(op=>op.id===second.operationId)?.ordinal??-1));
 for(const proof of proofs){const operation=history.operations.find(row=>row.id===proof.operationId),verification=history.verifications.find(row=>row.operationId===proof.operationId&&row.callId===proof.callId);
  if(!binding||!operation||operation.kind!=="read_manifest"||!verification||verification.actualResult.providerInvoiceRef!==binding.providerInvoiceRef||verification.actualResult.exactManifest!==true
   ||verification.actualResult.manifestDigest!==merchantTaxDigest(manifest)||proof.resultDigest!==verification.actualResultDigest||proof.canonicalTargetDigest!==canonical.digest||proof.customerFinancialDigest!==verification.actualResult.customerFinancialDigest)refuse();}
 return{collection,quote,resource,parent,terms,review,history,canonical,components,binding:binding??null,itemReceipts,proofs,manifest};
}
