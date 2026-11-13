// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: quote-time original gross freight, before per-business tax extraction.
import {ServiceError} from "@/core/service";
import {assertMinor,extendMinor} from "./money";
type Line={sellerUserId:string|null;requiresShipping:boolean;quantityMicros:number;unitAmountMinor:number;discountMinor:number};
export function allocateMerchantGrossFreight(lines:readonly Line[],shippingMinor:number){
 if(!Number.isSafeInteger(shippingMinor)||shippingMinor<0)throw new ServiceError("validation","Freight must be exact non-negative minor units.");
 const physical=lines.map((line,position)=>({line,position})).filter(row=>row.line.requiresShipping);
 if(shippingMinor&&!physical.length)throw new ServiceError("conflict","The original freight has no physical item owner.");
 const net=physical.map(({line})=>BigInt(extendMinor(line.unitAmountMinor,line.quantityMicros))-BigInt(assertMinor(line.discountMinor,"Original freight allocation discount")));
 if(net.some(amount=>amount<0n))throw new ServiceError("validation","An original item's discount exceeds its amount.");
 const weights=net.some(amount=>amount>0n)?net:physical.map(({line})=>BigInt(line.quantityMicros));
 const weight=weights.reduce((sum,value)=>sum+value,0n);
 if(shippingMinor&&weight<=0n)throw new ServiceError("conflict","The original freight has no valid physical allocation weight.");
 const amount=BigInt(shippingMinor),shares=physical.map((row,index)=>({...row,amount:weight?amount*weights[index]!/weight:0n,remainder:weight?amount*weights[index]!%weight:0n}));
 let left=amount-shares.reduce((sum,row)=>sum+row.amount,0n);
 shares.sort((a,b)=>a.remainder===b.remainder?a.position-b.position:a.remainder>b.remainder?-1:1);
 for(const share of shares){if(!left)break;share.amount++;left--;}
 const owners=new Map<string,{sellerUserId:string|null;linePositions:number[];shippingMinor:number}>();
 for(const[line,position]of lines.map((line,index)=>[line,index] as const)){const key=line.sellerUserId===null?"site":`seller:${line.sellerUserId}`;const owner=owners.get(key)??{sellerUserId:line.sellerUserId,linePositions:[],shippingMinor:0};owner.linePositions.push(position);owner.shippingMinor+=Number(shares.find(row=>row.position===position)?.amount??0n);owners.set(key,owner);}
 return[...owners.values()];
}
