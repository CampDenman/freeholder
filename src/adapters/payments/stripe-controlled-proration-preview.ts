// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C12.38: actual non-payable preview, exact proration date, accepted trial and original anchor.
import { AdapterError } from "../types";
import { number, object, text } from "./http";
import { assertControlledCurrent } from "./controlled-subscription-current";
import { validateMerchantChargeScope } from "./stripe-merchant-scope";
import type { PaymentAccountScope } from "./types";
import type { MerchantControlledProrationPreviewRequest, MerchantControlledProrationPreview } from "./merchant-controlled-subscription-types";
type Api=(path:string,init:RequestInit,scope:PaymentAccountScope)=>Promise<Record<string,unknown>>;
const reference=(value:unknown)=>text(value)??text(object(value)?.id);
function unproven():never{throw new AdapterError("payments","stripe","provider_failure","Retain and review the actual original provider preview, complete lines and current paused-calendar source before consenting or changing canonical money.",true);}
function seconds(value:string):number{const n=Date.parse(value);if(!Number.isSafeInteger(n)||n<0||n%1000!==0||new Date(n).toISOString()!==value)unproven();return n/1000;}
function timestamp(value:unknown):string{const n=number(value);if(n===undefined||!Number.isSafeInteger(n)||n<0||n>8640000000000)unproven();return new Date(n*1000).toISOString();}
function signed(value:unknown):number{const n=number(value);if(n===undefined||!Number.isSafeInteger(n))unproven();return n;}
export function stripeControlledProrationPreview(api:Api){return{
 async previewMerchantControlledProration(request:MerchantControlledProrationPreviewRequest):Promise<MerchantControlledProrationPreview>{
  validateMerchantChargeScope(request);
  if(request.providerApiVersion!=="2026-10-28.endive"||!request.providerPlatformAccountId||!/^sub_[A-Za-z0-9_]+$/.test(request.providerSubscriptionRef)
   ||request.originalComponents.length!==1||!/^prod_[A-Za-z0-9_]+$/.test(request.target.providerProductRef)
   ||!Number.isSafeInteger(request.target.principalMinor)||request.target.principalMinor<0||!Number.isSafeInteger(request.target.intervalCount)||request.target.intervalCount<1
   ||!["day","week","month","year"].includes(request.target.interval)||!/^([a-f0-9]{64})$/.test(request.currentReadDigest)||!/^([a-f0-9]{64})$/.test(request.requestDigest)
   ||!request.idempotencyKey||request.idempotencyKey.length>200||seconds(request.prorationAt)<seconds(request.originalPeriodStart)||seconds(request.prorationAt)>=seconds(request.originalPeriodEnd))unproven();
  // This independently admitted read belongs to the preview caller, not to an
  // earlier update/GET nonce. Its original raw facts are retained first.
  const current=await api(`/v1/subscriptions/${encodeURIComponent(request.providerSubscriptionRef)}?expand%5B%5D=items.data.price`,{method:"GET"},request);
  await request.onObserved({kind:"subscription_read",raw:current});
  assertControlledCurrent(request,current);
  const itemIds=new Set(request.originalComponents.map(row=>row.subscriptionItemRef));
  const form=new URLSearchParams({customer:request.providerCustomerRef,subscription:request.providerSubscriptionRef,currency:request.currency.toLowerCase(),preview_mode:"next",
   "automatic_tax[enabled]":"false","subscription_details[proration_behavior]":"create_prorations","subscription_details[proration_date]":String(seconds(request.prorationAt)),
   "subscription_details[billing_cycle_anchor][type]":"unchanged"});
  for(const[index,expected]of request.originalComponents.entries()){
   const prefix=`subscription_details[items][${index}]`;
   const values:{[key:string]:string}={id:expected.subscriptionItemRef,quantity:"1","price_data[currency]":request.currency.toLowerCase(),
    "price_data[product]":request.target.providerProductRef,
    "price_data[unit_amount]":String(request.target.principalMinor),"price_data[tax_behavior]":"exclusive",
    "price_data[recurring][interval]":request.target.interval,"price_data[recurring][interval_count]":String(request.target.intervalCount)};
   for(const[key,value]of Object.entries(values)){const split=key.indexOf("[");form.set(split<0?`${prefix}[${key}]`:`${prefix}[${key.slice(0,split)}]${key.slice(split)}`,value);}
  }
  const taxComponent=request.taxComponent;
  if(taxComponent&&(!/^prod_[A-Za-z0-9_]+$/.test(taxComponent.providerProductRef)||!Number.isSafeInteger(taxComponent.amountMinor)||taxComponent.amountMinor<0
   ||!/^([a-f0-9]{64})$/.test(taxComponent.taxQuoteDigest)||!Number.isSafeInteger(taxComponent.profileVersion)||taxComponent.profileVersion<1||seconds(taxComponent.periodEnd)<seconds(taxComponent.periodStart)))unproven();
  if(taxComponent){
  // Fixed collection of the exact sealed canonical merchant tax. This is an
  // ordinary one-off item, never Stripe Tax calculation or a prorated flat-tax
  // recurring price. It cannot add rounding adjustments to the tax ledger.
  form.set("invoice_items[0][price_data][currency]",request.currency.toLowerCase());
  form.set("invoice_items[0][price_data][product]",taxComponent.providerProductRef);
  form.set("invoice_items[0][price_data][unit_amount]",String(taxComponent.amountMinor));
  form.set("invoice_items[0][price_data][tax_behavior]","exclusive");
  form.set("invoice_items[0][quantity]","1");
  form.set("invoice_items[0][period][start]",String(seconds(taxComponent.periodStart)));
  form.set("invoice_items[0][period][end]",String(seconds(taxComponent.periodEnd)));
  form.set("invoice_items[0][metadata][freeholder_controlled_component]","merchant_declared_tax_collection");
  form.set("invoice_items[0][metadata][freeholder_merchant_tax_quote_digest]",taxComponent.taxQuoteDigest);
  form.set("invoice_items[0][metadata][freeholder_merchant_profile_id]",taxComponent.profileId);
  form.set("invoice_items[0][metadata][freeholder_merchant_profile_version]",String(taxComponent.profileVersion));
  }
  // Preserve the actually accepted trial. Never serialize trial_end=now or
  // manufacture an old-paid credit for this uncharged interval.
  if(request.acceptedTrialEnd!==null&&seconds(request.acceptedTrialEnd)>seconds(request.prorationAt))form.set("subscription_details[trial_end]",String(seconds(request.acceptedTrialEnd)));
  const actual=await api("/v1/invoices/create_preview",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded","idempotency-key":request.idempotencyKey},body:form},request);
  await request.onObserved({kind:"proration_preview",raw:actual});
  const lines=object(actual.lines), previewRef=text(actual.id);
  if(!previewRef||!/^upcoming_in_[A-Za-z0-9_]+$/.test(previewRef)||reference(actual.customer)!==request.providerCustomerRef||actual.currency!==request.currency.toLowerCase()
   ||!Array.isArray(lines?.data)||lines.has_more!==false||lines.data.length>1000||actual.amount_paid!==0||actual.status_transitions!==undefined&&object(actual.status_transitions)?.paid_at!==null
   ||Buffer.byteLength(JSON.stringify(actual))>256000)unproven();
  const actualLines:MerchantControlledProrationPreview["actualLines"]=[],seenLines=new Set<string>();
  for(const raw of lines.data){const line=object(raw),parent=object(line?.parent),detail=object(parent?.subscription_item_details),period=object(line?.period),lineRef=text(line?.id),tag=object(line?.metadata);
   if(!lineRef||seenLines.has(lineRef))unproven();seenLines.add(lineRef);
   const tax=!!taxComponent&&parent?.type==="invoice_item_details"&&tag?.freeholder_controlled_component==="merchant_declared_tax_collection"&&tag.freeholder_merchant_tax_quote_digest===taxComponent.taxQuoteDigest;
   if(tax&&taxComponent){if(!line||!lineRef||!/^il_[A-Za-z0-9_]+$/.test(lineRef)||line.currency!==request.currency.toLowerCase()||tag?.freeholder_merchant_profile_id!==taxComponent.profileId||tag.freeholder_merchant_profile_version!==String(taxComponent.profileVersion)||signed(line.amount)!==taxComponent.amountMinor||timestamp(period?.start)!==taxComponent.periodStart||timestamp(period?.end)!==taxComponent.periodEnd)unproven();
    actualLines.push({providerLineRef:lineRef,amountMinor:signed(line.amount),periodStart:timestamp(period?.start),periodEnd:timestamp(period?.end),proration:false,component:"merchant_declared_tax_collection",raw:line});continue;}

   if(!line||!lineRef||!/^il_[A-Za-z0-9_]+$/.test(lineRef)||line.currency!==request.currency.toLowerCase()||typeof detail?.proration!=="boolean"
    ||reference(detail.subscription)!==request.providerSubscriptionRef||!itemIds.has(reference(detail.subscription_item)??"")||line.quantity!==1)unproven();
   actualLines.push({providerLineRef:lineRef,amountMinor:signed(line.amount),periodStart:timestamp(period?.start),periodEnd:timestamp(period?.end),proration:detail.proration,component:request.originalComponents.find(value=>value.subscriptionItemRef===reference(detail.subscription_item))!.kind,raw:line});
  }
  if(actualLines.filter(row=>row.component==="merchant_declared_tax_collection").length!==(taxComponent?1:0)
   ||actualLines.reduce((sum,row)=>sum+BigInt(row.amountMinor),0n)!==BigInt(signed(actual.subtotal)))unproven();
  return{providerPreviewRef:previewRef,providerSubscriptionRef:request.providerSubscriptionRef,providerCustomerRef:request.providerCustomerRef,currency:request.currency,
   subtotalMinor:signed(actual.subtotal),totalMinor:signed(actual.total),amountDueMinor:signed(actual.amount_due),prorationAt:request.prorationAt,requestedAnchor:"unchanged",originalAnchor:request.originalAnchor,
   trialPolicy:"preserve_original_end",originalTrialEnd:request.acceptedTrialEnd,actualLines,actualRaw:actual,suppliesPaidAuthority:false,sealedTaxIncluded:!!taxComponent};
 }
};}
