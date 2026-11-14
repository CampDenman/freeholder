// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: exact six-family targets; no service registration or locks.
import { sql } from "drizzle-orm";
import type { Tx } from "@/core/service";
import { merchantTaxDigest } from "./merchant-tax-store";
import { controlledCollectionWitnesses } from "@/modules/subscriptions/controlled-provider-collection-witnesses";
import type { ControlledFinancialHistory,ControlledFinancialScope } from "./controlled-provider-financial-witness";
export const controlledTargetTables={quotes:"subscription_controlled_quotes",collections:"subscription_controlled_collections",components:"subscription_controlled_components",
 invoiceBindings:"subscription_controlled_invoice_bindings",itemReceipts:"subscription_controlled_item_receipts",invoiceProofs:"subscription_controlled_invoice_proofs"} as const;
export type ControlledTargetHistory=Awaited<ReturnType<typeof controlledCollectionWitnesses>>;
const families=Object.keys(controlledTargetTables) as Array<keyof typeof controlledTargetTables>;
const list=(ids:readonly string[])=>ids.length?sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`):sql`null::uuid`;
export function controlledTargetEntries(history:ControlledTargetHistory){return families.flatMap(family=>history[family].map(row=>({table:controlledTargetTables[family],id:row.id,fingerprint:row.fingerprint}))).sort((a,b)=>a.table.localeCompare(b.table)||a.id.localeCompare(b.id));}
/** Invoice/payment/receipt scopes select real canonical target FKs only. A
 * shared resource never selects its other quotes. Subscription/profile mode
 * deliberately includes unaccepted cashless period quotes before any invoice. */
export async function controlledTargetFinancialWitness(tx:Tx,scope:ControlledFinancialScope,transport:ControlledFinancialHistory){
 const empty=await controlledCollectionWitnesses(tx,{}),failed=()=>({...empty,incomplete:true});
 const invoiceIds=new Set(scope.invoiceIds??[]);
 if(transport.resources.length&&(scope.paymentIds?.length||scope.receiptIds?.length)){
  const links=await tx.execute<{id:string}>(sql`select p.invoice_id::text as id from payments p where p.id in (${list(scope.paymentIds??[])})
   union select c.invoice_id::text from subscription_provider_charge_receipts receipt
    join subscription_controlled_resources resource on resource.subscription_id=receipt.subscription_id
     and resource.original_scope->>'providerPlatformAccountId'=receipt.provider_platform_account_id
     and coalesce(resource.original_scope->>'providerAccountId','')=coalesce(receipt.charge_account_id,'')
    join subscription_controlled_invoice_bindings binding on binding.resource_id=resource.id and binding.provider_invoice_ref=receipt.provider_invoice_ref
    join subscription_controlled_collections c on c.id=binding.collection_id
   where receipt.id in (${list(scope.receiptIds??[])}) and resource.id in (${list(transport.resources.map(row=>row.id))}) and c.invoice_id is not null limit 5001`);
  if(links.length>5000)return failed();for(const row of links)invoiceIds.add(row.id);
 }
 if(invoiceIds.size>5000)return failed();
 const groups:ControlledTargetHistory[]=[];
 if(transport.resources.length&&scope.subscriptionIds?.length)groups.push(await controlledCollectionWitnesses(tx,{subscriptionIds:scope.subscriptionIds}));
 if(invoiceIds.size)groups.push(await controlledCollectionWitnesses(tx,{invoiceIds:[...invoiceIds].sort()}));
 for(const profileId of [...new Set(scope.profileIds??[])].sort())groups.push(await controlledCollectionWitnesses(tx,{profileId}));
 const result:ControlledTargetHistory={...empty};
 for(const family of families){const rows=new Map<string,ControlledTargetHistory[typeof family][number]>();for(const group of groups)for(const row of group[family]){
  const previous=rows.get(row.id);if(previous&&merchantTaxDigest(previous)!==merchantTaxDigest(row))return failed();rows.set(row.id,row);
 }Object.assign(result,{[family]:[...rows.values()].sort((a,b)=>a.id.localeCompare(b.id))});}
 if(groups.some(group=>group.incomplete)||controlledTargetEntries(result).length>5000)return failed();return result;
}
/** Physical FK closure is separate from signature/current-money authority. */
export function controlledTargetAncestryComplete(targets:ControlledTargetHistory,transport:ControlledFinancialHistory){
 const resources=new Map(transport.resources.map(row=>[row.id,row])),operations=new Map(transport.operations.map(row=>[row.id,row]));
 const calls=new Map(transport.calls.map(row=>[row.id,row])),facts=new Map(transport.facts.map(row=>[row.id,row]));
 const quotes=new Map(targets.quotes.map(row=>[row.id,row])),collections=new Map(targets.collections.map(row=>[row.id,row])),components=new Map(targets.components.map(row=>[row.id,row]));
 const bindings=new Map(targets.invoiceBindings.map(row=>[row.collectionId,row]));
 const actual=(resourceId:string,creatorId:string,operationId:string,callId:string,factId?:string)=>operations.get(creatorId)?.resourceId===resourceId&&operations.get(operationId)?.resourceId===resourceId
  &&calls.get(callId)?.operationId===operationId&&(!factId||facts.get(factId)?.callId===callId);
 return !targets.incomplete&&families.every(family=>new Set(targets[family].map(row=>row.id)).size===targets[family].length)
  &&targets.quotes.every(quote=>{const resource=resources.get(quote.resourceId);return resource?.subscriptionId===quote.subscriptionId&&resource.profileId===quote.originalProfileId&&resource.profileVersion===quote.originalProfileVersion
   &&[[quote.calendarReadOperationId,"read_calendar"],[quote.customerFinancialOperationId,"read_customer_financials"],[quote.nativePreviewOperationId,"preview_proration"],[quote.updatePreviewOperationId,"preview_update"]].every(([id,kind])=>operations.get(id)?.resourceId===quote.resourceId&&operations.get(id)?.kind===kind);})
  &&targets.collections.every(collection=>{const quote=quotes.get(collection.quoteId);return quote?.plannedCollectionId===collection.id&&quote.kind===collection.kind&&quote.plannedProrationId===collection.prorationId
   &&(collection.kind!=="period"||collection.invoiceId!==null&&collection.prorationId===null);})
  &&targets.components.every(component=>collections.has(component.collectionId))
  &&targets.invoiceBindings.every(binding=>{const collection=collections.get(binding.collectionId),quote=collection?quotes.get(collection.quoteId):null;
   return quote?.resourceId===binding.resourceId&&actual(binding.resourceId,binding.creatorOperationId,binding.operationId,binding.callId,binding.factId);})
  &&targets.itemReceipts.every(item=>{const component=components.get(item.componentId),collection=component?collections.get(component.collectionId):null,quote=collection?quotes.get(collection.quoteId):null;
   return quote?.resourceId===item.resourceId&&actual(item.resourceId,item.creatorOperationId,item.operationId,item.callId,item.factId);})
  &&targets.invoiceProofs.every(proof=>{const collection=collections.get(proof.collectionId),quote=collection?quotes.get(collection.quoteId):null;
   return !!quote&&bindings.has(proof.collectionId)&&operations.get(proof.operationId)?.resourceId===quote.resourceId&&operations.get(proof.operationId)?.kind==="read_manifest"&&calls.get(proof.callId)?.operationId===proof.operationId;});
}
