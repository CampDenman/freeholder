// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: pure arithmetic supplies no identity/current-bank authority.
import {ServiceError} from "@/core/service";
import type {AtomicCreditFeeSegment} from "./atomic-credit-reservation-contract";
type Epoch=Pick<AtomicCreditFeeSegment,"epochFundingId"|"epochStartMinor"|"epochEndMinor"|"epochAssignedFeeMinor"|"epochProvenCollectedMinor">;
type Root={originalPrincipalMinor:number;originalFeeMinor:number};
function refuse():never{throw new ServiceError("conflict","Restore the actual original fee segment, immutable cap anchors and every occupied interval; unknown offsets cannot be reconstructed from amounts, dates or IDs.");}
const safe=(values:readonly number[])=>values.every(value=>Number.isSafeInteger(value)&&value>=0);
/** All coordinates are ABSOLUTE. The original epoch start is subtracted once
 * inside the cumulative floor; a descendant never resets that cap anchor. */
export function originalAtomicCreditFeeSegment(root:Root,epoch:Epoch,startMinor:number,endMinor:number):AtomicCreditFeeSegment{
 if(!safe([root.originalPrincipalMinor,root.originalFeeMinor,epoch.epochStartMinor,epoch.epochEndMinor,epoch.epochAssignedFeeMinor,epoch.epochProvenCollectedMinor,startMinor,endMinor])
  ||root.originalPrincipalMinor<=0||root.originalFeeMinor>root.originalPrincipalMinor||!epoch.epochFundingId||epoch.epochStartMinor>=epoch.epochEndMinor||epoch.epochEndMinor>root.originalPrincipalMinor
  ||startMinor<epoch.epochStartMinor||startMinor>=endMinor||endMinor>epoch.epochEndMinor||epoch.epochProvenCollectedMinor>epoch.epochAssignedFeeMinor)refuse();
 const p=BigInt(root.originalPrincipalMinor),f=BigInt(root.originalFeeMinor),base=f*BigInt(epoch.epochStartMinor)/p;
 const nominal=(absolute:number)=>f*BigInt(absolute)/p-base;
 if(BigInt(epoch.epochAssignedFeeMinor)>nominal(epoch.epochEndMinor))refuse();
 const assigned=(absolute:number)=>{const n=nominal(absolute),cap=BigInt(epoch.epochAssignedFeeMinor);return n<cap?n:cap;};
 const proven=(absolute:number)=>{const a=assigned(absolute),cap=BigInt(epoch.epochProvenCollectedMinor);return a<cap?a:cap;};
 const n=nominal(endMinor)-nominal(startMinor),a=assigned(endMinor)-assigned(startMinor),c=proven(endMinor)-proven(startMinor);
 return{...epoch,startMinor,endMinor,nominalFeeMinor:Number(n),retiredFeeMinor:Number(n-a),assignedFeeMinor:Number(a),provenCollectedMinor:Number(c),owedFeeMinor:Number(a-c)};
}
const sameEpoch=(a:Epoch,b:Epoch)=>a.epochFundingId===b.epochFundingId&&a.epochStartMinor===b.epochStartMinor&&a.epochEndMinor===b.epochEndMinor
 &&a.epochAssignedFeeMinor===b.epochAssignedFeeMinor&&a.epochProvenCollectedMinor===b.epochProvenCollectedMinor;
const amount=(segment:AtomicCreditFeeSegment)=>segment.endMinor-segment.startMinor;
function exact(root:Root,row:AtomicCreditFeeSegment){const actual=originalAtomicCreditFeeSegment(root,row,row.startMinor,row.endMinor);
 if(actual.nominalFeeMinor!==row.nominalFeeMinor||actual.retiredFeeMinor!==row.retiredFeeMinor||actual.assignedFeeMinor!==row.assignedFeeMinor||actual.provenCollectedMinor!==row.provenCollectedMinor||actual.owedFeeMinor!==row.owedFeeMinor)refuse();return actual;}
export function atomicCreditFeeSegmentTotals(segments:readonly AtomicCreditFeeSegment[]){
 const sums=segments.reduce((out,row)=>({amountMinor:out.amountMinor+BigInt(amount(row)),nominalFeeMinor:out.nominalFeeMinor+BigInt(row.nominalFeeMinor),retiredFeeMinor:out.retiredFeeMinor+BigInt(row.retiredFeeMinor),assignedFeeMinor:out.assignedFeeMinor+BigInt(row.assignedFeeMinor),provenCollectedMinor:out.provenCollectedMinor+BigInt(row.provenCollectedMinor),owedFeeMinor:out.owedFeeMinor+BigInt(row.owedFeeMinor)}),{amountMinor:0n,nominalFeeMinor:0n,retiredFeeMinor:0n,assignedFeeMinor:0n,provenCollectedMinor:0n,owedFeeMinor:0n});
 if(Object.values(sums).some(value=>value<0n||value>BigInt(Number.MAX_SAFE_INTEGER)))refuse();
 return{amountMinor:Number(sums.amountMinor),nominalFeeMinor:Number(sums.nominalFeeMinor),retiredFeeMinor:Number(sums.retiredFeeMinor),assignedFeeMinor:Number(sums.assignedFeeMinor),provenCollectedMinor:Number(sums.provenCollectedMinor),owedFeeMinor:Number(sums.owedFeeMinor)};
}
/** Caller MUST independently authenticate actual FK/HMAC/current bank and
 * active/release ownership. This function receives exactly occupied intervals,
 * with no allow/release flags. A release never destroys its historical row. */
export function selectAtomicCreditFeeSegments(input:Root&{sourceSegments:readonly AtomicCreditFeeSegment[];occupied:readonly{reservationId:string;segments:readonly AtomicCreditFeeSegment[]}[];takeMinor:number}){
 if(!safe([input.takeMinor])||!input.sourceSegments.length||input.sourceSegments.length+input.occupied.length+input.occupied.reduce((n,row)=>n+row.segments.length,0)>5000
  ||input.occupied.some(row=>!row.reservationId||!row.segments.length)||new Set(input.occupied.map(row=>row.reservationId)).size!==input.occupied.length)refuse();
 const source=input.sourceSegments.map(row=>exact(input,row)).sort((a,b)=>a.startMinor-b.startMinor),used=input.occupied.flatMap(row=>row.segments.map(segment=>exact(input,segment))).sort((a,b)=>a.startMinor-b.startMinor);
 if(source.some((row,i)=>i>0&&row.startMinor<(source[i-1]?.endMinor??0))||used.some((row,i)=>i>0&&row.startMinor<(used[i-1]?.endMinor??0)))refuse();
 for(const row of used)if(!source.some(parent=>sameEpoch(parent,row)&&row.startMinor>=parent.startMinor&&row.endMinor<=parent.endMinor))refuse();
 const free:AtomicCreditFeeSegment[]=[];
 for(const parent of source){let next=parent.startMinor;for(const row of used.filter(row=>sameEpoch(parent,row)&&row.startMinor>=parent.startMinor&&row.endMinor<=parent.endMinor)){
   if(next<row.startMinor)free.push(originalAtomicCreditFeeSegment(input,parent,next,row.startMinor));next=row.endMinor;
  }if(next<parent.endMinor)free.push(originalAtomicCreditFeeSegment(input,parent,next,parent.endMinor));}
 if(free.length+used.length+source.length+input.occupied.length>5000)refuse();
 const available=atomicCreditFeeSegmentTotals(free);if(input.takeMinor>available.amountMinor)refuse();
 const selected:AtomicCreditFeeSegment[]=[],remaining:AtomicCreditFeeSegment[]=[];let needed=input.takeMinor;
 for(const row of free){const take=Math.min(needed,amount(row));if(take)selected.push(originalAtomicCreditFeeSegment(input,row,row.startMinor,row.startMinor+take));
  if(take<amount(row))remaining.push(originalAtomicCreditFeeSegment(input,row,row.startMinor+take,row.endMinor));needed-=take;}
 if(needed!==0)refuse();
 const chosen=atomicCreditFeeSegmentTotals(selected),after=atomicCreditFeeSegmentTotals(remaining),occupied=atomicCreditFeeSegmentTotals(used),whole=atomicCreditFeeSegmentTotals(source);
 for(const key of ["amountMinor","nominalFeeMinor","retiredFeeMinor","assignedFeeMinor","provenCollectedMinor","owedFeeMinor"] as const)
  if(BigInt(chosen[key])+BigInt(after[key])+BigInt(occupied[key])!==BigInt(whole[key]))refuse();
 return{segments:selected,remainingSegments:remaining,available,selected:chosen,remaining:after,occupied,whole};
}
