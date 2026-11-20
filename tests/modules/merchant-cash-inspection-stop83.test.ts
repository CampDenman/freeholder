// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN: live actual child -> real exit -> independent stop -> NEW GET.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath,pathToFileURL } from "node:url";
import { eq,sql } from "drizzle-orm";
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import { z } from "zod";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { stopJobs } from "@/core/jobs";
import { defineService } from "@/core/service";
import { prepareMerchantCashReturnInspection,performMerchantCashReturnInspection,recordCashReturnPrimaryObservation,recordCashReturnObservation,finishMerchantCashReturnInspection } from "@/modules/invoicing/merchant-cash-return-service";
import { cashInspectionRecoveryList,cashInspectionRecoveryPlan,reviewCashInspectionCallerStopped } from "@/modules/invoicing/merchant-cash-inspection-stop-service";
import { CASH_INSPECTION_STOP_CONFIRMATION } from "@/modules/invoicing/merchant-cash-inspection-stop-proof";
import { cashInspectionStopFinancialWitness,exportCashInspectionStops } from "@/modules/invoicing/merchant-cash-inspection-stops";
import { invoiceMerchantDependencyFingerprints,exportMerchantRecoveryHistory } from "@/modules/invoicing/merchant-payment-dependencies";
import { merchantRefundDependencyFingerprints } from "@/modules/invoicing/merchant-refund-dependencies";
import { cashInspectionSource } from "@/modules/invoicing/merchant-cash-inspection-evidence";
import { originalMerchantRefundCash,lockMerchantRefundCash } from "@/modules/invoicing/merchant-refund-origin";
import { currentOriginalCashInspection } from "@/modules/invoicing/merchant-cash-inspection-current";
import { merchantCashReturnInspections,merchantCashReturnInspectionFinishes,merchantCashReturnPrimaryObservations,merchantCashReturnObservations } from "@/modules/invoicing/merchant-refund-schema";
import { merchantCashReturnInspectionStops } from "@/modules/invoicing/merchant-cash-inspection-stop-schema";
import { merchantPaymentEvidence } from "@/modules/invoicing/merchant-payment-observations";
import { recordMerchantRefundObservation } from "@/modules/invoicing/merchant-refund-observations";
import { partialCashFixture } from "../helpers/original-cash-partial";
import { closeDb,hasDatabase,OWNER,truncateSpine } from "../helpers/spine";
const system={kind:"system"} as const;
const current=defineService({name:"invoicing.testStoppedCashInspection83",summary:"Read real stopped inspection without claiming a returned wrapper.",kind:"query",permission:"system",external:false,input:z.object({inspectionId:z.uuid()}),output:z.boolean(),handler:async(input,ctx)=>{const[inspection]=await ctx.tx.select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id,input.inspectionId));if(!inspection)return false;await lockMerchantRefundCash(ctx,await originalMerchantRefundCash(ctx,cashInspectionSource(inspection)));return!!(await currentOriginalCashInspection(ctx,input));}});
describe.runIf(hasDatabase)("authentic original cash inspection independent stop",{timeout:90000},()=>{
 let fixture:Awaited<ReturnType<typeof partialCashFixture>>|undefined;
 beforeAll(ready,60000);beforeEach(truncateSpine);afterEach(()=>{fixture?.base.cleanup();fixture=undefined;vi.restoreAllMocks();});afterAll(async()=>{await stopJobs();await closeDb();});
 it.runIf(process.platform==="linux")("refuses live/foreign review, waits for the original child's actual exit, preserves its NULL finish and only then admits a new real bank GET",async()=>{
  const f=fixture=await partialCashFixture({unapplied:true}),require=createRequire(import.meta.url),loader=require.resolve("tsx",{paths:[dirname(require.resolve("vite/package.json"))]}),childEnv:NodeJS.ProcessEnv={...process.env,NODE_ENV:"test"};delete childEnv.FREEHOLDER_JOBS;delete childEnv.NEXT_PHASE;
  const child=spawn(process.execPath,["--import",pathToFileURL(loader).href,fileURLToPath(new URL("../fixtures/original-cash-interrupted-inspection.ts",import.meta.url)),JSON.stringify(f.source)],{cwd:process.cwd(),env:childEnv,stdio:["ignore","pipe","pipe","ipc"]});
  child.stdout?.resume();let diagnostics="",ended=false;child.stderr?.on("data",chunk=>{diagnostics=(diagnostics+String(chunk)).slice(-4000);});child.once("exit",()=>{ended=true;});
  try{
   const ticket=await new Promise<{inspectionId:string}>((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error("The actual original cash GET did not reach its committed admission barrier.")),30000);
    child.once("message",message=>{clearTimeout(timeout);const parsed=z.object({inspectionId:z.uuid()}).safeParse(message);if(parsed.success)resolve(parsed.data);else{const error=z.object({error:z.string()}).safeParse(message);reject(Error(error.success?error.data.error:diagnostics));}});child.once("error",error=>{clearTimeout(timeout);reject(error);});child.once("exit",code=>{clearTimeout(timeout);reject(Error(`Child exited ${code} before GET barrier: ${diagnostics}`));});});
   const[before]=await db().select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id,ticket.inspectionId));if(!before)throw Error("The actual original admission must exist.");
   const plan=await cashInspectionRecoveryPlan.call(ticket,OWNER);expect(plan).toMatchObject({inspectionId:ticket.inspectionId,liveness:"live",originalBirthKnown:true,finished:false,reviewed:false});
   const pending=await cashInspectionRecoveryList.call({},OWNER);expect(pending).toHaveLength(1);expect(pending[0]).toMatchObject({inspectionId:ticket.inspectionId,callerId:plan.callerId,liveness:"live",originalBirthKnown:true});
   expect(Object.keys(pending[0]!).sort()).toEqual(["callerId","createdAt","host","inspectionId","liveness","originalBirthKnown","pid","startedAt"]);
   await expect(cashInspectionRecoveryList.call({},{...OWNER,keyScopes:["invoicing.cashInspectionRecoveryList"]})).rejects.toMatchObject({code:"permission"});await expect(cashInspectionRecoveryList.call({},system)).rejects.toMatchObject({code:"permission"});
   expect(await db().select().from(merchantCashReturnPrimaryObservations)).toHaveLength(0);expect(await db().select().from(merchantCashReturnObservations)).toHaveLength(0);
   const review={inspectionId:plan.inspectionId,expectedCallerId:plan.callerId,expectedAdmissionDigest:plan.admissionDigest,expectedSourceRevision:plan.sourceRevision,hostingEvidence:"Synthetic independent hosting review for this exact original child's actual exit, not a timeout or a successor read.",confirmation:CASH_INSPECTION_STOP_CONFIRMATION};
   await expect(reviewCashInspectionCallerStopped.call(review,OWNER)).rejects.toMatchObject({code:"conflict"});await expect(reviewCashInspectionCallerStopped.call(review,{...OWNER,keyScopes:["invoicing.reviewCashInspectionCallerStopped"]})).rejects.toMatchObject({code:"permission"});
   await expect(prepareMerchantCashReturnInspection.call({source:f.source},system)).rejects.toMatchObject({code:"conflict"});expect(await db().select().from(merchantCashReturnInspectionStops)).toHaveLength(0);
   const exited=once(child,"exit");child.kill("SIGKILL");await exited;
   await expect(reviewCashInspectionCallerStopped.call({...review,expectedSourceRevision:"f".repeat(64)},OWNER)).rejects.toMatchObject({code:"conflict"});
   const mergeBeforeStop=await db().transaction(tx=>invoiceMerchantDependencyFingerprints(tx,[f.invoiceId]));expect(mergeBeforeStop?.get(f.invoiceId)).toMatch(/^[a-f0-9]{64}$/);
   expect(await reviewCashInspectionCallerStopped.call(review,OWNER)).toEqual({reviewed:true,mechanicalCheck:"original_process_absent"});
   expect(await cashInspectionRecoveryList.call({},OWNER)).toEqual([]);
   const mergeAfterStop=await db().transaction(tx=>invoiceMerchantDependencyFingerprints(tx,[f.invoiceId]));expect(mergeAfterStop?.get(f.invoiceId)).toMatch(/^[a-f0-9]{64}$/);expect(mergeAfterStop?.get(f.invoiceId)).not.toBe(mergeBeforeStop?.get(f.invoiceId));
   expect(await db().select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id,before.id))).toEqual([before]);expect(await db().select().from(merchantCashReturnInspectionFinishes)).toHaveLength(0);expect(await current.call(ticket,system)).toBe(false);
   await expect(finishMerchantCashReturnInspection.call({inspectionId:before.id,completionNonce:"A".repeat(43)},system)).rejects.toMatchObject({code:"conflict"});
   await expect(db().transaction(async tx=>{await tx.execute(sql`select set_config('freeholder.merchant_refund_v1','1',true)`);await tx.insert(merchantCashReturnInspectionFinishes).values({inspectionId:before.id,callerInstanceId:before.caller.id,outcome:"returned"});})).rejects.toThrow();
   const paymentId=before.paymentId;if(!paymentId)throw Error("The fixture must retain its actual payment-owned source.");
   const witness=await db().transaction(tx=>cashInspectionStopFinancialWitness(tx,{paymentIds:[paymentId],receiptIds:[]}));expect(witness.entries).toHaveLength(1);expect(witness.entries[0]).toMatchObject({table:"merchant_cash_return_inspection_stops",id:before.id,inspectionId:before.id});expect(witness.entries[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);expect(exportCashInspectionStops(witness.stops)).toEqual([{inspectionId:before.id,reviewedAt:witness.stops[0]?.createdAt,callerStopped:true,suppliesBankEvidence:false}]);
   const originalChildren=await db().transaction(tx=>merchantRefundDependencyFingerprints(tx,{paymentIds:[paymentId],subscriptionChargeReceiptIds:[]}));
   expect(originalChildren.incomplete).toBe(false);expect(originalChildren.entries.filter(row=>row.table==="merchant_cash_return_inspection_stops")).toEqual(witness.entries.map(({table,id,fingerprint})=>({table,id,fingerprint})));
   const subjectHistory=await db().transaction(tx=>exportMerchantRecoveryHistory(tx,[f.invoiceId]));expect(subjectHistory).toMatchObject({originalCashInspectionStops:exportCashInspectionStops(witness.stops)});
   const claim=await prepareMerchantCashReturnInspection.call({source:f.source},system),inspect=f.base.stripe.inspectMerchantReturnedCash?.bind(f.base.stripe);if(!inspect)throw Error("The real Stripe GET adapter is required.");
   await performMerchantCashReturnInspection(claim,()=>inspect({providerPlatformAccountId:claim.providerPlatformAccountId,providerApiVersion:claim.providerApiVersion,...(claim.providerAccountId?{providerAccountId:claim.providerAccountId}:{}),paymentProviderRef:claim.paymentProviderRef,
    onOriginalCashObserved:async evidence=>{await recordCashReturnPrimaryObservation.call({...claim,evidence:merchantPaymentEvidence.extend({amountMinor:z.number().int().nonnegative(),currency:z.string().regex(/^[A-Z]{3}$/)}).parse(evidence)},system);},
    onRefundObserved:async evidence=>{await recordMerchantRefundObservation.call({source:f.source,inspectionId:claim.inspectionId,evidence:{...evidence,providerApiVersion:evidence.providerApiVersion??null,status:evidence.providerStatus??null}},system);},
    onReturnStateObserved:async evidence=>{await recordCashReturnObservation.call({...claim,evidence},system);}}));
   expect(await current.call({inspectionId:claim.inspectionId},system)).toBe(true);expect(await db().select().from(merchantCashReturnInspectionFinishes)).toMatchObject([{inspectionId:claim.inspectionId,outcome:"returned"}]);expect(await db().select().from(merchantCashReturnInspectionStops)).toHaveLength(1);expect(f.posts).toEqual([]);
   expect(await cashInspectionRecoveryList.call({},OWNER)).toEqual([]);
   const[latest]=await db().select().from(merchantCashReturnObservations).where(eq(merchantCashReturnObservations.inspectionId,claim.inspectionId)).orderBy(merchantCashReturnObservations.sequence);if(!latest)throw Error("The new actual bank read must retain its own evidence.");
   const retainedStates=await db().select().from(merchantCashReturnObservations);
   await expect(recordCashReturnObservation.call({inspectionId:before.id,completionNonce:"A".repeat(43),evidence:latest.evidence},system)).rejects.toMatchObject({code:"conflict"});expect(await db().select().from(merchantCashReturnObservations)).toEqual(retainedStates);
   await expect(db().transaction(async tx=>{await tx.execute(sql`select set_config('freeholder.cash_inspection_stop_v1',${before.id},true)`);await tx.delete(merchantCashReturnInspectionStops).where(eq(merchantCashReturnInspectionStops.inspectionId,before.id));})).rejects.toThrow();
  }finally{if(!ended){const exited=once(child,"exit");child.kill("SIGKILL");await exited;}}
 });
});
