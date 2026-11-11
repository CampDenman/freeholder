// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: synthetic provider→agreement→invoice→receipt and data rights.
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {eq} from "drizzle-orm";
import {db} from "@/core/db";
import {users} from "@/core/auth/schema";
import {contacts,contactMergeOperations} from "@/core/contacts/schema";
import {resolveContact,mergeContacts,undoContactMerge} from "@/core/contacts/service";
import {ready} from "@/core/runtime";
import {updateBusiness} from "@/core/settings/service";
import {contactPrivacySources,createDataRequest,fulfillDataRequest,verifyDataRequest,addRetentionException,removeRetentionException} from "@/core/privacy/service";
import {dataRequestArtifacts} from "@/core/privacy/schema";
import {createStripeConnect} from "@/adapters/payouts/stripe-connect";
import {setPayoutProviderForTests} from "@/adapters/payouts";
import * as paymentAdapters from "@/adapters/payments";
import {joinSite,updateMembershipRules} from "@/modules/members/service";
import {createMemberPlan} from "@/modules/members/member-subscriptions";
import {refreshPayoutAccount,applyPayoutAccount,applyPayoutWebhook} from "@/modules/members/provider-payouts";
import {memberPayoutAccounts,memberSettings} from "@/modules/members/schema";
import {getSubscriptionMarketPolicy} from "@/modules/subscriptions/market-policy";
import {renewDue,savePlan,subscribe} from "@/modules/subscriptions/service";
import {plans,subscriptions,subscriptionMarketPolicies} from "@/modules/subscriptions/schema";
import {getInvoiceMarketPolicy} from "@/modules/invoicing/market-policy";
import {beginCustomerCheckout,confirmCustomerPayment,customerPaymentReceipt,getCustomerInvoice} from "@/modules/invoicing/customer-service";
import {paymentReturnToken} from "@/modules/invoicing/customer-tokens";
import {invoices,invoiceMarketPolicies,payments} from "@/modules/invoicing/schema";
import {ANONYMOUS,closeDb,CUSTOMER,failure,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";

const SELLER=CUSTOMER,BUYER={...CUSTOMER,userId:"00000000-0000-4000-8000-0000000000c2"},SYSTEM={kind:"system"} as const;
const support={email:"support@original-studio.example",phone:"+1 250 555 0123",url:"https://original-studio.example/help",address:{line1:"10 Public Studio Lane",line2:null,city:"Victoria",state:"BC",postalCode:"V8W 1P6",country:"CA"}};
const replacement={...support,email:"replacement@studio.example",url:"https://replacement.example/help"};

describe.runIf(hasDatabase)("frozen merchant commercial identity (C12.38)",()=>{
 let buyerContact:string,sellerContact:string,currentSupport=support;
 beforeAll(ready,60000);
 beforeEach(async()=>{
  vi.restoreAllMocks();await truncateSpine();currentSupport=support;
  await db().insert(users).values([{id:OWNER.userId,email:"owner@example.test",role:"owner"},{id:SELLER.userId,email:"seller@example.test",role:"customer"},{id:BUYER.userId,email:"buyer@example.test",role:"customer"}]);
  await updateBusiness.call({name:"Current platform",country:"CA",baseCurrency:"CAD",timezone:"UTC"},OWNER);
  await joinSite.call({handle:"merchant",displayName:"Original Studio",meetsMinimumAge:true,isAdult:true},SELLER);
  await updateMembershipRules.call({marketplaceEnabled:true,listingReview:false,payoutModel:"instant",payoutAdapter:"stripe_connect",siteFeeBps:1000},OWNER);
  const seller=(await resolveContact.call({email:"seller@example.test",name:"Original Studio"},OWNER)).contact;
  const buyer=(await resolveContact.call({email:"buyer@example.test",name:"Buyer"},OWNER)).contact;
  sellerContact=seller.id;buyerContact=buyer.id;
  await db().update(contacts).set({userId:SELLER.userId}).where(eq(contacts.id,sellerContact));
  await db().update(contacts).set({userId:BUYER.userId}).where(eq(contacts.id,buyerContact));
  await db().insert(memberPayoutAccounts).values({userId:SELLER.userId,adapter:"stripe_connect",externalAccountId:"acct_OriginalCommercial",status:"pending"});
  setPayoutProviderForTests("stripe_connect",createStripeConnect({secretKey:"synthetic-test-only",webhookSecrets:["synthetic-test-only"],fetch:async()=>Response.json({id:"acct_OriginalCommercial",payouts_enabled:true,charges_enabled:true,capabilities:{transfers:"active",card_payments:"active"},business_profile:{name:"Original Studio",support_email:currentSupport.email,support_phone:currentSupport.phone,support_url:currentSupport.url,support_address:{line1:currentSupport.address.line1,line2:null,city:"Victoria",state:"BC",postal_code:"V8W 1P6",country:"CA"}},email:"private-representative@example.test",individual:{address:{line1:"Private home address"}}})}));
  await refreshPayoutAccount.call({},SELLER);
 });
 afterEach(()=>{setPayoutProviderForTests("stripe_connect",null);vi.restoreAllMocks();});afterAll(closeDb);

 async function agreement(){
  const {planId}=await createMemberPlan.call({name:"Original merchant membership",price:"10"},SELLER);
  const [plan]=await db().select().from(plans).where(eq(plans.id,planId));
  await savePlan.call({id:planId,productId:plan!.productId,name:plan!.name,interval:"month",status:"active",trialDays:14,billingMode:"manual"},OWNER);
  // Internal fixture only: public owner activation stays unavailable.
  await db().update(memberSettings).set({payoutModel:"seller_merchant"}).where(eq(memberSettings.id,1));
  return subscribe.call({planId,contactId:buyerContact},OWNER);
 }
 async function issued(){
  const started=await agreement();
  await db().update(subscriptions).set({currentPeriodStart:new Date("2026-01-01T00:00:00Z"),currentPeriodEnd:new Date("2026-02-01T00:00:00Z"),trialEndsAt:new Date("2026-02-01T00:00:00Z")}).where(eq(subscriptions.id,started.subscription.id));
  expect((await renewDue.call({},SYSTEM)).renewed).toBe(1);
  const [invoice]=await db().select().from(invoices);return{started,invoice:invoice!};
 }
 async function request(kind:"export"|"erasure"){
  const created=await createDataRequest.call({contactId:sellerContact,request:{kind}},OWNER);
  await verifyDataRequest.call({id:created.id,method:"Verified merchant request"},OWNER);return created.id;
 }
 it("keeps provider public support through agreement, renewal, customer invoice and original-account receipt",async()=>{
  expect((await db().select().from(memberPayoutAccounts))[0]).toMatchObject({merchantName:"Original Studio",merchantSupport:support});
  const started=await agreement();
  expect(await getSubscriptionMarketPolicy.call({subscriptionId:started.subscription.id},SYSTEM)).toMatchObject({merchantSupport:support,merchantContactId:sellerContact});
  currentSupport=replacement;await refreshPayoutAccount.call({},SELLER);
  await db().update(subscriptions).set({currentPeriodStart:new Date("2026-01-01T00:00:00Z"),currentPeriodEnd:new Date("2026-02-01T00:00:00Z"),trialEndsAt:new Date("2026-02-01T00:00:00Z")}).where(eq(subscriptions.id,started.subscription.id));
  expect((await renewDue.call({},SYSTEM)).renewed).toBe(1);
  const [invoice]=await db().select().from(invoices);
  expect(await getInvoiceMarketPolicy.call({invoiceId:invoice!.id},SYSTEM)).toMatchObject({merchantSupport:support});
  const manual=paymentAdapters.createManualPayments();
  const stripe={...manual,id:"stripe",capabilities:()=>({...manual.capabilities(),sellerMerchantCharges:true}),createCheckout:vi.fn<paymentAdapters.PaymentAdapter["createCheckout"]>().mockResolvedValue({providerRef:"cs_OriginalCommercial",url:"https://checkout.example.test/original",providerAccountId:"acct_OriginalCommercial"}),captureCheckout:vi.fn<paymentAdapters.PaymentAdapter["captureCheckout"]>().mockResolvedValue({providerRef:"pi_OriginalCommercial",status:"succeeded",amountMinor:1000,currency:"CAD",providerAccountId:"acct_OriginalCommercial",applicationFeeMinor:100})};
  vi.spyOn(paymentAdapters,"paymentAdapter").mockImplementation(id=>id==="stripe"?stripe:manual);
  expect(await getCustomerInvoice.call({id:invoice!.id},BUYER)).toMatchObject({issuerName:"Original Studio",issuerSupport:support,issuerIsMerchant:true});
  await beginCustomerCheckout.call({id:invoice!.id},BUYER);const [payment]=await db().select().from(payments),input={token:paymentReturnToken(payment!)};
  expect(await confirmCustomerPayment.call(input,ANONYMOUS)).toMatchObject({status:"succeeded",issuerSupport:support,issuerName:"Original Studio"});
  const receipt=await customerPaymentReceipt.call(input,ANONYMOUS);
  for(const privateValue of ["acct_OriginalCommercial",SELLER.userId,sellerContact,"merchantContactId","private-representative","Private home",replacement.email,"siteFeeBps"])expect(JSON.stringify(receipt)).not.toContain(privateValue);
  expect((await db().select().from(invoices))[0]).toMatchObject({status:"paid",paidMinor:1000});
 });
 it("requires public support before a new direct agreement without inventing private representative details",async()=>{
  await db().update(memberPayoutAccounts).set({merchantSupport:null}).where(eq(memberPayoutAccounts.userId,SELLER.userId));
  expect(await failure(agreement())).toMatchObject({code:"conflict"});
  expect(await db().select().from(subscriptionMarketPolicies)).toHaveLength(0);
 });
 it("exports only this merchant's public account/agreement/invoice copies, then erases them while preserving financial records",async()=>{
  const {invoice}=await issued(),source=contactPrivacySources().find(item=>item.scope==="members.merchantIdentity")!;
  const {artifact}=await fulfillDataRequest.call({id:await request("export")},OWNER);
  const [stored]=await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.id,artifact.id));
  const body=stored!.body as {sources:Record<string,unknown>};expect(JSON.stringify(body.sources[source.scope])).toContain(support.email);
  expect(JSON.stringify(body.sources[source.scope])).not.toContain("private-representative");
  expect(JSON.stringify(await db().transaction(tx=>source.exportData(tx,buyerContact)))).not.toContain(support.email);
  await fulfillDataRequest.call({id:await request("erasure"),confirmation:"ERASE"},OWNER);
  const customer=await getCustomerInvoice.call({id:invoice.id},BUYER);
  expect(customer).toMatchObject({issuerName:null,issuerSupport:null,issuerIsMerchant:true,paymentMode:"unavailable",totalMinor:1000});
  const policies=await db().select().from(invoiceMarketPolicies);expect(JSON.stringify(policies)).not.toContain(support.email);expect(JSON.stringify(policies)).not.toContain("Original Studio");
  expect(policies[0]).toMatchObject({providerAccountId:"acct_OriginalCommercial",feeMinor:100});
 });
 it.each(["commerce.money","members","members.merchantIdentity"])("respects the existing named hold %s for original commercial evidence",async scope=>{
  await issued();const id=await request("erasure");
  await addRetentionException.call({dataRequestId:id,scope,reason:"accounting_tax",legalBasis:"Original supplier records are required for this specific accounting dispute."},OWNER);
  const result=await fulfillDataRequest.call({id,confirmation:"ERASE"},OWNER);
  expect(JSON.stringify(result)).toContain("retained");
  expect((await db().select().from(invoiceMarketPolicies))[0]).toMatchObject({merchantName:"Original Studio",merchantSupport:support,merchantContactId:sellerContact});
  if(scope==="members")expect((await db().select().from(memberPayoutAccounts))[0]).toMatchObject({merchantSupport:support});
 });
 it("redrives released financial identity after login deletion using its persistent contact ownership",async()=>{
  await issued();const id=await request("erasure"),exception=await addRetentionException.call({dataRequestId:id,scope:"members.merchantIdentity",reason:"accounting_tax",legalBasis:"Keep the original supplier identity until this specific accounting review ends."},OWNER);
  await fulfillDataRequest.call({id,confirmation:"ERASE"},OWNER);
  expect(await db().select().from(users).where(eq(users.id,SELLER.userId))).toHaveLength(0);
  expect((await db().select().from(contacts).where(eq(contacts.id,sellerContact)))[0]?.userId).toBeNull();
  const source=contactPrivacySources().find(item=>item.scope==="members.merchantIdentity")!;
  expect(JSON.stringify(await db().transaction(tx=>source.exportData(tx,sellerContact)))).toContain(support.email);
  await removeRetentionException.call({id:exception.id},OWNER);
  await fulfillDataRequest.call({id:await request("erasure"),confirmation:"ERASE"},OWNER);
  expect(JSON.stringify(await db().transaction(tx=>source.exportData(tx,sellerContact)))).not.toContain(support.email);
 });
 it("repoints commercial ownership on contact merge and restores unchanged documents without copying support into recovery history",async()=>{
  const {invoice,started}=await issued(),other=(await resolveContact.call({email:"merchant-duplicate@example.test",name:"Same merchant duplicate"},OWNER)).contact;
  const merged=await mergeContacts.call({duplicateId:sellerContact,survivingId:other.id},OWNER);
  expect(await getInvoiceMarketPolicy.call({invoiceId:invoice.id},SYSTEM)).toMatchObject({merchantContactId:other.id,merchantSupport:support});
  expect(await getSubscriptionMarketPolicy.call({subscriptionId:started.subscription.id},SYSTEM)).toMatchObject({merchantContactId:other.id,merchantSupport:support});
  const [operation]=await db().select().from(contactMergeOperations).where(eq(contactMergeOperations.id,merged.mergeOperationId));
  expect(JSON.stringify(operation!.referenceState)).not.toContain(support.email);
  await undoContactMerge.call({operationId:merged.mergeOperationId},OWNER);
  expect(await getInvoiceMarketPolicy.call({invoiceId:invoice.id},SYSTEM)).toMatchObject({merchantContactId:sellerContact,merchantSupport:support});
  expect(await getSubscriptionMarketPolicy.call({subscriptionId:started.subscription.id},SYSTEM)).toMatchObject({merchantContactId:sellerContact,merchantSupport:support});
 });
 it("refuses undo after new merchant documents enter the merged financial identity",async()=>{
  await issued();const other=(await resolveContact.call({email:"merchant-duplicate@example.test",name:"Same merchant duplicate"},OWNER)).contact;
  const merged=await mergeContacts.call({duplicateId:sellerContact,survivingId:other.id},OWNER);
  await agreement();
  expect(await failure(undoContactMerge.call({operationId:merged.mergeOperationId},OWNER))).toMatchObject({code:"conflict"});
  expect((await db().select().from(subscriptionMarketPolicies)).every(row=>row.merchantContactId===other.id)).toBe(true);
 });
 it("refuses late provider refresh and ignores personal copies in signed account feedback after the erasure marker",async()=>{
  await db().update(contacts).set({source:"privacy-erasure"}).where(eq(contacts.id,sellerContact));
  expect(await failure(applyPayoutAccount.call({adapter:"stripe_connect",externalAccountId:"acct_OriginalCommercial",status:"ready",chargesReady:true,merchantName:"Recreated Studio",merchantSupport:replacement},SELLER))).toMatchObject({code:"conflict"});
  await applyPayoutWebhook.call({provider:"stripe_connect",events:[{kind:"account",externalAccountId:"acct_OriginalCommercial",status:"ready",chargesReady:true,merchantName:"Recreated Studio",merchantSupport:replacement}]},SYSTEM);
  expect((await db().select().from(memberPayoutAccounts))[0]).toMatchObject({merchantName:"Original Studio",merchantSupport:support,chargesReady:false});
 });
});
