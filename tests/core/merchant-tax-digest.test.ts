// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
import {createHash} from "node:crypto";
import {describe,expect,it} from "vitest";
import {merchantTaxDigest} from "@/modules/invoicing/merchant-tax-store";
function originalCanonical(value:unknown):string{
 if(value instanceof Date)return JSON.stringify(value.toISOString());
 if(Array.isArray(value))return`[${value.map(originalCanonical).join(",")}]`;
 if(value&&typeof value==="object")return`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${originalCanonical(item)}`).join(",")}}`;
 return JSON.stringify(value)??"null";
}
const originalDigest=(value:unknown)=>createHash("sha256").update(originalCanonical(value)).digest("hex");
describe("merchantTaxDigest",()=>{
 it("preserves the exact original canonical byte stream",()=>{
  const sparse=[,1,undefined,,{z:1,a:[true,null,"text"]}];
  const values=[null,true,false,0,-0,NaN,Infinity,-Infinity,"","é",undefined,
   {},{a:1},{b:2,a:1},{"é":1,"e":2,"😀":3},{"a":1,"aé":2},{"a-b":1,"a_b":2,"ab":3},{date:new Date("2026-11-15T01:02:03.004Z")},
   {nested:[{z:null,a:undefined},[1,2],{empty:{}},sparse]},sparse];
  for(const value of values)expect(merchantTaxDigest(value)).toBe(originalDigest(value));
 });
 it("reuses only key ordering, never a mutable value or getter result",()=>{
  const value={b:2,a:{z:1}};expect(merchantTaxDigest(value)).toBe(originalDigest(value));value.a.z=9;value.b=3;expect(merchantTaxDigest(value)).toBe(originalDigest(value));
  let reads=0;const getter={get a(){reads++;return 7;}};expect(merchantTaxDigest(getter)).toBe(originalDigest({a:7}));expect(reads).toBe(1);
 });
});
