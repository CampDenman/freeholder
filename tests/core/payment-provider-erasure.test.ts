// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38/C11.10: payment-provider cleanup and late feedback boundaries.
import {afterAll,beforeEach,describe,expect,it,vi} from "vitest";
import {createHash,randomUUID} from "node:crypto";
import * as adapters from "@/adapters/payments";
import {createStripePayments} from "@/adapters/payments/stripe";
import {eq,sql} from "drizzle-orm";
import {db} from "@/core/db";
import {createContact,updateContact} from "@/core/contacts/service";
import {contacts,organizations} from "@/core/contacts/schema";
import {createDataRequest,verifyDataRequest,fulfillDataRequest,downloadDataRequestArtifact,denyDataRequest,addRetentionException,registerContactPrivacySource} from "@/core/privacy/service";
import {createDraftInvoice,issueInvoice,createPayment,startPayment} from "@/modules/invoicing/invoice-service";
import {processPaymentProviderEvents} from "@/modules/invoicing/payment-provider-service";
import {paymentMethods,paymentProviderCustomers,paymentProviderEvents,payments} from "@/modules/invoicing/schema";
import {erasePaymentProviderCustomer,providerCustomerErasureScope} from "@/modules/invoicing/provider-erasure";
import {dataRequests,dataRequestArtifacts} from "@/core/privacy/schema";
import {getJob,stopJobs,type JobExecutionContext} from "@/core/jobs";
import {OWNER,closeDb,hasDatabase,truncateSpine} from "../helpers/spine";
let raceGate:{contactId:string;entered:()=>void;resume:Promise<void>}|undefined;
registerContactPrivacySource({scope:"tests.payment-erasure-race",tables:[],eraseOrder:30,exportData:async()=>[],erase:async(_tx,contactId)=>{
 if(raceGate?.contactId===contactId){raceGate.entered();await raceGate.resume;}
 return {affected:0};
}});
function jobContext(id:string):JobExecutionContext{return {id,name:erasePaymentProviderCustomer.name,attempt:1,signal:new AbortController().signal,leaseSeconds:300,heartbeat:async()=>true,isCancelled:async()=>false,throwIfCancelled:async()=>{}};}
function jobIds(result:Awaited<ReturnType<typeof erase>>):string[]{
 const body=result.artifact.body as {outcomes:Array<{scope:string;pendingJobs?:string[]}>};
 return body.outcomes.find(outcome=>outcome.scope===providerCustomerErasureScope)?.pendingJobs??[];
}
async function subject(key:string){return createContact.call({name:`Synthetic ${key}`,email:`${key}@example.test`},OWNER);}
async function erase(contactId:string){
 const request=await createDataRequest.call({contactId,request:{kind:"erasure"}},OWNER);
 await verifyDataRequest.call({id:request.id,method:"Synthetic verified payment erasure"},OWNER);
 return fulfillDataRequest.call({id:request.id,confirmation:"ERASE"},OWNER);
}
async function invoice(contactId:string){
 const draft=await createDraftInvoice.call({contactId,currency:"CAD",idempotencyKey:"erasure-invoice",lines:[{description:"Existing service",quantityMicros:1000000,unitAmountMinor:1000,discountMinor:0,taxCategoryCode:"standard",requiresShipping:false,snapshot:{}}],shippingMinor:0,tax:{mode:"not_applicable",reason:"Synthetic no-tax fixture"}},OWNER);
 return (await issueInvoice.call({id:draft.invoice.id},OWNER)).invoice;
}
describe.runIf(hasDatabase)("payment-provider erasure (C1.08/C12.38/C11.10)",()=>{
 beforeEach(async()=>{raceGate=undefined;vi.restoreAllMocks();await truncateSpine();});
 afterAll(async()=>{await stopJobs();await closeDb();});
 it("keeps provider customer erasure pending after local deletion",async()=>{
  const contact=await subject("provider-pending");
  await db().insert(paymentProviderCustomers).values({contactId:contact.id,provider:"stripe",providerAccountId:"acct_original",providerCustomerRef:"cus_original"});
  const result=await erase(contact.id);
  expect(result.request.status).toBe("in_progress");
  expect(result.request.fulfilledAt).toBeNull();
  expect(await db().select().from(paymentProviderCustomers)).toHaveLength(0);
 });
 it("does not recreate saved cards or customer references from late authenticated method feedback",async()=>{
  const contact=await subject("late-method");
  await erase(contact.id);
  const receivedAt=new Date().toISOString();
  await processPaymentProviderEvents.call({provider:"stripe",bodySha256:"a".repeat(64),receivedAt,events:[{id:"evt_late_method",kind:"saved_method_added",contactId:contact.id,providerCustomerRef:"cus_late",occurredAt:receivedAt,method:{providerRef:"pm_late",providerCustomerRef:"cus_late",kind:"card",label:"Late card ending4242"}}]},{kind:"system"});
  expect(await db().select().from(paymentMethods)).toHaveLength(0);
  expect(await db().select().from(paymentProviderCustomers)).toHaveLength(0);
  expect((await db().select().from(contacts).where(eq(contacts.id,contact.id)))[0]!.source).toBe("privacy-erasure");
 });
 it("records actual late money without restoring erased provider customer data",async()=>{
  const contact=await subject("late-money"),issued=await invoice(contact.id);
  const payment=await createPayment.call({invoiceId:issued.id,provider:"stripe",method:"hosted_checkout",amountMinor:1000,idempotencyKey:"late-money-payment"},OWNER);
  await startPayment.call({id:payment.id,providerRef:"pi_late_money"},OWNER);
  await erase(contact.id);
  const receivedAt=new Date().toISOString();
  await processPaymentProviderEvents.call({provider:"stripe",bodySha256:"b".repeat(64),receivedAt,events:[{id:"evt_late_money",kind:"payment_succeeded",providerRef:"pi_late_money",invoiceId:issued.id,contactId:contact.id,providerCustomerRef:"cus_late_money",amountMinor:1000,currency:"CAD",occurredAt:receivedAt}]},{kind:"system"});
  expect((await db().select().from(payments).where(eq(payments.id,payment.id)))[0]!.status).toBe("succeeded");
  expect(await db().select().from(paymentProviderCustomers)).toHaveLength(0);
 });
 it("durably erases every original account once, waits through outages and replays a confirmed tombstone",async()=>{
  const contact=await subject("all-original-accounts"),other=await subject("unrelated-provider-owner");
  await db().insert(paymentProviderCustomers).values([
   {contactId:contact.id,provider:"stripe",providerAccountId:"",providerCustomerRef:"cus_shared"},
   {contactId:contact.id,provider:"stripe",providerAccountId:"acct_original",providerCustomerRef:"cus_shared"},
   {contactId:other.id,provider:"stripe",providerAccountId:"acct_other",providerCustomerRef:"cus_shared"},
  ]);
  await db().insert(paymentMethods).values({contactId:contact.id,provider:"stripe",providerAccountId:"acct_original",providerMethodRef:"pm_shared",providerCustomerRef:"cus_shared",kind:"card",label:"Saved card",status:"active",consentSource:"provider_checkout",consentedAt:new Date(),providerStatusAt:new Date()});
  const result=await erase(contact.id),ids=jobIds(result);
  expect(ids).toHaveLength(2);
  const deleted=new Set<string>();let failSeller=true;
  const fetcher=vi.fn<typeof fetch>().mockImplementation(async(input,init)=>{
   const [active]=await db().execute<{count:number}>(sql`select count(*)::int as count from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and state like 'idle in transaction%'`);
   expect(active!.count).toBe(0);
   const headers=new Headers(init?.headers),account=headers.get("stripe-account")??"";
   expect(["","acct_original"]).toContain(account);
   expect(typeof input==="string"?input:input instanceof URL?input.href:input.url).toBe("https://stripe.example.test/v1/customers/cus_shared");
   if(init?.method==="DELETE"){
    if(account==="acct_original"&&failSeller){failSeller=false;return new Response(JSON.stringify({error:{code:"synthetic_outage"}}),{status:503});}
    deleted.add(account);
   }
   return Response.json({id:"cus_shared",deleted:deleted.has(account)});
  });
  const provider=createStripePayments({secretKey:"sk_erasure_fixture",webhookSecrets:["whsec_erasure_fixture"],apiBase:"https://stripe.example.test",fetch:fetcher});
  vi.spyOn(adapters,"paymentAdapter").mockReturnValue(provider);
  const queued=await Promise.all(ids.map(id=>getJob(erasePaymentProviderCustomer.name,id)));
  const platform=queued.find(job=>job!.data.providerAccountId==="")!,seller=queued.find(job=>job!.data.providerAccountId==="acct_original")!;
  for(const job of queued){expect(JSON.stringify(job!.data)).not.toContain(contact.email);expect(JSON.stringify(job!.data)).not.toContain(contact.id);expect(job!.data.originalJobId).toBe(job!.id);}
  await erasePaymentProviderCustomer.handler(platform.data,jobContext(platform.id));
  expect((await db().select().from(dataRequests).where(eq(dataRequests.id,result.request.id)))[0]!.status).toBe("in_progress");
  await expect(erasePaymentProviderCustomer.handler(seller.data,jobContext(seller.id))).rejects.toMatchObject({code:"provider_failure"});
  expect((await db().select().from(dataRequests).where(eq(dataRequests.id,result.request.id)))[0]!.status).toBe("in_progress");
  await erasePaymentProviderCustomer.handler(seller.data,jobContext(randomUUID()));
  await erasePaymentProviderCustomer.handler(seller.data,jobContext(randomUUID()));
  expect((await db().select().from(dataRequests).where(eq(dataRequests.id,result.request.id)))[0]!.status).toBe("completed");
  const deletes=fetcher.mock.calls.filter(([,init])=>init?.method==="DELETE");
  expect(deletes).toHaveLength(3);
  expect(deletes.filter(([,init])=>new Headers(init?.headers).get("stripe-account")==="acct_original").map(([,init])=>new Headers(init?.headers).get("idempotency-key"))).toEqual([`privacy-customer:${seller.id}`,`privacy-customer:${seller.id}`]);
  expect(await db().select().from(paymentProviderCustomers)).toMatchObject([{contactId:other.id,providerAccountId:"acct_other",providerCustomerRef:"cus_shared"}]);
 });
 it("captures a customer known only by a saved method before deleting local rows",async()=>{
  const contact=await subject("method-only-customer");
  await db().insert(paymentMethods).values({contactId:contact.id,provider:"stripe",providerAccountId:"acct_original",providerMethodRef:"pm_only",providerCustomerRef:"cus_only",kind:"card",label:"Method-only card",status:"active",consentSource:"provider_checkout",consentedAt:new Date(),providerStatusAt:new Date()});
  const result=await erase(contact.id),ids=jobIds(result);
  expect(ids).toHaveLength(1);expect(await db().select().from(paymentMethods)).toHaveLength(0);
  expect((await getJob(erasePaymentProviderCustomer.name,ids[0]!))!.data).toMatchObject({providerAccountId:"acct_original",providerCustomerRef:"cus_only"});
 });
 it("keeps an unsupported provider pending and honors the existing named money hold",async()=>{
  const contact=await subject("unsupported-provider");
  await db().insert(paymentProviderCustomers).values({contactId:contact.id,provider:"unavailable",providerCustomerRef:"external_customer"});
  const result=await erase(contact.id),id=jobIds(result)[0]!;
  vi.spyOn(adapters,"paymentAdapter").mockReturnValue(adapters.createManualPayments());
  const queued=await getJob(erasePaymentProviderCustomer.name,id);
  await expect(erasePaymentProviderCustomer.handler(queued!.data,jobContext(id))).rejects.toThrow(/remains pending/);
  expect((await db().select().from(dataRequests).where(eq(dataRequests.id,result.request.id)))[0]!.status).toBe("in_progress");
 });
 it("retains both provider work and its local references under one explicit commerce.money hold",async()=>{
  const contact=await subject("provider-money-hold");
  await db().insert(paymentProviderCustomers).values({contactId:contact.id,provider:"stripe",providerAccountId:"acct_original",providerCustomerRef:"cus_held"});
  const request=await createDataRequest.call({contactId:contact.id,request:{kind:"erasure"}},OWNER);
  await verifyDataRequest.call({id:request.id,method:"Synthetic held identity"},OWNER);
  await addRetentionException.call({dataRequestId:request.id,scope:"commerce.money",reason:"legal_obligation",legalBasis:"Synthetic named financial evidence hold"},OWNER);
  const result=await fulfillDataRequest.call({id:request.id,confirmation:"ERASE"},OWNER);
  expect(result.request.status).toBe("partially_completed");expect(jobIds(result)).toEqual([]);
  expect(await db().select().from(paymentProviderCustomers)).toMatchObject([{contactId:contact.id,providerCustomerRef:"cus_held"}]);
 });
 it("rolls back a racing settlement before privacy cutover, then records real money without personal resurrection",async()=>{
  const contact=await subject("provider-erasure-race"),issued=await invoice(contact.id);
  const payment=await createPayment.call({invoiceId:issued.id,provider:"stripe",method:"hosted_checkout",amountMinor:1000,idempotencyKey:"racing-erasure-payment"},OWNER);
  await startPayment.call({id:payment.id,providerRef:"pi_erasure_race"},OWNER);
  let entered!:()=>void,resume!:()=>void;
  const ready=new Promise<void>(resolve=>{entered=resolve;}),resumed=new Promise<void>(resolve=>{resume=resolve;});
  raceGate={contactId:contact.id,entered,resume:resumed};
  const erasing=erase(contact.id);
  await ready;
  const receivedAt=new Date().toISOString(),event={id:"evt_racing_erasure",kind:"payment_succeeded" as const,providerRef:"pi_erasure_race",invoiceId:issued.id,contactId:contact.id,providerCustomerRef:"cus_racing_erasure",amountMinor:1000,currency:"CAD",occurredAt:receivedAt};
  try{
   await expect(processPaymentProviderEvents.call({provider:"stripe",bodySha256:"c".repeat(64),receivedAt,events:[event]},{kind:"system"})).rejects.toMatchObject({code:"conflict"});
   expect((await db().select().from(payments).where(eq(payments.id,payment.id)))[0]!.status).toBe("processing");
   expect(await db().select().from(paymentProviderEvents)).toHaveLength(0);
  }finally{resume();await erasing;raceGate=undefined;}
  await processPaymentProviderEvents.call({provider:"stripe",bodySha256:"c".repeat(64),receivedAt,events:[event]},{kind:"system"});
  expect((await db().select().from(payments).where(eq(payments.id,payment.id)))[0]!.status).toBe("succeeded");
  expect(await db().select().from(paymentProviderCustomers)).toHaveLength(0);
 });

 it("does not let an ordinary source-field edit remove a completed erasure boundary",async()=>{
  const contact=await subject("edited-erasure-marker");
  await erase(contact.id);
  await expect(updateContact.call({id:contact.id,source:"owner-corrected-source"},OWNER)).rejects.toMatchObject({code:"conflict"});
  const receivedAt=new Date().toISOString();
  await processPaymentProviderEvents.call({provider:"stripe",bodySha256:"d".repeat(64),receivedAt,events:[{id:"evt_late_after_source_edit",kind:"saved_method_added",contactId:contact.id,providerCustomerRef:"cus_late_edited",occurredAt:receivedAt,method:{providerRef:"pm_late_edited",providerCustomerRef:"cus_late_edited",kind:"card",label:"Old provider card"}}]},{kind:"system"});
  expect(await db().select().from(paymentMethods)).toHaveLength(0);
  expect(await db().select().from(paymentProviderCustomers)).toHaveLength(0);
 });

 it("refuses a source edit prepared before erasure when its final write races after cutover",async()=>{
  const contact=await subject("racing-source-marker");
  const [organization]=await db().insert(organizations).values({name:"Synthetic source-edit barrier"}).returning();
  let locked!:()=>void,resume!:()=>void;
  const ready=new Promise<void>(resolve=>{locked=resolve;}),resumed=new Promise<void>(resolve=>{resume=resolve;});
  const held=db().transaction(async tx=>{await tx.execute(sql`lock table organizations in access exclusive mode`);locked();await resumed;});
  await ready;
  const editing=updateContact.call({id:contact.id,source:"stale-source-edit",orgId:organization!.id},OWNER).then(value=>({value}),error=>({error: error as unknown}));
  try{
   await vi.waitFor(async()=>{
    const [waiting]=await db().execute<{count:number}>(sql`select count(*)::int as count from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock' and query like '%from "organizations"%'`);
    expect(waiting!.count).toBeGreaterThan(0);
   },{timeout:5000,interval:20});
   expect((await erase(contact.id)).request.status).toBe("completed");
  }finally{resume();await held;}
  expect(await editing).toMatchObject({error:{code:"conflict"}});
  expect((await db().select().from(contacts).where(eq(contacts.id,contact.id)))[0]!.source).toBe("privacy-erasure");
 });

 it("does not let another erasure request forget an existing provider promise",async()=>{
  const contact=await subject("second-erasure-promise");
  await db().insert(paymentProviderCustomers).values({contactId:contact.id,provider:"stripe",providerAccountId:"acct_original",providerCustomerRef:"cus_pending_second"});
  const first=await erase(contact.id);expect(first.request.status).toBe("in_progress");
  await expect(erase(contact.id)).rejects.toMatchObject({code:"conflict"});
  const [artifact]=await db().select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId,first.request.id));
  expect(artifact!.sha256).toBe(first.artifact.sha256);
  expect(artifact!.body).toEqual(first.artifact.body);
  expect((await db().select().from(dataRequests).where(eq(dataRequests.id,first.request.id)))[0]!.status).toBe("in_progress");
 });

 it("does not declare an already-applied legacy erasure complete when its pending receipt is missing",async()=>{
  const contact=await subject("lost-erasure-receipt");
  await db().insert(paymentProviderCustomers).values({contactId:contact.id,provider:"stripe",providerAccountId:"acct_original",providerCustomerRef:"cus_LostReceipt"});
  const first=await erase(contact.id);expect(first.request.status).toBe("in_progress");
  const backup=await downloadDataRequestArtifact.call({id:first.artifact.id},OWNER);
  expect(createHash("sha256").update(backup.content).digest("hex")).toBe(backup.sha256);
  await db().delete(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId,first.request.id));
  await expect(fulfillDataRequest.call({id:first.request.id,confirmation:"ERASE"},OWNER)).rejects.toMatchObject({code:"conflict"});
  await expect(denyDataRequest.call({id:first.request.id,resolution:"Do not discard pending provider work"},OWNER)).rejects.toMatchObject({code:"conflict"});
  expect((await db().select().from(dataRequests).where(eq(dataRequests.id,first.request.id)))[0]!.status).toBe("in_progress");
  // Restore the exact checksum-verified original receipt; no provider outcome
  // is invented. Its actual durable task still has to perform cleanup.
  await db().insert(dataRequestArtifacts).values({id:backup.id,dataRequestId:first.request.id,filename:backup.filename,mime:backup.mime,body:JSON.parse(backup.content) as unknown,sha256:backup.sha256,expiresAt:backup.expiresAt});
  const id=jobIds(first)[0]!,queued=await getJob(erasePaymentProviderCustomer.name,id);
  let deleted=false;
  const provider=createStripePayments({secretKey:"sk_erasure_fixture",webhookSecrets:["whsec_erasure_fixture"],apiBase:"https://stripe.example.test",fetch:async(_input,init)=>{if(init?.method==="DELETE")deleted=true;return Response.json({id:"cus_LostReceipt",deleted});}});
  vi.spyOn(adapters,"paymentAdapter").mockReturnValue(provider);
  await erasePaymentProviderCustomer.handler(queued!.data,jobContext(randomUUID()));
  expect(deleted).toBe(true);
  expect((await db().select().from(dataRequests).where(eq(dataRequests.id,first.request.id)))[0]!.status).toBe("completed");
 });

});
