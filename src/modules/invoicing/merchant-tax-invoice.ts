// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: only original source services may assign a draft's tax businesses.
import {z} from "zod";
import {ServiceError,type ServiceContext} from "@/core/service";
import {taxQuote} from "./contract";
import type {invoiceLines,invoices} from "./schema";
import {invoiceMerchantTaxQuoteLines,invoiceMerchantTaxQuotes} from "./merchant-tax-schema";
import {merchantTaxAddress} from "./merchant-tax-contract";
import type {merchantTaxPreviewOutput} from "./merchant-tax-preview";
import {merchantTaxQuoteItem,previewMerchantTax} from "./merchant-tax-preview";
import {allowMerchantTaxWrites,merchantTaxDigest} from "./merchant-tax-store";
import {sumMinor} from "./money";
import {merchantTaxConsentDigest} from "./merchant-tax-consent";

const minor=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const merchantTaxSourceRequest=z.object({sourceType:z.string().min(1),sourceId:z.string().optional(),contactId:z.uuid(),currency:z.string().regex(/^[A-Z]{3}$/),
 lines:z.array(z.object({sourceType:z.string().optional(),sourceId:z.string().optional(),quantityMicros:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),unitAmountMinor:minor,discountMinor:minor,taxCategoryCode:z.string(),requiresShipping:z.boolean(),snapshot:z.record(z.string(),z.unknown())})).min(1).max(1000),shippingMinor:minor,destination:merchantTaxAddress,expectedQuoteDigest:z.string().regex(/^[a-f0-9]{64}$/).optional()});
export const merchantTaxSourceParty=z.object({sellerUserId:z.uuid().nullable(),profileId:z.uuid(),profileVersion:z.number().int().positive(),linePositions:z.array(z.number().int().nonnegative()).min(1).max(1000),shippingMinor:minor,expectedQuoteDigest:z.string().regex(/^[a-f0-9]{64}$/).optional(),
 // Only a trusted original-source resolver supplies this date. It is absent
 // from public draft/cart input and must come from actual accepted period facts.
 occurredAt:z.coerce.date().optional()});
type SourceRequest=z.infer<typeof merchantTaxSourceRequest>;
type Party=z.infer<typeof merchantTaxSourceParty>;
type Resolver=(input:SourceRequest,ctx:ServiceContext)=>Promise<Party[]>;
const resolvers=new Map<string,Resolver>();
/** Startup-only hook. The callback composes a real original-source service. */
export function registerMerchantTaxSourceResolver(sourceType:string,resolver:Resolver){resolvers.set(sourceType,resolver);}

export async function prepareMerchantInvoiceTax(input:SourceRequest,ctx:ServiceContext){
 const request=merchantTaxSourceRequest.parse(input),resolver=resolvers.get(request.sourceType);
 if(!resolver)throw new ServiceError("conflict","This commercial source has no original merchant tax ownership resolver.");
 const parties=merchantTaxSourceParty.array().min(1).max(request.lines.length).parse(await resolver(request,ctx));
 const seen=new Set<number>(),owners=new Set<string>();
 for(const party of parties){
  const key=party.sellerUserId===null?"site":`seller:${party.sellerUserId}`;
  if(owners.has(key))throw new ServiceError("conflict","The original invoice has duplicate tax business portions.");owners.add(key);
  for(const position of party.linePositions){if(position>=request.lines.length||seen.has(position))throw new ServiceError("conflict","Each original invoice line needs exactly one tax business.");seen.add(position);}
  if(party.shippingMinor>0&&!party.linePositions.some(position=>request.lines[position]!.requiresShipping))throw new ServiceError("conflict","Original freight has no physical line owned by this business.");
 }
 if(seen.size!==request.lines.length||sumMinor(parties.map(party=>party.shippingMinor),"Original merchant freight")!==request.shippingMinor)throw new ServiceError("conflict","Original merchant tax portions do not cover the complete invoice.");
 const occurredAt=new Date(),prepared:Array<{party:Party;result:z.infer<typeof merchantTaxPreviewOutput>}>=[];
 for(const party of [...parties].sort((a,b)=>(a.sellerUserId??"").localeCompare(b.sellerUserId??""))){
  const positions=[...party.linePositions].sort((a,b)=>a-b);
  const items=positions.map(position=>{const line=request.lines[position]!;return merchantTaxQuoteItem.parse({id:`line:${position}`,quantityMicros:line.quantityMicros,unitAmountMinor:line.unitAmountMinor,discountMinor:line.discountMinor,category:line.taxCategoryCode,requiresShipping:line.requiresShipping});});
  const result=await ctx.callAsSystem(previewMerchantTax,{profileId:party.profileId,profileVersion:party.profileVersion,contactId:request.contactId,destination:request.destination,currency:request.currency,items,shippingMinor:party.shippingMinor,occurredAt:party.occurredAt??occurredAt});
  if(result.sellerUserId!==party.sellerUserId)throw new ServiceError("conflict","The tax profile does not belong to the original commercial source's business.");
  if(party.expectedQuoteDigest&&party.expectedQuoteDigest!==result.quoteDigest)throw new ServiceError("conflict","The buyer's accepted tax quote changed. Review the current original business quote before paying.");
  prepared.push({party:{...party,linePositions:positions},result});
 }
 const combine=(before:boolean)=>{
  const values=prepared.map(row=>before?row.result.preDiscountQuote:row.result.quote);
  const lines=values.flatMap(value=>value.lines),registrationNumbers:Array<{lineIndex:number;number:string|null}>=[],lineExemptions:Array<{lineIndex:number;kind:string}>=[];
  let offset=0;for(const value of values){for(const row of value.registrationNumbers)registrationNumbers.push({lineIndex:row.lineIndex+offset,number:row.number});if(value.exemption)for(let index=0;index<value.lines.length;index++)lineExemptions.push({lineIndex:offset+index,kind:value.exemption.kind});offset+=value.lines.length;}
  return{...taxQuote.parse({provider:"merchant_declared",currency:request.currency,lines,totalTaxMinor:sumMinor(values.map(value=>value.totalTaxMinor),"Merchant tax"),includedTaxMinor:sumMinor(values.map(value=>value.includedTaxMinor),"Included merchant tax"),explanation:values.flatMap(value=>value.explanation),zone:values.length===1?values[0]!.zone:null,registration:null,exemption:values.length===1?values[0]!.exemption:null}),registrationNumbers,lineExemptions};
 };
 const quoteDigest=merchantTaxConsentDigest(prepared.map(row=>({sellerUserId:row.party.sellerUserId,quoteDigest:row.result.quoteDigest})));
 if(request.expectedQuoteDigest&&request.expectedQuoteDigest!==quoteDigest)throw new ServiceError("conflict","The original accepted tax quote changed. Review and accept the complete quote again.");
 return{request,prepared,quote:combine(false),preDiscountQuote:combine(true),quoteDigest};
}

export async function freezeMerchantInvoiceTax(plan:Awaited<ReturnType<typeof prepareMerchantInvoiceTax>>,invoice:typeof invoices.$inferSelect,lines:readonly typeof invoiceLines.$inferSelect[],ctx:ServiceContext){
 if(invoice.status!=="draft"||invoice.contactId!==plan.request.contactId||invoice.currency!==plan.request.currency||lines.length!==plan.request.lines.length)throw new ServiceError("conflict","The original merchant tax quote cannot be attached to a different invoice.");
 const byPosition=new Map(lines.map(line=>[line.position,line]));
 if(byPosition.size!==lines.length||lines.some(line=>line.invoiceId!==invoice.id))throw new ServiceError("conflict","The original invoice tax lines are incomplete.");
 if(sumMinor(plan.prepared.map(row=>row.result.amounts.totalMinor),"Merchant invoice totals")!==invoice.totalMinor)throw new ServiceError("conflict","The original tax business quotes do not conserve the customer's invoice.");
 await allowMerchantTaxWrites(ctx.tx);
 for(const {party,result}of plan.prepared){
  const owned=party.linePositions.map(position=>{const line=byPosition.get(position);if(!line)throw new ServiceError("conflict","The original business has no matching invoice line.");return line;});
  if(sumMinor(owned.map(line=>line.taxMinor),"Original business item tax")+result.amounts.shippingTaxMinor!==result.amounts.taxMinor)throw new ServiceError("conflict","The original business's invoice tax does not match its quote.");
  const evidenceDigest=merchantTaxDigest({version:1,quoteDigest:result.quoteDigest,invoiceId:invoice.id,contactId:invoice.contactId,sourceType:invoice.sourceType,sourceId:invoice.sourceId,sellerUserId:party.sellerUserId,lines:owned.map(line=>({id:line.id,position:line.position,sourceType:line.sourceType,sourceId:line.sourceId,quantityMicros:line.quantityMicros,unitAmountMinor:line.unitAmountMinor,subtotalMinor:line.subtotalMinor,discountMinor:line.discountMinor,taxMinor:line.taxMinor,totalMinor:line.totalMinor})),amounts:result.amounts});
  const[quote]=await ctx.tx.insert(invoiceMerchantTaxQuotes).values({invoiceId:invoice.id,sellerUserId:party.sellerUserId,sellerKey:party.sellerUserId===null?"site":`seller:${party.sellerUserId}`,profileId:party.profileId,profileVersion:party.profileVersion,liability:result.liability,evidenceDigest,occurredAt:result.occurredAt,shippingMinor:result.amounts.shippingMinor,shippingTaxMinor:result.amounts.shippingTaxMinor,taxMinor:result.amounts.taxMinor}).returning({id:invoiceMerchantTaxQuotes.id});
  await ctx.tx.insert(invoiceMerchantTaxQuoteLines).values(owned.map(line=>({invoiceLineId:line.id,quoteId:quote!.id})));
 }
}
