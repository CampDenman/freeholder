// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: shared transaction helpers; no actor or provider authority is created.
import {createHash} from "node:crypto";
import {sql} from "drizzle-orm";
import type {Tx} from "@/core/service";
const canonicalKeyOrders=new Map<string,readonly (readonly [number,string])[]>();
function canonicalKeyOrder(entries:readonly (readonly [string,unknown])[]){
 const shape=JSON.stringify(entries.map(([key])=>key)),existing=canonicalKeyOrders.get(shape);if(existing)return existing;
 const order=entries.map((_,index)=>[index,JSON.stringify(entries[index]?.[0])] as const).sort(([a],[b])=>entries[a]![0].localeCompare(entries[b]![0]));
 if(canonicalKeyOrders.size>=2048)canonicalKeyOrders.clear();canonicalKeyOrders.set(shape,order);return order;
}
export async function allowMerchantTaxWrites(tx:Tx,privacy=false){
 await tx.execute(sql`select set_config('freeholder.merchant_tax_writes_v1','1',true)`);
 if(privacy)await tx.execute(sql`select set_config('freeholder.merchant_tax_privacy_v1','1',true)`);
}
function canonical(value:unknown):string{
 if(value instanceof Date)return JSON.stringify(value.toISOString());
 if(Array.isArray(value)){let result="[";for(let index=0;index<value.length;index++){if(index)result+=",";if(index in value)result+=canonical(value[index]);}return`${result}]`;}
 if(value&&typeof value==="object"){
  const entries=Object.entries(value as Record<string,unknown>),order=canonicalKeyOrder(entries);let result="{";let first=true;
  for(const[index,encoded]of order){if(!first)result+=",";result+=`${encoded}:${canonical(entries[index]?.[1])}`;first=false;}
  return`${result}}`;
 }
 return JSON.stringify(value)??"null";
}
export function merchantTaxDigest(value:unknown){return createHash("sha256").update(canonical(value)).digest("hex");}
