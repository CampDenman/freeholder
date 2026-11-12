// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: actual profile/quote/invoice services on the assembled80 schema.
import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,beforeEach,describe,expect,it} from "vitest";
import {eq} from "drizzle-orm";
import {db} from "@/core/db";
import {users} from "@/core/auth/schema";
import {contacts} from "@/core/contacts/schema";
import {resolveContact} from "@/core/contacts/service";
import {ready} from "@/core/runtime";
import {updateBusiness} from "@/core/settings/service";
import {joinSite} from "@/modules/members/service";
import {myMerchantTaxProfile,saveMyMerchantTaxProfile,merchantTaxZoneConfiguration} from "@/modules/invoicing/merchant-tax-profiles";
import {previewMerchantTax} from "@/modules/invoicing/merchant-tax-preview";
import {getInvoiceMerchantTaxReceipt} from "@/modules/invoicing/merchant-tax";
import {registerMerchantTaxSourceResolver,type merchantTaxSourceParty} from "@/modules/invoicing/merchant-tax-invoice";
import {createDraftInvoice,issueInvoice} from "@/modules/invoicing/invoice-service";
import {addTaxRate,createTaxZone,setTaxRegistration} from "@/modules/invoicing/tax-service";
import {invoiceLines,taxLines} from "@/modules/invoicing/schema";
import {invoiceMerchantTaxQuotes} from "@/modules/invoicing/merchant-tax-schema";
import {ANONYMOUS,closeDb,CUSTOMER,failure,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";
import type {z} from "zod";

const SELLER=CUSTOMER,OTHER={...CUSTOMER,userId:"00000000-0000-4000-8000-0000000000c2"},SYSTEM={kind:"system"} as const;
const destination={country:"CA",region:"BC"};
const occurredAt=new Date("2026-11-12T12:00:00.000Z");
const items=[{id:"line:0",quantityMicros:1000000,unitAmountMinor:1000,discountMinor:0,category:"standard",requiresShipping:true}];

describe.runIf(hasDatabase)("original merchant tax services (C12.38)",()=>{
 let zoneId:string,gstId:string,pstId:string,buyerId:string;
 let sourceParties:z.infer<typeof merchantTaxSourceParty>[]=[];
 const sourceId=randomUUID();
 beforeAll(async()=>{
  await ready();
  // Explicit synthetic trusted-source fixture. No handler context or actor is
  // fabricated; the real shared draft service still proves full line coverage,
  // business ownership, accepted quote and conservation. This is not checkout
  // or actual provider acceptance.
  registerMerchantTaxSourceResolver("merchant_tax_native",async input=>{
   expect(input.sourceId).toBe(sourceId);
   expect(input.contactId).toBe(buyerId);
   expect(input.currency).toBe("CAD");
   return sourceParties;
  });
 },60000);
 beforeEach(async()=>{
  await truncateSpine();sourceParties=[];
  await db().insert(users).values([{id:OWNER.userId,email:"tax-owner@example.test",role:"owner"},{id:SELLER.userId,email:"tax-first@example.test",role:"customer"},{id:OTHER.userId,email:"tax-second@example.test",role:"customer"}]);
  await updateBusiness.call({name:"Synthetic tax service proof",country:"CA",baseCurrency:"CAD",timezone:"UTC"},OWNER);
  for(const [actor,handle] of [[SELLER,"tax_first"],[OTHER,"tax_second"]] as const)await joinSite.call({handle,displayName:handle,meetsMinimumAge:true,isAdult:true},actor);
  buyerId=(await resolveContact.call({email:"tax-buyer@example.test",name:"Tax buyer"},OWNER)).contact.id;
  const zone=await createTaxZone.call({name:"Explicit fixture jurisdiction",country:"CA",regions:["BC"],basis:"destination",pricesIncludeTax:false,roundingScope:"line",roundingMode:"half_up"},OWNER);
  zoneId=zone.id;
  gstId=(await addTaxRate.call({zoneId,name:"Fixture GST",jurisdiction:"Fixture federal",ratePpm:50000,appliesToShipping:true},OWNER)).id;
  pstId=(await addTaxRate.call({zoneId,name:"Fixture PST",jurisdiction:"Fixture provincial",ratePpm:70000,appliesToShipping:true,priority:1},OWNER)).id;
 });
 afterAll(closeDb);

 async function declare(actor=SELLER,gst=true){
  const zone=await merchantTaxZoneConfiguration.call({zoneId},actor);
  return saveMyMerchantTaxProfile.call({expectedVersion:0,idempotencyKey:randomUUID(),acceptPolicy:true,liability:"seller",origin:destination,collectionStatus:"registered",registrations:[
   {zoneId,number:gst?"FIRST-GST":"SECOND-GST",rateIds:[gstId],configurationDigest:zone.configurationDigest,status:gst?"active":"monitoring"},
   {zoneId,number:gst?"FIRST-PST":"SECOND-PST",rateIds:[pstId],configurationDigest:zone.configurationDigest,status:gst?"monitoring":"active"},
  ]},actor);
 }
 async function quote(profile:Awaited<ReturnType<typeof declare>>,contactId:string|null=buyerId){
  return previewMerchantTax.call({profileId:profile.profileId,profileVersion:profile.profileVersion,contactId,destination,currency:"CAD",items,shippingMinor:101,occurredAt},SYSTEM);
 }
 async function draft(){
  return createDraftInvoice.call({contactId:buyerId,currency:"CAD",sourceType:"merchant_tax_native",sourceId,idempotencyKey:randomUUID(),shippingMinor:101,
   lines:[{description:"Original taxable item",quantityMicros:1000000,unitAmountMinor:1000,taxCategoryCode:"standard",requiresShipping:true}],tax:{mode:"merchant",destination}},OWNER);
 }
 it("keeps own declarations private and refuses human/connector access to the original-source preview",async()=>{
  const first=await declare();
  expect(await myMerchantTaxProfile.call({},SELLER)).toMatchObject({profileId:first.profileId,profileVersion:1,state:"active"});
  expect(await myMerchantTaxProfile.call({},OTHER)).toBeNull();
  expect(await failure(myMerchantTaxProfile.call({},ANONYMOUS))).toMatchObject({code:"permission"});
  const input={profileId:first.profileId,profileVersion:1,contactId:buyerId,destination,currency:"CAD",items,shippingMinor:101,occurredAt};
  for(const actor of [OWNER,{kind:"agent" as const,keyName:"tax-read",scopes:["invoicing.*","members.*"]}])expect(await failure(previewMerchantTax.call(input,actor))).toMatchObject({code:"permission"});
 });
 it("uses only each business's explicit registrations and keeps anonymous and nonexempt buyer consent stable",async()=>{
  await setTaxRegistration.call({zoneId,number:"LEGACY-SITE-ONLY",status:"active"},OWNER);
  const first=await declare(),second=await declare(OTHER,false);
  const a=await quote(first),anonymous=await quote(first,null),b=await quote(second);
  expect(a.amounts).toMatchObject({subtotalMinor:1000,shippingMinor:101,taxMinor:55,totalMinor:1156,shippingTaxMinor:5});
  expect(b.amounts).toMatchObject({subtotalMinor:1000,shippingMinor:101,taxMinor:77,totalMinor:1178,shippingTaxMinor:7});
  expect(a.quote.registrationNumbers.map(row=>row.number)).toEqual(["FIRST-GST","FIRST-GST"]);
  expect(b.quote.registrationNumbers.map(row=>row.number)).toEqual(["SECOND-PST","SECOND-PST"]);
  expect(a.quoteDigest).toBe(anonymous.quoteDigest);
  expect(a.quoteDigest).not.toBe(b.quoteDigest);
 });
 it("freezes original registration and exact freight tax on the shared invoice before issue",async()=>{
  const first=await declare();
  sourceParties=[{sellerUserId:SELLER.userId,profileId:first.profileId,profileVersion:1,linePositions:[0],shippingMinor:101,occurredAt}];
  const created=await draft();
  expect(created.invoice).toMatchObject({subtotalMinor:1000,shippingMinor:101,taxMinor:55,totalMinor:1156,status:"draft"});
  const issued=await issueInvoice.call({id:created.invoice.id},OWNER);
  expect(issued.invoice.status).toBe("sent");
  expect((await db().select().from(taxLines).where(eq(taxLines.invoiceId,created.invoice.id))).map(row=>({kind:row.kind,amount:row.amountMinor,number:row.registrationNumber}))).toEqual(expect.arrayContaining([{kind:"item",amount:50,number:"FIRST-GST"},{kind:"shipping",amount:5,number:"FIRST-GST"}]));
  expect(await getInvoiceMerchantTaxReceipt.call({invoiceId:created.invoice.id,sellerUserId:SELLER.userId},SYSTEM)).toMatchObject({liability:"seller",profileId:first.profileId,profileVersion:1});
  expect(await getInvoiceMerchantTaxReceipt.call({invoiceId:created.invoice.id,sellerUserId:OTHER.userId},SYSTEM)).toBeNull();
  expect(await db().select().from(invoiceMerchantTaxQuotes)).toEqual([expect.objectContaining({profileId:first.profileId,occurredAt,shippingMinor:101,shippingTaxMinor:5,taxMinor:55})]);
  const [line]=await db().select().from(invoiceLines).where(eq(invoiceLines.invoiceId,created.invoice.id));
  expect(line).toMatchObject({taxMinor:50,totalMinor:1050});
 });
 it("refuses source ownership mismatches and incomplete line coverage without a partial invoice",async()=>{
  const first=await declare();
  sourceParties=[{sellerUserId:OTHER.userId,profileId:first.profileId,profileVersion:1,linePositions:[0],shippingMinor:101}];
  expect(await failure(draft())).toMatchObject({code:"conflict"});
  expect(await db().select().from(invoiceMerchantTaxQuotes)).toHaveLength(0);
  sourceParties=[{sellerUserId:SELLER.userId,profileId:first.profileId,profileVersion:1,linePositions:[1],shippingMinor:101}];
  expect(await failure(draft())).toMatchObject({code:"conflict"});
  expect(await db().select().from(invoiceLines)).toHaveLength(0);
 });
 it("refuses stale declarations after the original member contact has entered erasure",async()=>{
  const first=await declare();
  const [person]=await db().select().from(contacts).where(eq(contacts.userId,SELLER.userId));
  const {createDataRequest,verifyDataRequest}=await import("@/core/privacy/service");
  const request=await createDataRequest.call({contactId:person!.id,request:{kind:"erasure"}},OWNER);
  await verifyDataRequest.call({id:request.id,method:"Verified original merchant request"},OWNER);
  expect(await failure(quote(first))).toMatchObject({code:"conflict"});
  expect(await failure(myMerchantTaxProfile.call({},SELLER))).toMatchObject({code:"conflict"});
 });
});
