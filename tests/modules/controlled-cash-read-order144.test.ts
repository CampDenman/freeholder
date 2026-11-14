// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN: desired ACTUAL ordering oracle; never hand-insert/adopt money.
// Current9's strict raw-debt gate may correctly refuse before the first GET.
// That is a genuine unmet positive dependency, NOT a passing ordering proof.
import { and,eq,sql } from "drizzle-orm";
import { z } from "zod";
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import * as adapters from "@/adapters/payments";
import { createStripePayments } from "@/adapters/payments/stripe";
import { db } from "@/core/db";
import { defineService } from "@/core/service";
import { ready } from "@/core/runtime";
import { stopJobs } from "@/core/jobs";
import { merchantRefundSource } from "@/modules/invoicing/merchant-refund-origin";
import { merchantPaymentEvidence } from "@/modules/invoicing/merchant-payment-observations";
import { prepareMerchantCashReturnInspection,performMerchantCashReturnInspection,recordCashReturnPrimaryObservation,recordCashReturnObservation } from "@/modules/invoicing/merchant-cash-return-service";
import { recordMerchantRefundObservation } from "@/modules/invoicing/merchant-refund-observations";
import { merchantCashReturnInspections,merchantCashReturnInspectionFinishes } from "@/modules/invoicing/merchant-refund-schema";
import { invoices,payments } from "@/modules/invoicing/schema";
import { subscriptionProviderChargeReceipts,subscriptionProviderChargeObservations } from "@/modules/subscriptions/schema";
import { prepareControlledProviderCalendar,stopControlledProviderCalendar } from "@/modules/subscriptions/controlled-provider-execution";
import { subscriptionControlledChargeOrigins } from "@/modules/subscriptions/controlled-provider-schema";
import { subscriptionControlledCashInspectionLineages } from "@/modules/subscriptions/controlled-cash-inspection-lineage-schema";
import { latestControlledCashInspectionLineage } from "@/modules/subscriptions/controlled-cash-inspection-lineage";
import { seedActualProviderSubscription80 } from "../helpers/merchant-subscription80";
import { controlledProviderEdge80 } from "../helpers/merchant-controlled-provider80";
import { closeDb,hasDatabase,OWNER,truncateSpine } from "../helpers/spine";
const system={kind:"system"} as const;
function signal<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(accept=>{resolve=accept;});return{promise,resolve};}
const claimSchema=z.object({inspectionId:z.uuid(),completionNonce:z.string(),providerPlatformAccountId:z.string(),providerAccountId:z.string().nullable(),providerApiVersion:z.enum(["2026-02-25.clover","2026-10-28.endive"]),paymentProviderRef:z.string()});
let started=signal<string>(),resume=signal<void>();
const delayed=defineService({name:"invoicing.testActuallyDelayedCashAdmission144",summary:"Start an actual transaction before another genuine read, admitting only after its actual caller finishes.",kind:"mutation",permission:"system",external:false,writeClass:"money",input:z.object({source:merchantRefundSource}),output:claimSchema,
 handler:async(input,ctx)=>{const[clock]=await ctx.tx.execute<{started_at:Date}>(sql`select transaction_timestamp() as started_at`);if(!clock)throw Error("The actual transaction must exist before the barrier.");started.resolve(clock.started_at.toISOString());await resume.promise;return ctx.callAsSystem(prepareMerchantCashReturnInspection,input);}});
describe.runIf(hasDatabase)("actual controlled cash ordering is admission order, never transaction start",{timeout:90000},()=>{
 let original:Awaited<ReturnType<typeof seedActualProviderSubscription80>>|undefined;
 beforeAll(ready,60000);beforeEach(async()=>{await truncateSpine();started=signal<string>();resume=signal<void>();});afterEach(()=>{original?.fixture.cleanup();original=undefined;vi.restoreAllMocks();});afterAll(async()=>{await stopJobs();await closeDb();});
 it("keeps B current until later-admitted A, refuses B while A unfinished, then selects the genuine returned A despite its older created_at",async()=>{
  original=await seedActualProviderSubscription80();const remote=controlledProviderEdge80();vi.spyOn(adapters,"paymentAdapter").mockReturnValue(remote.provider);
  const subscriptionId=original.accepted.subscription.id,prepared=await prepareControlledProviderCalendar.call({subscriptionId},OWNER);remote.externallyPayUnexpectedInvoice();
  expect(await stopControlledProviderCalendar.call({resourceId:prepared.resourceId},OWNER)).toMatchObject({calendarCanceled:true,financiallyQuiesced:false});
  const[receipt]=await db().select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId,subscriptionId));if(!receipt?.providerChargeRef)throw Error("Use the actual independently retained unexpected positive receipt.");
  expect(await db().select().from(subscriptionControlledChargeOrigins).where(eq(subscriptionControlledChargeOrigins.receiptId,receipt.id))).toHaveLength(1);
  const[observation]=await db().select().from(subscriptionProviderChargeObservations).where(and(eq(subscriptionProviderChargeObservations.subscriptionId,subscriptionId),eq(subscriptionProviderChargeObservations.providerPaymentIntentRef,receipt.providerPaymentIntentRef),eq(subscriptionProviderChargeObservations.providerInvoiceRef,receipt.providerInvoiceRef))).limit(1);
  if(!observation)throw Error("Use the actual retained receipt observation, never a fabricated phase/source.");
  const source={kind:"subscription" as const,receiptId:receipt.id,observationId:observation.id},gets:string[]=[];
  const bank=createStripePayments({secretKey:"sk_actual_order_control",webhookSecrets:["whsec_actual_order_control"],apiBase:"https://stripe.example.test",fetch:vi.fn<typeof fetch>(async(input,init={})=>{
   const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url);expect(init.method).toBe("GET");gets.push(url.pathname);
   if(url.pathname==="/v1/account")return Response.json({id:receipt.providerPlatformAccountId});
   if(url.pathname===`/v1/payment_intents/${receipt.providerPaymentIntentRef}`)return Response.json({id:receipt.providerPaymentIntentRef,status:"succeeded",amount:receipt.amountMinor,amount_received:receipt.amountMinor,amount_capturable:0,currency:receipt.currency.toLowerCase(),latest_charge:receipt.providerChargeRef});
   if(url.pathname===`/v1/charges/${receipt.providerChargeRef}`)return Response.json({id:receipt.providerChargeRef,payment_intent:receipt.providerPaymentIntentRef,amount_captured:receipt.amountMinor,currency:receipt.currency.toLowerCase(),paid:true,captured:true,refunded:false,amount_refunded:0,application_fee:null,transfer:receipt.actualDestinationAccountId?"tr_actualCashReadOrder":null});
   if(url.pathname==="/v1/transfers/tr_actualCashReadOrder")return Response.json({id:"tr_actualCashReadOrder",source_transaction:receipt.providerChargeRef,destination:receipt.actualDestinationAccountId,amount:receipt.amountMinor,amount_reversed:0,currency:receipt.currency.toLowerCase(),reversed:false});
   if(url.pathname==="/v1/refunds"||url.pathname==="/v1/disputes")return Response.json({data:[],has_more:false});
   throw Error(`Unexpected bank order control GET: ${url.pathname}`);
  })}),inspect=bank.inspectMerchantReturnedCash?.bind(bank);if(!inspect)throw Error("The genuine GET-only Stripe adapter is required.");
  async function perform(claim:z.infer<typeof claimSchema>){await performMerchantCashReturnInspection(claim,()=>inspect!({providerPlatformAccountId:claim.providerPlatformAccountId,providerApiVersion:claim.providerApiVersion,...(claim.providerAccountId?{providerAccountId:claim.providerAccountId}:{}),paymentProviderRef:claim.paymentProviderRef,
   onOriginalCashObserved:async evidence=>{await recordCashReturnPrimaryObservation.call({...claim,evidence:merchantPaymentEvidence.extend({amountMinor:z.number().int().nonnegative(),currency:z.string().regex(/^[A-Z]{3}$/)}).parse(evidence)},system);},
   onRefundObserved:async evidence=>{await recordMerchantRefundObservation.call({source,inspectionId:claim.inspectionId,evidence:{...evidence,providerApiVersion:evidence.providerApiVersion??null,status:evidence.providerStatus??null}},system);},
   onReturnStateObserved:async evidence=>{await recordCashReturnObservation.call({...claim,evidence},system);}}));}
  const attempt=delayed.call({source},system),outcome=attempt.then(value=>({ok:true as const,value}),error=>({ok:false as const,error}));
  try{
   const aStarted=await started.promise;
   // DO NOT catch/reinterpret a genuine current9 raw-debt refusal here. It
   // means the ordering path is not yet admitted, not that this oracle passed.
   const b=await prepareMerchantCashReturnInspection.call({source},system);await perform(b);
   expect((await db().transaction(tx=>latestControlledCashInspectionLineage(tx,receipt.id))).inspection.id).toBe(b.inspectionId);
   resume.resolve();const result=await outcome;if(!result.ok)throw result.error;const a=result.value;
   const[admittedA]=await db().select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id,a.inspectionId)),[admittedB]=await db().select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id,b.inspectionId));
   expect(admittedA?.createdAt.toISOString()).toBe(aStarted);expect(admittedA!.createdAt.getTime()).toBeLessThan(admittedB!.createdAt.getTime());
   const rows=await db().select().from(subscriptionControlledCashInspectionLineages).orderBy(subscriptionControlledCashInspectionLineages.admissionSequence);expect(rows.map(row=>row.inspectionId)).toEqual([b.inspectionId,a.inspectionId]);expect(rows[1]?.predecessorInspectionId).toBe(b.inspectionId);expect(rows[1]?.closedInspectionIds).toContain(b.inspectionId);
   await expect(db().transaction(tx=>latestControlledCashInspectionLineage(tx,receipt.id))).rejects.toMatchObject({code:"conflict"});expect(await db().select().from(merchantCashReturnInspectionFinishes)).toHaveLength(1);
   await perform(a);expect((await db().transaction(tx=>latestControlledCashInspectionLineage(tx,receipt.id))).inspection.id).toBe(a.inspectionId);
   expect(await db().select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id,b.inspectionId))).toEqual([admittedB]);expect(await db().select().from(merchantCashReturnInspectionFinishes)).toHaveLength(2);
   expect(await db().select().from(payments)).toHaveLength(0);expect(await db().select().from(invoices)).toHaveLength(0);expect(gets.filter(path=>path.startsWith("/v1/payment_intents/"))).toHaveLength(2);
  }finally{resume.resolve();await outcome;}
 });
});
