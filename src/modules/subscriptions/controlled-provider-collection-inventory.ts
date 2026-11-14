// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Whole returned bank inventory; actual operation ordinal is causal admission order.
import { ServiceError } from "@/core/service";
import { z } from "zod";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
const reference=z.string().regex(/^in_[A-Za-z0-9_]+$/).max(200),minor=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),record=z.record(z.string(),z.unknown());
const returnedInvoice=z.object({providerInvoiceRef:reference,providerSubscriptionRef:z.string(),providerCustomerRef:z.string(),currency:z.string(),status:z.enum(["draft","open","paid","void","uncollectible"]),totalMinor:minor,paidMinor:minor,remainingMinor:minor,autoAdvance:z.boolean(),completePayments:z.literal(true),completeLines:z.literal(true),actualCash:z.array(record).max(5000),actualPayments:z.array(record).max(5000),actualIntents:z.array(record).max(5000),actualLines:z.array(record).max(5000),actualPrices:z.array(record).max(5000),actualInvoice:record,suppliesPaidAuthority:z.literal(false)});
export type ControlledCollectionInventorySource={resource:{id:string;originalScope:{providerCustomerRef:string;currency:string}};canonical:{count:number};history:{count:number;unfinished:unknown[];closures:unknown[];
 operations:Array<{id:string;kind:string;ordinal:number;originalRequest:Record<string,unknown>}>;verifications:Array<{operationId:string;actualResult:Record<string,unknown>;actualResultDigest:string}>;
 calls:Array<{id:string;operationId:string}>;facts:Array<{callId:string;actual:{kind:string;raw:Record<string,unknown>}}>}};
export function refuseControlledCollectionInventory():never{throw new ServiceError("conflict","Perform a new complete original invoice/payment/line inventory after the actual update. Keep all old callers and actual raw money; unknown/generated invoices, lost creates or mismatched original drafts require genuine recovery, never another creation POST.");}
/** Returned results are authenticated by controlledProviderJournal. This reader
 * does not infer a finish from a newer read, compare wall clocks, or erase any
 * old raw occurrence. Parent current money authority remains separately required. */
export function readControlledCollectionInventory(source:ControlledCollectionInventorySource,afterOrdinal=0){
 const{history,resource}=source;if(history.unfinished.length||history.closures.length)refuseControlledCollectionInventory();
 const lists=history.operations.filter(op=>op.kind==="list_invoices"&&op.ordinal>afterOrdinal),list=lists.at(-1),verified=list?history.verifications.find(row=>row.operationId===list.id):null;
 if(!list||!verified)refuseControlledCollectionInventory();
 const inventory=z.object({complete:z.literal(true),providerSubscriptionRef:z.string(),providerInvoiceRefs:z.array(reference).max(5000),actualInvoices:z.array(record).max(5000)}).parse(verified.actualResult);
 if(new Set(inventory.providerInvoiceRefs).size!==inventory.providerInvoiceRefs.length||inventory.actualInvoices.length!==inventory.providerInvoiceRefs.length
  ||inventory.actualInvoices.some(row=>!inventory.providerInvoiceRefs.includes(reference.parse(row.id)))||new Set(inventory.actualInvoices.map(row=>row.id)).size!==inventory.actualInvoices.length)refuseControlledCollectionInventory();
 const reads=inventory.providerInvoiceRefs.map(providerInvoiceRef=>{
  const operation=history.operations.filter(op=>op.kind==="read_invoice"&&op.ordinal>list.ordinal&&record.parse(op.originalRequest.payload).providerInvoiceRef===providerInvoiceRef).at(-1);
  const verification=operation?history.verifications.find(row=>row.operationId===operation.id):null;if(!operation||!verification)refuseControlledCollectionInventory();
  const actual=returnedInvoice.parse(verification.actualResult);
  if(actual.providerInvoiceRef!==providerInvoiceRef||actual.providerSubscriptionRef!==inventory.providerSubscriptionRef||actual.providerCustomerRef!==resource.originalScope.providerCustomerRef
   ||actual.currency!==resource.originalScope.currency||actual.actualInvoice.id!==providerInvoiceRef||actual.actualInvoice.total!==actual.totalMinor||actual.actualInvoice.amount_paid!==actual.paidMinor
   ||actual.actualInvoice.amount_remaining!==actual.remainingMinor||actual.actualInvoice.status!==actual.status||actual.actualInvoice.auto_advance!==actual.autoAdvance)refuseControlledCollectionInventory();
  const facts=history.facts.filter(fact=>history.calls.some(call=>call.id===fact.callId&&call.operationId===operation.id));
  if(!facts.some(fact=>fact.actual.kind==="invoice_read"&&merchantTaxDigest(fact.actual.raw)===merchantTaxDigest(actual.actualInvoice)))refuseControlledCollectionInventory();
  return{providerInvoiceRef,operation,verification,actual};
 });
 const bound=history.count+source.canonical.count+inventory.actualInvoices.length+reads.reduce((sum,row)=>sum+1+row.actual.actualCash.length+row.actual.actualPayments.length+row.actual.actualIntents.length+row.actual.actualLines.length+row.actual.actualPrices.length,0);
 if(bound>5000)refuseControlledCollectionInventory();
 return{list,verification:verified,inventory,reads,physicalRowCount:bound,revision:merchantTaxDigest({listId:list.id,listDigest:verified.actualResultDigest,reads:reads.map(row=>({operationId:row.operation.id,resultDigest:row.verification.actualResultDigest}))})};
}
/** Only the actual original zero bootstrap invoice can be an unbound harmless
 * preparation object. Equal amount, current account or a later zero never adopts
 * a different original invoice. Zero calendar preparation gives no paid access. */
export function originalBootstrapZeroInvoice(source:Pick<ControlledCollectionInventorySource,"resource"|"history">,row:ReturnType<typeof readControlledCollectionInventory>["reads"][number],beforeOrdinal:number){
 const refs=[...new Set(source.history.verifications.filter(v=>source.history.operations.some(op=>op.id===v.operationId&&op.kind==="read_bootstrap"&&op.ordinal<beforeOrdinal)
  &&v.actualResult.completeZeroRecurringItem===true&&v.actualResult.providerSubscriptionRef===row.actual.providerSubscriptionRef).map(v=>v.actualResult.providerInvoiceRef))];
 const actual=row.actual,invoice=actual.actualInvoice;
 return refs.length===1&&refs[0]===row.providerInvoiceRef&&actual.currency===source.resource.originalScope.currency
  &&actual.totalMinor===0&&actual.paidMinor===0&&actual.remainingMinor===0&&actual.autoAdvance===false&&actual.status==="paid"
  &&invoice.amount_due===0&&invoice.starting_balance===0&&invoice.ending_balance===0&&invoice.pre_payment_credit_notes_amount===0&&invoice.post_payment_credit_notes_amount===0
  &&actual.actualCash.length===0&&actual.actualPayments.length===0&&actual.actualIntents.length===0
  &&actual.actualLines.every(line=>line.amount===0)&&actual.actualPrices.every(price=>price.unit_amount===0);
}
