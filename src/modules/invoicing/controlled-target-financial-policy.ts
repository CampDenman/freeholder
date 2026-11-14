// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C9.38: ordinary period preparation and actual collection have distinct clocks.
export type ControlledActivatedPeriodAmendment={subscriptionId:string;termsId:string;previousTermsId:string;planId:string;state:"pending_stop"|"activated";activatedAt:string|null;effectivePeriodStart:string;acceptedQuoteDigest:string};
export function controlledPeriodAdmission(input:{subscriptionId:string;sourceId:string;now:Date;pay:boolean;parentStart:string;parentEnd:string;trialEnd:string|null;
 originalStart:string;originalEnd:string;originalTrialEnd:string|null;periodStart:string;periodEnd:string;credits:readonly number[];
 governingTermsId?:string;governingAcceptedQuoteDigest?:string;pendingPlanId?:string|null;activatedAmendment?:ControlledActivatedPeriodAmendment}){
 const exact=(value:string)=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
 const amendment=input.activatedAmendment;
 const exactAmendment=amendment!==undefined&&amendment.subscriptionId===input.subscriptionId&&amendment.termsId===input.governingTermsId
  &&amendment.planId===input.pendingPlanId&&amendment.state==="activated"&&amendment.acceptedQuoteDigest===input.governingAcceptedQuoteDigest
  &&/^[a-f0-9]{64}$/.test(amendment.acceptedQuoteDigest)&&amendment.previousTermsId!==amendment.termsId&&amendment.activatedAt!==null&&exact(amendment.activatedAt)
  &&Date.parse(amendment.activatedAt)<=input.now.getTime()&&exact(amendment.effectivePeriodStart)&&amendment.effectivePeriodStart===input.periodStart&&Date.parse(input.periodStart)>Date.parse(input.parentEnd);
 if(![input.parentStart,input.parentEnd,input.originalStart,input.originalEnd,input.periodStart,input.periodEnd].every(exact)
  ||input.trialEnd!==null&&!exact(input.trialEnd)||input.originalTrialEnd!==input.trialEnd||!Number.isFinite(input.now.getTime())
  ||input.parentStart!==input.originalStart||input.parentEnd!==input.originalEnd||![input.parentStart,input.parentEnd].includes(input.periodStart)&&!exactAmendment
  ||input.sourceId!==`${input.subscriptionId}:${input.periodStart}`||input.credits.some(amount=>amount!==0)
  ||Date.parse(input.periodEnd)<=Date.parse(input.periodStart)||input.now.getTime()>=Date.parse(input.periodEnd)
  ||input.trialEnd!==null&&Date.parse(input.periodStart)<Date.parse(input.trialEnd))return false;
 return !input.pay||input.now.getTime()>=Date.parse(input.periodStart)&&(input.trialEnd===null||input.now.getTime()>=Date.parse(input.trialEnd));
}

/** A normal renewal can cross only an explicitly reviewed actual full-NET
 * forecast. This does not change accepted service dates, anchor or trial. */
export function controlledReviewedPeriodWindow(input:{kind:"period"|"proration";beforeUpdate:boolean;periodStart:string;periodEnd:string;expectedStart:string;expectedEnd:string;principalMinor:number;
 forecasts:readonly{proration:boolean;amountMinor:number;periodStart:string;periodEnd:string}[]}){
 return input.periodStart===input.expectedStart&&input.periodEnd===input.expectedEnd
  ||!input.beforeUpdate&&input.kind==="period"&&input.forecasts.some(forecast=>!forecast.proration&&forecast.amountMinor===input.principalMinor&&forecast.periodStart===input.periodStart&&forecast.periodEnd===input.periodEnd);
}
