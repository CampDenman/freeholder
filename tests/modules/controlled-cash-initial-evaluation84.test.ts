// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Genuine services/Stripe HTTP; no synthetic context or DB rows.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import { db } from "@/core/db";
import { defineService } from "@/core/service";
import { ready } from "@/core/runtime";
import { stopJobs } from "@/core/jobs";
import { entitlementGrants } from "@/core/entitlements/schema";
import { invoices,payments } from "@/modules/invoicing/schema";
import { subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { CONTROLLED_COLLECTION_PROTOCOL } from "@/modules/subscriptions/controlled-provider-collection-contract";
import { collectControlledCollection } from "@/modules/subscriptions/controlled-provider-collection-orchestration";
import { inspectControlledCashReceipt,prepareControlledCashInspection } from "@/modules/invoicing/controlled-cash-inspection-service";
import { merchantCashReturnInspections,merchantCashReturnInspectionFinishes } from "@/modules/invoicing/merchant-refund-schema";
import { controlledCashApplicationBatches,controlledCashApplicationReceipts,controlledCashApplicationLinks } from "@/modules/invoicing/controlled-cash-application-protocol-schema";
import { readControlledCashApplicationEvaluation } from "@/modules/invoicing/controlled-cash-application-evaluation";
import { actualControlledPeriod84 } from "../helpers/actual-controlled-period84";
import { closeDb,hasDatabase,OWNER,truncateSpine } from "../helpers/spine";
const system={kind:"system"} as const;
const scope=z.object({collectionId:z.uuid(),receiptIds:z.array(z.uuid()).min(1).max(5000),requiredProtocol:z.literal(CONTROLLED_COLLECTION_PROTOCOL)}).strict();
const evaluate=defineService({name:"invoicing.testControlledCashInitialEvaluation84",summary:"Read genuine prewrite parent/bank evidence in a real shared transaction without granting application.",kind:"query",permission:"system",external:false,input:scope,
 output:z.object({parentRevision:z.string().regex(/^[a-f0-9]{64}$/),expectedCashMinor:z.number().int(),outstandingAfterMinor:z.number().int(),canonicalPaidMinor:z.number().int(),receiptIds:z.array(z.uuid()),suppliesApplicationAuthority:z.literal(false),suppliesPrincipalAuthority:z.literal(false),suppliesAccessAuthority:z.literal(false)}),
 handler:async(input,ctx)=>{const actual=await readControlledCashApplicationEvaluation(ctx,input);return{parentRevision:actual.parentRevision,expectedCashMinor:actual.plan.expectedCashMinor,outstandingAfterMinor:actual.plan.outstandingAfterMinor,canonicalPaidMinor:actual.plan.proof.canonical.paidMinor,receiptIds:actual.plan.requestedReceiptIds,
  suppliesApplicationAuthority:actual.suppliesApplicationAuthority,suppliesPrincipalAuthority:actual.suppliesPrincipalAuthority,suppliesAccessAuthority:actual.suppliesAccessAuthority};}});
describe.runIf(hasDatabase)("genuine controlled batch initial parent evaluation",{timeout:120000},()=>{
 let f:Awaited<ReturnType<typeof actualControlledPeriod84>>|undefined;
 beforeAll(ready,60000);beforeEach(truncateSpine);afterEach(()=>{vi.useRealTimers();f?.cleanup();f=undefined;vi.restoreAllMocks();});afterAll(async()=>{await stopJobs();await closeDb();});
 async function actualBank(){f=await actualControlledPeriod84();expect(await collectControlledCollection.call({collectionId:f.target.collectionId},OWNER)).toMatchObject({state:"money_retained",applied:false});
  const[receipt]=await db().select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId,f.parent.id));if(!receipt)throw Error("Use the actual retained original target receipt.");
  const input={collectionId:f.target.collectionId,receiptId:receipt.id};expect(await inspectControlledCashReceipt.call(input,OWNER)).toMatchObject({bankReadReturned:true,completeInventory:true,suppliesMoneyAuthority:false});
  return{input,value:{collectionId:input.collectionId,receiptIds:[input.receiptId],requiredProtocol:CONTROLLED_COLLECTION_PROTOCOL}};
 }
 async function financial(){if(!f)throw Error("Use the actual accepted target first.");return{invoices:await db().select().from(invoices),payments:await db().select().from(payments),receipts:await db().select().from(subscriptionProviderChargeReceipts),
  batches:await db().select().from(controlledCashApplicationBatches),receiptProofs:await db().select().from(controlledCashApplicationReceipts),links:await db().select().from(controlledCashApplicationLinks),grants:await db().select().from(entitlementGrants).where(eq(entitlementGrants.sourceSubscriptionId,f.parent.id)),counts:f.remote.counts()};}
 it("evaluates actual retained cash before its first payment, preserving the entire canonical graph and original access",async()=>{const{value}=await actualBank(),before=await financial(),actual=await evaluate.call(value,system);
  expect(actual).toMatchObject({expectedCashMinor:4200,outstandingAfterMinor:0,canonicalPaidMinor:0,receiptIds:value.receiptIds,suppliesApplicationAuthority:false,suppliesPrincipalAuthority:false,suppliesAccessAuthority:false});
  expect(await financial()).toEqual(before);expect(before.batches).toEqual([]);expect(before.receiptProofs).toEqual([]);expect(before.links).toEqual([]);expect(before.grants).toEqual(f?.grants);
 });
 it("refuses a foreign UUID rather than adopting the actual equal cash, without mutating the retained source",async()=>{const{value}=await actualBank(),before=await financial();await expect(evaluate.call({...value,receiptIds:[randomUUID()]},system)).rejects.toMatchObject({code:"conflict"});expect(await financial()).toEqual(before);});
 it("keeps a genuinely admitted newer unfinished caller as debt rather than borrowing an older returned bank proof",async()=>{const{input,value}=await actualBank(),claim=await prepareControlledCashInspection.call(input,system),before=await financial();
  const[admission]=await db().select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id,claim.inspectionId));if(!admission)throw Error("The actual independent caller admission is required.");
  expect(await db().select().from(merchantCashReturnInspectionFinishes).where(eq(merchantCashReturnInspectionFinishes.inspectionId,claim.inspectionId))).toEqual([]);
  await expect(evaluate.call(value,system)).rejects.toMatchObject({code:"conflict"});expect(await financial()).toEqual(before);expect((await db().select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id,claim.inspectionId)))[0]).toEqual(admission);
 });
});
