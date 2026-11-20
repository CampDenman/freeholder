// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: enumerate every actual obligation and retain positive PI before lines/fees can fail.
import { AdapterError } from "../types";
import { number,object,text } from "./http";
import { merchantIntentEvidence,validateMerchantChargeScope } from "./stripe-merchant-scope";
import { originalSubscriptionInvoiceMetadata } from "./stripe-subscription-cash";
import type { PaymentAccountScope } from "./types";
import type { MerchantControlledInvoiceReadRequest,MerchantControlledInvoiceInventory,MerchantControlledObservation } from "./merchant-controlled-subscription-types";
type Api=(path:string,init:RequestInit,scope:PaymentAccountScope)=>Promise<Record<string,unknown>>;
const ref=(value:unknown)=>text(value)??text(object(value)?.id);
function unproven():never{throw new AdapterError("payments","stripe","provider_failure","Restore complete actual original controlled invoice/payment/line inventory; retained positive money cannot be replaced by a partial or reconstructed invoice.",true);}
function minor(value:unknown){const n=number(value);if(n===undefined||!Number.isSafeInteger(n))unproven();return n;}
export function stripeControlledInvoices(api:Api){return{
 async inspectMerchantControlledInvoice(request:MerchantControlledInvoiceReadRequest):Promise<MerchantControlledInvoiceInventory>{
  validateMerchantChargeScope(request);
  if(request.providerApiVersion!=="2026-10-28.endive"||!request.providerPlatformAccountId||!/^in_[A-Za-z0-9_]{1,196}$/.test(request.providerInvoiceRef)||!/^sub_[A-Za-z0-9_]{1,195}$/.test(request.providerSubscriptionRef))unproven();
  const observed=async(kind:MerchantControlledObservation["kind"],raw:Record<string,unknown>)=>request.onObserved({kind,raw});
  const invoice=await api(`/v1/invoices/${encodeURIComponent(request.providerInvoiceRef)}`,{method:"GET"},request);await observed("invoice_read",invoice);
  const tag=originalSubscriptionInvoiceMetadata(invoice),parent=object(object(invoice.parent)?.subscription_details),actualSub=ref(invoice.subscription)??ref(parent?.subscription);
  if(invoice.id!==request.providerInvoiceRef||actualSub!==request.providerSubscriptionRef||ref(invoice.customer)!==request.providerCustomerRef||invoice.currency!==request.currency.toLowerCase()
   ||tag.freeholder_controlled_subscription_version!=="1"||tag.freeholder_subscription_id!==request.subscriptionId||tag.freeholder_subscription_terms_id!==request.termsId
   ||tag.freeholder_controlled_generation!==String(request.generation)||tag.freeholder_bootstrap_operation_id!==request.bootstrapOperationId||tag.freeholder_bootstrap_request_digest!==request.bootstrapRequestDigest
   ||tag.freeholder_platform_account_id!==request.providerPlatformAccountId)unproven();
  const actualPayments:Array<Record<string,unknown>>=[],actualIntents:Array<Record<string,unknown>>=[],actualCash:Array<Record<string,unknown>>=[],actualLines:Array<Record<string,unknown>>=[],actualPrices:Array<Record<string,unknown>>=[];
  let cursor:string|undefined,complete=false;const paymentIds=new Set<string>(),intentIds=new Set<string>(),cursors=new Set<string>();
  const budget=()=>{if(actualPayments.length+actualIntents.length+actualCash.length+actualLines.length+actualPrices.length>5000)unproven();};
  for(let page=0;page<20;page++){
   const query=new URLSearchParams({invoice:request.providerInvoiceRef,limit:"100",...(cursor?{starting_after:cursor}:{})});
   const raw=await api(`/v1/invoice_payments?${query}`,{method:"GET"},request);await observed("invoice_payments_read",raw);
   if(!Array.isArray(raw.data)||typeof raw.has_more!=="boolean")unproven();
   for(const row of raw.data){const payment=object(row),relation=object(payment?.payment),id=ref(payment?.id),intentRef=ref(relation?.payment_intent);
    if(!payment||!id||paymentIds.has(id)||ref(payment.invoice)!==request.providerInvoiceRef||relation?.type!=="payment_intent"||!intentRef||!/^pi_[A-Za-z0-9_]{1,196}$/.test(intentRef))unproven();
    paymentIds.add(id);actualPayments.push(payment);budget();
    const intent=await api(`/v1/payment_intents/${encodeURIComponent(intentRef)}`,{method:"GET"},request);await observed("intent_read",intent);
    if(intent.id!==intentRef||intentIds.has(intentRef))unproven();intentIds.add(intentRef);actualIntents.push(intent);budget();
    const amount=minor(intent.amount_received),currency=text(intent.currency)?.toUpperCase();if(amount<0||!currency||!/^[A-Z]{3}$/.test(currency))unproven();
    if(amount>0){const route=merchantIntentEvidence(request,intent),charge=ref(intent.latest_charge);
     const cash={provider:"stripe",subscriptionId:request.subscriptionId,providerSubscriptionRef:request.providerSubscriptionRef,providerInvoiceRef:request.providerInvoiceRef,providerCustomerRef:request.providerCustomerRef,
      providerPlatformAccountId:request.providerPlatformAccountId,...(request.providerAccountId?{providerAccountId:request.providerAccountId}:{}),providerPaymentIntentRef:intentRef,...(charge?{providerChargeRef:charge}:{}),amountMinor:amount,currency,
      ...(route.destinationAccountId?{destinationAccountId:route.destinationAccountId}:{}),...(route.settlementMerchantAccountId?{settlementMerchantAccountId:route.settlementMerchantAccountId}:{}),
      customerChargeVerified:intent.status==="succeeded"&&ref(intent.customer)===request.providerCustomerRef,merchantRouteVerified:route.merchantRouteVerified};
     actualCash.push(cash);
     // The caller commits this genuine occurrence before any allocation,
     // invoice total, next PI, price, tax, fee or domain application can fail.
     await observed("cash_observed",{cash,invoice,intent,invoicePayment:payment});budget();
    }
   }
   if(!raw.has_more){complete=true;break;}
   const next=ref(raw.data.at(-1));if(!next||cursors.has(next))unproven();cursors.add(next);cursor=next;
  }
  if(!complete)unproven();
  cursor=undefined;complete=false;cursors.clear();const lineIds=new Set<string>(),priceIds=new Set<string>();
  for(let page=0;page<20;page++){
   const query=new URLSearchParams({limit:"100",...(cursor?{starting_after:cursor}:{})});
   const raw=await api(`/v1/invoices/${encodeURIComponent(request.providerInvoiceRef)}/lines?${query}`,{method:"GET"},request);await observed("invoice_lines_read",raw);
   if(!Array.isArray(raw.data)||typeof raw.has_more!=="boolean")unproven();
   for(const row of raw.data){const line=object(row),id=ref(line?.id);if(!line||!id||lineIds.has(id))unproven();lineIds.add(id);actualLines.push(line);budget();
    const priceRef=ref(object(object(line.pricing)?.price_details)?.price)??ref(line.price);
    if(priceRef&&!priceIds.has(priceRef)){if(!/^price_[A-Za-z0-9_]{1,195}$/.test(priceRef))unproven();const price=await api(`/v1/prices/${encodeURIComponent(priceRef)}`,{method:"GET"},request);await observed("price_read",price);
     if(price.id!==priceRef)unproven();priceIds.add(priceRef);actualPrices.push(price);budget();}
   }
   if(!raw.has_more){complete=true;break;}const next=ref(raw.data.at(-1));if(!next||cursors.has(next))unproven();cursors.add(next);cursor=next;
  }
  if(!complete||!["draft","open","paid","void","uncollectible"].includes(String(invoice.status))||typeof invoice.auto_advance!=="boolean")unproven();
  return{providerInvoiceRef:request.providerInvoiceRef,providerSubscriptionRef:request.providerSubscriptionRef,providerCustomerRef:request.providerCustomerRef,currency:request.currency,status:invoice.status as MerchantControlledInvoiceInventory["status"],
   totalMinor:minor(invoice.total),paidMinor:minor(invoice.amount_paid),remainingMinor:minor(invoice.amount_remaining),autoAdvance:invoice.auto_advance,completePayments:true,completeLines:true,
   actualCash,actualPayments,actualIntents,actualLines,actualPrices,actualInvoice:invoice,suppliesPaidAuthority:false,financiallyQuiesced:false};
 }
};}
