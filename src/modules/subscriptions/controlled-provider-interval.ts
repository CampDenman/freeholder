// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Provider anchor windows are explicit; historical manual/platform calendars stay unchanged.
import { ServiceError } from "@/core/service";
import { periodEnd } from "./calendar";
/** Flexible billing preserves the real anchor across interval/zero-price
 * changes. Anchored month/year windows clamp to that original day, unlike
 * iterating from a previously shortened February. Every result is subsequently
 * checked against actual retained preview dates; no guessed date can charge. */
export function controlledIntervalWindow(anchor:Date,at:Date,interval:"day"|"week"|"month"|"year",count:number){
 if(!Number.isSafeInteger(count)||count<1||!Number.isSafeInteger(anchor.getTime())||!Number.isSafeInteger(at.getTime()))throw new ServiceError("conflict","Restore a real original provider anchor, interval and exact quote instant.");
 const boundary=(index:number)=>{
  const units=count*index*(interval==="year"?12:1);if(!Number.isSafeInteger(units))throw new ServiceError("conflict","The original provider interval exceeds exact calendar capacity.");
  const result=periodEnd(anchor,interval==="year"?"month":interval,units);if(!Number.isFinite(result.getTime()))throw new ServiceError("conflict","The actual provider anchor window cannot be represented exactly.");return result;
 };
 const direction=at<anchor?-1:1;
 for(let step=0;step<5000;step++){
  const index=direction<0?-step-1:step,start=boundary(index),end=boundary(index+1);
  if(end<=start)throw new ServiceError("conflict","The real provider interval must have a positive actual duration.");
  if(start<=at&&at<end)return{start,end};
 }
 throw new ServiceError("conflict","Restore a bounded exact original provider anchor window before quoting; no current period is guessed.");
}
