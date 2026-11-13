// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN. Requires assembled new tail AND real parent readiness/namespace
// integration. No admission, financial row or provider resource is hand-inserted.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath,pathToFileURL } from "node:url";
import { z } from "zod";
import { eq,sql } from "drizzle-orm";
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import * as paymentAdapters from "@/adapters/payments";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { stopJobs } from "@/core/jobs";
import { invoices,payments } from "@/modules/invoicing/schema";
import { subscriptions,subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { prepareControlledProviderCalendar,recoverControlledProviderCalendar,stopControlledProviderCalendar,recoverControlledProviderOperation } from "@/modules/subscriptions/controlled-provider-execution";
import { closeControlledZeroProviderResource } from "@/modules/subscriptions/controlled-provider-zero-closure";
import { controlledProviderWitnesses,exportControlledProviderHistory } from "@/modules/subscriptions/controlled-provider-witnesses";
import { subscriptionControlledResources,subscriptionControlledCalls,subscriptionControlledFinishes,subscriptionControlledClosures,subscriptionControlledStops } from "@/modules/subscriptions/controlled-provider-schema";
import { planControlledProviderOperation } from "@/modules/subscriptions/controlled-provider-plan";
import { controlledProviderRecoveryPlan,reviewControlledProviderCallerStopped,CONTROLLED_PROVIDER_STOP_CONFIRMATION } from "@/modules/subscriptions/controlled-provider-stop";
import { seedActualProviderSubscription80 } from "../helpers/merchant-subscription80";
import { controlledProviderEdge80 } from "../helpers/merchant-controlled-provider80";
import { closeDb,hasDatabase,OWNER,truncateSpine } from "../helpers/spine";
describe.runIf(hasDatabase)("actual original zero controlled transport lifecycle",{timeout:90000},()=>{
 let source:Awaited<ReturnType<typeof seedActualProviderSubscription80>>|undefined;
 beforeAll(ready,60000);beforeEach(truncateSpine);
 afterEach(()=>{source?.fixture.cleanup();source=undefined;vi.restoreAllMocks();vi.useRealTimers();});afterAll(async()=>{await stopJobs();await closeDb();});
 async function original(loseBootstrapReply=false){
  source=await seedActualProviderSubscription80();const remote=controlledProviderEdge80({loseBootstrapReply});vi.spyOn(paymentAdapters,"paymentAdapter").mockReturnValue(remote.provider);
  const subscriptionId=source.accepted.subscription.id,before=(await db().select().from(subscriptions).where(eq(subscriptions.id,subscriptionId)))[0]!;
  return{subscriptionId,before,remote};
 }
 it("prepares zero-only actual collection pause without rewriting accepted trial/calendar, inventing a canonical invoice/PI or marking financial stop",async()=>{
  const originalSource=await original(),prepared=await prepareControlledProviderCalendar.call({subscriptionId:originalSource.subscriptionId},OWNER);
  expect(prepared).toMatchObject({collectionPausedAsDraft:true,positiveCollectionAdmissible:false,fixedTaxRequiredBeforeCollection:true});
  expect(originalSource.remote.bootstrapPosts()).toBe(1);expect(originalSource.remote.pausePosts()).toBe(1);expect(source!.remote.schedulePosts()).toBe(0);
  expect((await db().select().from(subscriptions).where(eq(subscriptions.id,originalSource.subscriptionId)))[0]).toEqual(originalSource.before);
  expect(await db().select().from(invoices).where(sql`${invoices.sourceType}='subscription' and split_part(${invoices.sourceId},':',1)=${originalSource.subscriptionId}`)).toHaveLength(0);
  expect(await db().select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId,originalSource.subscriptionId))).toHaveLength(0);
  const witness=await db().transaction(tx=>controlledProviderWitnesses(tx,{subscriptionIds:[originalSource.subscriptionId]}));expect(witness.incomplete).toBe(false);expect(witness.resources).toHaveLength(1);
  expect(witness.calls.length).toBe(4);expect(witness.finishes.length).toBe(4);expect(witness.closures).toHaveLength(0);
  expect(JSON.stringify(exportControlledProviderHistory(witness))).not.toMatch(/pm_actual|cus_actual|nonce|publicKey|signature|pidNamespace|startTicks|hostingEvidence/);
 });
 it("recovers an actual lost zero-create response by discovering and pausing that same resource, preserving its thrown finish and never POSTing twice",async()=>{
  const originalSource=await original(true);await expect(prepareControlledProviderCalendar.call({subscriptionId:originalSource.subscriptionId},OWNER)).rejects.toThrow();
  const[resource]=await db().select().from(subscriptionControlledResources).where(eq(subscriptionControlledResources.subscriptionId,originalSource.subscriptionId));if(!resource)throw Error("Actual original zero resource was not retained");
  const originalCalls=await db().select().from(subscriptionControlledCalls);expect(originalCalls).toHaveLength(1);
  const originalFinish=await db().select().from(subscriptionControlledFinishes);expect(originalFinish).toHaveLength(1);expect(originalFinish[0]!.actualResult.outcome).toBe("threw");
  expect(await recoverControlledProviderCalendar.call({resourceId:resource.id},OWNER)).toMatchObject({verified:true,collectionPausedAsDraft:true});
  expect(originalSource.remote.bootstrapPosts()).toBe(1);expect(originalSource.remote.discoveryGets()).toBe(1);expect(originalSource.remote.pausePosts()).toBe(1);
  expect((await db().select().from(subscriptionControlledFinishes).where(eq(subscriptionControlledFinishes.callId,originalCalls[0]!.id)))[0]).toEqual(originalFinish[0]);
  expect((await db().select().from(subscriptions).where(eq(subscriptions.id,originalSource.subscriptionId)))[0]).toEqual(originalSource.before);
 });
 it("retains real unexpected positive provider cash and its exact canonical receipt origin before refusing zero closure, without inventing an invoice/payment/access",async()=>{
  const originalSource=await original(),prepared=await prepareControlledProviderCalendar.call({subscriptionId:originalSource.subscriptionId},OWNER);originalSource.remote.externallyPayUnexpectedInvoice();
  expect(await stopControlledProviderCalendar.call({resourceId:prepared.resourceId},OWNER)).toMatchObject({calendarCanceled:true,invoiceCount:2,financiallyQuiesced:false});
  const receipts=await db().select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId,originalSource.subscriptionId));expect(receipts).toHaveLength(1);
  expect(receipts[0]).toMatchObject({providerSubscriptionRef:"sub_actualControlledZero",providerInvoiceRef:"in_actualControlledUnexpected",providerPaymentIntentRef:"pi_actualControlledUnexpected",amountMinor:500,currency:"CAD"});
  const witness=await db().transaction(tx=>controlledProviderWitnesses(tx,{subscriptionIds:[originalSource.subscriptionId]}));expect(witness.incomplete).toBe(false);expect(witness.chargeOrigins).toHaveLength(1);expect(witness.chargeOrigins[0]!.id).toBe(receipts[0]!.id);
  await expect(closeControlledZeroProviderResource.call({resourceId:prepared.resourceId},OWNER)).rejects.toMatchObject({code:"conflict"});expect(await db().select().from(subscriptionControlledClosures)).toHaveLength(0);
  expect((await db().select().from(subscriptions).where(eq(subscriptions.id,originalSource.subscriptionId)))[0]).toEqual(originalSource.before);
  expect(await db().select().from(invoices).where(sql`${invoices.sourceType}='subscription' and split_part(${invoices.sourceId},':',1)=${originalSource.subscriptionId}`)).toHaveLength(0);expect(await db().select().from(payments)).toHaveLength(0);
 });
 it.runIf(process.platform==="linux")("refuses an actual live original GET, separately proves its stopped process, and only then performs a new original-resource GET",async()=>{
  const originalSource=await original(),prepared=await prepareControlledProviderCalendar.call({subscriptionId:originalSource.subscriptionId},OWNER);
  const planned=await planControlledProviderOperation.call({resourceId:prepared.resourceId,kind:"read_bootstrap"},{kind:"system"});
  const require=createRequire(import.meta.url),loader=require.resolve("tsx",{paths:[dirname(require.resolve("vite/package.json"))]});
  const childEnv:NodeJS.ProcessEnv={...process.env,NODE_ENV:"test",STRIPE_SECRET_KEY:"sk_controlled_interrupted_fixture",STRIPE_WEBHOOK_SECRET:"whsec_controlled_interrupted_fixture"};delete childEnv.FREEHOLDER_JOBS;delete childEnv.NEXT_PHASE;
  const child=spawn(process.execPath,["--import",pathToFileURL(loader).href,fileURLToPath(new URL("../fixtures/subscription-interrupted-controlled-reader.ts",import.meta.url)),planned.operationId],{cwd:process.cwd(),env:childEnv,stdio:["ignore","pipe","pipe","ipc"]});
  let ended=false,diagnostics="";child.stdout?.resume();child.stderr?.on("data",chunk=>{diagnostics=(diagnostics+String(chunk)).slice(-4000);});child.once("exit",()=>{ended=true;});
  try{
   const ticket=await new Promise<{callId:string}>((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error("Actual controlled child did not reach its committed GET barrier")),30000);
    child.once("message",message=>{clearTimeout(timeout);const actual=z.object({callId:z.uuid()}).safeParse(message);if(actual.success)resolve(actual.data);else reject(Error(z.object({error:z.string()}).safeParse(message).success?String(Reflect.get(message as object,"error")):diagnostics));});
    child.once("error",error=>{clearTimeout(timeout);reject(error);});child.once("exit",code=>{clearTimeout(timeout);reject(Error(`Controlled child exited ${code} before actual GET: ${diagnostics}`));});});
   const row=(await controlledProviderRecoveryPlan.call({subscriptionId:originalSource.subscriptionId},OWNER)).find(row=>row.callId===ticket.callId);if(!row)throw Error("No genuine original controlled GET recovery plan");expect(row.liveness).toBe("live");
   const review={resourceId:row.resourceId,operationId:row.operationId,callId:row.callId,expectedCallerId:row.callerId,expectedAdmissionDigest:row.admissionDigest,expectedSourceRevision:row.currentEvidenceRevision,
    hostingEvidence:"Actual isolated original child is explicitly killed and its exit awaited in this control before the stop is accepted.",confirmation:CONTROLLED_PROVIDER_STOP_CONFIRMATION};
   await expect(reviewControlledProviderCallerStopped.call(review,OWNER)).rejects.toMatchObject({code:"conflict"});await expect(reviewControlledProviderCallerStopped.call(review,{...OWNER,keyScopes:["invoicing.reviewControlledProviderCallerStopped"]})).rejects.toMatchObject({code:"permission"});
   await expect(recoverControlledProviderOperation.call({operationId:planned.operationId},OWNER)).rejects.toMatchObject({code:"conflict"});
   const exited=once(child,"exit");child.kill("SIGKILL");await exited;
   expect(await reviewControlledProviderCallerStopped.call(review,OWNER)).toMatchObject({reviewed:true,mechanicalCheck:"original_process_absent"});
   expect(await db().select().from(subscriptionControlledFinishes).where(eq(subscriptionControlledFinishes.callId,ticket.callId))).toHaveLength(0);
   expect(await db().select().from(subscriptionControlledStops).where(eq(subscriptionControlledStops.callId,ticket.callId))).toHaveLength(1);
   expect(await recoverControlledProviderOperation.call({operationId:planned.operationId},OWNER)).toEqual({observed:true});expect(originalSource.remote.bootstrapPosts()).toBe(1);
   expect(await db().select().from(subscriptionControlledFinishes).where(eq(subscriptionControlledFinishes.callId,ticket.callId))).toHaveLength(0);
  }finally{if(!ended){const exited=once(child,"exit");child.kill("SIGKILL");await exited;}}
 });
 it("records genuine calendar cancellation separately, closes actual zero invoices, and makes old closed-resource preparation unable to dispatch another POST",async()=>{
  const originalSource=await original(),prepared=await prepareControlledProviderCalendar.call({subscriptionId:originalSource.subscriptionId},OWNER);
  expect(await stopControlledProviderCalendar.call({resourceId:prepared.resourceId},OWNER)).toEqual({resourceId:prepared.resourceId,calendarCanceled:true,invoiceCount:1,financiallyQuiesced:false});
  expect(await db().select().from(subscriptionControlledClosures)).toHaveLength(0);
  expect(await closeControlledZeroProviderResource.call({resourceId:prepared.resourceId},OWNER)).toEqual({closed:true});
  expect(await db().select().from(subscriptionControlledClosures)).toHaveLength(1);expect(originalSource.remote.cancelCalls()).toBe(1);
  await expect(prepareControlledProviderCalendar.call({subscriptionId:originalSource.subscriptionId},OWNER)).rejects.toMatchObject({code:"conflict"});expect(originalSource.remote.bootstrapPosts()).toBe(1);
  expect(await db().select().from(payments)).toHaveLength(0);expect((await db().select().from(subscriptions).where(eq(subscriptions.id,originalSource.subscriptionId)))[0]).toEqual(originalSource.before);
 });
});
