// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: bounded human form parsing; shared services still own all validation.
import {decimalToMinor} from "@/adapters/payments/currency";
import {ServiceError} from "@/core/service";
import {merchantTaxDigest} from "./merchant-tax-store";
export function merchantTaxFormValues(form:FormData){
 const text=(key:string)=>{const value=form.get(key);return typeof value==="string"?value.trim():"";};
 const nullable=(key:string)=>text(key)||null;
 const count=Number(text("rateCount"));
 if(!Number.isInteger(count)||count<0||count>1000)throw new ServiceError("validation","The business tax form has an invalid number of rate policies.");
 const rows:Array<{zoneId:string;number:string|null;scheme:string;status:string;collectsFrom:string|null;thresholdMinor:number;thresholdCurrency:string|null;rateIds:string[];configurationDigest:string}>=[];
 for(let index=0;index<count;index++){
  const prefix=`rate.${index}.`;
  if(text(`${prefix}include`)!=="on")continue;
  const thresholdCurrency=nullable(`${prefix}thresholdCurrency`)?.toUpperCase()??null;
  let thresholdMinor=0;
  const amount=text(`${prefix}threshold`)||"0";
  try{if(amount!=="0"){if(!thresholdCurrency)throw new Error("Missing threshold currency");thresholdMinor=decimalToMinor(amount,thresholdCurrency);}}catch{throw new ServiceError("validation","Enter the threshold as an exact amount in its declared currency.");}
  rows.push({zoneId:text(`${prefix}zoneId`),number:nullable(`${prefix}number`),scheme:text(`${prefix}scheme`),status:text(`${prefix}status`),collectsFrom:nullable(`${prefix}collectsFrom`),thresholdMinor,thresholdCurrency,rateIds:[text(`${prefix}rateId`)],configurationDigest:text(`${prefix}configurationDigest`)});
 }
 // One legal registration may explicitly authorize several rates. Preserve
 // that grouping when identical per-rate form policies are submitted.
 const grouped=new Map<string,(typeof rows)[number]>();
 for(const row of rows){const{rateIds,...declaration}=row,key=merchantTaxDigest(declaration),existing=grouped.get(key);if(existing)existing.rateIds.push(...rateIds);else grouped.set(key,{...row,rateIds:[...rateIds]});}
 const origin={country:text("origin.country").toUpperCase(),...(text("origin.region")?{region:text("origin.region").toUpperCase()}:{}),...(text("origin.postalCode")?{postalCode:text("origin.postalCode").toUpperCase()}:{}),...(text("origin.city")?{city:text("origin.city")}: {})};
 const publicAddress=text("support.line1")?{line1:text("support.line1"),line2:nullable("support.line2"),city:nullable("support.city"),state:nullable("support.state"),postalCode:nullable("support.postalCode"),country:text("support.country").toUpperCase()}:null;
 return{expectedVersion:Number(text("expectedVersion")),idempotencyKey:text("idempotencyKey"),acceptPolicy:text("acceptPolicy")==="on",origin,collectionStatus:text("collectionStatus"),nonCollectionReason:nullable("nonCollectionReason"),registrations:[...grouped.values()],acknowledgeTemplateLimitations:text("acknowledgeTemplateLimitations")==="on",merchantName:text("merchantName"),merchantSupport:{email:nullable("support.email"),phone:nullable("support.phone"),url:nullable("support.url"),address:publicAddress}};
}
