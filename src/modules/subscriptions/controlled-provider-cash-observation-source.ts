// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: authentic money identity for an observation GET, never spend authority.
import { and,asc,eq,sql } from "drizzle-orm";
import { z } from "zod";
import { ServiceError,type Tx } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptionCommercialTerms,subscriptionProviderChargeObservations,subscriptionProviderChargeReceipts,subscriptions } from "./schema";
import { subscriptionControlledChargeOrigins,subscriptionControlledResources } from "./controlled-provider-schema";
import { subscriptionControlledCollections,subscriptionControlledInvoiceBindings,subscriptionControlledQuotes } from "./controlled-provider-collection-schema";
import { controlledCashEvidence,readOriginalControlledChargeAuthority,type ControlledCashEvidence } from "./controlled-provider-cash-origin";
import { controlledProviderJournal } from "./controlled-provider-proof";
import { authenticatedControlledQuote } from "./controlled-provider-quote-proof";
import { controlledRawFinancialReview } from "./controlled-provider-raw-financial-review";
import { CONTROLLED_COLLECTION_PROTOCOL,CONTROLLED_COLLECTION_POLICY } from "./controlled-provider-collection-contract";
const sha=z.string().regex(/^[a-f0-9]{64}$/),reference=z.string().min(1).max(200);
export const controlledCashObservationProof=z.object({
 protocol:z.literal(CONTROLLED_COLLECTION_PROTOCOL),collectionId:z.uuid(),quoteId:z.uuid(),resourceId:z.uuid(),subscriptionId:z.uuid(),invoiceId:z.uuid(),receiptId:z.uuid(),observationId:z.uuid(),
 originOperationId:z.uuid(),originCallId:z.uuid(),originFactId:z.uuid(),invoiceCreatorOperationId:z.uuid(),invoiceObservationOperationId:z.uuid(),invoiceObservationCallId:z.uuid(),invoiceObservationFactId:z.uuid(),
 acceptedQuoteDigest:sha,providerPlatformAccountId:reference,chargeAccountId:reference.nullable(),providerSubscriptionRef:reference,providerInvoiceRef:reference,providerPaymentIntentRef:reference,providerChargeRef:reference.nullable(),providerApiVersion:z.literal("2026-10-28.endive"),
 amountMinor:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),currency:z.string().regex(/^[A-Z]{3}$/),
 controlledJournalRevision:sha,sourceRevision:sha,originalObservationIds:z.array(z.uuid()).min(1).max(5000),rawFactIds:z.array(z.uuid()).min(1).max(5000),rawMoneyReviewFactIds:z.array(z.uuid()).max(5000),unfinishedControlledCallIds:z.array(z.uuid()).max(5000),physicalRowCount:z.number().int().positive().max(5000),
 suppliesObservationAuthority:z.literal(false),suppliesApplicationAuthority:z.literal(false),suppliesPrincipalAuthority:z.literal(false),suppliesAccessAuthority:z.literal(false),
}).strict();
export type ControlledCashObservationProof=z.infer<typeof controlledCashObservationProof>;
type ReceiptIdentity=Pick<typeof subscriptionProviderChargeReceipts.$inferSelect,"subscriptionId"|"providerPlatformAccountId"|"chargeAccountId"|"providerSubscriptionRef"|"providerInvoiceRef"|"providerPaymentIntentRef"|"providerChargeRef"|"amountMinor"|"currency">;
/** Matching proves only the exact source to observe. Wrong/unknown merchant
 * route or partial/over-capture remains visible debt, not a forbidden GET. */
export function cashObservationSourceMatches(receipt:ReceiptIdentity,cash:ControlledCashEvidence){return cash.subscriptionId===receipt.subscriptionId&&cash.providerPlatformAccountId===receipt.providerPlatformAccountId&&(cash.providerAccountId??null)===receipt.chargeAccountId
 &&cash.providerSubscriptionRef===receipt.providerSubscriptionRef&&cash.providerInvoiceRef===receipt.providerInvoiceRef&&cash.providerPaymentIntentRef===receipt.providerPaymentIntentRef&&cash.amountMinor===receipt.amountMinor&&cash.currency===receipt.currency
 &&(!cash.providerChargeRef||!receipt.providerChargeRef||cash.providerChargeRef===receipt.providerChargeRef);}
const object=(value:unknown)=>z.record(z.string(),z.unknown()).parse(value);
const ref=(value:unknown)=>typeof value==="string"?value:value&&typeof value==="object"&&"id"in value&&typeof value.id==="string"?value.id:null;
function refuse():never{throw new ServiceError("conflict","Restore the exact accepted target, original retained receipt and authenticated creator/observation ancestry before admitting a debt-observing GET; a current account, equal amount or newer successful caller cannot adopt this source.");}
/** Reads ONLY. Caller holds resource→parent before ordinary payment/invoice/note
 * and namespace locks. Parent must independently prove full financial/privacy
 * coverage and all original caller closure, retaining every occurrence/debt.
 * No current paid/refunded/principal/fee-safety predicate is asserted here:
 * observing unexpected partial, over-captured or disputed money is necessary
 * to recover it. The same proof can never authorize its application or return. */
export async function readControlledCashObservationSource(tx:Tx,input:{collectionId:string;receiptId:string}):Promise<ControlledCashObservationProof>{
 const[collection]=await tx.select().from(subscriptionControlledCollections).where(eq(subscriptionControlledCollections.id,input.collectionId)).limit(1);
 const[quote]=collection?await tx.select().from(subscriptionControlledQuotes).where(eq(subscriptionControlledQuotes.id,collection.quoteId)).limit(1):[];
 const[resource]=quote?await tx.select().from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,quote.resourceId)).limit(1):[];
 const[parent]=resource?await tx.select().from(subscriptions).where(eq(subscriptions.id,resource.subscriptionId)).limit(1):[];
 const[terms]=collection?await tx.select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.id,collection.termsId)).limit(1):[];
 const[receipt]=await tx.select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.id,input.receiptId)).limit(1);
 const[origin]=await tx.select().from(subscriptionControlledChargeOrigins).where(eq(subscriptionControlledChargeOrigins.receiptId,input.receiptId)).limit(1);
 const[binding]=collection?await tx.select().from(subscriptionControlledInvoiceBindings).where(eq(subscriptionControlledInvoiceBindings.collectionId,collection.id)).limit(1):[];
 if(!collection||!quote||!resource||!parent||!terms||!receipt||!origin||!binding||!collection.invoiceId||origin.resourceId!==resource.id||binding.resourceId!==resource.id
  ||terms.subscriptionId!==parent.id||receipt.subscriptionId!==parent.id||receipt.providerApiVersion!=="2026-10-28.endive"
  ||collection.id!==quote.plannedCollectionId||collection.prorationId!==quote.plannedProrationId||collection.kind!==quote.kind||collection.collectionPolicy!==CONTROLLED_COLLECTION_POLICY
  ||collection.acceptedQuoteDigest!==quote.quoteDigest||collection.originalConsentDigest!==quote.quoteDigest||binding.providerInvoiceRef!==receipt.providerInvoiceRef)refuse();
 const history=await controlledProviderJournal(tx,resource.id),authenticated=authenticatedControlledQuote(quote,resource,history);
 if(history.unfinished.length||authenticated.review.controlled.plannedCollectionId!==collection.id||authenticated.review.subscriptionId!==parent.id)refuse();
 const ownFact=history.facts.find(row=>row.id===origin.factId),ownCall=history.calls.find(row=>row.id===origin.callId);
 if(!ownFact||!ownCall||ownCall.operationId!==origin.operationId||ownFact.callId!==ownCall.id||ownFact.actual.kind!=="cash_observed")refuse();
 const actualCash=controlledCashEvidence.parse(ownFact.actual.raw.cash),actualOrigin=await readOriginalControlledChargeAuthority(tx,actualCash,{resourceId:origin.resourceId,callId:origin.callId,factId:origin.factId});
 if(actualOrigin.controlledOrigin.operationId!==origin.operationId||actualOrigin.controlledOrigin.originalEvidenceDigest!==origin.originalEvidenceDigest
  ||!cashObservationSourceMatches(receipt,actualCash))refuse();
 const creator=history.operations.find(row=>row.id===binding.creatorOperationId),observer=history.operations.find(row=>row.id===binding.operationId),observingCall=history.calls.find(row=>row.id===binding.callId),observingFact=history.facts.find(row=>row.id===binding.factId);
 if(!creator||!observer||!observingCall||!observingFact||observingCall.operationId!==observer.id||observingFact.callId!==observingCall.id||!history.calls.some(row=>row.operationId===creator.id)
  ||!["controlled_draft_created","invoice_read","invoice_list_read"].includes(observingFact.actual.kind)
  ||binding.originalEvidenceDigest!==merchantTaxDigest({collectionId:collection.id,creator,operation:observer,call:observingCall,fact:observingFact,providerInvoiceRef:binding.providerInvoiceRef}))refuse();
 const invoices=observingFact.actual.kind==="invoice_list_read"?observingFact.actual.raw.data:[observingFact.actual.raw];
 if(!Array.isArray(invoices)||!invoices.some(row=>ref(row)===receipt.providerInvoiceRef))refuse();
 const originalInvoice=object(invoices.find(row=>ref(row)===receipt.providerInvoiceRef)),parentDetails=z.record(z.string(),z.unknown()).safeParse(originalInvoice.parent),details=parentDetails.success?z.record(z.string(),z.unknown()).safeParse(parentDetails.data.subscription_details):null;
 if((ref(originalInvoice.subscription)??(details?.success?ref(details.data.subscription):null))!==receipt.providerSubscriptionRef||ref(originalInvoice.customer)!==resource.originalScope.providerCustomerRef)refuse();
 // Every actual observation remains in this proof and the parent graph. A
 // matching original selects identity; it does not discard contrary later facts.
 const observations=await tx.select().from(subscriptionProviderChargeObservations).where(and(eq(subscriptionProviderChargeObservations.subscriptionId,parent.id),eq(subscriptionProviderChargeObservations.providerPlatformAccountId,receipt.providerPlatformAccountId),
  sql`${subscriptionProviderChargeObservations.chargeAccountId} is not distinct from ${receipt.chargeAccountId}`,eq(subscriptionProviderChargeObservations.providerPaymentIntentRef,receipt.providerPaymentIntentRef))).orderBy(asc(subscriptionProviderChargeObservations.createdAt),asc(subscriptionProviderChargeObservations.id)).limit(5001);
 const observation=observations.find(row=>row.providerApiVersion===receipt.providerApiVersion&&row.providerSubscriptionRef===receipt.providerSubscriptionRef&&row.providerInvoiceRef===receipt.providerInvoiceRef&&row.amountMinor===receipt.amountMinor&&row.currency===receipt.currency);
 const physicalRowCount=history.count+observations.length+7;if(!observation||physicalRowCount>5000)refuse();
 const raw=controlledRawFinancialReview(resource,history),rawMoneyReviewFactIds=raw.factIds;
 return controlledCashObservationProof.parse({protocol:CONTROLLED_COLLECTION_PROTOCOL,collectionId:collection.id,quoteId:quote.id,resourceId:resource.id,subscriptionId:parent.id,invoiceId:collection.invoiceId,receiptId:receipt.id,observationId:observation.id,
  originOperationId:origin.operationId,originCallId:origin.callId,originFactId:origin.factId,invoiceCreatorOperationId:creator.id,invoiceObservationOperationId:observer.id,invoiceObservationCallId:observingCall.id,invoiceObservationFactId:observingFact.id,
  acceptedQuoteDigest:collection.acceptedQuoteDigest,providerPlatformAccountId:receipt.providerPlatformAccountId,chargeAccountId:receipt.chargeAccountId,providerSubscriptionRef:receipt.providerSubscriptionRef,providerInvoiceRef:receipt.providerInvoiceRef,providerPaymentIntentRef:receipt.providerPaymentIntentRef,providerChargeRef:receipt.providerChargeRef,providerApiVersion:receipt.providerApiVersion,
  amountMinor:receipt.amountMinor,currency:receipt.currency,controlledJournalRevision:history.revision,sourceRevision:merchantTaxDigest({collection,quote,resource,parent,terms,receipt,origin,binding,originalMerchantScope:actualOrigin.scope,observations,controlledJournalRevision:history.revision}),
  originalObservationIds:observations.map(row=>row.id),rawFactIds:history.facts.map(row=>row.id),rawMoneyReviewFactIds,unfinishedControlledCallIds:history.unfinished,physicalRowCount,
  suppliesObservationAuthority:false,suppliesApplicationAuthority:false,suppliesPrincipalAuthority:false,suppliesAccessAuthority:false});
}
