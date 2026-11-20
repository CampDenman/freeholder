// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: independent real calendar stop and complete original invoice inventory.
import { AdapterError } from "../types";
import { object,text } from "./http";
import { validateMerchantChargeScope } from "./stripe-merchant-scope";
import { originalSubscriptionInvoiceMetadata } from "./stripe-subscription-cash";
import { controlledSubscriptionFactsDigest } from "./controlled-subscription-digest";
import type { PaymentAccountScope } from "./types";
import type { MerchantControlledSubscriptionReadRequest,MerchantControlledCalendarCancelRequest,MerchantControlledCalendarInventory,MerchantControlledInvoiceListInventory } from "./merchant-controlled-subscription-types";
type Api=(path:string,init:RequestInit,scope:PaymentAccountScope)=>Promise<Record<string,unknown>>;
const ref=(value:unknown)=>text(value)??text(object(value)?.id);
const time=(value:unknown)=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0&&value<=8640000000000;
function unproven():never{throw new AdapterError("payments","stripe","provider_failure","Retain the complete original controlled calendar and every actual invoice/payment. A pause, cancellation ACK or partial inventory cannot prove financial closure.",true);}
function validate(request:MerchantControlledSubscriptionReadRequest){
 validateMerchantChargeScope(request);
 if(request.providerApiVersion!=="2026-10-28.endive"||!/^acct_[A-Za-z0-9]+$/.test(request.providerPlatformAccountId)
  ||!/^sub_[A-Za-z0-9_]{1,195}$/.test(request.providerSubscriptionRef)||!/^cus_[A-Za-z0-9_]{1,195}$/.test(request.providerCustomerRef)
  ||!request.bootstrapOperationId||!/^[a-f0-9]{64}$/.test(request.bootstrapRequestDigest))unproven();
}
function originalTag(request:MerchantControlledSubscriptionReadRequest,tag:Record<string,unknown>){
 if(tag.freeholder_controlled_subscription_version!=="1"||tag.freeholder_subscription_id!==request.subscriptionId||tag.freeholder_subscription_terms_id!==request.termsId
  ||tag.freeholder_controlled_generation!==String(request.generation)||tag.freeholder_bootstrap_operation_id!==request.bootstrapOperationId
  ||tag.freeholder_bootstrap_request_digest!==request.bootstrapRequestDigest||tag.freeholder_platform_account_id!==request.providerPlatformAccountId)unproven();
}
function originalCalendar(request:MerchantControlledSubscriptionReadRequest,actual:Record<string,unknown>){
 if(actual.id!==request.providerSubscriptionRef||ref(actual.customer)!==request.providerCustomerRef||actual.currency!==request.currency.toLowerCase())unproven();
 originalTag(request,object(actual.metadata)??{});
}
export function stripeControlledCalendarRecovery(api:Api){return{
 async inspectMerchantControlledCalendar(request:MerchantControlledSubscriptionReadRequest):Promise<MerchantControlledCalendarInventory>{
  validate(request);
  const actual=await api(`/v1/subscriptions/${encodeURIComponent(request.providerSubscriptionRef)}?expand%5B%5D=items.data.price`,{method:"GET"},request);
  await request.onObserved({kind:"subscription_read",raw:actual});originalCalendar(request,actual);
  if(!["active","incomplete","incomplete_expired","trialing","past_due","unpaid","canceled","paused"].includes(String(actual.status)))unproven();
  const invoiceRef=ref(actual.latest_invoice)??null,pause=object(actual.pause_collection);
  if(invoiceRef&&!/^in_[A-Za-z0-9_]{1,196}$/.test(invoiceRef))unproven();
  const calendarCanceled=actual.status==="canceled"&&time(actual.canceled_at)&&time(actual.ended_at);
  return{providerSubscriptionRef:request.providerSubscriptionRef,providerInvoiceRef:invoiceRef,providerCustomerRef:request.providerCustomerRef,
   status:actual.status as MerchantControlledCalendarInventory["status"],collectionPausedAsDraft:pause?.behavior==="keep_as_draft"&&pause.resumes_at===null,
   calendarCanceled,actualRaw:actual,currentReadDigest:controlledSubscriptionFactsDigest(actual),suppliesPaidAuthority:false,financiallyQuiesced:false};
 },
 async cancelMerchantControlledCalendar(request:MerchantControlledCalendarCancelRequest):Promise<{providerSubscriptionRef:string;requiresIndependentRead:true}>{
  validate(request);
  if(!request.operationId||!/^[a-f0-9]{64}$/.test(request.requestDigest)||!request.idempotencyKey||request.idempotencyKey.length>200)unproven();
  // This independent actual GET is retained even when cancellation admission
  // subsequently fails. A changed price/paused flag never invents another ID.
  const current=await api(`/v1/subscriptions/${encodeURIComponent(request.providerSubscriptionRef)}`,{method:"GET"},request);
  await request.onObserved({kind:"subscription_read",raw:current});originalCalendar(request,current);
  if(current.status!=="canceled"){
   const query=new URLSearchParams({invoice_now:"false",prorate:"false"});
   const actual=await api(`/v1/subscriptions/${encodeURIComponent(request.providerSubscriptionRef)}?${query}`,{method:"DELETE",headers:{"idempotency-key":request.idempotencyKey}},request);
   await request.onObserved({kind:"calendar_canceled",raw:actual});originalCalendar(request,actual);
  }
  // No invoice is deleted, voided or forgiven here. A new independent GET,
  // complete invoice/payment enumeration and actual disposition still follow.
  return{providerSubscriptionRef:request.providerSubscriptionRef,requiresIndependentRead:true};
 },
 async listMerchantControlledInvoices(request:MerchantControlledSubscriptionReadRequest):Promise<MerchantControlledInvoiceListInventory>{
  validate(request);
  const actualInvoices:Array<Record<string,unknown>>=[],providerInvoiceRefs:string[]=[],seen=new Set<string>(),cursors=new Set<string>();let cursor:string|undefined,complete=false;
  for(let page=0;page<50;page++){
   const query=new URLSearchParams({customer:request.providerCustomerRef,subscription:request.providerSubscriptionRef,limit:"100",...(cursor?{starting_after:cursor}:{})});
   const actual=await api(`/v1/invoices?${query}`,{method:"GET"},request);await request.onObserved({kind:"invoice_list_read",raw:actual});
   if(!Array.isArray(actual.data)||typeof actual.has_more!=="boolean")unproven();
   for(const row of actual.data){const invoice=object(row),id=ref(invoice?.id),details=object(object(invoice?.parent)?.subscription_details),subscription=ref(invoice?.subscription)??ref(details?.subscription);
    if(!invoice||!id||!/^in_[A-Za-z0-9_]{1,196}$/.test(id)||seen.has(id)||subscription!==request.providerSubscriptionRef||ref(invoice.customer)!==request.providerCustomerRef||invoice.currency!==request.currency.toLowerCase())unproven();
    originalTag(request,originalSubscriptionInvoiceMetadata(invoice));seen.add(id);providerInvoiceRefs.push(id);actualInvoices.push(invoice);
    if(actualInvoices.length>5000)unproven();
   }
   if(!actual.has_more){complete=true;break;}
   const next=ref(actual.data.at(-1));if(!next||cursors.has(next))unproven();cursors.add(next);cursor=next;
  }
  if(!complete)unproven();
  return{providerSubscriptionRef:request.providerSubscriptionRef,providerInvoiceRefs,actualInvoices,complete:true,suppliesPaidAuthority:false,financiallyQuiesced:false};
 },
};}
