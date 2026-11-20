// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/4.12: watch only the original business's issued sales, by currency.
import {and,eq,gte,lte,notInArray,sql} from "drizzle-orm";
import {z} from "zod";
import {defineService,ServiceError,type ServiceContext} from "@/core/service";
import {lockContactIdentityForRead} from "@/core/contacts/identity-lock";
import {memberOwner} from "./merchant-tax-profiles";
import {invoiceMerchantTaxQuotes,merchantTaxProfiles,merchantTaxProfileVersions} from "./merchant-tax-schema";
import {invoices} from "./schema";

const minor=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const windowKind=z.enum(["calendar_year","rolling_12_months"]);
const input=z.object({asOf:z.coerce.date().default(()=>new Date()),window:windowKind.default("calendar_year")});
const total=z.object({currency:z.string().regex(/^[A-Z]{3}$/),grossSalesMinor:minor,transactions:minor});
const threshold=z.object({
 zone:z.object({id:z.uuid(),name:z.string(),country:z.string()}),rates:z.array(z.string()),
 registration:z.object({id:z.uuid(),status:z.enum(["monitoring","active","paused","closed"]),thresholdMinor:minor,thresholdCurrency:z.string().nullable()}),
 state:z.enum(["not_configured","reached","approaching","below"]),grossSalesMinor:minor,transactions:minor,remainingMinor:minor,progressPpm:z.number().int().min(0).max(1000000),totalsByCurrency:z.array(total),
});
const output=z.object({window:windowKind,startsAt:z.string(),endsAt:z.string(),thresholds:z.array(threshold)});

export function merchantTaxThresholdStart(asOf:Date,window:"calendar_year"|"rolling_12_months"){
 const start=new Date(asOf);
 if(window==="calendar_year"){start.setUTCMonth(0,1);start.setUTCHours(0,0,0,0);}
 else start.setUTCFullYear(start.getUTCFullYear()-1);
 return start;
}
export function merchantTaxThresholdProgress(grossSalesMinor:number,thresholdMinor:number){
 if(!Number.isSafeInteger(grossSalesMinor)||grossSalesMinor<0||!Number.isSafeInteger(thresholdMinor)||thresholdMinor<0)throw new ServiceError("validation","Threshold amounts must be exact nonnegative minor units.");
 const progressPpm=thresholdMinor?Number(BigInt(Math.min(grossSalesMinor,thresholdMinor))*1000000n/BigInt(thresholdMinor)):0;
 const state=thresholdMinor===0?"not_configured" as const:grossSalesMinor>=thresholdMinor?"reached" as const:progressPpm>=800000?"approaching" as const:"below" as const;
 return{state,remainingMinor:Math.max(0,thresholdMinor-grossSalesMinor),progressPpm};
}
function exactMinor(value:string){const amount=BigInt(value);if(amount<0n||amount>BigInt(Number.MAX_SAFE_INTEGER))throw new ServiceError("conflict","The original business report exceeds exact supported amounts.");return Number(amount);}
async function report(value:z.output<typeof input>,ctx:ServiceContext,sellerKey:string){
 await lockContactIdentityForRead(ctx.tx);
 const start=merchantTaxThresholdStart(value.asOf,value.window),result={window:value.window,startsAt:start.toISOString(),endsAt:value.asOf.toISOString()};
 const[original]=await ctx.tx.select({profile:merchantTaxProfiles,version:merchantTaxProfileVersions}).from(merchantTaxProfiles)
  .innerJoin(merchantTaxProfileVersions,and(eq(merchantTaxProfileVersions.profileId,merchantTaxProfiles.id),eq(merchantTaxProfileVersions.version,merchantTaxProfiles.currentVersion)))
  .where(eq(merchantTaxProfiles.sellerKey,sellerKey)).limit(1).for("share");
 if(!original||original.profile.state!=="active"||original.version.erasedAt)return{...result,thresholds:[]};
 // Aggregate each original party once. Item gross already includes its item
 // tax; freight is stored net with its separate original tax. Never include
 // another seller's invoice total or invent proportional refund allocations.
 const rows=await ctx.tx.select({zoneId:invoiceMerchantTaxQuotes.zoneId,currency:invoices.currency,
  gross:sql<string>`sum(${invoiceMerchantTaxQuotes.shippingMinor}+${invoiceMerchantTaxQuotes.shippingTaxMinor}+(select coalesce(sum(line.total_minor),0) from invoice_merchant_tax_quote_lines binding join invoice_lines line on line.id=binding.invoice_line_id where binding.quote_id=${invoiceMerchantTaxQuotes.id}))::text`,
  transactions:sql<string>`count(*)::text`,
 }).from(invoiceMerchantTaxQuotes).innerJoin(invoices,eq(invoices.id,invoiceMerchantTaxQuotes.invoiceId)).where(and(
  eq(invoiceMerchantTaxQuotes.profileId,original.profile.id),notInArray(invoices.status,["draft","void"]),gte(invoices.issuedAt,start),lte(invoices.issuedAt,value.asOf),
 )).groupBy(invoiceMerchantTaxQuotes.zoneId,invoices.currency);
 const thresholds:z.infer<typeof threshold>[]=[];
 for(const rule of original.version.rulesSnapshot){
  const totalsByCurrency=rows.filter(row=>row.zoneId===rule.zone.id).map(row=>({currency:row.currency,grossSalesMinor:exactMinor(row.gross),transactions:exactMinor(row.transactions)})).sort((a,b)=>a.currency.localeCompare(b.currency));
  for(const registration of rule.registrations){
   const selected=totalsByCurrency.find(row=>row.currency===registration.thresholdCurrency),grossSalesMinor=selected?.grossSalesMinor??0;
   thresholds.push({zone:{id:rule.zone.id,name:rule.zone.name,country:rule.zone.country},rates:rule.rates.filter(rate=>registration.rateIds.includes(rate.id)).map(rate=>rate.name),registration:{id:registration.id,status:registration.status,thresholdMinor:registration.thresholdMinor,thresholdCurrency:registration.thresholdCurrency},
    grossSalesMinor,transactions:selected?.transactions??0,totalsByCurrency,...merchantTaxThresholdProgress(grossSalesMinor,registration.thresholdMinor)});
  }
 }
 return{...result,thresholds};
}
export const myMerchantTaxThresholds=defineService({name:"members.myMerchantTaxThresholds",summary:"Watch your own business's issued sales against explicitly declared jurisdiction thresholds, separated by currency.",kind:"query",permission:"authenticated",input,output,handler:async(value,ctx)=>{const owner=await memberOwner(ctx);return report(value,ctx,`seller:${owner.userId}`);}});
export const siteMerchantTaxThresholds=defineService({name:"invoicing.siteMerchantTaxThresholds",summary:"Watch only the site's original merchant portions against its explicit business thresholds.",kind:"query",permission:"scoped",input,output,handler:(value,ctx)=>report(value,ctx,"site")});
