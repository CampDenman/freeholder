// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: original business authorization and rates, without legal inference.
import {randomUUID} from "node:crypto";
import {describe,expect,it} from "vitest";
import type {TaxQuoteRequest} from "@/adapters/tax";
import {calculateDeclaredMerchantTax} from "@/modules/invoicing/merchant-tax-calculation";
import {MerchantTaxLocationError,type MerchantTaxRuleSnapshot} from "@/modules/invoicing/merchant-tax-contract";
const rateId=randomUUID(),zoneId=randomUUID();
function rules(ratePpm=50000):MerchantTaxRuleSnapshot{
 return{zone:{id:zoneId,name:"Declared zone",country:"CA",regions:["BC"],postalPatterns:[],priority:0,basis:"destination",pricesIncludeTax:false,roundingScope:"line",roundingMode:"half_up"},
  registrations:[{id:randomUUID(),zoneId,number:"DECLARED-GST",scheme:"standard",status:"active",collectsFrom:null,thresholdMinor:0,thresholdCurrency:null,rateIds:[rateId],configurationDigest:"c".repeat(64)}],
  rates:[{id:rateId,name:"Declared tax",jurisdiction:"CA",ratePpm,compound:false,priority:0,appliesToShipping:true,categoryCode:null,active:true,effectiveFrom:null,effectiveTo:null}]};
}
function request():TaxQuoteRequest{return{currency:"CAD",pricesIncludeTax:false,origin:{country:"CA",region:"BC"},destination:{country:"CA",region:"BC"},items:[{id:"line1",quantityMicros:1000000,unitAmountMinor:1000,discountMinor:0,category:"standard",requiresShipping:true}],shippingMinor:101,occurredAt:"2026-11-11T12:00:00.000Z"};}
describe("declared original merchant tax calculation (C12.38)",()=>{
 it("keeps each business's own rates and actual shipping-tax cents",()=>{
  const a=calculateDeclaredMerchantTax(request(),{collectionStatus:"registered",rulesSnapshot:[rules()]}),b=calculateDeclaredMerchantTax(request(),{collectionStatus:"registered",rulesSnapshot:[rules(70000)]});
  expect(a.totalTaxMinor).toBe(55);expect(b.totalTaxMinor).toBe(77);
  expect(a.lines.filter(line=>!line.itemId).map(line=>line.taxMinor)).toEqual([5]);
  expect(b.lines.filter(line=>!line.itemId).map(line=>line.taxMinor)).toEqual([7]);
  expect(a.registrationNumbers.map(row=>row.number)).toEqual(["DECLARED-GST","DECLARED-GST"]);
 });
 it("binds different taxes to their own explicit original registrations",()=>{
  const row=rules(),secondId=randomUUID();
  row.rates.push({...row.rates[0]!,id:secondId,name:"Declared second tax",ratePpm:70000,priority:1});
  row.registrations.push({...row.registrations[0]!,id:randomUUID(),number:"DECLARED-PST",rateIds:[secondId]});
  const quote=calculateDeclaredMerchantTax(request(),{collectionStatus:"registered",rulesSnapshot:[row]});
  expect(quote.totalTaxMinor).toBe(132);
  expect(quote.registrationNumbers.map(row=>row.number)).toEqual(["DECLARED-GST","DECLARED-GST","DECLARED-PST","DECLARED-PST"]);
 });
 it("never activates a tax without its own registration or before its declared collection date",()=>{
  const row=rules();row.registrations[0]!.collectsFrom="2027-01-01";
  expect(calculateDeclaredMerchantTax(request(),{collectionStatus:"registered",rulesSnapshot:[row]}).totalTaxMinor).toBe(0);
  expect(calculateDeclaredMerchantTax({...request(),occurredAt:"2027-01-01T00:00:00.000Z"},{collectionStatus:"registered",rulesSnapshot:[row]}).totalTaxMinor).toBe(55);
  row.registrations[0]!.status="monitoring";
  expect(calculateDeclaredMerchantTax(request(),{collectionStatus:"registered",rulesSnapshot:[row]}).totalTaxMinor).toBe(0);
  row.registrations[0]!.rateIds=[];
  expect(()=>calculateDeclaredMerchantTax(request(),{collectionStatus:"registered",rulesSnapshot:[row]})).toThrow(/no explicit/);
 });
 it("refuses unknown or equally applicable jurisdictions instead of choosing a business fallback",()=>{
  expect(()=>calculateDeclaredMerchantTax({...request(),destination:{country:"US"}},{collectionStatus:"registered",rulesSnapshot:[rules()]})).toThrow(/no declared/);
  const a=rules(),b=rules();b.zone.id=randomUUID();
  expect(()=>calculateDeclaredMerchantTax(request(),{collectionStatus:"registered",rulesSnapshot:[a,b]})).toThrow(/ambiguous/);
  expect(calculateDeclaredMerchantTax(request(),{collectionStatus:"not_registered",rulesSnapshot:[]}).totalTaxMinor).toBe(0);
 });
 it("requires declared location details before a narrower jurisdiction can be excluded",()=>{
  expect(()=>calculateDeclaredMerchantTax({...request(),destination:{country:"CA"}},{collectionStatus:"registered",rulesSnapshot:[rules()]})).toThrow(MerchantTaxLocationError);
  const row=rules();row.zone.postalPatterns=["V0R*"];
  expect(()=>calculateDeclaredMerchantTax(request(),{collectionStatus:"registered",rulesSnapshot:[row]})).toThrow(MerchantTaxLocationError);
 });
 it("does not require the postal details of an explicitly excluded region",()=>{
  const bc=rules(),on=rules(130000);bc.zone.postalPatterns=["V0R*"];on.zone.id=randomUUID();on.zone.regions=["ON"];
  const quote=calculateDeclaredMerchantTax({...request(),destination:{country:"CA",region:"ON"}},{collectionStatus:"registered",rulesSnapshot:[bc,on]});
  expect(quote.totalTaxMinor).toBe(143);expect(quote.zone?.id).toBe(on.zone.id);
 });
 it("extracts inclusive item and freight tax without changing the declared gross price",()=>{
  const row=rules(100000);row.zone.pricesIncludeTax=true;
  const quote=calculateDeclaredMerchantTax(request(),{collectionStatus:"registered",rulesSnapshot:[row]});
  expect(quote.includedTaxMinor).toBe(100);expect(quote.totalTaxMinor).toBe(100);
  expect(quote.lines.map(line=>line.taxMinor)).toEqual([91,9]);
 });
 it("rejects conflicting registration authorization and preserves immutable input data",()=>{
  const row=rules(),before=JSON.stringify(row);calculateDeclaredMerchantTax(request(),{collectionStatus:"registered",rulesSnapshot:[row]});expect(JSON.stringify(row)).toBe(before);
  row.registrations.push({...row.registrations[0]!,id:randomUUID()});
  expect(()=>calculateDeclaredMerchantTax(request(),{collectionStatus:"registered",rulesSnapshot:[row]})).toThrow(/more than one/);
 });
});
