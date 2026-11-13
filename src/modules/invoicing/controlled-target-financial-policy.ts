// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C9.38: ordinary period preparation and actual collection have distinct clocks.
export function controlledPeriodAdmission(input:{subscriptionId:string;sourceId:string;now:Date;pay:boolean;parentStart:string;parentEnd:string;trialEnd:string|null;
 originalStart:string;originalEnd:string;originalTrialEnd:string|null;periodStart:string;periodEnd:string;credits:readonly number[]}){
 const exact=(value:string)=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
 if(![input.parentStart,input.parentEnd,input.originalStart,input.originalEnd,input.periodStart,input.periodEnd].every(exact)
  ||input.trialEnd!==null&&!exact(input.trialEnd)||input.originalTrialEnd!==input.trialEnd||!Number.isFinite(input.now.getTime())
  ||input.parentStart!==input.originalStart||input.parentEnd!==input.originalEnd||![input.parentStart,input.parentEnd].includes(input.periodStart)
  ||input.sourceId!==`${input.subscriptionId}:${input.periodStart}`||input.credits.some(amount=>amount!==0)
  ||Date.parse(input.periodEnd)<=Date.parse(input.periodStart)||input.now.getTime()>=Date.parse(input.periodEnd)
  ||input.trialEnd!==null&&Date.parse(input.periodStart)<Date.parse(input.trialEnd))return false;
 return !input.pay||input.now.getTime()>=Date.parse(input.periodStart)&&(input.trialEnd===null||input.now.getTime()>=Date.parse(input.trialEnd));
}
