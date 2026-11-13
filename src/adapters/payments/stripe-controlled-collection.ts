// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Exact canonical NET + fixed dated tax - target-locked credit. No wallet credit.
import { AdapterError } from "../types";
import { object,text } from "./http";
import { applyDestinationCharge,assertMerchantIntent,validateMerchantChargeScope } from "./stripe-merchant-scope";
import { assertControlledCurrent } from "./controlled-subscription-current";
import { controlledSubscriptionFactsDigest } from "./controlled-subscription-digest";
import { originalSubscriptionInvoiceMetadata } from "./stripe-subscription-cash";
import { stripeControlledInvoices } from "./stripe-controlled-invoice";
import { stripeControlledCustomerFinancials } from "./stripe-controlled-customer-financials";
import type { PaymentAccountScope } from "./types";
import type { MerchantControlledCollectionRequest,MerchantControlledCollectionComponent,MerchantControlledDraftRequest,MerchantControlledInvoiceComponentRequest,MerchantControlledInvoiceActionRequest } from "./merchant-controlled-collection-types";
import type { MerchantControlledInvoiceInventory } from "./merchant-controlled-subscription-types";
type Api=(path:string,init:RequestInit,scope:PaymentAccountScope)=>Promise<Record<string,unknown>>;
const ref=(value:unknown)=>text(value)??text(object(value)?.id),hash=(value:string)=>/^[a-f0-9]{64}$/.test(value),uuid=(value:string)=>/^[a-f0-9-]{36}$/.test(value);
function refuse():never{throw new AdapterError("payments","stripe","provider_failure","Retain the actual original canonical-target draft, complete lines/payments, paused calendar and customer financial inventory. A mismatch, unknown balance or lost original caller requires authentic recovery before collecting or applying access.",true);}
function epoch(value:string){const ms=Date.parse(value);if(!Number.isSafeInteger(ms)||ms%1000!==0||ms<0)refuse();return ms/1000;}
function money(value:unknown):value is number{return typeof value==="number"&&Number.isSafeInteger(value);}
function empty(value:unknown){return value===null||Array.isArray(value)&&value.length===0;}
function validate(request:MerchantControlledCollectionRequest){
 validateMerchantChargeScope(request);const m=request.manifest;
 if(request.providerApiVersion!=="2026-10-28.endive"||m.protocol!=="controlled_net_gross.v1"||![m.collectionId,m.quoteId,m.canonicalInvoiceId,m.termsId,request.operationId,request.invoiceOrigin.creatorOperationId].every(uuid)
  ||![m.acceptedQuoteDigest,m.canonicalTargetDigest,request.requestDigest,request.invoiceOrigin.creatorRequestDigest].every(hash)||m.currency!==request.currency||!request.idempotencyKey||request.idempotencyKey.length>200
  ||![m.grossMinor,m.creditedMinor,m.cashDueMinor,m.applicationFeeMinor].every(n=>money(n)&&n>=0)||m.creditedMinor>m.grossMinor||m.cashDueMinor!==m.grossMinor-m.creditedMinor||m.applicationFeeMinor>m.cashDueMinor
  ||m.components.length<1||m.components.length>250||request.lineBindings.length>250)refuse();
 let gross=0n,credit=0n;const ids=new Set<string>(),positions=new Set<number>();
 for(const c of m.components){
  if(!uuid(c.id)||ids.has(c.id)||!Number.isSafeInteger(c.position)||c.position<0||positions.has(c.position)||!money(c.amountMinor)
   ||!hash(c.provenanceDigest)||epoch(c.periodEnd)<=epoch(c.periodStart))refuse();ids.add(c.id);positions.add(c.position);
  if(c.kind==="locked_canonical_credit"){
   if(c.amountMinor>=0||c.providerProductRef!==undefined||!c.creditNoteId||!uuid(c.creditNoteId)||!c.applicationIds?.length||c.applicationIds.length>1000||new Set(c.applicationIds).size!==c.applicationIds.length||!c.applicationIds.every(uuid))refuse();credit-=BigInt(c.amountMinor);
  }else{
   if(c.amountMinor<0||!["net","merchant_declared_tax_collection"].includes(c.kind)||!c.providerProductRef||!/^prod_[A-Za-z0-9_]{1,195}$/.test(c.providerProductRef))refuse();gross+=BigInt(c.amountMinor);
   if(c.kind==="merchant_declared_tax_collection"&&(!c.taxQuoteDigest||!hash(c.taxQuoteDigest)||!c.profileId||!uuid(c.profileId)||!Number.isSafeInteger(c.profileVersion)||Number(c.profileVersion)<1))refuse();
  }
 }
 if(gross!==BigInt(m.grossMinor)||credit!==BigInt(m.creditedMinor)||new Set(request.lineBindings.map(b=>b.componentId)).size!==request.lineBindings.length
  ||new Set(request.lineBindings.map(b=>b.providerInvoiceLineRef)).size!==request.lineBindings.length
  ||request.lineBindings.some(b=>!ids.has(b.componentId)||!/^il_[A-Za-z0-9_]{1,196}$/.test(b.providerInvoiceLineRef)))refuse();
}
function originalTag(request:MerchantControlledCollectionRequest){return{freeholder_controlled_subscription_version:"1",freeholder_controlled_transport:"draft_calendar",freeholder_subscription_id:request.subscriptionId,
 freeholder_subscription_terms_id:request.termsId,freeholder_controlled_generation:String(request.generation),freeholder_bootstrap_operation_id:request.bootstrapOperationId,
 freeholder_bootstrap_request_digest:request.bootstrapRequestDigest,freeholder_platform_account_id:request.providerPlatformAccountId};}
function targetTag(request:MerchantControlledCollectionRequest){return{freeholder_controlled_collection_protocol:request.manifest.protocol,freeholder_controlled_collection_id:request.manifest.collectionId,
 freeholder_controlled_collection_quote_id:request.manifest.quoteId,freeholder_canonical_invoice_id:request.manifest.canonicalInvoiceId,freeholder_canonical_target_digest:request.manifest.canonicalTargetDigest,
 freeholder_controlled_collection_quote_digest:request.manifest.acceptedQuoteDigest,freeholder_controlled_creator_operation_id:request.invoiceOrigin.creatorOperationId,freeholder_controlled_creator_request_digest:request.invoiceOrigin.creatorRequestDigest};}
function metadata(form:URLSearchParams,tag:Record<string,string>){for(const[k,v]of Object.entries(tag))form.set(`metadata[${k}]`,v);}
function originalInvoice(request:MerchantControlledCollectionRequest,invoice:Record<string,unknown>){
 const tag=originalSubscriptionInvoiceMetadata(invoice),expected=originalTag(request),parent=object(object(invoice.parent)?.subscription_details);
 // Transport may still carry the immutable zero-preparation label. Economic
 // collection/creator identity is proved separately, never by this label.
 const identity=Object.fromEntries(Object.entries(expected).filter(([key])=>key!=="freeholder_controlled_transport"));
 if((ref(invoice.subscription)??ref(parent?.subscription))!==request.providerSubscriptionRef)refuse();
 if(Object.entries(identity).some(([k,v])=>tag[k]!==v)||ref(invoice.customer)!==request.providerCustomerRef||invoice.currency!==request.currency.toLowerCase()
  ||invoice.collection_method!=="charge_automatically"||ref(invoice.default_payment_method)!==request.providerMethodRef||invoice.auto_advance!==false
  ||object(invoice.automatic_tax)?.enabled!==false||!empty(invoice.discounts)||!empty(invoice.default_tax_rates))refuse();
 assertMerchantIntent(request,invoice);
 if(request.invoiceOrigin.kind==="created_draft"){
  const own=object(invoice.metadata);if(Object.entries(targetTag(request)).some(([k,v])=>own?.[k]!==v))refuse();
 }else{
  if(tag.freeholder_controlled_price_epoch_id!==request.manifest.collectionId||tag.freeholder_controlled_update_operation_id!==request.invoiceOrigin.creatorOperationId
   ||tag.freeholder_controlled_update_request_digest!==request.invoiceOrigin.creatorRequestDigest||tag.freeholder_controlled_accepted_quote_digest!==request.manifest.acceptedQuoteDigest
   ||request.invoiceOrigin.kind==="update_generated"&&invoice.billing_reason!=="subscription_update"||request.invoiceOrigin.kind==="calendar_generated"&&!["subscription_cycle","subscription_create"].includes(String(invoice.billing_reason)))refuse();
 }
}
function exactLine(request:MerchantControlledCollectionRequest,line:Record<string,unknown>,component:MerchantControlledCollectionComponent){
 const parent=object(line.parent),ii=object(parent?.invoice_item_details),si=object(parent?.subscription_item_details),pricing=object(object(line.pricing)?.price_details),period=object(line.period),tag=object(line.metadata);
 const binding=request.lineBindings.find(b=>b.componentId===component.id);
 if(!binding||line.id!==binding.providerInvoiceLineRef||line.amount!==component.amountMinor||line.currency!==request.currency.toLowerCase()||line.quantity!==1
  ||period?.start!==epoch(component.periodStart)||period.end!==epoch(component.periodEnd)||!empty(line.discount_amounts)||!empty(line.taxes)||line.tax_amounts!==undefined&&!empty(line.tax_amounts)
  ||(ref(pricing?.price)??null)!==binding.providerPriceRef||component.kind!=="locked_canonical_credit"&&ref(pricing?.product)!==component.providerProductRef)refuse();
 if(binding.providerInvoiceItemRef){
  if((ref(ii?.invoice_item)??ref(si?.invoice_item))!==binding.providerInvoiceItemRef||tag?.freeholder_controlled_collection_id!==request.manifest.collectionId
   ||tag.freeholder_controlled_component_id!==component.id||tag.freeholder_controlled_component_digest!==component.provenanceDigest||tag.freeholder_canonical_target_digest!==request.manifest.canonicalTargetDigest)refuse();
 }else if(component.kind!=="net"||parent?.type!=="subscription_item_details"||si?.proration!==false||ref(si.subscription_item)!==request.calendar.originalComponents[0]?.subscriptionItemRef)refuse();
}
function lines(request:MerchantControlledCollectionRequest,inventory:MerchantControlledInvoiceInventory,complete:boolean){
 const seen=new Set<string>();for(const raw of inventory.actualLines){const id=ref(raw.id),binding=request.lineBindings.find(b=>b.providerInvoiceLineRef===id),component=binding?request.manifest.components.find(c=>c.id===binding.componentId):undefined;
  if(!component||seen.has(component.id))refuse();exactLine(request,raw,component);seen.add(component.id);
 }
 if(complete&&seen.size!==request.manifest.components.length||seen.size!==request.lineBindings.length)refuse();return seen;
}
export function stripeControlledCollections(api:Api){
 const invoices=stripeControlledInvoices(api),customers=stripeControlledCustomerFinancials(api);
 async function current(request:MerchantControlledCollectionRequest){validate(request);const raw=await api(`/v1/subscriptions/${encodeURIComponent(request.providerSubscriptionRef)}?expand%5B%5D=items.data.price`,{method:"GET"},request);
  await request.onObserved({kind:"subscription_read",raw});assertControlledCurrent(request.calendar,raw);
  // The nested calendar is an original frozen DTO, never an alternate route.
  for(const key of ["subscriptionId","termsId","generation","providerCustomerRef","providerMethodRef","providerSubscriptionRef","providerPlatformAccountId","providerAccountId","destinationAccountId","settlementMerchantAccountId","currency"] as const)if(request[key]!==request.calendar[key])refuse();
 }
 async function isolated(request:MerchantControlledCollectionRequest){const actual=await customers.inspectMerchantControlledCustomerFinancials(request);if(actual.balanceState!=="known_zero")refuse();return actual;}
 async function inventory(request:MerchantControlledInvoiceActionRequest,complete:boolean){const actual=await invoices.inspectMerchantControlledInvoice(request);originalInvoice(request,actual.actualInvoice);lines(request,actual,complete);return actual;}
 async function proof(request:MerchantControlledInvoiceActionRequest){await current(request);const financial=await isolated(request),actual=await inventory(request,true),m=request.manifest;
  if(actual.totalMinor!==m.cashDueMinor||actual.actualInvoice.subtotal!==m.cashDueMinor||(actual.actualInvoice.application_fee_amount??0)!==m.applicationFeeMinor
   ||actual.actualInvoice.starting_balance!==0||actual.actualInvoice.ending_balance!==0||actual.actualInvoice.pre_payment_credit_notes_amount!==0||actual.actualInvoice.post_payment_credit_notes_amount!==0
   ||!empty(actual.actualInvoice.total_discount_amounts)||!empty(actual.actualInvoice.total_taxes)||actual.actualInvoice.total_tax_amounts!==undefined&&!empty(actual.actualInvoice.total_tax_amounts))refuse();
  return{providerInvoiceRef:request.providerInvoiceRef,manifestDigest:controlledSubscriptionFactsDigest(m),inventory:actual,customerFinancialDigest:financial.inventoryDigest,exactManifest:true as const,suppliesPaidAuthority:false as const};
 }
 const post=async(request:MerchantControlledCollectionRequest,path:string,form:URLSearchParams)=>api(path,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded","idempotency-key":request.idempotencyKey},body:form},request);
 return{
  async prepareMerchantControlledDraft(request:MerchantControlledDraftRequest){
   await current(request);await isolated(request);
   if(request.mode==="existing_generated"){
    if(!request.providerInvoiceRef||request.invoiceOrigin.kind==="created_draft")refuse();const actual=await inventory({...request,providerInvoiceRef:request.providerInvoiceRef},false);
    if(actual.status!=="draft"||actual.paidMinor!==0||actual.actualPayments.length||actual.actualCash.length)refuse();
    return{providerInvoiceRef:request.providerInvoiceRef,origin:"existing_generated" as const,requiresIndependentRead:true as const,suppliesPaidAuthority:false as const};
   }
   if(request.providerInvoiceRef||request.invoiceOrigin.kind!=="created_draft"||request.invoiceOrigin.creatorOperationId!==request.operationId||request.invoiceOrigin.creatorRequestDigest!==request.requestDigest||request.lineBindings.length)refuse();
   const form=new URLSearchParams({customer:request.providerCustomerRef,subscription:request.providerSubscriptionRef,currency:request.currency.toLowerCase(),auto_advance:"false",collection_method:"charge_automatically",
    default_payment_method:request.providerMethodRef,pending_invoice_items_behavior:"exclude",discounts:"",default_tax_rates:"","automatic_tax[enabled]":"false"});
   applyDestinationCharge(form,false,request);metadata(form,{...originalTag(request),...targetTag(request)});
   const raw=await post(request,"/v1/invoices",form);await request.onObserved({kind:"controlled_draft_created",raw});const id=ref(raw.id);if(!id||!/^in_[A-Za-z0-9_]{1,196}$/.test(id))refuse();
   return{providerInvoiceRef:id,origin:"created_draft" as const,requiresIndependentRead:true as const,suppliesPaidAuthority:false as const};
  },
  async addMerchantControlledComponent(request:MerchantControlledInvoiceComponentRequest){
   await current(request);await isolated(request);const actual=await inventory(request,false),component=request.manifest.components.find(c=>c.id===request.componentId);
   if(!component||request.lineBindings.some(b=>b.componentId===component.id)||actual.status!=="draft"||actual.paidMinor!==0||actual.actualPayments.length||actual.actualCash.length)refuse();
   const form=new URLSearchParams({customer:request.providerCustomerRef,invoice:request.providerInvoiceRef,currency:request.currency.toLowerCase(),discountable:"false",discounts:"",tax_rates:"",quantity:"1",
    "period[start]":String(epoch(component.periodStart)),"period[end]":String(epoch(component.periodEnd))});
   if(component.kind==="locked_canonical_credit"){
    // Negative credit is an attached amount item. Price creation accepts only
    // nonnegative prices; never invent a negative Product/Price or bank credit note.
    form.set("amount",String(component.amountMinor));
   }else{
    if(!component.providerProductRef)refuse();
    form.set("price_data[currency]",request.currency.toLowerCase());form.set("price_data[product]",component.providerProductRef);
    form.set("price_data[unit_amount]",String(component.amountMinor));form.set("price_data[tax_behavior]","exclusive");
   }
   metadata(form,{...targetTag(request),freeholder_controlled_component_id:component.id,freeholder_controlled_component_digest:component.provenanceDigest,freeholder_controlled_component_kind:component.kind,
    freeholder_controlled_item_operation_id:request.operationId,freeholder_controlled_item_request_digest:request.requestDigest});
   const raw=await post(request,"/v1/invoiceitems",form);await request.onObserved({kind:"controlled_item_created",raw});
   if(!/^ii_[A-Za-z0-9_]{1,196}$/.test(ref(raw.id)??"")||ref(raw.invoice)!==request.providerInvoiceRef||ref(raw.customer)!==request.providerCustomerRef||raw.amount!==component.amountMinor)refuse();
   return{providerInvoiceRef:request.providerInvoiceRef,componentId:component.id,providerInvoiceItemRef:String(raw.id),providerPriceRef:ref(object(object(raw.pricing)?.price_details)?.price)??ref(raw.price)??null,requiresIndependentRead:true as const};
  },
  async setMerchantControlledInvoiceFee(request:MerchantControlledInvoiceActionRequest){
   await current(request);await isolated(request);const actual=await inventory(request,true);
   if(actual.status!=="draft"||actual.totalMinor!==request.manifest.cashDueMinor||actual.paidMinor!==0||actual.actualPayments.length||actual.actualCash.length||request.manifest.applicationFeeMinor>0&&!request.providerAccountId&&!request.destinationAccountId)refuse();
   const raw=await post(request,`/v1/invoices/${encodeURIComponent(request.providerInvoiceRef)}`,new URLSearchParams({auto_advance:"false",application_fee_amount:String(request.manifest.applicationFeeMinor)}));
   await request.onObserved({kind:"controlled_invoice_updated",raw});if(raw.id!==request.providerInvoiceRef)refuse();return{providerInvoiceRef:request.providerInvoiceRef,requiresIndependentRead:true as const,suppliesPaidAuthority:false as const};
  },
  inspectMerchantControlledInvoiceManifest:proof,
  async finalizeMerchantControlledInvoice(request:MerchantControlledInvoiceActionRequest){
   const exact=await proof(request);if(exact.inventory.status!=="draft"||exact.inventory.paidMinor!==0||exact.inventory.actualPayments.length||exact.inventory.actualCash.length)refuse();
   const raw=await post(request,`/v1/invoices/${encodeURIComponent(request.providerInvoiceRef)}/finalize`,new URLSearchParams({auto_advance:"false"}));
   await request.onObserved({kind:"controlled_invoice_finalized",raw});if(raw.id!==request.providerInvoiceRef)refuse();
   // Finalize may consume an external balance/minimum-charge carry. Its ACK is
   // never principal; the next independent complete read must still prove it.
   return{providerInvoiceRef:request.providerInvoiceRef,requiresIndependentRead:true as const,suppliesPaidAuthority:false as const};
  },
  async payMerchantControlledInvoice(request:MerchantControlledInvoiceActionRequest){
   const exact=await proof(request),actual=exact.inventory;
   if(actual.status!=="open"||actual.paidMinor!==0||actual.remainingMinor!==request.manifest.cashDueMinor||actual.actualInvoice.amount_due!==request.manifest.cashDueMinor||request.manifest.cashDueMinor<=0||actual.actualCash.length
    ||actual.actualIntents.some(pi=>pi.status!=="requires_payment_method"&&pi.status!=="requires_confirmation"&&pi.status!=="canceled"))refuse();
   const raw=await post(request,`/v1/invoices/${encodeURIComponent(request.providerInvoiceRef)}/pay`,new URLSearchParams({payment_method:request.providerMethodRef,off_session:"true"}));
   await request.onObserved({kind:"controlled_invoice_paid",raw});if(raw.id!==request.providerInvoiceRef)refuse();
   // Read all PIs immediately: its observer commits every positive occurrence
   // before line/price/fee/manifest or canonical bridge/application can refuse.
   await invoices.inspectMerchantControlledInvoice(request);
   return{providerInvoiceRef:request.providerInvoiceRef,requiresIndependentRead:true as const,suppliesPaidAuthority:false as const};
  },
 };
}
