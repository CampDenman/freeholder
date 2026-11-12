// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C12.09: seller liabilities use the actual original invoice revenue.
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {db} from "@/core/db";
import {eq,sql} from "drizzle-orm";
import {users} from "@/core/auth/schema";
import {resolveContact} from "@/core/contacts/service";
import {ready} from "@/core/runtime";
import {updateBusiness} from "@/core/settings/service";
import {joinSite,updateMembershipRules} from "@/modules/members/service";
import {createListing} from "@/modules/members/listings";
import{createStripeConnect}from"@/adapters/payouts/stripe-connect";
import{setPayoutProviderForTests}from"@/adapters/payouts";
import{sendProviderPayouts}from"@/modules/members/provider-payouts";
import{memberPayoutAccounts,memberPayouts,memberPayoutTransfers}from"@/modules/members/schema";
import {onOrderPaid,savePayoutInstructions,setPayoutAccountStatus,settlePayouts,sitePayouts} from "@/modules/members/payouts";
import {addCartItem,applyCouponToCart,checkoutCart,createCoupon,getOrCreateCart,getProductVariants} from "@/modules/catalog/service";
import {getInvoiceMarketPolicy} from "@/modules/invoicing/market-policy";
import {createPayment,getInvoice,settlePayment} from "@/modules/invoicing/invoice-service";
import {invoiceMarketPolicies} from "@/modules/invoicing/schema";
import {ANONYMOUS,closeDb,CUSTOMER,failure,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";

const SECOND={...CUSTOMER,userId:"00000000-0000-4000-8000-0000000000c2"};

describe.runIf(hasDatabase)("original discounted order earnings (C12.38)",()=>{
 beforeAll(ready,60000);
 beforeEach(async()=>{
  await truncateSpine();
  await db().insert(users).values([{id:OWNER.userId,email:"owner@example.test",role:"owner"},{id:CUSTOMER.userId,email:"seller@example.test",role:"customer"},{id:SECOND.userId,email:"second@example.test",role:"customer"}]);
  await updateBusiness.call({name:"Original revenue proof",country:"CA",baseCurrency:"CAD",timezone:"UTC"},OWNER);
  await joinSite.call({handle:"discounted_seller",displayName:"Original Seller",meetsMinimumAge:true,isAdult:true},CUSTOMER);
  await updateMembershipRules.call({marketplaceEnabled:true,listingReview:false,siteFeeBps:1000,holdDays:7},OWNER);
  await savePayoutInstructions.call({instructions:"Synthetic manual account for the recorded fixture"},CUSTOMER);
  await setPayoutAccountStatus.call({userId:CUSTOMER.userId,status:"ready"},OWNER);
 });
 afterAll(closeDb);
 afterEach(()=>{setPayoutProviderForTests("stripe_connect",null);vi.restoreAllMocks();});

 async function place(lines=[{seller:CUSTOMER,price:"40"}],percentOffPpm=500000){
  const {contact}=await resolveContact.call({email:"buyer@example.test",name:"Buyer"},OWNER);
  const cart=await getOrCreateCart.call({currency:"CAD",contactId:contact.id},OWNER);
  for(const [position,line]of lines.entries()){
   const listing=await createListing.call({acceptPolicy:true,title:`Original digital work ${position}`,kind:"digital",price:line.price},line.seller);
   const [variant]=(await getProductVariants.call({productId:listing.productId},OWNER)).variants;
   await addCartItem.call({cartId:cart.cart.id,cartToken:cart.cart.token??undefined,variantId:variant!.id},ANONYMOUS);
  }
  await createCoupon.call({code:"HALFOFF",kind:"percent",percentOffPpm},OWNER);
  await applyCouponToCart.call({cartId:cart.cart.id,code:"HALFOFF"},OWNER);
  const placed=await checkoutCart.call({cartId:cart.cart.id,contactId:contact.id,idempotencyKey:"discounted-seller-order",acceptedTerms:true},OWNER);
  const invoice=await getInvoice.call({id:placed.order.invoiceId!},OWNER);
  return{placed,invoice};
 }
 async function pay(invoiceId:string){
  const invoice=await getInvoice.call({id:invoiceId},OWNER);
  const payment=await createPayment.call({invoiceId,provider:"manual",method:"bank_transfer",amountMinor:invoice.invoice.totalMinor,idempotencyKey:"discounted-seller-payment"},OWNER);
  await settlePayment.call({id:payment.id,providerRef:"synthetic-discounted-seller-bank-reference"},OWNER);
  return payment;
 }
 async function restorePriorPolicy(invoiceId:string,feeMinor:number){
  // Privileged fixture restoration only: represent the already-issued pre77
  // history demonstrated by the original coupon regression. A current writer
  // must never be able to rewrite a new immutable portion into that history.
  // DDL and data changes share ONE disposable-test transaction; every named
  // guard is restored before commit, including on rollback after any failure.
  await db().transaction(async tx=>{
   await tx.execute(sql`alter table invoice_merchant_allocation_lines disable trigger invoice_merchant_allocation_line_guard`);
   await tx.execute(sql`alter table invoice_merchant_allocations disable trigger invoice_merchant_allocation_guard`);
   await tx.execute(sql`alter table invoice_market_policies disable trigger invoice_merchant_allocation_policy_guard`);
   await tx.execute(sql`delete from invoice_merchant_allocation_lines where allocation_id in(select id from invoice_merchant_allocations where invoice_id=${invoiceId})`);
   await tx.execute(sql`delete from invoice_merchant_allocations where invoice_id=${invoiceId}`);
   await tx.update(invoiceMarketPolicies).set({feeMinor,allocationVersion:0}).where(eq(invoiceMarketPolicies.invoiceId,invoiceId));
   await tx.execute(sql`alter table invoice_market_policies enable trigger invoice_merchant_allocation_policy_guard`);
   await tx.execute(sql`alter table invoice_merchant_allocations enable trigger invoice_merchant_allocation_guard`);
   await tx.execute(sql`alter table invoice_merchant_allocation_lines enable trigger invoice_merchant_allocation_line_guard`);
  });
 }
 async function providerSeller(){
  await updateMembershipRules.call({payoutModel:"instant",payoutAdapter:"stripe_connect"},OWNER);
  // A prior verified payout account, without live onboarding acceptance.
  await db().update(memberPayoutAccounts).set({adapter:"stripe_connect",externalAccountId:"acct_SyntheticCoupon",status:"ready"}).where(eq(memberPayoutAccounts.userId,CUSTOMER.userId));
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json({id:"tr_SyntheticLegacyCoupon"}));
  setPayoutProviderForTests("stripe_connect",createStripeConnect({secretKey:"synthetic-only",webhookSecrets:["synthetic-only"],fetch:fetcher}));
  return fetcher;
 }
 it.each(["hold","instant"]as const)("records only discounted invoice revenue and its frozen fee for a paid %s seller order",async model=>{
  await updateMembershipRules.call({payoutModel:model},OWNER);
  const{placed,invoice}=await place();expect(invoice.invoice.totalMinor).toBe(2000);
  await pay(invoice.invoice.id);
  await onOrderPaid({orderId:placed.order.id});
  const policy=await getInvoiceMarketPolicy.call({invoiceId:invoice.invoice.id},{kind:"system"});
  const {payouts}=await sitePayouts.call({},OWNER);
  expect({feeMinor:policy!.feeMinor,earnings:payouts.map(({grossMinor,feeMinor,netMinor,state})=>({grossMinor,feeMinor,netMinor,state}))}).toEqual({feeMinor:200,earnings:[{grossMinor:2000,feeMinor:200,netMinor:1800,state:model==="hold"?"held":"due"}]});
 });
 it("preserves an older issued fee and recorded money while repeated delivery creates no second earning",async()=>{
  const{placed,invoice}=await place();
  // Genuine prior-image terms: the old resolver froze ten percent of40.00.
  // This fixture does not claim a provider charged or accepted those terms.
  await restorePriorPolicy(invoice.invoice.id,400);
  const payment=await pay(invoice.invoice.id);await onOrderPaid({orderId:placed.order.id});
  const before=(await sitePayouts.call({},OWNER)).payouts;
  expect(before).toMatchObject([{grossMinor:2000,feeMinor:400,netMinor:1600}]);
  await updateMembershipRules.call({siteFeeBps:5000,payoutModel:"instant"},OWNER);
  await onOrderPaid({orderId:placed.order.id});
  expect((await sitePayouts.call({},OWNER)).payouts).toEqual(before);
  const original=await getInvoice.call({id:invoice.invoice.id},OWNER);
  expect(original.payments).toMatchObject([{id:payment.id,amountMinor:2000,status:"succeeded",providerRef:"synthetic-discounted-seller-bank-reference"}]);
  expect(await getInvoiceMarketPolicy.call({invoiceId:invoice.invoice.id},{kind:"system"})).toMatchObject({feeMinor:400,siteFeeBps:1000});
 });
 it("keeps the original cent allocation across two sellers on one discounted invoice",async()=>{
  await joinSite.call({handle:"second_seller",displayName:"Second Seller",meetsMinimumAge:true,isAdult:true},SECOND);
  await savePayoutInstructions.call({instructions:"Synthetic second manual account"},SECOND);await setPayoutAccountStatus.call({userId:SECOND.userId,status:"ready"},OWNER);
  await updateMembershipRules.call({siteFeeBps:3333},OWNER);
  const{placed,invoice}=await place([{seller:CUSTOMER,price:"0.13"},{seller:SECOND,price:"0.17"}]);
  expect(invoice.invoice.totalMinor).toBe(15);await pay(invoice.invoice.id);await onOrderPaid({orderId:placed.order.id});
  const earnings=(await sitePayouts.call({},OWNER)).payouts.map(({sellerHandle,grossMinor,feeMinor,netMinor})=>({sellerHandle,grossMinor,feeMinor,netMinor})).sort((a,b)=>a.sellerHandle.localeCompare(b.sellerHandle));
  expect(earnings).toEqual([{sellerHandle:"discounted_seller",grossMinor:7,feeMinor:2,netMinor:5},{sellerHandle:"second_seller",grossMinor:8,feeMinor:2,netMinor:6}]);
  expect(await getInvoiceMarketPolicy.call({invoiceId:invoice.invoice.id},{kind:"system"})).toMatchObject({feeMinor:4});
 });
 it("keeps actual payment recorded but refuses an original fee allocation it cannot establish",async()=>{
  const{placed,invoice}=await place();await restorePriorPolicy(invoice.invoice.id,123);
  await pay(invoice.invoice.id);
  expect(await failure(onOrderPaid({orderId:placed.order.id}))).toMatchObject({code:"conflict"});
  expect((await sitePayouts.call({},OWNER)).payouts).toHaveLength(0);
  expect((await getInvoice.call({id:invoice.invoice.id},OWNER)).invoice).toMatchObject({paidMinor:2000,status:"paid"});
 });
 it.each(["new","unsent","refused","unknown","confirmed"]as const)("does not send a previously recorded overstated coupon payout to its provider (%s)",async prior=>{
  const fetcher=await providerSeller();
  const{placed,invoice}=await place();await restorePriorPolicy(invoice.invoice.id,400);await pay(invoice.invoice.id);
  // Exact prior-image row demonstrated by the original failing business case.
  const[payout]=await db().update(memberPayouts).set({grossMinor:4000,feeMinor:400,netMinor:3600,model:"instant",state:"due",releasedAt:new Date()}).where(eq(memberPayouts.orderItemId,placed.lines[0]!.id)).returning();
  if(prior!=="new")await db().insert(memberPayoutTransfers).values({payoutId:payout!.id,kind:"transfer",provider:"stripe_connect",amountMinor:3600,currency:"CAD",state:prior==="refused"?"failed":prior==="confirmed"?"settled":"pending",reference:prior==="confirmed"?"tr_OriginalConfirmed":null,attempts:prior==="unsent"?0:1,lastError:prior==="unknown"?"Outcome unknown: provider response was lost.":null,attemptStartedAt:prior==="unknown"?new Date():null});
  const result=await sendProviderPayouts(),[stored]=await db().select().from(memberPayouts).where(eq(memberPayouts.id,payout!.id));
  const providerAmounts=fetcher.mock.calls.map(([,init])=>new URLSearchParams(init?.body instanceof URLSearchParams?init.body:typeof init?.body==="string"?init.body:"").get("amount"));
  const transfers=await db().select().from(memberPayoutTransfers);
  expect({result,providerAmounts,state:stored!.state,grossMinor:stored!.grossMinor,feeMinor:stored!.feeMinor,netMinor:stored!.netMinor,attempts:transfers.length}).toEqual({result:{sent:0,failed:0},providerAmounts:[],state:prior==="confirmed"?"paid":"review",grossMinor:4000,feeMinor:400,netMinor:3600,attempts:prior==="new"?0:1});
  if(prior==="unknown")expect(transfers[0]).toMatchObject({state:"unknown",amountMinor:3600,attempts:1,attempt:1});
  if(prior==="confirmed")expect(stored).toMatchObject({reference:"tr_OriginalConfirmed"});
  else expect(await failure(settlePayouts.call({ids:[payout!.id],action:"owe",note:"Attempt to send the old amount again."},OWNER))).toMatchObject({code:"conflict"});
  expect(await sendProviderPayouts()).toEqual({sent:0,failed:0});expect(fetcher).not.toHaveBeenCalled();
  if(prior==="unknown"){
   expect(await settlePayouts.call({ids:[payout!.id],action:"providerPaid",reference:"tr_CheckedOriginalPayment"},OWNER)).toEqual({changed:1});
   expect((await sitePayouts.call({},OWNER)).payouts).toMatchObject([{state:"paid",grossMinor:4000,feeMinor:400,netMinor:3600,reference:"tr_CheckedOriginalPayment"}]);
  }
 });
 it.each(["new","due","unsent","unknown"]as const)("finishes a fully discounted seller earning without sending a zero provider transfer (%s)",async prior=>{
  const fetcher=await providerSeller();const{placed,invoice}=await place([{seller:CUSTOMER,price:"40"}],1000000);
  expect(invoice.invoice).toMatchObject({status:"paid",totalMinor:0});await onOrderPaid({orderId:placed.order.id});
  const[payout]=await db().select().from(memberPayouts).where(eq(memberPayouts.orderId,placed.order.id));
  if(prior!=="new")await db().update(memberPayouts).set({state:"due",paidAt:null}).where(eq(memberPayouts.id,payout!.id));
  if(prior==="unsent"||prior==="unknown")await db().insert(memberPayoutTransfers).values({payoutId:payout!.id,kind:"transfer",provider:"stripe_connect",amountMinor:0,currency:"CAD",attempts:prior==="unknown"?1:0,lastError:prior==="unknown"?"Outcome unknown: zero-amount response was lost.":null,attemptStartedAt:prior==="unknown"?new Date():null});
  expect(await sendProviderPayouts()).toEqual({sent:0,failed:0});expect(fetcher).not.toHaveBeenCalled();
  expect((await sitePayouts.call({},OWNER)).payouts).toMatchObject([{grossMinor:0,feeMinor:0,netMinor:0,state:prior==="unknown"?"review":"paid"}]);
  const transfers=await db().select().from(memberPayoutTransfers);
  if(prior==="unsent"||prior==="unknown")expect(transfers).toMatchObject([{amountMinor:0,attempts:prior==="unknown"?1:0,state:prior==="unknown"?"unknown":"failed"}]);
  else expect(transfers).toHaveLength(0);
 });
});
