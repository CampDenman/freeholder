// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Actual canonical target/paid bank receipt, genuine controlled GET.
// This does NOT replace the current9 generic unexpected-cash refusal oracle.
import { eq,sql } from "drizzle-orm";
import { z } from "zod";
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import { db } from "@/core/db";
import { defineService } from "@/core/service";
import { ready } from "@/core/runtime";
import { stopJobs } from "@/core/jobs";
import { entitlementGrants } from "@/core/entitlements/schema";
import { invoices,payments } from "@/modules/invoicing/schema";
import { prepareControlledCashInspection } from "@/modules/invoicing/controlled-cash-inspection-service";
import { performMerchantCashReturnInspection,recordCashReturnPrimaryObservation,recordCashReturnObservation } from "@/modules/invoicing/merchant-cash-return-service";
import { merchantCashReturnInspections,merchantCashReturnInspectionFinishes } from "@/modules/invoicing/merchant-refund-schema";
import { merchantPaymentEvidence } from "@/modules/invoicing/merchant-payment-observations";
import { recordMerchantRefundObservation } from "@/modules/invoicing/merchant-refund-observations";
import { subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { subscriptionControlledChargeOrigins } from "@/modules/subscriptions/controlled-provider-schema";
import { subscriptionControlledCashInspectionLineages } from "@/modules/subscriptions/controlled-cash-inspection-lineage-schema";
import { latestControlledCashInspectionLineage } from "@/modules/subscriptions/controlled-cash-inspection-lineage";
import { collectControlledCollection } from "@/modules/subscriptions/controlled-provider-collection-orchestration";
import { actualControlledPeriod84 } from "../helpers/actual-controlled-period84";
import { closeDb,hasDatabase,OWNER,truncateSpine } from "../helpers/spine";
const system={kind:"system"} as const;
function signal<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(accept=>{resolve=accept;});return{promise,resolve};}
let started=signal<string>(),resume=signal<void>();
const scope=z.object({collectionId:z.uuid(),receiptId:z.uuid()}).strict();
const claimSchema=prepareControlledCashInspection.def.output;
const delayed=defineService({name:"invoicing.testControlledTargetCashOrder84",summary:"Start an actual transaction before B, acquiring no money locks until genuine B finishes.",kind:"mutation",permission:"system",external:false,writeClass:"money",auditInputFields:["collectionId","receiptId"],input:scope,output:claimSchema,
 handler:async(input,ctx)=>{const[clock]=await ctx.tx.execute<{started_at:string}>(sql`select transaction_timestamp()::text as started_at`);if(!clock)throw Error("Start the real transaction before its barrier.");started.resolve(z.coerce.date().parse(clock.started_at).toISOString());await resume.promise;return ctx.callAsSystem(prepareControlledCashInspection,input);}});
describe.runIf(hasDatabase)("actual accepted-target controlled bank read admission order",{timeout:120000},()=>{
 let f:Awaited<ReturnType<typeof actualControlledPeriod84>>|undefined;
 beforeAll(ready,60000);beforeEach(async()=>{await truncateSpine();started=signal<string>();resume=signal<void>();});afterEach(()=>{vi.useRealTimers();f?.cleanup();f=undefined;vi.restoreAllMocks();});afterAll(async()=>{await stopJobs();await closeDb();});
 it("genuinely admits later A with older transaction time, refuses older B while A is unfinished, then selects only actual returned A without new money or access",async()=>{
  f=await actualControlledPeriod84();expect(await collectControlledCollection.call({collectionId:f.target.collectionId},OWNER)).toMatchObject({state:"money_retained",applied:false});
  const[receipt]=await db().select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId,f.parent.id));if(!receipt?.providerChargeRef)throw Error("The real original exact-target bank receipt is required.");
  expect(await db().select().from(subscriptionControlledChargeOrigins).where(eq(subscriptionControlledChargeOrigins.receiptId,receipt.id))).toHaveLength(1);
  const input={collectionId:f.target.collectionId,receiptId:receipt.id},beforePayments=await db().select().from(payments),beforeInvoices=await db().select().from(invoices),beforeCounts=f.remote.counts();
  const inspect=f.remote.provider.inspectMerchantReturnedCash?.bind(f.remote.provider);if(!inspect)throw Error("Use the real original GET-only Stripe adapter.");
  async function perform(claim:z.output<typeof claimSchema>){await performMerchantCashReturnInspection(claim,()=>inspect!({providerPlatformAccountId:claim.providerPlatformAccountId,providerApiVersion:claim.providerApiVersion,...(claim.providerAccountId?{providerAccountId:claim.providerAccountId}:{}),paymentProviderRef:claim.paymentProviderRef,
   onOriginalCashObserved:async evidence=>{await recordCashReturnPrimaryObservation.call({...claim,evidence:merchantPaymentEvidence.extend({amountMinor:z.number().int().nonnegative(),currency:z.string().regex(/^[A-Z]{3}$/)}).parse(evidence)},system);},
   onRefundObserved:async evidence=>{await recordMerchantRefundObservation.call({source:{kind:"subscription",receiptId:input.receiptId},inspectionId:claim.inspectionId,inspectionCompletionNonce:claim.completionNonce,evidence:{...evidence,providerApiVersion:evidence.providerApiVersion??null,status:evidence.providerStatus??null}},system);},
   onReturnStateObserved:async evidence=>{await recordCashReturnObservation.call({...claim,evidence},system);}}));}
  const attempt=delayed.call(input,system),outcome=attempt.then(value=>({ok:true as const,value}),(error:unknown)=>({ok:false as const,error}));
  try{
   const aStarted=await Promise.race([started.promise,outcome.then(result=>{if(!result.ok)throw result.error;throw Error("The delayed actual TX returned before its admission barrier.");})]);
   // A missing genuine future parent/producer is a real failure. Never catch
   // it as a pass, bypass it or fall back to the legacy strict generic lane.
   const b=await prepareControlledCashInspection.call(input,system);await perform(b);
   expect((await db().transaction(tx=>latestControlledCashInspectionLineage(tx,receipt.id))).inspection.id).toBe(b.inspectionId);
   const[admittedB]=await db().select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id,b.inspectionId));
   resume.resolve();const result=await outcome;if(!result.ok)throw result.error;const a=result.value;
   const[admittedA]=await db().select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id,a.inspectionId));
   expect(admittedA?.createdAt.toISOString()).toBe(aStarted);expect(admittedA!.createdAt.getTime()).toBeLessThan(admittedB!.createdAt.getTime());
   const lineages=await db().select().from(subscriptionControlledCashInspectionLineages).where(eq(subscriptionControlledCashInspectionLineages.receiptId,receipt.id)).orderBy(subscriptionControlledCashInspectionLineages.admissionSequence);
   expect(lineages.map(row=>row.inspectionId)).toEqual([b.inspectionId,a.inspectionId]);expect(lineages[1]!.predecessorInspectionId).toBe(b.inspectionId);expect(lineages[1]!.closedInspectionIds).toContain(b.inspectionId);
   await expect(db().transaction(tx=>latestControlledCashInspectionLineage(tx,receipt.id))).rejects.toMatchObject({code:"conflict"});expect(await db().select().from(merchantCashReturnInspectionFinishes)).toHaveLength(1);
   await perform(a);expect((await db().transaction(tx=>latestControlledCashInspectionLineage(tx,receipt.id))).inspection.id).toBe(a.inspectionId);
   expect((await db().select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id,b.inspectionId)))[0]).toEqual(admittedB);expect(await db().select().from(merchantCashReturnInspectionFinishes)).toHaveLength(2);
   expect(await db().select().from(payments)).toEqual(beforePayments);expect(await db().select().from(invoices)).toEqual(beforeInvoices);
   expect(await db().select().from(entitlementGrants).where(eq(entitlementGrants.sourceSubscriptionId,f.parent.id))).toEqual(f.grants);
   expect(f.remote.counts()).toEqual({...beforeCounts,cashGets:beforeCounts.cashGets+2});
  }finally{resume.resolve();await outcome;}
 });
});
