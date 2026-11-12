// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: actual profile/quote/invoice services on the assembled80 schema.
import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,beforeEach,describe,expect,it} from "vitest";
import {eq} from "drizzle-orm";
import {db} from "@/core/db";
import {users} from "@/core/auth/schema";
import {contacts} from "@/core/contacts/schema";
import {mergeContacts,resolveContact,undoContactMerge} from "@/core/contacts/service";
import {addRetentionException,createDataRequest,fulfillDataRequest,removeRetentionException,verifyDataRequest} from "@/core/privacy/service";
import {dataRequestArtifacts} from "@/core/privacy/schema";
import {ready} from "@/core/runtime";
import {updateBusiness} from "@/core/settings/service";
import {joinSite} from "@/modules/members/service";
import {myMerchantTaxProfile,saveMyMerchantTaxProfile,merchantTaxZoneConfiguration} from "@/modules/invoicing/merchant-tax-profiles";
import {previewMerchantTax} from "@/modules/invoicing/merchant-tax-preview";
import {getInvoiceMerchantTaxReceipt} from "@/modules/invoicing/merchant-tax";
import {myMerchantTaxThresholds,siteMerchantTaxThresholds} from "@/modules/invoicing/merchant-tax-thresholds";
import {registerMerchantTaxSourceResolver,type merchantTaxSourceParty} from "@/modules/invoicing/merchant-tax-invoice";
import {createDraftInvoice,issueInvoice} from "@/modules/invoicing/invoice-service";
import {addTaxRate,createTaxZone,listTaxThresholds,setTaxRegistration} from "@/modules/invoicing/tax-service";
import {invoiceLines,taxExemptions,taxLines} from "@/modules/invoicing/schema";
import {allowMerchantTaxWrites} from "@/modules/invoicing/merchant-tax-store";
import {invoiceMerchantTaxQuotes,merchantTaxProfiles,merchantTaxProfileVersions} from "@/modules/invoicing/merchant-tax-schema";
import {ANONYMOUS,closeDb,CUSTOMER,failure,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";
import type {z} from "zod";

const SELLER=CUSTOMER,OTHER={...CUSTOMER,userId:"00000000-0000-4000-8000-0000000000c2"},SYSTEM={kind:"system"} as const;
const destination={country:"CA",region:"BC"};
const occurredAt=new Date("2026-11-12T12:00:00.000Z");
const items=[{id:"line:0",quantityMicros:1000000,unitAmountMinor:1000,discountMinor:0,category:"standard",requiresShipping:true}];

describe.runIf(hasDatabase)("original merchant tax services (C12.38)",()=>{
 let zoneId:string,gstId:string,pstId:string,buyerId:string,sellerContact:string;
 let sourceParties:z.infer<typeof merchantTaxSourceParty>[]=[];
 const sourceId=randomUUID();
 let sourceCurrency="CAD";
 beforeAll(async()=>{
  await ready();
  // Explicit synthetic trusted-source fixture. No handler context or actor is
  // fabricated; the real shared draft service still proves full line coverage,
  // business ownership, accepted quote and conservation. This is not checkout
  // or actual provider acceptance.
  registerMerchantTaxSourceResolver("manual",async input=>{
   expect(input.sourceId).toBe(sourceId);
   expect(input.contactId).toBe(buyerId);
   expect(input.currency).toBe(sourceCurrency);
   return sourceParties;
  });
 },60000);
 beforeEach(async()=>{
  await truncateSpine();sourceParties=[];sourceCurrency="CAD";
  await db().insert(users).values([{id:OWNER.userId,email:"tax-owner@example.test",role:"owner"},{id:SELLER.userId,email:"tax-first@example.test",role:"customer"},{id:OTHER.userId,email:"tax-second@example.test",role:"customer"}]);
  await updateBusiness.call({name:"Synthetic tax service proof",country:"CA",baseCurrency:"CAD",timezone:"UTC"},OWNER);
  for(const [actor,handle] of [[SELLER,"tax_first"],[OTHER,"tax_second"]] as const)await joinSite.call({handle,displayName:handle,meetsMinimumAge:true,isAdult:true},actor);
  sellerContact=(await db().select().from(contacts).where(eq(contacts.userId,SELLER.userId)))[0]!.id;
  buyerId=(await resolveContact.call({email:"tax-buyer@example.test",name:"Tax buyer"},OWNER)).contact.id;
  const zone=await createTaxZone.call({name:"Explicit fixture jurisdiction",country:"CA",regions:["BC"],basis:"destination",pricesIncludeTax:false,roundingScope:"line",roundingMode:"half_up"},OWNER);
  zoneId=zone.id;
  gstId=(await addTaxRate.call({zoneId,name:"Fixture GST",jurisdiction:"Fixture federal",ratePpm:50000,appliesToShipping:true},OWNER)).id;
  pstId=(await addTaxRate.call({zoneId,name:"Fixture PST",jurisdiction:"Fixture provincial",ratePpm:70000,appliesToShipping:true,priority:1},OWNER)).id;
 });
 afterAll(closeDb);

 async function declare(actor=SELLER,gst=true,thresholdMinor=0){
  const zone=await merchantTaxZoneConfiguration.call({zoneId},actor);
  return saveMyMerchantTaxProfile.call({expectedVersion:0,idempotencyKey:randomUUID(),acceptPolicy:true,liability:"seller",origin:destination,collectionStatus:"registered",registrations:[
   {zoneId,number:gst?"FIRST-GST":"SECOND-GST",rateIds:[gstId],configurationDigest:zone.configurationDigest,status:gst?"active":"monitoring",...(thresholdMinor?{thresholdMinor,thresholdCurrency:"CAD"}:{})},
   {zoneId,number:gst?"FIRST-PST":"SECOND-PST",rateIds:[pstId],configurationDigest:zone.configurationDigest,status:gst?"monitoring":"active",...(thresholdMinor?{thresholdMinor,thresholdCurrency:"CAD"}:{})},
  ]},actor);
 }
 async function quote(profile:Awaited<ReturnType<typeof declare>>,contactId:string|null=buyerId){
  return previewMerchantTax.call({profileId:profile.profileId,profileVersion:profile.profileVersion,contactId,destination,currency:"CAD",items,shippingMinor:101,occurredAt},SYSTEM);
 }
 async function draft(){
  return createDraftInvoice.call({contactId:buyerId,currency:sourceCurrency,sourceType:"manual",sourceId,idempotencyKey:randomUUID(),shippingMinor:101,
   lines:[{description:"Original taxable item",quantityMicros:1000000,unitAmountMinor:1000,taxCategoryCode:"standard",requiresShipping:true}],tax:{mode:"merchant",destination}},OWNER);
 }
 async function request(kind:"export"|"erasure"){
  const created=await createDataRequest.call({contactId:sellerContact,request:{kind}},OWNER);
  await verifyDataRequest.call({id:created.id,method:"Verified original merchant request"},OWNER);
  return created.id;
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
  expect(a.quote.registrationNumbers.map(row=>row.number)).toEqual(["FIRST-GST","FIRST-GST",null,null]);
  expect(b.quote.registrationNumbers.map(row=>row.number)).toEqual([null,null,"SECOND-PST","SECOND-PST"]);
  expect(a.quote.lines.filter(line=>line.taxMinor>0).every(line=>line.name==="Fixture GST")).toBe(true);
  expect(b.quote.lines.filter(line=>line.taxMinor>0).every(line=>line.name==="Fixture PST")).toBe(true);
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
  expect(await failure(getInvoiceMerchantTaxReceipt.call({invoiceId:created.invoice.id,sellerUserId:OTHER.userId},SYSTEM))).toMatchObject({code:"conflict"});
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
  const request=await createDataRequest.call({contactId:person!.id,request:{kind:"erasure"}},OWNER);
  await verifyDataRequest.call({id:request.id,method:"Verified original merchant request"},OWNER);
  expect(await failure(quote(first))).toMatchObject({code:"conflict"});
  expect(await failure(myMerchantTaxProfile.call({},SELLER))).toMatchObject({code:"conflict"});
 });
 it("exports only the original business declaration and preserves exact ownership through contact merge and undo",async()=>{
  const first=await declare(),second=await declare(OTHER,false);
  const {artifact}=await fulfillDataRequest.call({id:await request("export")},OWNER);
  const [stored]=await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.id,artifact.id));
  const body=stored!.body as {sources:Record<string,unknown>};
  const exported=JSON.stringify(body.sources["commerce.merchantTax"]);
  expect(exported).toContain(first.profileId);expect(exported).toContain("FIRST-GST");
  expect(exported).not.toContain(second.profileId);expect(exported).not.toContain("SECOND-PST");
  const duplicate=(await resolveContact.call({email:"tax-seller-merge@example.test",name:"Original seller duplicate"},OWNER)).contact;
  const merged=await mergeContacts.call({duplicateId:sellerContact,survivingId:duplicate.id},OWNER);
  expect((await db().select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id,first.profileId)))[0]).toMatchObject({contactId:duplicate.id,currentVersion:1});
  await undoContactMerge.call({operationId:merged.mergeOperationId},OWNER);
  expect((await db().select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id,first.profileId)))[0]).toMatchObject({contactId:sellerContact,currentVersion:1});
  expect((await quote(first)).amounts.taxMinor).toBe(55);
 });
 it("minimizes unheld business configuration while retaining issued TaxLine facts and the original opaque receipt",async()=>{
  const first=await declare();
  sourceParties=[{sellerUserId:SELLER.userId,profileId:first.profileId,profileVersion:1,linePositions:[0],shippingMinor:101,occurredAt}];
  const created=await draft();await issueInvoice.call({id:created.invoice.id},OWNER);
  const originalTax=await db().select().from(taxLines).where(eq(taxLines.invoiceId,created.invoice.id));
  const originalReceipt=await getInvoiceMerchantTaxReceipt.call({invoiceId:created.invoice.id,sellerUserId:SELLER.userId},SYSTEM);
  await fulfillDataRequest.call({id:await request("erasure"),confirmation:"ERASE"},OWNER);
  expect((await db().select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id,first.profileId)))[0]).toMatchObject({state:"erased",contactId:null});
  const [erasedVersion]=await db().select().from(merchantTaxProfileVersions).where(eq(merchantTaxProfileVersions.profileId,first.profileId));
  expect(erasedVersion).toMatchObject({origin:{},rulesSnapshot:[]});expect(erasedVersion!.erasedAt).toBeInstanceOf(Date);
  expect(await db().select().from(taxLines).where(eq(taxLines.invoiceId,created.invoice.id))).toEqual(originalTax);
  expect(await getInvoiceMerchantTaxReceipt.call({invoiceId:created.invoice.id,sellerUserId:SELLER.userId},SYSTEM)).toEqual(originalReceipt);
  expect(await failure(quote(first))).toMatchObject({code:"conflict"});
 });
 it("retains a held tax declaration until actual hold release, then erases it even after login deletion",async()=>{
  const first=await declare(),id=await request("erasure");
  const hold=await addRetentionException.call({dataRequestId:id,scope:"commerce.merchantTax",reason:"accounting_tax",legalBasis:"Retain this original declaration during the specific accounting dispute."},OWNER);
  const held=await fulfillDataRequest.call({id,confirmation:"ERASE"},OWNER);
  expect(held.request.status).toBe("partially_completed");
  expect((await db().select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id,first.profileId)))[0]).toMatchObject({state:"active",contactId:sellerContact});
  expect((await db().select().from(merchantTaxProfileVersions).where(eq(merchantTaxProfileVersions.profileId,first.profileId)))[0]).toMatchObject({origin:destination,erasedAt:null});
  await removeRetentionException.call({id:hold.id},OWNER);
  await fulfillDataRequest.call({id:await request("erasure"),confirmation:"ERASE"},OWNER);
  expect((await db().select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id,first.profileId)))[0]).toMatchObject({state:"erased",contactId:null});
 });
 it("keeps a seller's issued sales out of the historical site-only registration threshold",async()=>{
  const registration=await setTaxRegistration.call({zoneId,number:"LEGACY-SITE-ONLY",status:"monitoring",thresholdMinor:100,thresholdCurrency:"CAD"},OWNER);
  const first=await declare();
  sourceParties=[{sellerUserId:SELLER.userId,profileId:first.profileId,profileVersion:1,linePositions:[0],shippingMinor:101,occurredAt}];
  const created=await draft();await issueInvoice.call({id:created.invoice.id},OWNER);
  const report=await listTaxThresholds.call({asOf:new Date(),window:"calendar_year"},OWNER);
  expect(report.thresholds.find(row=>row.registration.id===registration.id)).toMatchObject({grossSalesMinor:0,transactions:0,state:"below"});
 });
 it("reports only the owner's issued gross portions, excluding drafts and another business's sales",async()=>{
  const first=await declare(SELLER,true,1000);await declare(OTHER,false,1000);
  sourceParties=[{sellerUserId:SELLER.userId,profileId:first.profileId,profileVersion:1,linePositions:[0],shippingMinor:101,occurredAt}];
  const created=await draft();
  const pending=await myMerchantTaxThresholds.call({},SELLER);
  expect(pending.thresholds).toHaveLength(2);expect(pending.thresholds.every(row=>row.grossSalesMinor===0&&row.transactions===0)).toBe(true);
  await issueInvoice.call({id:created.invoice.id},OWNER);
  const own=await myMerchantTaxThresholds.call({},SELLER),other=await myMerchantTaxThresholds.call({},OTHER);
  expect(own.thresholds.every(row=>row.zone.id===zoneId&&row.grossSalesMinor===1156&&row.transactions===1&&row.state==="reached"&&row.remainingMinor===0)).toBe(true);
  expect(own.thresholds[0]!.totalsByCurrency).toEqual([{currency:"CAD",grossSalesMinor:1156,transactions:1}]);
  expect(other.thresholds).toHaveLength(2);
  expect(other.thresholds.every(row=>row.grossSalesMinor===0&&row.transactions===0&&row.state==="below")).toBe(true);
  expect((await siteMerchantTaxThresholds.call({},OWNER)).thresholds).toEqual([]);
  expect(await failure(myMerchantTaxThresholds.call({},ANONYMOUS))).toMatchObject({code:"permission"});
 });
 it("keeps another invoice currency out of the explicitly declared threshold amount",async()=>{
  const first=await declare(SELLER,true,1000);
  sourceParties=[{sellerUserId:SELLER.userId,profileId:first.profileId,profileVersion:1,linePositions:[0],shippingMinor:101,occurredAt}];
  // A distinct trusted original manual source in this test is denominated in
  // USD. Its taxes are still frozen in exact USD cents; the CAD threshold is
  // never reached by converting or adding those cents to CAD.
  sourceCurrency="USD";
  const created=await draft();
  await issueInvoice.call({id:created.invoice.id},OWNER);
  const own=await myMerchantTaxThresholds.call({},SELLER);
  expect(own.thresholds.every(row=>row.grossSalesMinor===0&&row.transactions===0&&row.state==="below")).toBe(true);
  expect(own.thresholds[0]!.totalsByCurrency).toEqual([{currency:"USD",grossSalesMinor:1156,transactions:1}]);
 });
 it("does not erase another customer's held certificate when minimizing the merchant's own declaration",async()=>{
  const first=await declare();
  // Declared source fixture: the public customer-request/merchant-review
  // workflow is not claimed here. The original certificate belongs to the
  // buyer and its actual named financial hold must survive another subject's
  // erasure, regardless of the merchant's future collection being disabled.
  const certificate=await db().transaction(async tx=>{
   await allowMerchantTaxWrites(tx);
   return(await tx.insert(taxExemptions).values({merchantProfileId:first.profileId,contactId:buyerId,zoneId,kind:"reverse_charge",certificateRef:"BUYER-OWN-HELD-CERTIFICATE",validatedAt:new Date(),status:"valid"}).returning())[0]!;
  });
  const buyerRequest=await createDataRequest.call({contactId:buyerId,request:{kind:"erasure"}},OWNER);
  await verifyDataRequest.call({id:buyerRequest.id,method:"Verified buyer request with a specific financial hold"},OWNER);
  const hold=await addRetentionException.call({dataRequestId:buyerRequest.id,scope:"commerce.money",reason:"accounting_tax",legalBasis:"Retain this buyer's original certificate for the active accounting dispute."},OWNER);
  await fulfillDataRequest.call({id:await request("erasure"),confirmation:"ERASE"},OWNER);
  expect((await db().select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id,first.profileId)))[0]).toMatchObject({state:"erased",contactId:null});
  expect((await db().select().from(taxExemptions).where(eq(taxExemptions.id,certificate.id)))[0]!.certificateRef).toBe("BUYER-OWN-HELD-CERTIFICATE");
  expect((await db().select().from(taxExemptions).where(eq(taxExemptions.id,certificate.id)))[0]).toEqual(certificate);
  await removeRetentionException.call({id:hold.id},OWNER);
  await fulfillDataRequest.call({id:buyerRequest.id,confirmation:"ERASE"},OWNER);
  expect((await db().select().from(taxExemptions).where(eq(taxExemptions.id,certificate.id)))[0]).toMatchObject({certificateRef:null,status:"revoked"});
 });
});
