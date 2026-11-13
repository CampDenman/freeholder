// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Real shared wrapper/callback +real Stripe HTTP read, no seeded
// observation, fake holder, invented finish or provider POST.
import { eq,inArray } from "drizzle-orm";
import { z } from "zod";
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { stopJobs } from "@/core/jobs";
import { prepareMerchantCashReturnInspection,performMerchantCashReturnInspection,recordCashReturnPrimaryObservation,recordCashReturnObservation } from "@/modules/invoicing/merchant-cash-return-service";
import { recordMerchantRefundObservation } from "@/modules/invoicing/merchant-refund-observations";
import { merchantCashReturnInspections,merchantRefundObservations } from "@/modules/invoicing/merchant-refund-schema";
import { merchantRefundObservationCaptures } from "@/modules/invoicing/merchant-refund-current-schema";
import { merchantPaymentEvidence } from "@/modules/invoicing/merchant-payment-observations";
import { cashInspectionEvidenceKeys } from "@/modules/invoicing/merchant-cash-inspection-stops";
import { verifiedCashInspectionRefundCapture } from "@/modules/invoicing/merchant-cash-inspection-refund-capture";
import { partialCashFixture } from "../helpers/original-cash-partial";
import { closeDb,hasDatabase,truncateSpine } from "../helpers/spine";
const system={kind:"system"} as const;
describe.runIf(hasDatabase)("actual original inspection callback capture ownership",{timeout:90000},()=>{
 let fixture:Awaited<ReturnType<typeof partialCashFixture>>|undefined;
 beforeAll(ready,60000);beforeEach(truncateSpine);afterEach(()=>{fixture?.base.cleanup();fixture=undefined;vi.restoreAllMocks();});afterAll(async()=>{await stopJobs();await closeDb();});
 it("authenticates the actual held callback but retains a later same-state occurrence separately without adopting it as that read",async()=>{
  const f=fixture=await partialCashFixture({unapplied:true});f.dashboardRefund(1);
  const claim=await prepareMerchantCashReturnInspection.call({source:f.source},system),inspect=f.base.stripe.inspectMerchantReturnedCash?.bind(f.base.stripe);if(!inspect)throw Error("The real Stripe GET adapter is required.");
  let callback:z.input<typeof recordMerchantRefundObservation.def.input>|undefined;
  await performMerchantCashReturnInspection(claim,()=>inspect({providerPlatformAccountId:claim.providerPlatformAccountId,providerApiVersion:claim.providerApiVersion,...(claim.providerAccountId?{providerAccountId:claim.providerAccountId}:{}),paymentProviderRef:claim.paymentProviderRef,
   onOriginalCashObserved:async evidence=>{await recordCashReturnPrimaryObservation.call({...claim,evidence:merchantPaymentEvidence.extend({amountMinor:z.number().int().nonnegative(),currency:z.string().regex(/^[A-Z]{3}$/)}).parse(evidence)},system);},
   onRefundObserved:async evidence=>{callback={source:f.source,inspectionId:claim.inspectionId,inspectionCompletionNonce:claim.completionNonce,evidence:{...evidence,providerApiVersion:evidence.providerApiVersion??null,status:evidence.providerStatus??null}};await recordMerchantRefundObservation.call(callback,system);},
   onReturnStateObserved:async evidence=>{await recordCashReturnObservation.call({...claim,evidence},system);}}));
  const[admission]=await db().select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id,claim.inspectionId)),observations=await db().select().from(merchantRefundObservations).where(eq(merchantRefundObservations.inspectionId,claim.inspectionId));
  if(!admission||!callback||observations.length!==1)throw Error("The actual original callback and its retained semantic row are required.");
  const captures=await db().select().from(merchantRefundObservationCaptures).where(inArray(merchantRefundObservationCaptures.observationId,observations.map(row=>row.id)));expect(captures).toHaveLength(1);
  const original=observations[0],capture=captures[0];if(!original||!capture)throw Error("Retain the actual owned capture.");expect(verifiedCashInspectionRefundCapture(admission,original,capture,cashInspectionEvidenceKeys())).toBe(true);
  // An actual repeated authenticated occurrence arrives after wrapper finish.
  // Retain its raw money; the closed old holder cannot sign/adopt it.
  const late=await recordMerchantRefundObservation.call(callback,system),[raw]=await db().select().from(merchantRefundObservations).where(eq(merchantRefundObservations.id,late.observationId)),[occurrence]=await db().select().from(merchantRefundObservationCaptures).where(eq(merchantRefundObservationCaptures.id,late.captureId));
  expect(raw).toMatchObject({inspectionId:null,claimedInspectionId:claim.inspectionId,amountMinor:1});if(!raw||!occurrence)throw Error("Retain the actual late raw occurrence.");expect(verifiedCashInspectionRefundCapture(admission,raw,occurrence,cashInspectionEvidenceKeys())).toBe(false);
  expect(await db().select().from(merchantRefundObservations).where(eq(merchantRefundObservations.id,original.id))).toEqual([original]);expect(f.posts).toEqual([]);
 });
});
