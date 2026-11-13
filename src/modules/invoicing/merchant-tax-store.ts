// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: shared transaction helpers; no actor or provider authority is created.
import {createHash} from "node:crypto";
import {sql} from "drizzle-orm";
import type {Tx} from "@/core/service";
export async function allowMerchantTaxWrites(tx:Tx,privacy=false){
 await tx.execute(sql`select set_config('freeholder.merchant_tax_writes_v1','1',true)`);
 if(privacy)await tx.execute(sql`select set_config('freeholder.merchant_tax_privacy_v1','1',true)`);
}
function canonical(value:unknown):string{
 if(value instanceof Date)return JSON.stringify(value.toISOString());
 if(Array.isArray(value))return`[${value.map(canonical).join(",")}]`;
 if(value&&typeof value==="object")return`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
 return JSON.stringify(value)??"null";
}
export function merchantTaxDigest(value:unknown){return createHash("sha256").update(canonical(value)).digest("hex");}
