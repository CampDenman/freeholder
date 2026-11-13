// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Pure actual-zero transport policy; no service registration or mutation.
import type { controlledProviderJournal } from "./controlled-provider-proof";
type Journal=Awaited<ReturnType<typeof controlledProviderJournal>>;
const record=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;
const ref=(value:unknown)=>typeof value==="string"?value:typeof record(value)?.id==="string"?String(record(value)!.id):null;
const safeKinds=new Set(["bootstrap","discover_bootstrap","read_bootstrap","pause_drafts","read_invoice","read_calendar","list_invoices","cancel_calendar","create_product","read_product"]);
/** This bounded policy closes only a genuinely canceled ZERO transport. It is
 * deliberately not the later positive-money applied/returned closure policy. */
export function controlledZeroTransportProof(history:Journal,currency:string){
 if(history.unfinished.length||history.closures.length||history.chargeOrigins.length||history.operations.some(row=>!safeKinds.has(row.kind))||history.operations.filter(row=>row.kind==="bootstrap").length!==1)return null;
 const operation=(id:string)=>history.operations.find(row=>row.id===id);
 const read=history.verifications.filter(row=>operation(row.operationId)?.kind==="read_calendar"&&row.actualResult.calendarCanceled===true).at(-1);
 const list=history.verifications.filter(row=>operation(row.operationId)?.kind==="list_invoices").at(-1);
 if(!read||!list||operation(list.operationId)!.ordinal<=operation(read.operationId)!.ordinal||list.actualResult.complete!==true
  ||!Array.isArray(list.actualResult.providerInvoiceRefs)||!Array.isArray(list.actualResult.actualInvoices))return null;
 const providerSubscriptionRef=ref(read.actualResult.providerSubscriptionRef),invoiceRefs=list.actualResult.providerInvoiceRefs;
 if(!providerSubscriptionRef||list.actualResult.providerSubscriptionRef!==providerSubscriptionRef||invoiceRefs.some(value=>typeof value!=="string")||new Set(invoiceRefs).size!==invoiceRefs.length||list.actualResult.actualInvoices.length!==invoiceRefs.length)return null;
 const known=new Set<string>();
 for(const fact of history.facts){const raw=fact.actual.raw;
  if(fact.actual.kind==="cash_observed"||fact.actual.kind==="intent_read"&&raw.amount_received!==0)return null;
  if(fact.actual.kind==="invoice_read"||fact.actual.kind==="invoice_list_read"){
   const invoices=fact.actual.kind==="invoice_read"?[raw]:Array.isArray(raw.data)?raw.data:[];
   for(const value of invoices){const invoice=record(value),id=ref(invoice?.id);
    if(!invoice||!id||invoice.amount_paid!==0||invoice.total!==0||invoice.currency!==currency.toLowerCase())return null;known.add(id);
   }
  }
  const latest=ref(raw.latest_invoice);if(latest)known.add(latest);
 }
 if(known.size!==invoiceRefs.length||invoiceRefs.some(id=>!known.has(String(id))))return null;
 const invoices:Array<{providerInvoiceRef:string;readOperationId:string;resultDigest:string}>=[];let total=history.count+invoiceRefs.length;
 for(const id of invoiceRefs){
  const latest=history.verifications.filter(row=>operation(row.operationId)?.kind==="read_invoice"&&row.actualResult.providerInvoiceRef===id).at(-1);
  if(!latest||operation(latest.operationId)!.ordinal<=operation(list.operationId)!.ordinal)return null;
  const result=latest.actualResult,raw=record(result.actualInvoice),payments=result.actualPayments,intents=result.actualIntents,lines=result.actualLines,prices=result.actualPrices;
  if(result.providerSubscriptionRef!==providerSubscriptionRef||result.currency!==currency||!["paid","void"].includes(String(result.status))
   ||result.totalMinor!==0||result.paidMinor!==0||result.remainingMinor!==0||result.autoAdvance!==false||result.completePayments!==true||result.completeLines!==true
   ||!Array.isArray(result.actualCash)||result.actualCash.length||!Array.isArray(payments)||!Array.isArray(intents)||!Array.isArray(lines)||!Array.isArray(prices)
   ||!raw||raw.starting_balance!==0||raw.ending_balance!==0||raw.post_payment_credit_notes_amount!==0||raw.pre_payment_credit_notes_amount!==0
   ||intents.some(value=>{const intent=record(value);return!intent||intent.status!=="canceled"||intent.amount_received!==0;})
   ||lines.some(value=>{const line=record(value);return!line||line.amount!==0;}))return null;
  total+=payments.length+intents.length+lines.length+prices.length;if(total>5000)return null;
  invoices.push({providerInvoiceRef:String(id),readOperationId:latest.operationId,resultDigest:latest.actualResultDigest});
 }
 return{kind:"zero_transport" as const,providerSubscriptionRef,calendarReadOperationId:read.operationId,calendarResultDigest:read.actualResultDigest,
  invoiceListOperationId:list.operationId,invoiceListResultDigest:list.actualResultDigest,invoices,originalEvidenceRevision:history.revision};
}
