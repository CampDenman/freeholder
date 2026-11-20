// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Exact canonical target ancestry, including cashless and unaccepted reviews.
import { and,eq,inArray,or,sql } from "drizzle-orm";
import type { Tx } from "@/core/service";
import { subscriptionCommercialTerms } from "./schema";
import { subscriptionControlledResources as resources } from "./controlled-provider-schema";
import { subscriptionControlledQuotes as quotesTable,subscriptionControlledCollections as collectionsTable,subscriptionControlledComponents as componentsTable,
 subscriptionControlledInvoiceBindings as bindingsTable,subscriptionControlledItemReceipts as itemsTable,subscriptionControlledInvoiceProofs as proofsTable } from "./controlled-provider-collection-schema";
const empty=()=>({quotes:[],collections:[],components:[],invoiceBindings:[],itemReceipts:[],invoiceProofs:[],incomplete:false});
const hash=(row:unknown)=>sql<string>`encode(sha256(convert_to(to_jsonb(${row})::text,'UTF8')),'hex')`;
/** Frozen accepted profile identity is selected independently for the target
 * and original resource. An invoice selects only its actual canonical FK;
 * sharing a resource never adopts the resource's other targets. Pending period
 * quotes remain discoverable by subscription/profile before any invoice exists.
 * No resource/parent lock, service call or mutation occurs in this plain reader. */
export async function controlledCollectionWitnesses(tx:Tx,input:{subscriptionIds?:readonly string[];invoiceIds?:readonly string[];profileId?:string}){
 const subscriptionIds=[...new Set(input.subscriptionIds??[])],invoiceIds=[...new Set(input.invoiceIds??[])];
 if(subscriptionIds.length+invoiceIds.length>5000)return{...empty(),incomplete:true};
 if(!subscriptionIds.length&&!invoiceIds.length&&!input.profileId)return empty();
 const exactTargetQuotes=invoiceIds.length?await tx.select({id:collectionsTable.quoteId}).from(collectionsTable).where(inArray(collectionsTable.invoiceId,invoiceIds)).limit(5001):[];
 if(exactTargetQuotes.length>5000)return{...empty(),incomplete:true};
 const selectors=[...(subscriptionIds.length?[inArray(resources.subscriptionId,subscriptionIds)]:[]),...(exactTargetQuotes.length?[inArray(quotesTable.id,exactTargetQuotes.map(row=>row.id))]:[]),
  ...(input.profileId?[or(eq(subscriptionCommercialTerms.profileId,input.profileId),eq(quotesTable.profileId,input.profileId))]:[])];
 if(!selectors.length)return empty();
 const quotes=await tx.select({id:quotesTable.id,resourceId:quotesTable.resourceId,subscriptionId:resources.subscriptionId,previousTermsId:quotesTable.previousTermsId,
  kind:quotesTable.kind,canonicalSourceId:quotesTable.canonicalSourceId,plannedProrationId:quotesTable.plannedProrationId,plannedCollectionId:quotesTable.plannedCollectionId,
  calendarReadOperationId:quotesTable.calendarReadOperationId,customerFinancialOperationId:quotesTable.customerFinancialOperationId,nativePreviewOperationId:quotesTable.nativePreviewOperationId,
  updatePreviewOperationId:quotesTable.updatePreviewOperationId,originalProfileId:subscriptionCommercialTerms.profileId,originalProfileVersion:subscriptionCommercialTerms.profileVersion,
  profileId:quotesTable.profileId,profileVersion:quotesTable.profileVersion,fingerprint:hash(quotesTable)})
  .from(quotesTable).innerJoin(resources,eq(resources.id,quotesTable.resourceId)).innerJoin(subscriptionCommercialTerms,eq(subscriptionCommercialTerms.id,quotesTable.previousTermsId))
  .where(and(eq(subscriptionCommercialTerms.subscriptionId,resources.subscriptionId),or(...selectors))).orderBy(quotesTable.id).limit(5001);
 const quoteIds=quotes.map(row=>row.id);
 const collections=quoteIds.length?await tx.select({id:collectionsTable.id,kind:collectionsTable.kind,quoteId:collectionsTable.quoteId,prorationId:collectionsTable.prorationId,
  invoiceId:collectionsTable.invoiceId,termsId:collectionsTable.termsId,creditNoteId:collectionsTable.creditNoteId,fingerprint:hash(collectionsTable)})
  .from(collectionsTable).where(inArray(collectionsTable.quoteId,quoteIds)).orderBy(collectionsTable.id).limit(5001):[];
 const ids=collections.map(row=>row.id);
 const components=ids.length?await tx.select({id:componentsTable.id,collectionId:componentsTable.collectionId,kind:componentsTable.kind,fingerprint:hash(componentsTable)})
  .from(componentsTable).where(inArray(componentsTable.collectionId,ids)).orderBy(componentsTable.id).limit(5001):[];
 const invoiceBindings=ids.length?await tx.select({id:bindingsTable.collectionId,collectionId:bindingsTable.collectionId,resourceId:bindingsTable.resourceId,originKind:bindingsTable.originKind,
  creatorOperationId:bindingsTable.creatorOperationId,operationId:bindingsTable.operationId,callId:bindingsTable.callId,factId:bindingsTable.factId,fingerprint:hash(bindingsTable)})
  .from(bindingsTable).where(inArray(bindingsTable.collectionId,ids)).orderBy(bindingsTable.collectionId).limit(5001):[];
 const componentIds=components.map(row=>row.id);
 const itemReceipts=componentIds.length?await tx.select({id:itemsTable.componentId,componentId:itemsTable.componentId,resourceId:itemsTable.resourceId,originKind:itemsTable.originKind,
  creatorOperationId:itemsTable.creatorOperationId,operationId:itemsTable.operationId,callId:itemsTable.callId,factId:itemsTable.factId,fingerprint:hash(itemsTable)})
  .from(itemsTable).where(inArray(itemsTable.componentId,componentIds)).orderBy(itemsTable.componentId).limit(5001):[];
 const invoiceProofs=ids.length?await tx.select({id:proofsTable.id,collectionId:proofsTable.collectionId,operationId:proofsTable.operationId,callId:proofsTable.callId,fingerprint:hash(proofsTable)})
  .from(proofsTable).where(inArray(proofsTable.collectionId,ids)).orderBy(proofsTable.id).limit(5001):[];
 return{quotes,collections,components,invoiceBindings,itemReceipts,invoiceProofs,
  incomplete:quotes.length+collections.length+components.length+invoiceBindings.length+itemReceipts.length+invoiceProofs.length>5000};
}
/** Public subject export contains original IDs and parent links. Bank/customer/
 * method references, request bodies, human hosting evidence and SHA stay private. */
export function exportControlledCollectionHistory(history:Awaited<ReturnType<typeof controlledCollectionWitnesses>>){return{
 quotes:history.quotes.map(({id,resourceId,subscriptionId,previousTermsId,kind,canonicalSourceId})=>({quoteId:id,resourceId,subscriptionId,previousTermsId,kind,canonicalSourceId})),
 collections:history.collections.map(({id,kind,quoteId,prorationId,invoiceId,termsId,creditNoteId})=>({collectionId:id,kind,quoteId,prorationId,invoiceId,termsId,creditNoteId})),
 components:history.components.map(({id,collectionId,kind})=>({componentId:id,collectionId,kind})),
 invoiceBindings:history.invoiceBindings.map(({collectionId,resourceId,originKind,creatorOperationId,operationId,callId,factId})=>({collectionId,resourceId,originKind,creatorOperationId,operationId,callId,factId})),
 itemReceipts:history.itemReceipts.map(({componentId,resourceId,originKind,creatorOperationId,operationId,callId,factId})=>({componentId,resourceId,originKind,creatorOperationId,operationId,callId,factId})),
 invoiceProofs:history.invoiceProofs.map(({id,collectionId,operationId,callId})=>({proofId:id,collectionId,operationId,callId})),
};}
