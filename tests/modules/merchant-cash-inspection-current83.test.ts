// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Actual shared admission/callback/finish/read, real Stripe HTTP
// adapter against the declared fictional bank. No local financial row is seeded.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import { db } from "@/core/db";
import { stopJobs } from "@/core/jobs";
import { ready } from "@/core/runtime";
import { defineService } from "@/core/service";
import { prepareMerchantCashReturnInspection,performMerchantCashReturnInspection,finishMerchantCashReturnInspection,recordCashReturnPrimaryObservation,recordCashReturnObservation,finalizeUnappliedCashReturn } from "@/modules/invoicing/merchant-cash-return-service";
import { cashInspectionSource } from "@/modules/invoicing/merchant-cash-inspection-evidence";
import { currentOriginalCashInspection } from "@/modules/invoicing/merchant-cash-inspection-current";
import { originalMerchantRefundCash,lockMerchantRefundCash } from "@/modules/invoicing/merchant-refund-origin";
import { merchantPaymentEvidence } from "@/modules/invoicing/merchant-payment-observations";
import { recordMerchantRefundObservation } from "@/modules/invoicing/merchant-refund-observations";
import { merchantCashReturnInspections,merchantCashReturnInspectionFinishes,merchantCashReturnObservations,merchantUnappliedChargeResolutions } from "@/modules/invoicing/merchant-refund-schema";
import { partialCashFixture } from "../helpers/original-cash-partial";
import { closeDb,hasDatabase,truncateSpine } from "../helpers/spine";
const system={kind:"system"} as const;
const read=defineService({name:"invoicing.testCurrentOriginalCashInspection83",summary:"Read actual current original inspection with its real shared context.",kind:"query",permission:"system",external:false,
 input:z.object({inspectionId:z.uuid(),observationId:z.uuid().optional()}),output:z.object({inspectionId:z.uuid(),observationId:z.uuid(),amountRefundedMinor:z.number().nullable(),revision:z.string()}).nullable(),handler:async(input,ctx)=>{
  const[inspection]=await ctx.tx.select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id,input.inspectionId)).limit(1);if(!inspection)return null;
  await lockMerchantRefundCash(ctx,await originalMerchantRefundCash(ctx,cashInspectionSource(inspection)));
  const checked=await currentOriginalCashInspection(ctx,input);return checked?{inspectionId:checked.inspection.id,observationId:checked.observation.id,amountRefundedMinor:checked.evidence.amountRefundedMinor,revision:checked.revision}:null;
 }});
describe.runIf(hasDatabase)("actual read-only original cash inspection and bare caller debt",{timeout:90000},()=>{
 let fixture:Awaited<ReturnType<typeof partialCashFixture>>|undefined;
 beforeAll(ready,60000);beforeEach(truncateSpine);afterEach(()=>{fixture?.base.cleanup();fixture=undefined;vi.restoreAllMocks();});afterAll(async()=>{await stopJobs();await closeDb();});
 async function original(){fixture=await partialCashFixture({unapplied:true});return fixture;}
 async function perform(f:Awaited<ReturnType<typeof partialCashFixture>>,claim:Awaited<ReturnType<typeof prepareMerchantCashReturnInspection.call>>){
  const inspect=f.base.stripe.inspectMerchantReturnedCash?.bind(f.base.stripe);if(!inspect)throw Error("The real original-account Stripe GET adapter is required.");let observationId:string|undefined;
  await performMerchantCashReturnInspection(claim,()=>inspect({providerPlatformAccountId:claim.providerPlatformAccountId,providerApiVersion:claim.providerApiVersion,...(claim.providerAccountId?{providerAccountId:claim.providerAccountId}:{}),paymentProviderRef:claim.paymentProviderRef,
   onOriginalCashObserved:async evidence=>{await recordCashReturnPrimaryObservation.call({...claim,evidence:merchantPaymentEvidence.extend({amountMinor:z.number().int().nonnegative(),currency:z.string().regex(/^[A-Z]{3}$/)}).parse(evidence)},system);},
   onRefundObserved:async evidence=>{await recordMerchantRefundObservation.call({source:f.source,inspectionId:claim.inspectionId,evidence:{...evidence,providerApiVersion:evidence.providerApiVersion??null,status:evidence.providerStatus??null}},system);},
   onReturnStateObserved:async evidence=>{observationId=(await recordCashReturnObservation.call({...claim,evidence},system)).observationId;}}));
  if(!observationId)throw Error("The actual complete original bank snapshot is required.");return observationId;
 }
 it("blocks a successor GET before the original admission's first callback and permits only that genuine original caller to finish",async()=>{
  const f=await original(),claim=await prepareMerchantCashReturnInspection.call({source:f.source},system);
  expect(await db().select().from(merchantCashReturnObservations).where(eq(merchantCashReturnObservations.inspectionId,claim.inspectionId))).toHaveLength(0);
  await expect(prepareMerchantCashReturnInspection.call({source:f.source},system)).rejects.toMatchObject({code:"conflict"});
  await expect(finishMerchantCashReturnInspection.call(claim,system)).rejects.toMatchObject({code:"permission"});
  expect(await db().select().from(merchantCashReturnInspectionFinishes)).toHaveLength(0);
  const observationId=await perform(f,claim);expect(await read.call({inspectionId:claim.inspectionId,observationId},system)).toMatchObject({amountRefundedMinor:0});
  expect(f.posts).toEqual([]);expect(await db().select().from(merchantUnappliedChargeResolutions)).toHaveLength(0);
 });
 it("returns genuine unreturned bank evidence without manufacturing a returned disposition or payment",async()=>{
  const f=await original(),inspect=vi.spyOn(f.base.stripe,"inspectMerchantReturnedCash"),claim=await prepareMerchantCashReturnInspection.call({source:f.source},system),observationId=await perform(f,claim);
  await expect(perform(f,claim)).rejects.toMatchObject({code:"conflict"});expect(inspect).toHaveBeenCalledTimes(1);
  expect(await read.call({inspectionId:claim.inspectionId,observationId},system)).toMatchObject({inspectionId:claim.inspectionId,observationId,amountRefundedMinor:0});
  expect(await finalizeUnappliedCashReturn.call({inspectionId:claim.inspectionId,observationId},system)).toMatchObject({settled:false,returnReceiptId:null});
  expect(f.posts).toEqual([]);expect(await db().select().from(merchantUnappliedChargeResolutions)).toHaveLength(0);
 });
 it("retains a later actual refund and refuses the earlier clean snapshot and late original callback",async()=>{
  const f=await original(),first=await prepareMerchantCashReturnInspection.call({source:f.source},system),oldObservationId=await perform(f,first);
  expect(await read.call({inspectionId:first.inspectionId,observationId:oldObservationId},system)).toMatchObject({amountRefundedMinor:0});
  f.dashboardRefund(1);const next=await prepareMerchantCashReturnInspection.call({source:f.source},system),observationId=await perform(f,next);
  expect(await read.call({inspectionId:next.inspectionId,observationId},system)).toMatchObject({amountRefundedMinor:1});expect(await read.call({inspectionId:first.inspectionId,observationId:oldObservationId},system)).toBeNull();
  const[old]=await db().select().from(merchantCashReturnObservations).where(eq(merchantCashReturnObservations.id,oldObservationId));if(!old)throw Error("Retain the actual original snapshot.");
  const before=await db().select().from(merchantCashReturnObservations);
  await expect(recordCashReturnObservation.call({...first,evidence:old.evidence},system)).rejects.toMatchObject({code:"conflict"});expect(await db().select().from(merchantCashReturnObservations)).toEqual(before);
  expect(f.posts).toEqual([]);expect(await db().select().from(merchantUnappliedChargeResolutions)).toHaveLength(0);
 });
});
