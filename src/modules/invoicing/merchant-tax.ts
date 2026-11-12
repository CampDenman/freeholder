// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: read immutable original tax authority; never infer it from a route.
import {and,asc,eq} from "drizzle-orm";
import {z} from "zod";
import {publicMerchantSupport} from "@/core/commerce/merchant-identity";
import {contacts} from "@/core/contacts/schema";
import {lockContactIdentityForRead} from "@/core/contacts/identity-lock";
import {defineService,ServiceError} from "@/core/service";
import {invoiceMerchantTaxQuotes,merchantTaxProfiles,merchantTaxProfileVersions} from "./merchant-tax-schema";
import {merchantTaxPolicyReceipt} from "./merchant-tax-contract";
import {assertMerchantTaxRevisionSafe} from "@/modules/subscriptions/merchant-tax-revision";
export {merchantTaxPolicyReceipt} from "./merchant-tax-contract";

const party=z.object({sellerUserId:z.uuid().nullable()});
const invoiceParty=party.extend({invoiceId:z.uuid()});
const freight=z.object({sellerUserId:z.uuid().nullable(),shippingMinor:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),shippingTaxMinor:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)});
const key=(id:string|null)=>id===null?"site":`seller:${id}`;

export const currentMerchantTaxProfile=defineService({
 name:"invoicing.currentMerchantTaxProfile",summary:"Read the deliberately configured current tax business for a new commercial agreement.",
 kind:"query",permission:"system",external:false,input:party,
 output:merchantTaxPolicyReceipt.omit({evidenceDigest:true}),
 handler:async({sellerUserId},ctx)=>{
  await lockContactIdentityForRead(ctx.tx);
  const[found]=await ctx.tx.select({profile:merchantTaxProfiles,version:merchantTaxProfileVersions})
   .from(merchantTaxProfiles).innerJoin(merchantTaxProfileVersions,and(eq(merchantTaxProfileVersions.profileId,merchantTaxProfiles.id),eq(merchantTaxProfileVersions.version,merchantTaxProfiles.currentVersion)))
   .where(eq(merchantTaxProfiles.sellerKey,key(sellerUserId))).limit(1).for("share");
  if(!found||found.profile.state!=="active"||found.version.erasedAt||found.profile.sellerUserId!==sellerUserId)throw new ServiceError("conflict","This merchant needs an explicit tax profile before a new agreement can be accepted.");
  if(sellerUserId!==null){
   const[owner]=found.profile.contactId?await ctx.tx.select({source:contacts.source,userId:contacts.userId}).from(contacts).where(eq(contacts.id,found.profile.contactId)).limit(1):[];
   if(!owner||owner.source==="privacy-erasure"||owner.userId!==sellerUserId)throw new ServiceError("conflict","The original merchant tax business no longer has verified contact ownership.");
  }
  if(found.version.liability!==(sellerUserId===null?"platform":"seller"))throw new ServiceError("conflict","This declared tax liability requires a different supported collection policy.");
  return{profileId:found.profile.id,profileVersion:found.version.version,liability:found.version.liability};
 },
});

export const getInvoiceMerchantTaxReceipt=defineService({
 name:"invoicing.getInvoiceMerchantTaxReceipt",summary:"Read the exact original per-merchant tax policy frozen on an invoice.",
 kind:"query",permission:"system",external:false,input:invoiceParty,output:merchantTaxPolicyReceipt,
 handler:async({invoiceId,sellerUserId},ctx)=>{
  const[found]=await ctx.tx.select().from(invoiceMerchantTaxQuotes).where(and(eq(invoiceMerchantTaxQuotes.invoiceId,invoiceId),eq(invoiceMerchantTaxQuotes.sellerKey,key(sellerUserId)))).limit(1);
  if(!found||found.sellerUserId!==sellerUserId)throw new ServiceError("conflict","This invoice has no complete original merchant tax receipt.");
  return{liability:found.liability,profileId:found.profileId,profileVersion:found.profileVersion,evidenceDigest:found.evidenceDigest};
 },
});

export const getInvoiceMerchantFreightReceipts=defineService({
 name:"invoicing.getInvoiceMerchantFreightReceipts",summary:"Read all frozen original merchant freight and shipping-tax amounts, if quoted.",
 kind:"query",permission:"system",external:false,input:z.object({invoiceId:z.uuid()}),output:z.array(freight).nullable(),
 handler:async({invoiceId},ctx)=>{
  const rows=await ctx.tx.select({sellerUserId:invoiceMerchantTaxQuotes.sellerUserId,shippingMinor:invoiceMerchantTaxQuotes.shippingMinor,shippingTaxMinor:invoiceMerchantTaxQuotes.shippingTaxMinor}).from(invoiceMerchantTaxQuotes).where(eq(invoiceMerchantTaxQuotes.invoiceId,invoiceId)).orderBy(asc(invoiceMerchantTaxQuotes.sellerKey));
  // NULL keeps existing platform/legacy invoice arithmetic unchanged. A NEW
  // merchant collection must separately require every original tax receipt.
  return rows.length?rows:null;
 },
});

export const getInvoiceSiteMerchantIdentity=defineService({
 name:"invoicing.getInvoiceSiteMerchantIdentity",summary:"Read the site business identity deliberately frozen on this invoice's tax profile.",
 kind:"query",permission:"system",external:false,input:z.object({invoiceId:z.uuid()}),
 output:z.object({merchantName:z.string().min(1).max(200),merchantSupport:publicMerchantSupport}),
 handler:async({invoiceId},ctx)=>{
  const[found]=await ctx.tx.select({quote:invoiceMerchantTaxQuotes,version:merchantTaxProfileVersions}).from(invoiceMerchantTaxQuotes)
   .innerJoin(merchantTaxProfileVersions,and(eq(merchantTaxProfileVersions.profileId,invoiceMerchantTaxQuotes.profileId),eq(merchantTaxProfileVersions.version,invoiceMerchantTaxQuotes.profileVersion)))
   .where(and(eq(invoiceMerchantTaxQuotes.invoiceId,invoiceId),eq(invoiceMerchantTaxQuotes.sellerKey,"site"))).limit(1);
  if(!found||found.quote.liability!=="platform"||found.version.liability!=="platform"||found.version.erasedAt||!found.version.merchantName||!found.version.merchantSupport)throw new ServiceError("conflict","This invoice needs its original declared site business identity; current branding cannot supply it.");
  return{merchantName:found.version.merchantName,merchantSupport:found.version.merchantSupport};
 },
});

// Register the external-schedule guard with invoicing even if subscriptions is off.
export default [currentMerchantTaxProfile,getInvoiceMerchantTaxReceipt,getInvoiceMerchantFreightReceipts,getInvoiceSiteMerchantIdentity,assertMerchantTaxRevisionSafe];
