// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Explicit controlled policy: actual native preview is evidence, no autonomous proration or customer-wallet credit.
import { AdapterError } from "../types";
import { object,text } from "./http";
import { validateMerchantChargeScope } from "./stripe-merchant-scope";
import { assertControlledCurrent } from "./controlled-subscription-current";
import type { PaymentAccountScope } from "./types";
import type { MerchantControlledCalendarUpdateRequest } from "./merchant-controlled-subscription-types";
type Api=(path:string,init:RequestInit,scope:PaymentAccountScope)=>Promise<Record<string,unknown>>;
function unproven():never{throw new AdapterError("payments","stripe","provider_failure","Retain the actual original controlled calendar update and independently read its real result before canonical collection or paid access.",true);}
export function stripeControlledUpdates(api:Api){return{
 async updateMerchantControlledCalendar(request:MerchantControlledCalendarUpdateRequest):Promise<{providerSubscriptionRef:string;providerInvoiceRef:string|null;prorationSuppressed:true;pauseRequested:true;requiresIndependentRead:true}>{
  validateMerchantChargeScope(request);
  if(request.providerApiVersion!=="2026-10-28.endive"||!/^sub_[A-Za-z0-9_]+$/.test(request.providerSubscriptionRef)||!/^([a-f0-9]{64})$/.test(request.acceptedQuoteDigest)
   ||!/^([a-f0-9-]{36})$/.test(request.collectionId)||request.originalComponents.length!==1||!Number.isSafeInteger(request.target.principalMinor)||request.target.principalMinor<0
   ||!/^prod_[A-Za-z0-9_]+$/.test(request.target.providerProductRef)||!request.idempotencyKey||request.idempotencyKey.length>200)unproven();
  const current=await api(`/v1/subscriptions/${encodeURIComponent(request.providerSubscriptionRef)}?expand%5B%5D=items.data.price`,{method:"GET"},request);
  await request.onObserved({kind:"subscription_read",raw:current});assertControlledCurrent(request,current);
  const item=request.originalComponents[0]!;
  const form=new URLSearchParams({"proration_behavior":"none","pause_collection[behavior]":"keep_as_draft","payment_behavior":"default_incomplete","billing_cycle_anchor[type]":"unchanged",
   "automatic_tax[enabled]":"false",discounts:"","items[0][id]":item.subscriptionItemRef,"items[0][quantity]":"1","items[0][price_data][currency]":request.currency.toLowerCase(),
   "items[0][price_data][product]":request.target.providerProductRef,"items[0][price_data][unit_amount]":String(request.target.principalMinor),"items[0][price_data][tax_behavior]":"exclusive",
   "items[0][price_data][recurring][interval]":request.target.interval,"items[0][price_data][recurring][interval_count]":String(request.target.intervalCount),
   "metadata[freeholder_controlled_transport]":"draft_calendar","metadata[freeholder_controlled_price_epoch_id]":request.collectionId,
   "metadata[freeholder_controlled_update_operation_id]":request.operationId,"metadata[freeholder_controlled_update_request_digest]":request.requestDigest,
   "metadata[freeholder_controlled_collection_policy]":"canonical_gross_target_locked_credit_no_wallet","metadata[freeholder_controlled_accepted_quote_digest]":request.acceptedQuoteDigest});
  if(request.acceptedTrialEnd!==null){const trial=Date.parse(request.acceptedTrialEnd);if(!Number.isSafeInteger(trial)||trial%1000!==0)unproven();if(trial>Date.now())form.set("trial_end",String(trial/1000));}
  const raw=await api(`/v1/subscriptions/${encodeURIComponent(request.providerSubscriptionRef)}`,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded","idempotency-key":request.idempotencyKey},body:form},request);
  await request.onObserved({kind:"calendar_updated",raw});
  if(raw.id!==request.providerSubscriptionRef)unproven();
  const invoice=typeof raw.latest_invoice==="string"?raw.latest_invoice:text(object(raw.latest_invoice)?.id)??null;
  // The actual POST ACK remains separate from a new read proving pause,
  // current real items/prices/calendar, generated drafts and all actual cash.
  return{providerSubscriptionRef:request.providerSubscriptionRef,providerInvoiceRef:invoice,prorationSuppressed:true,pauseRequested:true,requiresIndependentRead:true};
 }
};}
