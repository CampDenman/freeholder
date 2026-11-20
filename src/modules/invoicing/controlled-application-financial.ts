// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: exact existing target scope, not expanded subscription discovery.
import {ServiceError,type Tx} from "@/core/service";
import {merchantTaxDigest} from "./merchant-tax-store";
import type {ControlledFinancialScope} from "./controlled-provider-financial-witness";
import type {ControlledTargetHistory} from "./controlled-target-financial-witness";
import {controlledCashApplicationWitnesses,exportControlledCashApplicationHistory,type ControlledCashApplicationWitnessScope,type ControlledCashApplicationWitnessEntry} from "./controlled-cash-application-witnesses";
const unique=(ids:readonly string[])=>[...new Set(ids)].sort();
function refuse():never{throw new ServiceError("conflict","Restore the exact complete original application target and its financial history before review or export.");}
/** The caller already proved the six target families and their actual FKs.
 * Keep original subscription scope distinct from receipt/invoice-discovered
 * ancestors: those ancestors do not select their other application batches. */
export async function controlledApplicationFinancialWitness(tx:Tx,scope:ControlledFinancialScope,targets:ControlledTargetHistory,receiptAliases:readonly string[]){
 const scopes:ControlledCashApplicationWitnessScope[]=[],profileIds=unique(scope.profileIds??[]);
 // Every application batch has an immutable collection FK. The caller has
 // already validated complete target selection/ancestry; an empty collection
 // set cannot acquire application descendants or a new legacy read surface.
 if(!targets.collections.length)return{entries:[] as ControlledCashApplicationWitnessEntry[],scopes};
 const receipts=unique([...(scope.receiptIds??[]),...receiptAliases]);
 if(profileIds.length){
  for(const profileId of profileIds){
   const quoteIds=new Set(targets.quotes.filter(row=>row.profileId===profileId).map(row=>row.id));
   const collections=targets.collections.filter(row=>quoteIds.has(row.quoteId));
   const invoiceIds=unique(collections.flatMap(row=>row.invoiceId?[row.invoiceId]:[]));
   if(invoiceIds.length)scopes.push({profileId,invoiceIds,receiptIds:receipts,collectionIds:collections.map(row=>row.id)});
  }
 }else{
  const subscriptionIds=unique(scope.subscriptionIds??[]);
  const invoiceIds=unique([...(scope.invoiceIds??[]),...targets.collections.flatMap(row=>row.invoiceId?[row.invoiceId]:[])]);
  if(subscriptionIds.length||invoiceIds.length||receipts.length)scopes.push({subscriptionIds,invoiceIds,receiptIds:receipts,collectionIds:targets.collections.map(row=>row.id)});
 }
 const entries=new Map<string,ControlledCashApplicationWitnessEntry>();
 for(const selectedScope of scopes){
  const selected=await controlledCashApplicationWitnesses(tx,selectedScope);if(selected.incomplete)refuse();
  for(const row of selected.entries){const key=`${row.table}:${row.id}`,previous=entries.get(key);if(previous&&merchantTaxDigest(previous)!==merchantTaxDigest(row))refuse();entries.set(key,row);}
  if(entries.size>5000)refuse();
 }
 return{entries:[...entries.values()].sort((a,b)=>a.table.localeCompare(b.table)||a.id.localeCompare(b.id)),scopes};
}
export type ControlledApplicationFinancialHistory=Awaited<ReturnType<typeof controlledApplicationFinancialWitness>>;
/** Use the identical actual scopes for whitelisted archives. No raw preimage,
 * MAC, provider/process body or internal row SHA is an exported field. */
export async function exportControlledApplicationFinancialHistory(tx:Tx,selected:ControlledApplicationFinancialHistory,options:{merchant:boolean;existingRows:number}){
 if(!Number.isInteger(options.existingRows)||options.existingRows<0||options.existingRows+selected.entries.length>5000)refuse();
 const batches:Array<Awaited<ReturnType<typeof exportControlledCashApplicationHistory>>["exported"]["batches"][number]>=[];
 const receipts:Array<Awaited<ReturnType<typeof exportControlledCashApplicationHistory>>["exported"]["receipts"][number]>=[];
 const links:Array<Awaited<ReturnType<typeof exportControlledCashApplicationHistory>>["exported"]["links"][number]>=[];
 const entries=new Map<string,ControlledCashApplicationWitnessEntry>();
 for(const scope of selected.scopes){
  const actual=await exportControlledCashApplicationHistory(tx,scope,{merchant:options.merchant,existingRows:options.existingRows+entries.size});
  for(const row of actual.selected.entries){const key=`${row.table}:${row.id}`;if(entries.has(key))refuse();entries.set(key,row);}
  batches.push(...actual.exported.batches);receipts.push(...actual.exported.receipts);links.push(...actual.exported.links);
 }
 const actual=[...entries.values()].sort((a,b)=>a.table.localeCompare(b.table)||a.id.localeCompare(b.id));
 if(merchantTaxDigest(actual)!==merchantTaxDigest(selected.entries)||batches.length+receipts.length+links.length!==selected.entries.length)refuse();
 return{batches,receipts,links};
}
