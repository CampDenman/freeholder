// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: concurrent/unknown-order original GETs cannot hide a changed state.
import {ServiceError} from "@/core/service";
import {originalInventoryComparison} from "./original-cash-inventory-causal-contract";
import {originalInventoryStatesAgree} from "./original-cash-inventory-causal-policy";
import {merchantReturnedCashEvidenceSchema} from "./merchant-returned-cash-contract";
import {merchantTaxDigest} from "./merchant-tax-store";
import type {controlledAtomicRefundOriginalReadOrder} from "./controlled-atomic-refund-bank-policy";
type Input=Parameters<typeof controlledAtomicRefundOriginalReadOrder>[0];
function refuse():never{throw new ServiceError("conflict","Retain every current original GET packet; a missing, partial or causally maximal changed bank state cannot be hidden by an older controlled read.");}
/** Caller first authenticates actual MACs and read-order headers. Only actual
 * complete predecessor-row membership orders reads; no time/UUID inference,
 * current-parent row subtraction, old snapshot or bank authority is supplied. */
export function controlledAtomicRefundMaximalInventories(input:Input,order:ReturnType<typeof controlledAtomicRefundOriginalReadOrder>){
 const operations=input.original.operations.filter(row=>order.priorOperationIds.includes(row.id));
 const facts=(id:string)=>input.original.facts.filter(row=>row.operationId===id).sort((a,b)=>a.sequence-b.sequence);
 const headers=new Map(operations.map(row=>[row.id,originalInventoryComparison.parse(row.request.inventoryComparison)]));
 const later=new Map(operations.map(row=>[row.id,new Set(operations.filter(candidate=>{
  if(candidate.id===row.id)return false;const header=headers.get(candidate.id);if(!header)refuse();
  const keys=new Set(header.preimageEntries.map(entry=>`${entry.table}:${entry.id}`));
  return keys.has(`original_cash_recovery_operations:${row.id}`)&&facts(row.id).every(fact=>keys.has(`original_cash_recovery_facts:${fact.id}`));
 }).map(candidate=>candidate.id))]));
 const visiting=new Set<string>(),complete=new Set<string>();
 const visit=(id:string):void=>{if(visiting.has(id))refuse();if(complete.has(id))return;visiting.add(id);for(const successor of later.get(id)??[])visit(successor);visiting.delete(id);complete.add(id);};
 for(const row of operations)visit(row.id);
 const maximal=operations.filter(row=>later.get(row.id)?.size===0);if(operations.length&&!maximal.length)refuse();
 for(const row of maximal){
  const own=facts(row.id),finishes=own.filter(fact=>fact.kind==="finish"),finish=finishes[0],packets=own.filter(fact=>fact.kind==="state").map(fact=>merchantReturnedCashEvidenceSchema.parse(fact.evidence)),last=packets.at(-1);
  if(finishes.length!==1||!finish||finish.evidence.callerInstanceId!==row.caller.id||finish.evidence.outcome!=="returned"||own.some(fact=>fact.kind==="stop"||fact.sequence>finish.sequence)
   ||!last||!last.refundsComplete||!last.disputesComplete||merchantTaxDigest(last)!==merchantTaxDigest(input.currentBank)||!originalInventoryStatesAgree(packets,input.currentBank))refuse();
 }
 return{maximalOperationIds:maximal.map(row=>row.id).sort(),suppliesDispatchAuthority:false as const};
}
