// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: original order terms and tax parties precede invoice calculations.
import {asc,eq,sql} from "drizzle-orm";
import {z} from "zod";
import {publicMerchantSupport} from "@/core/commerce/merchant-identity";
import {defineService,getService,ServiceError} from "@/core/service";
import {currentMerchantTaxProfile,merchantTaxBusinessIdentity} from "@/modules/invoicing/merchant-tax";
import {merchantTaxAddress} from "@/modules/invoicing/merchant-tax-contract";
import {allocateMerchantGrossFreight} from "@/modules/invoicing/merchant-tax-freight";
import {merchantTaxDigest} from "@/modules/invoicing/merchant-tax-store";
import {merchantTaxSourceRequest,registerMerchantTaxSourceResolver} from "@/modules/invoicing/merchant-tax-invoice";
import {orders,orderItems} from "./schema";
import {orderCommercialPolicies,orderCommercialParties,orderCommercialLines} from "./order-commercial-schema";
import "./order-commercial-privacy";
import {currentOrderCommercialTerms as terms,orderCommercialConsentDigest} from "./order-commercial-consent";

const original=z.object({sellerUserId:z.uuid().nullable(),requiresShipping:z.boolean(),linePosition:z.number().int().nonnegative(),invoiceDiscountMinor:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),taxCategoryCode:z.string()});
const party=z.object({sellerUserId:z.uuid().nullable(),merchantContactId:z.uuid().nullable(),merchantName:z.string(),merchantSupport:publicMerchantSupport.nullable(),recipientAccountId:z.string().nullable(),profileId:z.uuid(),profileVersion:z.number().int().positive(),liability:z.enum(["platform","seller"]),linePositions:z.array(z.number().int().nonnegative()),shippingMinor:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)});
export const orderCommercialTerms=defineService({
 name:"catalog.orderCommercialTerms",summary:"Read the original commercial policy captured before this order's draft invoice.",kind:"query",permission:"system",external:false,
 input:z.object({orderId:z.uuid()}),output:terms.omit({sellers:true}).extend({parties:z.array(party),acceptedQuoteDigest:z.string().nullable(),acceptedCommercialDigest:z.string().nullable(),taxDestination:merchantTaxAddress.nullable()}).nullable(),
 handler:async({orderId},ctx)=>{
  const[policy]=await ctx.tx.select().from(orderCommercialPolicies).where(eq(orderCommercialPolicies.orderId,orderId)).limit(1).for("share");
  if(!policy)return null;
  if(policy.buyerErasedAt)throw new ServiceError("conflict","This original order's buyer tax evidence was erased and cannot authorize new collection.");
  const parties=await ctx.tx.select().from(orderCommercialParties).where(eq(orderCommercialParties.orderId,orderId)).orderBy(asc(orderCommercialParties.sellerKey)).for("share");
  const lines=await ctx.tx.select({partyId:orderCommercialLines.partyId,position:orderCommercialLines.position}).from(orderCommercialLines).innerJoin(orderCommercialParties,eq(orderCommercialParties.id,orderCommercialLines.partyId)).where(eq(orderCommercialParties.orderId,orderId)).orderBy(asc(orderCommercialLines.position));
  if(parties.some(row=>row.merchantErasedAt))throw new ServiceError("conflict","The original merchant's erased identity cannot authorize a new collection.");
  return{...policy,parties:parties.map(row=>({...row,linePositions:lines.filter(line=>line.partyId===row.id).map(line=>line.position)}))};
 },
});
export const captureOrderCommercialTerms=defineService({
 name:"catalog.captureOrderCommercialTerms",summary:"Freeze a new member order's actual original settings, merchant and tax authority before drafting.",kind:"mutation",permission:"system",external:false,
 auditInputFields:["orderId"],
 input:z.object({orderId:z.uuid(),destination:merchantTaxAddress.optional(),quoteDigest:z.string().regex(/^[a-f0-9]{64}$/).optional(),commercialDigest:z.string().regex(/^[a-f0-9]{64}$/).optional()}),output:z.object({captured:z.boolean(),merchantTax:z.boolean()}),
 handler:async(input,ctx)=>{
  const[order]=await ctx.tx.select().from(orders).where(eq(orders.id,input.orderId)).limit(1).for("update");
  if(!order||order.commercialEpoch!==1||order.invoiceId)throw new ServiceError("conflict","Only a new unbilled order can capture original commercial terms.");
  const[existing]=await ctx.tx.select().from(orderCommercialPolicies).where(eq(orderCommercialPolicies.orderId,order.id)).limit(1);
  if(existing)return{captured:true,merchantTax:existing.model==="seller_merchant"};
  const items=await ctx.tx.select().from(orderItems).where(eq(orderItems.orderId,order.id)).for("share");
  const owned=items.map(row=>({row,original:original.parse(row.snapshot)})).sort((a,b)=>a.original.linePosition-b.original.linePosition);
  if(!owned.length||owned.some((row,index)=>row.original.linePosition!==index))throw new ServiceError("conflict","The new order has no complete original line position witness.");
  if(!owned.some(row=>row.original.sellerUserId!==null))return{captured:false,merchantTax:false};
  const resolve=getService("members.resolveOrderCommercialTerms");
  if(!resolve)throw new ServiceError("conflict","Original member commercial policy is unavailable.");
  const current=terms.parse(await ctx.callAsSystem(resolve,{orderId:order.id}));
  if(current.model==="seller_merchant"&&(!input.destination||!input.quoteDigest||!current.collectionKind||!current.providerPlatformAccountId||current.adapter!=="stripe_connect"||input.commercialDigest!==orderCommercialConsentDigest(current)))throw new ServiceError("conflict","Review and accept the complete original merchant business and tax quote before this order is created.");
  await ctx.tx.execute(sql`select set_config('freeholder.order_commercial_writes_v1','1',true)`);
  await ctx.tx.insert(orderCommercialPolicies).values({orderId:order.id,model:current.model,adapter:current.adapter,siteFeeBps:current.siteFeeBps,holdDays:current.holdDays,collectionKind:current.collectionKind,providerPlatformAccountId:current.providerPlatformAccountId,taxDestination:current.model==="seller_merchant"?input.destination:null,acceptedQuoteDigest:current.model==="seller_merchant"?input.quoteDigest:null,acceptedCommercialDigest:current.model==="seller_merchant"?input.commercialDigest:null});
  if(current.model!=="seller_merchant")return{captured:true,merchantTax:false};
  const freight=allocateMerchantGrossFreight(owned.map(({row,original:receipt})=>({sellerUserId:receipt.sellerUserId,requiresShipping:receipt.requiresShipping,quantityMicros:row.quantity*1000000,unitAmountMinor:row.unitAmountMinor,discountMinor:receipt.invoiceDiscountMinor})),order.shippingMinor);
  for(const portion of freight){
   const profile=await ctx.callAsSystem(currentMerchantTaxProfile,{sellerUserId:portion.sellerUserId});
   const business=portion.sellerUserId===null?{...await ctx.callAsSystem(merchantTaxBusinessIdentity,profile),merchantContactId:null,recipientAccountId:null}:current.sellers.find(seller=>seller.sellerUserId===portion.sellerUserId);
   if(!business)throw new ServiceError("conflict","An original member seller has no verified commercial business receipt.");
   const identity=z.object({merchantName:z.string().min(1).max(200),merchantSupport:publicMerchantSupport,merchantContactId:z.uuid().nullable(),recipientAccountId:z.string().min(1).nullable()}).parse(business);
   if(portion.sellerUserId!==null&&(!identity.merchantContactId||!identity.recipientAccountId)||portion.sellerUserId===null&&(identity.merchantContactId!==null||identity.recipientAccountId!==null))throw new ServiceError("conflict","The original merchant needs its exact verified contact and collection recipient.");
   const[inserted]=await ctx.tx.insert(orderCommercialParties).values({orderId:order.id,sellerUserId:portion.sellerUserId,sellerKey:portion.sellerUserId===null?"site":`seller:${portion.sellerUserId}`,merchantContactId:identity.merchantContactId,merchantName:identity.merchantName,merchantSupport:identity.merchantSupport,recipientAccountId:identity.recipientAccountId,profileId:profile.profileId,profileVersion:profile.profileVersion,liability:profile.liability,shippingMinor:portion.shippingMinor}).returning({id:orderCommercialParties.id});
   await ctx.tx.insert(orderCommercialLines).values(portion.linePositions.map(position=>({orderItemId:owned[position]!.row.id,partyId:inserted!.id,position})));
  }
  ctx.setSubject("order",order.id);return{captured:true,merchantTax:true};
 },
});
export const orderMerchantTaxSource=defineService({
 name:"catalog.orderMerchantTaxSource",summary:"Prove every original order amount and party before merchant invoice tax is calculated.",kind:"query",permission:"system",external:false,
 input:merchantTaxSourceRequest,output:z.array(party.omit({merchantContactId:true,merchantName:true,merchantSupport:true,recipientAccountId:true})),
 handler:async(input,ctx)=>{
  if(input.sourceType!=="order"||!input.sourceId)throw new ServiceError("conflict","This tax source must identify its original order.");
  const[order]=await ctx.tx.select().from(orders).where(eq(orders.id,input.sourceId)).limit(1).for("share");
  const commercial=await ctx.callAsSystem(orderCommercialTerms,{orderId:input.sourceId});
  if(!order||order.commercialEpoch!==1||order.invoiceId||order.contactId!==input.contactId||order.currency!==input.currency||order.shippingMinor!==input.shippingMinor||commercial?.model!=="seller_merchant"||!commercial.taxDestination||merchantTaxDigest(commercial.taxDestination)!==merchantTaxDigest(input.destination)||input.expectedQuoteDigest!==commercial.acceptedQuoteDigest)throw new ServiceError("conflict","This quote does not match the original accepted order business, buyer or destination.");
  const lines=await ctx.tx.select({item:orderItems,line:orderCommercialLines}).from(orderCommercialLines).innerJoin(orderItems,eq(orderItems.id,orderCommercialLines.orderItemId)).innerJoin(orderCommercialParties,eq(orderCommercialParties.id,orderCommercialLines.partyId)).where(eq(orderCommercialParties.orderId,order.id)).orderBy(asc(orderCommercialLines.position));
  if(lines.length!==input.lines.length||lines.some(({item,line},position)=>{const receipt=original.parse(item.snapshot),given=input.lines[position]!;return line.position!==position||receipt.linePosition!==position||given.sourceType!=="variant"||given.sourceId!==item.variantId||given.quantityMicros!==item.quantity*1000000||given.unitAmountMinor!==item.unitAmountMinor||given.discountMinor!==receipt.invoiceDiscountMinor||given.requiresShipping!==receipt.requiresShipping||given.taxCategoryCode!==receipt.taxCategoryCode;}))throw new ServiceError("conflict","The original order's tax items changed before its invoice was drafted.");
  return commercial.parties;
 },
});
registerMerchantTaxSourceResolver("order",(input,ctx)=>ctx.callAsSystem(orderMerchantTaxSource,input));
export default [orderCommercialTerms,captureOrderCommercialTerms,orderMerchantTaxSource];
