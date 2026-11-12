// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: real authorized cart preview, using the same tax/consent arithmetic.
import {and,eq,inArray} from "drizzle-orm";
import {z} from "zod";
import {contacts} from "@/core/contacts/schema";
import {publicMerchantSupport} from "@/core/commerce/merchant-identity";
import {defineService,getService,permits,ServiceError,type ServiceContext} from "@/core/service";
import {merchantTaxAddress} from "@/modules/invoicing/merchant-tax-contract";
import {currentMerchantTaxProfile,merchantTaxBusinessIdentity} from "@/modules/invoicing/merchant-tax";
import {previewMerchantTax} from "@/modules/invoicing/merchant-tax-preview";
import {allocateMerchantGrossFreight} from "@/modules/invoicing/merchant-tax-freight";
import {merchantTaxConsentDigest} from "@/modules/invoicing/merchant-tax-consent";
import {sumMinor} from "@/modules/invoicing/money";
import {taxCategories} from "@/modules/invoicing/schema";
import {getCart} from "./cart";
import {requireCartAccess} from "./cart-access";
import {productVariants,products} from "./schema";
import {quoteShipping} from "./shipping";
import {resolveCartPromotions} from "./promotions";
import {allocateDiscount} from "./promo-quote";
import {currentOrderCommercialTerms,orderCommercialConsentDigest} from "./order-commercial-consent";
const minor=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const amounts=z.object({subtotalMinor:minor,discountMinor:minor,shippingMinor:minor,taxMinor:minor,totalMinor:minor});
const publicQuoteInput=z.object({cartId:z.uuid(),cartToken:z.uuid().optional(),email:z.string().trim().email().toLowerCase().max(320).optional(),shippingAddress:merchantTaxAddress.optional(),taxDestination:merchantTaxAddress.optional(),shippingMethodId:z.uuid().optional(),locationId:z.uuid().optional(),couponCode:z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{2,31}$/).optional()});
const quoteOutput=z.object({currency:z.string(),taxQuoteDigest:z.string().regex(/^[a-f0-9]{64}$/),commercialQuoteDigest:z.string().regex(/^[a-f0-9]{64}$/),collectionKind:z.enum(["direct","destination"]),amounts,parties:z.array(z.object({sellerUserId:z.uuid().nullable(),merchantName:z.string().min(1).max(200),merchantSupport:publicMerchantSupport,liability:z.enum(["platform","seller"]),pricesIncludeTax:z.boolean(),amounts}))}).nullable();
const preparedQuoteInput=publicQuoteInput.omit({email:true}).extend({contactId:z.uuid().nullable()});

async function quoteForBuyer(input:z.infer<typeof preparedQuoteInput>,ctx:ServiceContext){
  const basket=await ctx.callAsSystem(getCart,{cartId:input.cartId});
  if(basket.cart.status!=="open"||basket.cart.kind!=="cart")throw new ServiceError("conflict","Review an open cart before accepting a merchant quote.");
  if(!basket.lines.length||!basket.allPriced||!basket.allAvailable)throw new ServiceError("conflict","Every original cart item needs its current price and availability before quoting.");
  const original=await ctx.tx.select({variantId:productVariants.id,sellerUserId:products.sellerUserId,taxCategoryId:products.taxCategoryId,requiresShipping:productVariants.requiresShipping}).from(productVariants).innerJoin(products,eq(products.id,productVariants.productId)).where(inArray(productVariants.id,basket.lines.map(line=>line.variantId))).orderBy(productVariants.id).for("share");
  if(original.length!==new Set(basket.lines.map(line=>line.variantId)).size||basket.lines.some(line=>original.find(row=>row.variantId===line.variantId)?.requiresShipping!==line.requiresShipping))throw new ServiceError("conflict","The original cart ownership or shipping terms changed. Refresh the quote.");
  if(!original.some(row=>row.sellerUserId!==null))return null;
  const resolver=getService("members.resolveCartCommercialTerms");
  if(!resolver)throw new ServiceError("conflict","Member merchant quotes are unavailable in this build.");
  const commercial=currentOrderCommercialTerms.parse(await ctx.callAsSystem(resolver,{cartId:input.cartId}));
  if(commercial.model!=="seller_merchant")return null;
  if(!commercial.collectionKind||!commercial.providerPlatformAccountId||commercial.adapter!=="stripe_connect")throw new ServiceError("conflict","Verify the original merchant platform before accepting this quote.");
  const physical=basket.lines.some(line=>line.requiresShipping),destination=physical?input.shippingAddress:input.taxDestination;
  if(!destination)throw new ServiceError("validation",physical?"Declare the actual shipping destination before reviewing merchant tax.":"Declare the buyer's actual billing country before reviewing merchant tax.");
  let shippingMinor=0;
  if(physical){
   const shipping=await ctx.call(quoteShipping,{country:destination.country,region:destination.region,postal:destination.postalCode,currency:basket.cart.currency,locationId:input.locationId,items:basket.lines.map(line=>({quantity:line.quantity,weightG:line.weightG??0,priceMinor:line.unitAmountMinor!,lengthMm:line.lengthMm??undefined,widthMm:line.widthMm??undefined,heightMm:line.heightMm??undefined,requiresShipping:line.requiresShipping}))});
   if(shipping.needed&&!input.shippingMethodId&&shipping.quotes.length>1)throw new ServiceError("validation","Choose the original shipping method before accepting this quote.");
   const selected=input.shippingMethodId?shipping.quotes.find(row=>row.methodId===input.shippingMethodId):shipping.quotes[0];
   if(shipping.needed&&!selected)throw new ServiceError("validation","No selected shipping method reaches that destination.");
   shippingMinor=selected?.amountMinor??0;
  }
  const promotions=await ctx.call(resolveCartPromotions,{cartId:input.cartId,cartToken:input.cartToken,couponCode:input.couponCode,subtotalMinor:basket.subtotalMinor,shippingMinor,currency:basket.cart.currency});
  shippingMinor=promotions.shippingMinor;
  const discounts=allocateDiscount(basket.lines.map(line=>line.lineTotalMinor!),promotions.discountMinor);
  const categoryIds=[...new Set(original.flatMap(row=>row.taxCategoryId?[row.taxCategoryId]:[]))];
  const categories=categoryIds.length?await ctx.tx.select({id:taxCategories.id,code:taxCategories.code}).from(taxCategories).where(inArray(taxCategories.id,categoryIds)).orderBy(taxCategories.id).for("share"):[];
  const items=basket.lines.map((line,position)=>{const owner=original.find(row=>row.variantId===line.variantId)!;const category=owner.taxCategoryId?categories.find(row=>row.id===owner.taxCategoryId)?.code:"standard";if(!category)throw new ServiceError("conflict","The original product tax category is unavailable.");return{id:`line:${position}`,sellerUserId:owner.sellerUserId,quantityMicros:line.quantity*1000000,unitAmountMinor:line.unitAmountMinor!,discountMinor:discounts[position]??0,category,requiresShipping:line.requiresShipping};});
  const contactId=input.contactId;
  const freight=allocateMerchantGrossFreight(items,shippingMinor),results:Array<{sellerUserId:string|null;merchantName:string;merchantSupport:z.infer<typeof publicMerchantSupport>;liability:"platform"|"seller";pricesIncludeTax:boolean;amounts:z.infer<typeof amounts>;quoteDigest:string}>=[],occurredAt=new Date();
  for(const portion of freight){
   const profile=await ctx.callAsSystem(currentMerchantTaxProfile,{sellerUserId:portion.sellerUserId});
   const identity=portion.sellerUserId===null?await ctx.callAsSystem(merchantTaxBusinessIdentity,profile):commercial.sellers.find(row=>row.sellerUserId===portion.sellerUserId);
   if(!identity?.merchantName||!identity.merchantSupport)throw new ServiceError("conflict","Every original seller needs a verified public business identity.");
   const quoted=await ctx.callAsSystem(previewMerchantTax,{...profile,contactId,destination,currency:basket.cart.currency,items:portion.linePositions.map(position=>items[position]!),shippingMinor:portion.shippingMinor,occurredAt});
   results.push({sellerUserId:portion.sellerUserId,merchantName:identity.merchantName,merchantSupport:identity.merchantSupport,liability:quoted.liability,pricesIncludeTax:quoted.quote.lines.some(line=>line.inclusive),amounts:amounts.parse(quoted.amounts),quoteDigest:quoted.quoteDigest});
  }
  const total=amounts.parse(Object.fromEntries(["subtotalMinor","discountMinor","shippingMinor","taxMinor","totalMinor"].map(key=>[key,sumMinor(results.map(row=>row.amounts[key as keyof z.infer<typeof amounts>]),"Merchant quote amount")])));
  return{currency:basket.cart.currency,taxQuoteDigest:merchantTaxConsentDigest(results),commercialQuoteDigest:orderCommercialConsentDigest(commercial),collectionKind:commercial.collectionKind,amounts:total,parties:results.map(({quoteDigest:_privateQuote,...publicParty})=>publicParty)};
}

export const quoteMerchantCheckout=defineService({
 name:"catalog.quoteMerchantCheckout",summary:"Review actual merchant business identities and exact taxes before accepting this authorized cart.",kind:"query",permission:"public",
 input:publicQuoteInput,output:quoteOutput,
 handler:async(input,ctx)=>{
  await requireCartAccess(ctx,input,"catalog.quoteMerchantCheckout","query");
  // A cart token is not authority over the email holder's exemption records.
  let contactId:string|null=null;
  if(input.email&&ctx.actor.kind==="user"){const[person]=await ctx.tx.select({id:contacts.id,source:contacts.source}).from(contacts).where(and(eq(contacts.userId,ctx.actor.userId),eq(contacts.email,input.email))).limit(1);if(person&&person.source!=="privacy-erasure")contactId=person.id;}
  if(!contactId&&input.email&&permits(ctx.actor,"scoped","catalog.quoteMerchantCheckout","query")){const[person]=await ctx.tx.select({id:contacts.id,source:contacts.source}).from(contacts).where(eq(contacts.email,input.email)).limit(1);if(person&&person.source!=="privacy-erasure")contactId=person.id;}
  return quoteForBuyer({...input,contactId},ctx);
 },
});

export const quoteMerchantCheckoutForBuyer=defineService({
 name:"catalog.quoteMerchantCheckoutForBuyer",summary:"Quote a cart and buyer whose authority the actual checkout parent has already established.",kind:"query",permission:"system",external:false,
 input:preparedQuoteInput,output:quoteOutput,handler:quoteForBuyer,
});
