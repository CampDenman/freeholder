// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C11.10/C1.08 PREPARED/UNRUN: real admissions/HTTP SDK/retainers, no inserted financial rows.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import * as adapters from "@/adapters/payments";
import { ready } from "@/core/runtime";
import { db } from "@/core/db";
import { stopJobs } from "@/core/jobs";
import { invoices,payments } from "@/modules/invoicing/schema";
import { subscriptions,subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { prepareControlledProviderCalendar,stopControlledProviderCalendar,executeControlledOperation } from "@/modules/subscriptions/controlled-provider-execution";
import { planControlledProviderOperation } from "@/modules/subscriptions/controlled-provider-plan";
import { closeControlledZeroProviderResource } from "@/modules/subscriptions/controlled-provider-zero-closure";
import { controlledProviderJournal } from "@/modules/subscriptions/controlled-provider-proof";
import { subscriptionControlledResources,subscriptionControlledFacts,subscriptionControlledFinishes,subscriptionControlledVerifications } from "@/modules/subscriptions/controlled-provider-schema";
import { seedActualProviderSubscription80 } from "../helpers/merchant-subscription80";
import { controlledProviderEdge80 } from "../helpers/merchant-controlled-provider80";
import { closeDb,hasDatabase,OWNER,truncateSpine } from "../helpers/spine";
const secret="PRIVATE_SAFE_RESPONSE_NATIVE_CLIENT_SECRET_CONTACT_CARD";
describe.runIf(hasDatabase)("actual controlled safe response retention",{timeout:120000},()=>{
 let seed:Awaited<ReturnType<typeof seedActualProviderSubscription80>>|undefined;
 beforeAll(ready,60000);beforeEach(truncateSpine);
 afterEach(()=>{seed?.fixture.cleanup();seed=undefined;vi.restoreAllMocks();});afterAll(async()=>{await stopJobs();await closeDb();});
 async function evidence(){return{facts:await db().select().from(subscriptionControlledFacts),finishes:await db().select().from(subscriptionControlledFinishes),verifications:await db().select().from(subscriptionControlledVerifications)};}
 it("retains actual positive cash/receipt before interpretation without retaining nested private provider data or advancing access",async()=>{
  seed=await seedActualProviderSubscription80();const id=seed.accepted.subscription.id;
  const remote:ReturnType<typeof controlledProviderEdge80>=controlledProviderEdge80({extra:async(url,init)=>{
   if(url.pathname!=="/v1/payment_intents/pi_actualControlledUnexpected"||init.method!=="GET")return null;
   const current=z.record(z.string(),z.unknown()).parse(remote.currentSubscription());
   return Response.json({id:"pi_actualControlledUnexpected",object:"payment_intent",status:"succeeded",customer:current.customer,amount:500,amount_received:500,amount_capturable:0,currency:"cad",client_secret:secret,payment_method:current.default_payment_method,latest_charge:{id:"ch_actualControlledUnexpected",object:"charge",amount:500,amount_captured:500,amount_refunded:0,currency:"cad",disputed:false,billing_details:{name:secret,email:secret,card:{number:secret}},metadata:{private:secret}},transfer_data:current.transfer_data,on_behalf_of:current.on_behalf_of});
  }});vi.spyOn(adapters,"paymentAdapter").mockReturnValue(remote.provider);
  const[before]=await db().select().from(subscriptions).where(eq(subscriptions.id,id));
  const prepared=await prepareControlledProviderCalendar.call({subscriptionId:id},OWNER);remote.externallyPayUnexpectedInvoice();
  expect(await stopControlledProviderCalendar.call({resourceId:prepared.resourceId},OWNER)).toMatchObject({calendarCanceled:true,invoiceCount:2,financiallyQuiesced:false});
  const receipts=await db().select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId,id));expect(receipts).toHaveLength(1);expect(receipts[0]).toMatchObject({providerPaymentIntentRef:"pi_actualControlledUnexpected",providerChargeRef:"ch_actualControlledUnexpected",amountMinor:500,currency:"CAD"});
  const history=await db().transaction(tx=>controlledProviderJournal(tx,prepared.resourceId));expect(history.unfinished).toEqual([]);expect(history.facts.some(row=>row.actual.kind==="intent_read"&&row.actual.raw.amount_received===500)).toBe(true);expect(history.chargeOrigins).toHaveLength(1);
  expect(JSON.stringify(await evidence())).not.toContain(secret);expect(JSON.stringify(receipts)).not.toContain(secret);
  await expect(closeControlledZeroProviderResource.call({resourceId:prepared.resourceId},OWNER)).rejects.toMatchObject({code:"conflict"});
  expect((await db().select().from(subscriptions).where(eq(subscriptions.id,id)))[0]).toEqual(before);
  expect(await db().select().from(invoices).where(eq(invoices.sourceType,"subscription"))).toHaveLength(0);expect(await db().select().from(payments)).toHaveLength(0);
 });
 it("commits a malformed financial-currency map as safe unknown review, preserving supported zero without granting known-zero authority",async()=>{
  seed=await seedActualProviderSubscription80();const id=seed.accepted.subscription.id;
  const remote:ReturnType<typeof controlledProviderEdge80>=controlledProviderEdge80({extra:async(url,init)=>{
   if(url.pathname.startsWith("/v1/customers/")&&init.method==="GET")return Response.json({id:url.pathname.split("/")[3],object:"customer",currency:"cad",balance:0,invoice_credit_balance:{cad:0,[secret]:secret},cash_balance:null,email:secret,name:secret});
   if(url.pathname==="/v1/credit_notes"&&init.method==="GET")return Response.json({object:"list",data:[],has_more:false});return null;
  }});vi.spyOn(adapters,"paymentAdapter").mockReturnValue(remote.provider);
  const prepared=await prepareControlledProviderCalendar.call({subscriptionId:id},OWNER),operation=await planControlledProviderOperation.call({resourceId:prepared.resourceId,kind:"read_customer_financials"},{kind:"system"});
  const actual=await executeControlledOperation(operation.operationId,OWNER);expect(actual).toMatchObject({balanceState:"review",customer:{balance:0,invoice_credit_balance:{cad:0}}});
  const history=await db().transaction(tx=>controlledProviderJournal(tx,prepared.resourceId)),fact=history.facts.find(row=>row.actual.kind==="customer_financial_read");expect(fact).toBeDefined();
  expect(z.object({unknownFinancialPathCount:z.number().int().positive()}).parse(fact?.actual.raw._freeholder_projection).unknownFinancialPathCount).toBeGreaterThan(0);
  expect(history.finishes.some(row=>row.actualResult.outcome==="returned")).toBe(true);expect(history.verificationViews.find(row=>row.operationId===operation.operationId)?.resultView.balanceState).toBe("review");
  expect(JSON.stringify(await evidence())).not.toContain(secret);expect(await db().select().from(subscriptionProviderChargeReceipts)).toHaveLength(0);expect(await db().select().from(payments)).toHaveLength(0);
  await stopControlledProviderCalendar.call({resourceId:prepared.resourceId},OWNER);await expect(closeControlledZeroProviderResource.call({resourceId:prepared.resourceId},OWNER)).rejects.toMatchObject({code:"conflict"});
  const[resource]=await db().select().from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,prepared.resourceId));expect(resource?.subscriptionId).toBe(id);
 });
});
