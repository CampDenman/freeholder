// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One exact actual-current predicate for preview and positive calendar mutation.
import { AdapterError } from "../types";
import { object,text } from "./http";
import { assertMerchantIntent } from "./stripe-merchant-scope";
import { controlledSubscriptionFactsDigest } from "./controlled-subscription-digest";
import type { MerchantControlledProrationPreviewRequest } from "./merchant-controlled-subscription-types";
const ref=(value:unknown)=>text(value)??text(object(value)?.id);
function unproven():never{throw new AdapterError("payments","stripe","provider_failure","The actual original paused provider calendar, component price or current read changed. Retain its facts and review fresh consent before mutating or collecting.",true);}
const time=(value:unknown)=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0&&value<=8640000000000?new Date(value*1000).toISOString():null;
export function assertControlledCurrent(request:Omit<MerchantControlledProrationPreviewRequest,"onObserved">,current:Record<string,unknown>){
 assertMerchantIntent(request,current);
 const tag=object(current.metadata),items=object(current.items),trial=current.trial_end===null?null:time(current.trial_end);
 if(!["active","trialing"].includes(String(current.status))||current.schedule!==null||current.cancel_at!==null||current.cancel_at_period_end!==false
  ||ref(current.default_payment_method)!==request.providerMethodRef||controlledSubscriptionFactsDigest(current)!==request.currentReadDigest||ref(current.id)!==request.providerSubscriptionRef||ref(current.customer)!==request.providerCustomerRef
  ||current.currency!==request.currency.toLowerCase()||tag?.freeholder_controlled_subscription_version!=="1"||!["zero_only_preparation","draft_calendar"].includes(String(tag.freeholder_controlled_transport))
  ||tag.freeholder_subscription_id!==request.subscriptionId||tag.freeholder_subscription_terms_id!==request.termsId||tag.freeholder_controlled_generation!==String(request.generation)
  ||tag.freeholder_bootstrap_operation_id!==request.bootstrapOperationId||tag.freeholder_bootstrap_request_digest!==request.bootstrapRequestDigest||tag.freeholder_platform_account_id!==request.providerPlatformAccountId
  ||object(current.pause_collection)?.behavior!=="keep_as_draft"||object(current.pause_collection)?.resumes_at!==null||current.collection_method!=="charge_automatically"
  ||object(current.billing_mode)?.type!=="flexible"||current.pending_update!==null||items?.has_more!==false||!Array.isArray(items.data)||items.data.length!==request.originalComponents.length
  ||time(current.billing_cycle_anchor)!==request.originalAnchor||trial!==request.originalProviderTrialEnd||object(current.automatic_tax)?.enabled!==false
  ||!Array.isArray(current.default_tax_rates)||current.default_tax_rates.length!==0||current.discounts!==null&&(!Array.isArray(current.discounts)||current.discounts.length!==0))unproven();
 const componentIds=new Set<string>();
 for(const expected of request.originalComponents){
  const item=items.data.map(object).find(value=>ref(value?.id)===expected.subscriptionItemRef),price=object(item?.price);
  if(expected.kind!=="principal"||componentIds.has(expected.subscriptionItemRef)||!item||!price||item.quantity!==1||ref(price.id)!==expected.providerPriceRef
   ||price.unit_amount!==expected.amountMinor||ref(price.product)!==expected.providerProductRef||price.currency!==request.currency.toLowerCase()
   ||(expected.interval!==undefined||expected.intervalCount!==undefined)&&(object(price.recurring)?.interval!==expected.interval||object(price.recurring)?.interval_count!==expected.intervalCount)
   ||time(item.current_period_start)!==expected.actualPeriodStart||time(item.current_period_end)!==expected.actualPeriodEnd
   ||expected.actualPeriodStart!==request.originalPeriodStart||expected.actualPeriodEnd!==request.originalPeriodEnd)unproven();
  componentIds.add(expected.subscriptionItemRef);
 }
}
