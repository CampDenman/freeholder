// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: human declarations keep exact currency and business rate ownership.
import {randomUUID} from "node:crypto";
import {describe,expect,it} from "vitest";
import {merchantTaxFormValues} from "@/modules/invoicing/merchant-tax-form";
function form(count=1){const data=new FormData();data.set("rateCount",String(count));data.set("expectedVersion","0");data.set("idempotencyKey",randomUUID());data.set("acceptPolicy","on");data.set("origin.country"," ca ");data.set("collectionStatus","registered");return data;}
function rate(data:FormData,index:number,zoneId:string,rateId:string,threshold="0",currency=""){const prefix=`rate.${index}.`;for(const[key,value]of Object.entries({include:"on",zoneId,rateId,configurationDigest:"c".repeat(64),number:"DECLARED-REG",scheme:"standard",status:"active",threshold,thresholdCurrency:currency}))data.set(prefix+key,value);}
describe("business tax form boundaries (C12.38)",()=>{
 it("groups only identical explicit policies for the same business jurisdiction",()=>{
  const data=form(3),zone=randomUUID(),a=randomUUID(),b=randomUUID(),c=randomUUID();rate(data,0,zone,a);rate(data,1,zone,b);rate(data,2,randomUUID(),c);
  const result=merchantTaxFormValues(data);expect(result.origin).toEqual({country:"CA"});expect(result.registrations).toHaveLength(2);expect(result.registrations[0]!.rateIds).toEqual([a,b]);expect(result.registrations[1]!.rateIds).toEqual([c]);
 });
 it("preserves distinct collecting dates and numbers rather than grouping by tax rate alone",()=>{
  const data=form(2),zone=randomUUID();rate(data,0,zone,randomUUID());rate(data,1,zone,randomUUID());data.set("rate.1.collectsFrom","2027-01-01");
  expect(merchantTaxFormValues(data).registrations).toHaveLength(2);
 });
 it("converts exact zero-, three- and four-decimal declared thresholds",()=>{
  const data=form(3);rate(data,0,randomUUID(),randomUUID(),"12","JPY");rate(data,1,randomUUID(),randomUUID(),"1.234","KWD");rate(data,2,randomUUID(),randomUUID(),"1.2345","CLF");
  expect(merchantTaxFormValues(data).registrations.map(row=>row.thresholdMinor)).toEqual([12,1234,12345]);
 });
 it("refuses missing currencies, exponents, rounding and oversized form counts",()=>{
  const data=form();rate(data,0,randomUUID(),randomUUID(),"10");expect(()=>merchantTaxFormValues(data)).toThrow(/exact amount/);
  data.set("rate.0.thresholdCurrency","USD");for(const value of ["1e3","1.001","9007199254740991.99"]){data.set("rate.0.threshold",value);expect(()=>merchantTaxFormValues(data)).toThrow(/exact amount/);}
  expect(()=>merchantTaxFormValues(form(1001))).toThrow(/number of rate/);
 });
 it("does not invent a currency or collection status for an omitted rate",()=>{
  const data=form();rate(data,0,randomUUID(),randomUUID());data.delete("rate.0.include");const result=merchantTaxFormValues(data);expect(result.registrations).toEqual([]);expect(result.origin).not.toHaveProperty("region");
 });
});
