// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Requires genuine future families, parent queries and owned tails.
import { eq } from "drizzle-orm";
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { stopJobs } from "@/core/jobs";
import { entitlementGrants } from "@/core/entitlements/schema";
import { invoices,payments } from "@/modules/invoicing/schema";
import { subscriptions,subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { subscriptionControlledChargeOrigins,subscriptionControlledFinishes,subscriptionControlledCalls,subscriptionControlledOperations } from "@/modules/subscriptions/controlled-provider-schema";
import { collectControlledCollection } from "@/modules/subscriptions/controlled-provider-collection-orchestration";
import { actualControlledPeriod84 } from "../helpers/actual-controlled-period84";
import { closeDb,hasDatabase,OWNER,truncateSpine } from "../helpers/spine";
describe.runIf(hasDatabase)("actual controlled canonical target bank sequence",{timeout:120000},()=>{
 let f:Awaited<ReturnType<typeof actualControlledPeriod84>>|undefined;
 beforeAll(ready,60000);beforeEach(truncateSpine);afterEach(()=>{vi.useRealTimers();f?.cleanup();f=undefined;vi.restoreAllMocks();});afterAll(async()=>{await stopJobs();await closeDb();});
 async function assertRetained(){
  if(!f)throw Error("Use the actual service-produced original target.");
  const[receipt]=await db().select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId,f.parent.id));
  expect(receipt).toMatchObject({providerInvoiceRef:f.remote.invoices()[0]!.id,amountMinor:4200,currency:"CAD",customerChargeVerified:true,merchantRouteVerified:true});
  expect(await db().select().from(subscriptionControlledChargeOrigins).where(eq(subscriptionControlledChargeOrigins.receiptId,receipt!.id))).toHaveLength(1);
  const[target]=await db().select().from(invoices).where(eq(invoices.id,f.target.invoiceId));expect(target).toMatchObject({subtotalMinor:4000,taxMinor:200,totalMinor:4200,paidMinor:0,creditedMinor:0});
  expect(await db().select().from(payments).where(eq(payments.invoiceId,f.target.invoiceId))).toHaveLength(0);
  expect(await db().select().from(entitlementGrants).where(eq(entitlementGrants.sourceSubscriptionId,f.parent.id))).toEqual(f.grants);
  expect((await db().select().from(subscriptions).where(eq(subscriptions.id,f.parent.id)))[0]).toMatchObject({planId:f.parent.planId,status:f.parent.status,currentPeriodStart:f.parent.currentPeriodStart,currentPeriodEnd:f.parent.currentPeriodEnd});
 }
 it("runs actual update/draft/NET/tax/fee/finalize/pay once and retains real cash without a fake local payment or access advance",async()=>{
  f=await actualControlledPeriod84();const result=await collectControlledCollection.call({collectionId:f.target.collectionId},OWNER);
  expect(result).toMatchObject({state:"money_retained",applied:false,suppliesAccessAuthority:false});expect(f.remote.counts()).toMatchObject({updatePosts:1,draftPosts:1,itemPosts:2,feePosts:1,finalizePosts:1,payPosts:1});await assertRetained();
 });
 it("recovers authentic lost update and draft effects through fresh GET metadata without replaying either original POST or inventing its finish",async()=>{
  f=await actualControlledPeriod84({loseUpdateReply:true,loseDraftReply:true});
  await expect(collectControlledCollection.call({collectionId:f.target.collectionId},OWNER)).rejects.toThrow();expect(f.remote.counts()).toMatchObject({updatePosts:1,draftPosts:0});
  const[update]=await db().select().from(subscriptionControlledOperations).where(eq(subscriptionControlledOperations.kind,"update_calendar")),[call]=update?await db().select().from(subscriptionControlledCalls).where(eq(subscriptionControlledCalls.operationId,update.id)):[];
  const[finish]=call?await db().select().from(subscriptionControlledFinishes).where(eq(subscriptionControlledFinishes.callId,call.id)):[];expect(finish?.actualResult.outcome).toBe("threw");
  await expect(collectControlledCollection.call({collectionId:f.target.collectionId},OWNER)).rejects.toThrow();expect(f.remote.counts()).toMatchObject({updatePosts:1,draftPosts:1});
  expect(await collectControlledCollection.call({collectionId:f.target.collectionId},OWNER)).toMatchObject({state:"money_retained",applied:false});
  expect(f.remote.counts()).toMatchObject({updatePosts:1,draftPosts:1,itemPosts:2,finalizePosts:1,payPosts:1});
  expect((await db().select().from(subscriptionControlledFinishes).where(eq(subscriptionControlledFinishes.callId,call!.id)))[0]).toEqual(finish);await assertRetained();
 });
 it("keeps the actual signed/raw positive cash and canonical receipt when a later price GET fails",async()=>{
  f=await actualControlledPeriod84({failAfterPositiveCash:true});await expect(collectControlledCollection.call({collectionId:f.target.collectionId},OWNER)).rejects.toThrow();
  expect(f.remote.counts().payPosts).toBe(1);await assertRetained();
  expect(await collectControlledCollection.call({collectionId:f.target.collectionId},OWNER)).toMatchObject({state:"money_retained",applied:false});expect(f.remote.counts().payPosts).toBe(1);await assertRetained();
 });
});
