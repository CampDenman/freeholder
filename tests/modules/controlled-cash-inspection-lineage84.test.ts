// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Actual unchanged ordinary admission/GET/finish proves the new
// controlled-only model does not adopt a legacy payment or replace its digest.
// Positive controlled batch qualification additionally requires the real future
// observation producer/parent query; this test makes no such acceptance claim.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { stopJobs } from "@/core/jobs";
import { defineService } from "@/core/service";
import { currentOriginalCashInspection } from "@/modules/invoicing/merchant-cash-inspection-current";
import { prepareMerchantCashReturnInspection,performMerchantCashReturnInspection,recordCashReturnPrimaryObservation,recordCashReturnObservation } from "@/modules/invoicing/merchant-cash-return-service";
import { originalMerchantRefundCash,lockMerchantRefundCash } from "@/modules/invoicing/merchant-refund-origin";
import { cashInspectionSource } from "@/modules/invoicing/merchant-cash-inspection-evidence";
import { merchantCashReturnInspections } from "@/modules/invoicing/merchant-refund-schema";
import { merchantPaymentEvidence } from "@/modules/invoicing/merchant-payment-observations";
import { recordMerchantRefundObservation } from "@/modules/invoicing/merchant-refund-observations";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptionControlledCashInspectionLineages } from "@/modules/subscriptions/controlled-cash-inspection-lineage-schema";
import { controlledCashInspectionLineageWitness,exportControlledCashInspectionLineages } from "@/modules/subscriptions/controlled-cash-inspection-lineage";
import { partialCashFixture } from "../helpers/original-cash-partial";
import { closeDb,hasDatabase,truncateSpine } from "../helpers/spine";
const system={kind:"system"} as const;
const current=defineService({name:"invoicing.testLegacyCashLineage84",summary:"Verify unchanged original legacy bank evidence after a controlled-only admission extension.",kind:"query",permission:"system",external:false,input:z.object({inspectionId:z.uuid()}),output:z.boolean(),handler:async({inspectionId},ctx)=>{
 const[admission]=await ctx.tx.select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id,inspectionId));if(!admission)return false;
 await lockMerchantRefundCash(ctx,await originalMerchantRefundCash(ctx,cashInspectionSource(admission)));return!!await currentOriginalCashInspection(ctx,{inspectionId});
}});
describe.runIf(hasDatabase)("genuine original legacy inspection remains outside controlled admission lineage",{timeout:90000},()=>{
 let fixture:Awaited<ReturnType<typeof partialCashFixture>>|undefined;
 beforeAll(ready,60000);beforeEach(truncateSpine);afterEach(()=>{fixture?.base.cleanup();fixture=undefined;vi.restoreAllMocks();});afterAll(async()=>{await stopJobs();await closeDb();});
 it("retains the actual legacy admission digest/GET outcome with no child or invented controlled owner",async()=>{
  const f=fixture=await partialCashFixture({unapplied:true}),claim=await prepareMerchantCashReturnInspection.call({source:f.source},system);
  const[original]=await db().select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id,claim.inspectionId));if(!original?.paymentId)throw Error("The actual original payment-owned admission is required.");
  const before=merchantTaxDigest(original),inspect=f.base.stripe.inspectMerchantReturnedCash?.bind(f.base.stripe);if(!inspect)throw Error("Use the genuine GET-only Stripe adapter.");
  await performMerchantCashReturnInspection(claim,()=>inspect({providerPlatformAccountId:claim.providerPlatformAccountId,providerApiVersion:claim.providerApiVersion,...(claim.providerAccountId?{providerAccountId:claim.providerAccountId}:{}),paymentProviderRef:claim.paymentProviderRef,
   onOriginalCashObserved:async evidence=>{await recordCashReturnPrimaryObservation.call({...claim,evidence:merchantPaymentEvidence.extend({amountMinor:z.number().int().nonnegative(),currency:z.string().regex(/^[A-Z]{3}$/)}).parse(evidence)},system);},
   onRefundObserved:async evidence=>{await recordMerchantRefundObservation.call({source:f.source,inspectionId:claim.inspectionId,evidence:{...evidence,providerApiVersion:evidence.providerApiVersion??null,status:evidence.providerStatus??null}},system);},
   onReturnStateObserved:async evidence=>{await recordCashReturnObservation.call({...claim,evidence},system);}}));
  expect(await current.call({inspectionId:claim.inspectionId},system)).toBe(true);
  const[after]=await db().select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id,claim.inspectionId));expect(merchantTaxDigest(after)).toBe(before);
  expect(await db().select().from(subscriptionControlledCashInspectionLineages)).toEqual([]);
  const witness=await db().transaction(tx=>controlledCashInspectionLineageWitness(tx,{paymentIds:[original.paymentId!]}));expect(witness.entries).toEqual([]);expect(exportControlledCashInspectionLineages(witness.lineages)).toEqual([]);expect(f.posts).toEqual([]);
 });
});
