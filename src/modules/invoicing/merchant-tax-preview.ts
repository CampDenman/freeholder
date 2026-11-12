// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: quote one explicitly authorized business, never site-wide tax records.
import {and,asc,desc,eq,gte,inArray,isNull,lte,or} from "drizzle-orm";
import {z} from "zod";
import {contacts} from "@/core/contacts/schema";
import {lockContactIdentityForRead} from "@/core/contacts/identity-lock";
import {dataRequests} from "@/core/privacy/schema";
import {defineService,ServiceError} from "@/core/service";
import {taxQuote} from "./contract";
import {taxExemptions} from "./schema";
import {merchantTaxProfiles,merchantTaxProfileVersions} from "./merchant-tax-schema";
import {merchantTaxAddress} from "./merchant-tax-contract";
import {calculateDeclaredMerchantTax} from "./merchant-tax-calculation";
import {calculateInvoiceAmounts} from "./invoice-amounts";
import {merchantTaxDigest} from "./merchant-tax-store";

const minor=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const merchantTaxQuoteItem=z.object({id:z.string().min(1).max(200),quantityMicros:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),unitAmountMinor:minor,discountMinor:minor.default(0),category:z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/).max(80).default("standard"),requiresShipping:z.boolean().default(false)});
export const merchantTaxPreviewInput=z.object({profileId:z.uuid(),profileVersion:z.number().int().positive(),contactId:z.uuid().nullable(),destination:merchantTaxAddress,currency:z.string().regex(/^[A-Z]{3}$/),items:z.array(merchantTaxQuoteItem).min(1).max(1000),shippingMinor:minor.default(0),occurredAt:z.coerce.date().default(()=>new Date())});
const detail=taxQuote.extend({registrationNumbers:z.array(z.object({lineIndex:z.number().int().nonnegative(),number:z.string().nullable()}))});
const amounts=z.object({subtotalMinor:minor,discountMinor:minor,shippingMinor:minor,shippingTaxMinor:minor,taxMinor:minor,totalMinor:minor});
export const merchantTaxPreviewOutput=z.object({sellerUserId:z.uuid().nullable(),profileId:z.uuid(),profileVersion:z.number().int().positive(),liability:z.enum(["platform","seller"]),quote:detail,preDiscountQuote:detail,amounts,quoteDigest:z.string().regex(/^[a-f0-9]{64}$/)});
export const previewMerchantTax=defineService({
 name:"invoicing.previewMerchantTax",summary:"Quote the original declared merchant's pinned business policy before buyer consent.",kind:"query",permission:"system",external:false,
 input:merchantTaxPreviewInput,output:merchantTaxPreviewOutput,
 handler:async(input,ctx)=>{
  await lockContactIdentityForRead(ctx.tx);
  if(new Set(input.items.map(item=>item.id)).size!==input.items.length)throw new ServiceError("validation","Each tax quote item needs a distinct original key.");
  const[found]=await ctx.tx.select({profile:merchantTaxProfiles,version:merchantTaxProfileVersions}).from(merchantTaxProfiles)
   .innerJoin(merchantTaxProfileVersions,and(eq(merchantTaxProfileVersions.profileId,merchantTaxProfiles.id),eq(merchantTaxProfileVersions.version,input.profileVersion)))
   .where(eq(merchantTaxProfiles.id,input.profileId)).limit(1).for("share");
  if(!found||found.profile.state!=="active"||found.profile.currentVersion!==input.profileVersion||found.version.erasedAt)throw new ServiceError("conflict","The accepted merchant tax policy changed or was withdrawn. Review the original business agreement before collecting.");
  const sellerUserId=found.profile.sellerUserId;
  if(found.version.liability!==(sellerUserId===null?"platform":"seller"))throw new ServiceError("conflict","This tax liability needs a different supported merchant policy.");
  if(sellerUserId!==null){
   const[owner]=found.profile.contactId?await ctx.tx.select().from(contacts).where(eq(contacts.id,found.profile.contactId)).limit(1):[];
   if(!owner||owner.source==="privacy-erasure"||owner.userId!==sellerUserId)throw new ServiceError("conflict","The original tax business no longer has verified contact ownership.");
   const[erasure]=await ctx.tx.select({id:dataRequests.id}).from(dataRequests).where(and(eq(dataRequests.contactId,owner.id),eq(dataRequests.kind,"erasure"),inArray(dataRequests.status,["verified","in_progress","completed","partially_completed"]))).limit(1);
   if(erasure)throw new ServiceError("conflict","The original merchant's privacy request prevents new collection.");
  }
  if(input.contactId){const[buyer]=await ctx.tx.select({source:contacts.source}).from(contacts).where(eq(contacts.id,input.contactId)).limit(1);if(!buyer||buyer.source==="privacy-erasure")throw new ServiceError("conflict","The original buyer is no longer available for a new tax quote.");}
  const request={currency:input.currency,pricesIncludeTax:false,origin:merchantTaxAddress.parse(found.version.origin),destination:input.destination,items:input.items,shippingMinor:input.shippingMinor,occurredAt:input.occurredAt.toISOString()};
  const initial=calculateDeclaredMerchantTax(request,found.version);
  const exemptions=input.contactId&&initial.zone?await ctx.tx.select().from(taxExemptions).where(and(eq(taxExemptions.merchantProfileId,input.profileId),eq(taxExemptions.contactId,input.contactId),eq(taxExemptions.zoneId,initial.zone.id),eq(taxExemptions.status,"valid"),lte(taxExemptions.validatedAt,input.occurredAt),or(isNull(taxExemptions.expiresAt),gte(taxExemptions.expiresAt,input.occurredAt)))).orderBy(desc(taxExemptions.validatedAt),asc(taxExemptions.id)).limit(1):[];
  const exemption=exemptions[0];
  const exemptionRule=exemption?{kind:exemption.kind,legend:exemption.kind==="reverse_charge"?"Tax not charged — reverse charge applies.":`Tax not charged — valid ${exemption.kind.replaceAll("_"," ")} exemption.`}:undefined;
  const calculate=(items:typeof input.items)=>{const result=calculateDeclaredMerchantTax({...request,items},found.version,exemptionRule);return{...result,registration:null,exemption:exemption?{id:exemption.id,kind:exemption.kind}:null};};
  const quote=exemption?calculate(input.items):{...initial,registration:null,exemption:null};
  const preDiscountQuote=quote.lines.some(line=>line.inclusive)?calculate(input.items.map(item=>({...item,discountMinor:0}))):quote;
  const calculated=calculateInvoiceAmounts(input.items,input.shippingMinor,quote,preDiscountQuote,input.items.map(item=>item.id));
  const actualAmounts=amounts.parse(calculated);
  // Public consent binds outcomes and customer-supplied location. Private origin,
  // registration numbers, exemption IDs and declaration hashes never leave here.
  const publicQuote=(value:typeof quote)=>({lines:value.lines,exemptionKind:value.exemption?.kind??null});
  const quoteDigest=merchantTaxDigest({version:1,profileId:input.profileId,profileVersion:input.profileVersion,liability:found.version.liability,date:input.occurredAt.toISOString().slice(0,10),currency:input.currency,destination:input.destination,items:input.items,shippingMinor:input.shippingMinor,quote:publicQuote(quote),preDiscountQuote:publicQuote(preDiscountQuote),amounts:actualAmounts});
  return merchantTaxPreviewOutput.parse({sellerUserId,profileId:input.profileId,profileVersion:input.profileVersion,liability:found.version.liability,quote,preDiscountQuote,amounts:actualAmounts,quoteDigest});
 },
});
