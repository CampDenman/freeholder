// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: calculate solely from the declared business's immutable rule version.
import type { QuotedTaxLine, TaxQuoteRequest } from "@/adapters/tax";
import { ServiceError } from "@/core/service";
import { calculateTaxQuote, type TaxRuleSet } from "./tax-engine";
import { MerchantTaxLocationError, type MerchantTaxRuleSnapshot } from "./merchant-tax-contract";

type Declaration={collectionStatus:"registered"|"not_registered";rulesSnapshot:readonly MerchantTaxRuleSnapshot[]};
function postal(value:string){return value.toUpperCase().replace(/[^A-Z0-9]/g,"");}
function matching(row:MerchantTaxRuleSnapshot,request:TaxQuoteRequest):boolean{
  const side=row.zone.basis, selected=side==="origin"?request.origin:request.destination;
  if(selected.country!==row.zone.country)return false;
  if(row.zone.regions.length&&!selected.region?.trim())throw new MerchantTaxLocationError("region",side);
  if(row.zone.regions.length&&!row.zone.regions.includes(selected.region!.trim().toUpperCase()))return false;
  if(row.zone.postalPatterns.length&&!selected.postalCode?.trim())throw new MerchantTaxLocationError("postalCode",side);
  const code=postal(selected.postalCode??"");
  return !row.zone.postalPatterns.length||row.zone.postalPatterns.some(pattern=>pattern.endsWith("*")?code.startsWith(postal(pattern.slice(0,-1))):code===postal(pattern));
}
function specificity(row:MerchantTaxRuleSnapshot){return(row.zone.postalPatterns.length?2:0)+(row.zone.regions.length?1:0);}

export function calculateDeclaredMerchantTax(request:TaxQuoteRequest,declaration:Declaration,exemption?:{kind:string;legend:string}){
  const matchingRows=declaration.rulesSnapshot.filter(row=>matching(row,request)).sort((a,b)=>specificity(b)-specificity(a)||b.zone.priority-a.zone.priority||a.zone.id.localeCompare(b.zone.id));
  const selected=matchingRows[0];
  if(matchingRows[1]&&specificity(matchingRows[1])===specificity(selected!)&&matchingRows[1].zone.priority===selected!.zone.priority)throw new ServiceError("conflict","The declared merchant tax zones are ambiguous. Review their explicit priority before collecting.");
  if(!selected){
    if(declaration.collectionStatus==="registered")throw new ServiceError("conflict","The registered merchant has no declared tax policy for this transaction location.");
    return{provider:"built_in" as const,currency:request.currency,lines:[] as QuotedTaxLine[],totalTaxMinor:0,includedTaxMinor:0,explanation:[] as string[],zone:null,registrationNumbers:[] as Array<{lineIndex:number;number:string|null}>};
  }
  const onDate=request.occurredAt.slice(0,10),owners=new Map<string,MerchantTaxRuleSnapshot["registrations"][number]>();
  for(const registration of selected.registrations)for(const id of registration.rateIds){
    if(owners.has(id))throw new ServiceError("conflict","A tax rate has more than one original business registration.");
    owners.set(id,registration);
  }
  const rates=selected.rates.filter(rate=>rate.active&&(!rate.effectiveFrom||rate.effectiveFrom<=onDate)&&(!rate.effectiveTo||rate.effectiveTo>=onDate));
  const rules:TaxRuleSet["rules"]=rates.map(rate=>{
    const registration=owners.get(rate.id);
    if(!registration)throw new ServiceError("conflict","An applicable tax rate has no explicit merchant registration policy.");
    const collecting=declaration.collectionStatus==="registered"&&registration.status==="active"&&(!registration.collectsFrom||registration.collectsFrom<=onDate);
    return{id:rate.id,name:rate.name,jurisdiction:rate.jurisdiction,ratePpm:collecting?rate.ratePpm:0,compound:rate.compound,priority:rate.priority,appliesToShipping:rate.appliesToShipping,...(rate.categoryCode?{categoryCode:rate.categoryCode}:{}),...(collecting&&registration.number?{registrationNumber:registration.number}:{})};
  });
  const registrationNumbers:Array<{lineIndex:number;number:string|null}>=[];
  const quote=calculateTaxQuote({...request,pricesIncludeTax:selected.zone.pricesIncludeTax},{zoneId:selected.zone.id,zoneName:selected.zone.name,pricesIncludeTax:selected.zone.pricesIncludeTax,roundingScope:selected.zone.roundingScope,roundingMode:selected.zone.roundingMode,rules,...(exemption?{exemption}:{})},(_line,rule,lineIndex)=>registrationNumbers.push({lineIndex,number:rule.registrationNumber??null}));
  return{...quote,zone:{id:selected.zone.id,name:selected.zone.name},registrationNumbers};
}
