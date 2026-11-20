// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Interpret genuine retained NET rows with the existing canonical rounding engine.
import { ServiceError } from "@/core/service";
import type { MerchantControlledProrationPreview,MerchantControlledProrationPreviewRequest } from "@/adapters/payments";
import { proratedAmounts } from "./proration-amounts";
import { controlledIntervalWindow } from "./controlled-provider-interval";
const record=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;
const ref=(value:unknown)=>typeof value==="string"?value:typeof record(value)?.id==="string"?String(record(value)!.id):null;
function refuse():never{throw new ServiceError("conflict","The actual original native preview NET/period/credit differs from the unchanged canonical invoice engine. Keep its complete facts and old access; obtain an honest exact reviewed collection rather than replacing arithmetic or inventing money.");}
/** A forecast is neither an issued obligation nor received principal. Caller
 * already authenticated these exact original returned preview operations. */
export function controlledNativeAmounts(request:Omit<MerchantControlledProrationPreviewRequest,"onObserved">,native:MerchantControlledProrationPreview,update:MerchantControlledProrationPreview){
 const at=new Date(request.prorationAt),start=new Date(request.originalPeriodStart),end=new Date(request.originalPeriodEnd),item=request.originalComponents[0];
 if(!item||request.originalComponents.length!==1||at<start||at>=end||native.requestedProrationBehavior!=="create_prorations"||update.requestedProrationBehavior!=="none"
  ||native.providerSubscriptionRef!==request.providerSubscriptionRef||update.providerSubscriptionRef!==request.providerSubscriptionRef||native.currency!==request.currency||update.currency!==request.currency
  ||native.prorationAt!==request.prorationAt||update.prorationAt!==request.prorationAt||native.sealedTaxIncluded||update.sealedTaxIncluded
  ||native.providerCustomerRef!==request.providerCustomerRef||update.providerCustomerRef!==request.providerCustomerRef||native.originalAnchor!==request.originalAnchor||update.originalAnchor!==request.originalAnchor
  ||[native,update].some(preview=>preview.actualLines.reduce((sum,line)=>sum+BigInt(line.amountMinor),0n)!==BigInt(preview.subtotalMinor)||preview.totalMinor!==preview.subtotalMinor||preview.amountDueMinor!==Math.max(0,preview.totalMinor)))refuse();
 const currentPositive:MerchantControlledProrationPreview["actualLines"]=[],oldNegative:MerchantControlledProrationPreview["actualLines"]=[],forecasts:MerchantControlledProrationPreview["actualLines"]=[];
 for(const line of native.actualLines){
  if(line.component!=="principal"||Date.parse(line.periodEnd)<=Date.parse(line.periodStart))refuse();
  const pricing=record(record(line.raw.pricing)?.price_details),detail=record(record(line.raw.parent)?.subscription_item_details);
  if(!detail||ref(detail.subscription_item)!==item.subscriptionItemRef||ref(detail.subscription)!==request.providerSubscriptionRef||typeof detail.proration!=="boolean")refuse();
  if(line.amountMinor<0){if(ref(pricing?.product)!==item.providerProductRef)refuse();oldNegative.push(line);}
  else if(line.amountMinor>0){
   if(ref(pricing?.product)!==request.target.providerProductRef)refuse();
   if(Date.parse(line.periodStart)>at.getTime())forecasts.push(line);else if(Date.parse(line.periodEnd)>at.getTime())currentPositive.push(line);else refuse();
  }
 }
 const forecastTotal=forecasts.reduce((n,line)=>n+BigInt(line.amountMinor),0n);
 if(forecastTotal>BigInt(Number.MAX_SAFE_INTEGER))refuse();
 const trial=request.acceptedTrialEnd!==null&&Date.parse(request.acceptedTrialEnd)>at.getTime();
 if(trial){
  if(item.amountMinor!==0||oldNegative.length||currentPositive.length||forecasts.some(line=>Date.parse(line.periodStart)<Date.parse(request.acceptedTrialEnd!)))refuse();
  return{trial:true as const,debitNetMinor:0,proposedPeriodStart:request.prorationAt,proposedPeriodEnd:request.acceptedTrialEnd!,nativeCurrentDebitMinor:0,nativeUnusedCreditMinor:0,
   nativeRenewalForecastMinor:Number(forecastTotal),forecasts,expectedProviderPeriodStart:request.originalPeriodStart,expectedProviderPeriodEnd:request.acceptedTrialEnd!,expectedProviderBillingAnchor:request.acceptedTrialEnd!,expectedProviderTrialEndsAt:request.acceptedTrialEnd};
 }
 if(currentPositive.length>1)refuse();
 const positive=currentPositive[0],sameInterval=request.target.interval===(item.interval??request.interval)&&request.target.intervalCount===(item.intervalCount??request.intervalCount);
 const full=sameInterval?{start,end}:controlledIntervalWindow(new Date(request.originalAnchor),at,request.target.interval,request.target.intervalCount);
 const debit=proratedAmounts(0,request.target.principalMinor,full.start,full.end,at).newUnusedMinor;
 const nativeCredit=oldNegative.reduce((sum,line)=>sum-BigInt(line.amountMinor),0n);if(nativeCredit>BigInt(Number.MAX_SAFE_INTEGER))refuse();
 // A native credit estimate is NOT old paid principal. Flexible billing uses
 // the last provider-billed recurring debit, which can differ from the exact
 // canonical one-off collection. Only actual paid canonical basis funds credit.
 if(positive&&(positive.periodEnd!==full.end.toISOString()||positive.periodStart!==request.prorationAt&&!(positive.periodStart===full.start.toISOString()&&at.getTime()===full.start.getTime())))refuse();
 // Equivalent debit/credit prorations can cancel in a provider preview. In
 // that specific case the actual target full-price forecast still has to
 // prove the accepted NET and exact next interval, not an arbitrary amount.
 const equivalentCancelled=!positive&&item.amountMinor===request.target.principalMinor&&sameInterval
  &&forecasts.some(line=>line.amountMinor===request.target.principalMinor&&line.periodStart===end.toISOString());
 if((positive?.amountMinor??0)!==debit&&!equivalentCancelled)refuse();
 // The no-proration preview is retained separately. A negative row would be
 // an autonomous wallet credit outside this explicit canonical disposition.
 if(update.actualLines.some(line=>line.component!=="principal"||line.amountMinor<0))refuse();
 return{trial:false as const,debitNetMinor:debit,proposedPeriodStart:request.prorationAt,proposedPeriodEnd:full.end.toISOString(),
  nativeCurrentDebitMinor:positive?.amountMinor??0,nativeUnusedCreditMinor:Number(nativeCredit),nativeRenewalForecastMinor:Number(forecastTotal),forecasts,
  expectedProviderPeriodStart:full.start.toISOString(),expectedProviderPeriodEnd:full.end.toISOString(),expectedProviderBillingAnchor:request.originalAnchor,expectedProviderTrialEndsAt:request.originalProviderTrialEnd};
}
