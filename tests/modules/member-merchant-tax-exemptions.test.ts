// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C5.03: actual cart, customer, merchant review and invoice services.
import {randomUUID} from "node:crypto";
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {eq} from "drizzle-orm";
import {db} from "@/core/db";
import {users} from "@/core/auth/schema";
import {contacts} from "@/core/contacts/schema";
import {resolveContact} from "@/core/contacts/service";
import {ready} from "@/core/runtime";
import {checkoutCart} from "@/modules/catalog/orders";
import {quoteMerchantCheckout} from "@/modules/catalog/merchant-checkout-quote";
import {cartMerchantTaxBusinesses,myMerchantTaxExemptions,requestMerchantTaxExemption,reviewMemberMerchantTaxExemption,memberMerchantTaxExemptions,withdrawMerchantTaxExemption} from "@/modules/invoicing/merchant-tax-exemptions";
import {taxExemptions,taxLines,invoices} from "@/modules/invoicing/schema";
import {previewMerchantTax} from "@/modules/invoicing/merchant-tax-preview";
import {ANONYMOUS,closeDb,CUSTOMER,failure,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";
import {seedMerchantCheckout80,MERCHANT_FIXTURE_BUYER_EMAIL,MERCHANT_FIXTURE_DESTINATION} from "../helpers/merchant-checkout80";

const BUYER={...CUSTOMER,userId:"00000000-0000-4000-8000-0000000000c3"};
const OTHER_BUYER={...CUSTOMER,userId:"00000000-0000-4000-8000-0000000000c4"};
const QUOTE_KEY={kind:"agent" as const,keyName:"public-tax-quote-only",scopes:["catalog.quoteMerchantCheckout"]};
const certificate="SYNTHETIC-CUSTOMER-VAT-EVIDENCE";
describe.runIf(hasDatabase)("customer merchant tax request authority (C12.38)",()=>{
 let cleanup:(()=>void)|undefined;
 beforeAll(ready,60000);beforeEach(truncateSpine);
 afterEach(()=>{cleanup?.();cleanup=undefined;vi.restoreAllMocks();});afterAll(closeDb);
 async function setup(count:1|2=1){
  const value=await seedMerchantCheckout80(count===2?"destination":"direct",count);cleanup=value.cleanup;
  // Explicit login fixture. The handlers still resolve the actual user's
  // unified contact; no email-supplied customer or handler context is forged.
  await db().insert(users).values({id:BUYER.userId,email:MERCHANT_FIXTURE_BUYER_EMAIL,role:"customer"});
  await db().update(contacts).set({userId:BUYER.userId}).where(eq(contacts.id,value.buyer.id));
  return value;
 }
 function requestInput(value:Awaited<ReturnType<typeof setup>>){return{cartId:value.cart.id,cartToken:value.cart.token,sellerUserId:value.sellers[0]!.userId,destination:MERCHANT_FIXTURE_DESTINATION,kind:"reverse_charge" as const,certificateRef:certificate};}
 it("requires the real buyer and business, and keeps pending requests out of tax quotes",async()=>{
  const value=await setup(2),input=requestInput(value);
  expect(await cartMerchantTaxBusinesses.call({cartId:value.cart.id,cartToken:value.cart.token},BUYER)).toHaveLength(2);
  const requested=await requestMerchantTaxExemption.call(input,BUYER);
  expect(requested.status).toBe("pending");expect(await requestMerchantTaxExemption.call(input,BUYER)).toEqual(requested);
  expect((await quoteMerchantCheckout.call({...value.quoteInput,email:MERCHANT_FIXTURE_BUYER_EMAIL},BUYER))!.amounts.taxMinor).toBe(250);
  expect((await myMerchantTaxExemptions.call({},BUYER)).rows).toEqual([expect.objectContaining({id:requested.id,certificateRef:certificate,status:"pending"})]);
  expect((await memberMerchantTaxExemptions.call({},value.sellers[1]!)).rows).toEqual([]);
  expect(await failure(reviewMemberMerchantTaxExemption.call({id:requested.id,expectedStatus:"pending",decision:"valid",confirmEvidence:true},value.sellers[1]!))).toMatchObject({code:"not_found"});
  expect(await failure(reviewMemberMerchantTaxExemption.call({id:requested.id,expectedStatus:"pending",decision:"valid",confirmEvidence:false},value.sellers[0]!))).toMatchObject({code:"validation"});
  expect(await failure(myMerchantTaxExemptions.call({},QUOTE_KEY))).toMatchObject({code:"permission"});
  expect(await failure(requestMerchantTaxExemption.call(input,ANONYMOUS))).toMatchObject({code:"permission"});
  await db().insert(users).values({id:OTHER_BUYER.userId,email:"other-certificate-buyer@example.test",role:"customer"});
  const other=(await resolveContact.call({email:"other-certificate-buyer@example.test",name:"Other customer"},OWNER)).contact;
  await db().update(contacts).set({userId:OTHER_BUYER.userId}).where(eq(contacts.id,other.id));
  expect((await myMerchantTaxExemptions.call({},OTHER_BUYER)).rows).toEqual([]);
  expect(await failure(requestMerchantTaxExemption.call(input,OTHER_BUYER))).toMatchObject({code:"permission"});
  expect((await db().select().from(taxExemptions))[0]).toMatchObject({id:requested.id,status:"pending",contactId:value.buyer.id});
 });
 it("applies verified evidence only to its business and refuses a quote-only connector's named-email oracle",async()=>{
  const value=await setup(2),requested=await requestMerchantTaxExemption.call(requestInput(value),BUYER);
  await reviewMemberMerchantTaxExemption.call({id:requested.id,expectedStatus:"pending",decision:"valid",confirmEvidence:true},value.sellers[0]!);
  const own=await quoteMerchantCheckout.call({...value.quoteInput,email:MERCHANT_FIXTURE_BUYER_EMAIL},BUYER);
  expect(own!.amounts.taxMinor).toBe(50);expect(own!.parties.find(party=>party.sellerUserId===value.sellers[0]!.userId)!.amounts.taxMinor).toBe(0);
  for(const actor of [ANONYMOUS,QUOTE_KEY]){
   const quoted=await quoteMerchantCheckout.call({...value.quoteInput,email:MERCHANT_FIXTURE_BUYER_EMAIL},actor);
   expect(quoted!.amounts.taxMinor).toBe(250);
   for(const secret of [certificate,value.buyer.id,value.profiles[0]!.profileId,"acct_fixturePlatform","acct_fixtureSeller0"])expect(JSON.stringify(quoted)).not.toContain(secret);
  }
  const privateKey={kind:"agent" as const,keyName:"authorized-private-customer-pricing",scopes:["catalog.quoteMerchantCheckout","catalog.resolvePrice"]};
  expect((await quoteMerchantCheckout.call({...value.quoteInput,email:MERCHANT_FIXTURE_BUYER_EMAIL},privateKey))!.amounts.taxMinor).toBe(50);
 });
 it("retains issued reverse-charge evidence after revocation and allows withdrawing only one's own pending request",async()=>{
  const value=await setup(),input=requestInput(value),requested=await requestMerchantTaxExemption.call(input,BUYER);
  await reviewMemberMerchantTaxExemption.call({id:requested.id,expectedStatus:"pending",decision:"valid",confirmEvidence:true},value.sellers[0]!);
  const accepted=await quoteMerchantCheckout.call({...value.quoteInput,email:MERCHANT_FIXTURE_BUYER_EMAIL},BUYER);
  const placed=await checkoutCart.call({cartId:value.cart.id,cartToken:value.cart.token,contactId:value.buyer.id,idempotencyKey:randomUUID(),acceptedTerms:true,taxDestination:MERCHANT_FIXTURE_DESTINATION,taxQuoteDigest:accepted!.taxQuoteDigest,commercialQuoteDigest:accepted!.commercialQuoteDigest},BUYER);
  const invoiceId=placed.order.invoiceId!,[issued]=await db().select().from(invoices).where(eq(invoices.id,invoiceId));
  expect(issued).toMatchObject({taxMinor:0,totalMinor:4000});expect(issued!.requiredTaxLegend).toContain("reverse charge");
  const original=await db().select().from(taxLines).where(eq(taxLines.invoiceId,invoiceId));
  expect(original.some(line=>line.exemptionKind==="reverse_charge"&&line.amountMinor===0)).toBe(true);
  await reviewMemberMerchantTaxExemption.call({id:requested.id,expectedStatus:"valid",decision:"revoked"},value.sellers[0]!);
  expect(await db().select().from(taxLines).where(eq(taxLines.invoiceId,invoiceId))).toEqual(original);
  expect((await db().select().from(taxExemptions).where(eq(taxExemptions.id,requested.id)))[0]).toMatchObject({certificateRef:certificate,status:"revoked"});
  // A separate real open cart carries a new pending request. Withdrawal does
  // not destroy its evidence or revoke an already approved decision.
  const {getOrCreateCart,addCartItem}=await import("@/modules/catalog/cart");
  const cart=(await getOrCreateCart.call({contactId:value.buyer.id,currency:"CAD"},BUYER)).cart;
  const {getProductVariants}=await import("@/modules/catalog/variants");
  const {products}=await import("@/modules/catalog/schema");
  const [product]=await db().select().from(products).where(eq(products.sellerUserId,value.sellers[0]!.userId));
  const variant=(await getProductVariants.call({productId:product!.id},OWNER)).variants[0]!;
  await addCartItem.call({cartId:cart.id,cartToken:cart.token,variantId:variant.id},BUYER);
  const next=await requestMerchantTaxExemption.call({...input,cartId:cart.id,cartToken:cart.token},BUYER);
  await withdrawMerchantTaxExemption.call({id:next.id},BUYER);
  expect((await db().select().from(taxExemptions).where(eq(taxExemptions.id,next.id)))[0]).toMatchObject({certificateRef:certificate,status:"revoked"});
  expect(await failure(withdrawMerchantTaxExemption.call({id:requested.id},BUYER))).toMatchObject({code:"conflict"});
 });
 it("uses the trusted original tax date to enforce the approved certificate expiry",async()=>{
  const value=await setup(),requested=await requestMerchantTaxExemption.call(requestInput(value),BUYER);
  const expiresAt=new Date(Date.now()+86400000);
  await reviewMemberMerchantTaxExemption.call({id:requested.id,expectedStatus:"pending",decision:"valid",confirmEvidence:true,expiresAt},value.sellers[0]!);
  const input={profileId:value.profiles[0]!.profileId,profileVersion:value.profiles[0]!.profileVersion,contactId:value.buyer.id,destination:MERCHANT_FIXTURE_DESTINATION,currency:"CAD",items:[{id:"line:0",quantityMicros:1000000,unitAmountMinor:4000,discountMinor:0,category:"standard",requiresShipping:false}],shippingMinor:0};
  // The existing private preview accepts its trusted source's original date;
  // no shopper input, system clock or provider outcome is fabricated here.
  const before=await previewMerchantTax.call({...input,occurredAt:new Date(expiresAt.getTime()-3600000)},{kind:"system"});
  const after=await previewMerchantTax.call({...input,occurredAt:new Date(expiresAt.getTime()+1)},{kind:"system"});
  expect(before.amounts.taxMinor).toBe(0);expect(before.quote.exemption?.kind).toBe("reverse_charge");
  expect(after.amounts.taxMinor).toBe(200);expect(after.quote.exemption).toBeNull();
 });
});
