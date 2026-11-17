// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// Real DB transactions, original SDK holders and actual savepoints.
import {randomUUID} from "node:crypto";
import {eq,inArray,sql} from "drizzle-orm";
import {z} from "zod";
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import * as paymentAdapters from "@/adapters/payments";
import {db} from "@/core/db";
import {ready} from "@/core/runtime";
import {stopJobs} from "@/core/jobs";
import {defineService,type Tx} from "@/core/service";
import {merchantTaxDigest} from "@/modules/invoicing/merchant-tax-store";
import {invoices,payments} from "@/modules/invoicing/schema";
import {entitlementGrants} from "@/core/entitlements/schema";
import {controlledProviderJournal,assertControlledCallersQuiesced,originalControlledCall} from "@/modules/subscriptions/controlled-provider-proof";
import {requireControlledCurrentVerification} from "@/modules/subscriptions/controlled-provider-safe-response-proof";
import {subscriptionControlledResources,subscriptionControlledOperations,subscriptionControlledCalls,subscriptionControlledFacts,subscriptionControlledFinishes,subscriptionControlledStops,subscriptionControlledVerifications,subscriptionControlledChargeOrigins,subscriptionControlledClosures} from "@/modules/subscriptions/controlled-provider-schema";
import {prepareControlledProviderCalendar,executeControlledOperation} from "@/modules/subscriptions/controlled-provider-execution";
import {retainControlledProviderResource} from "@/modules/subscriptions/controlled-provider-source";
import {planControlledProviderOperation} from "@/modules/subscriptions/controlled-provider-plan";
import {collectControlledCollection} from "@/modules/subscriptions/controlled-provider-collection-orchestration";
import {readControlledReceiptNamespace} from "@/modules/subscriptions/controlled-provider-cash-namespace";
import {subscriptionProviderChargeReceipts} from "@/modules/subscriptions/schema";
import {seedActualProviderSubscription80} from "../helpers/merchant-subscription80";
import {controlledPeriodEdge84} from "../helpers/merchant-controlled-period84";
import {actualControlledPeriod84} from "../helpers/actual-controlled-period84";
import {actualControlledOpenInvoice84} from "../helpers/actual-controlled-open-invoice84";
import {OWNER,closeDb,hasDatabase,truncateSpine} from "../helpers/spine";
const system={kind:"system"} as const;
type ContentRead={inventory:boolean;ordinal:number};
type History=Awaited<ReturnType<typeof controlledProviderJournal>>;
function expectBase(actual:History,expected:Omit<History,"verificationViews">){
 const{verificationViews,...rows}=actual;expect(rows).toEqual(expected);expect(verificationViews).toHaveLength(actual.verifications.length);
 for(const verification of actual.verifications)expect(()=>requireControlledCurrentVerification(actual,verification)).not.toThrow();
}
function observeContentReads(tx:Tx,before:(read:ContentRead)=>Promise<void>=async()=>{},after:(read:ContentRead,actual:unknown)=>Promise<void>=async()=>{}){
 const execute:Tx["execute"]=tx.execute.bind(tx);let count=0;
 const intercepted:Tx["execute"]=<Row extends Record<string,unknown>>(query:Parameters<Tx["execute"]>[0])=>{
  const pending=execute<Row>(query),statement=pending.getQuery();
  if(statement.sql.includes("controlled_journal_pg_content.v1")){
   const read={inventory:statement.sql.includes("controlled-journal-content-certificate.v1"),ordinal:++count},run=pending.execute.bind(pending);
   pending.execute=async()=>{await before(read);const actual=await run();await after(read,actual);return actual;};
  }
  return pending;
 };
 return{spy:vi.spyOn(tx,"execute").mockImplementation(intercepted),count:()=>count};
}
async function originalRows(tx:Tx,resourceId:string):Promise<Omit<History,"verificationViews">>{
 const operations=await tx.select().from(subscriptionControlledOperations).where(eq(subscriptionControlledOperations.resourceId,resourceId)).orderBy(subscriptionControlledOperations.ordinal).limit(5001),ids=operations.map(row=>row.id);
 const calls=ids.length?await tx.select().from(subscriptionControlledCalls).where(inArray(subscriptionControlledCalls.operationId,ids)).orderBy(subscriptionControlledCalls.id).limit(5001):[],callIds=calls.map(row=>row.id);
 const facts=callIds.length?await tx.select().from(subscriptionControlledFacts).where(inArray(subscriptionControlledFacts.callId,callIds)).orderBy(subscriptionControlledFacts.callId,subscriptionControlledFacts.ordinal).limit(5001):[];
 const finishes=callIds.length?await tx.select().from(subscriptionControlledFinishes).where(inArray(subscriptionControlledFinishes.callId,callIds)).orderBy(subscriptionControlledFinishes.callId).limit(5001):[];
 const stops=callIds.length?await tx.select().from(subscriptionControlledStops).where(inArray(subscriptionControlledStops.callId,callIds)).orderBy(subscriptionControlledStops.callId).limit(5001):[];
 const verifications=ids.length?await tx.select().from(subscriptionControlledVerifications).where(inArray(subscriptionControlledVerifications.operationId,ids)).orderBy(subscriptionControlledVerifications.operationId).limit(5001):[];
 verifications.sort((left,right)=>(operations.find(row=>row.id===left.operationId)?.ordinal??0)-(operations.find(row=>row.id===right.operationId)?.ordinal??0));
 const chargeOrigins=await tx.select().from(subscriptionControlledChargeOrigins).where(eq(subscriptionControlledChargeOrigins.resourceId,resourceId)).orderBy(subscriptionControlledChargeOrigins.receiptId).limit(5001),closures=await tx.select().from(subscriptionControlledClosures).where(eq(subscriptionControlledClosures.resourceId,resourceId)).limit(2);
 const rows={operations,calls,facts,finishes,stops,verifications,chargeOrigins,closures},unfinished=calls.filter(call=>!finishes.some(row=>row.callId===call.id)&&!stops.some(row=>row.callId===call.id)).map(row=>row.id);
 return{...rows,unfinished,count:1+Object.values(rows).reduce((sum,entries)=>sum+entries.length,0),revision:merchantTaxDigest(rows)};
}
const rollback=Error("Rollback the genuine same-session savepoint without provider I/O");
const savepointABA=defineService({name:"subscriptions.testControlledJournalAtomicSnapshot84",summary:"Verify genuine same-session J0 to J1 to J0 cannot certify an independently loaded raw journal.",kind:"mutation",permission:"system",external:false,writeClass:"money",input:z.object({resourceId:z.uuid()}).strict(),output:z.literal(true),handler:async({resourceId},ctx)=>{
 const first=await originalRows(ctx.tx,resourceId),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
 let injection=false,injectedOrdinal:number|undefined,plannedId:string|undefined,savepoint:Promise<unknown>|undefined;
 const observation=observeContentReads(ctx.tx,async read=>{
  if(!read.inventory||injection)return;injection=true;injectedOrdinal=read.ordinal;
  savepoint=ctx.tx.transaction(async nested=>{
   const[parentId]=await ctx.tx.execute<{id:string}>(sql`select txid_current()::text as id`),[nestedId]=await nested.execute<{id:string}>(sql`select txid_current()::text as id`);expect(parentId).toEqual(nestedId);
   const planned=await ctx.callAsSystem(planControlledProviderOperation,{resourceId,kind:"read_bootstrap"});plannedId=planned.operationId;
   expect((await ctx.tx.select().from(subscriptionControlledOperations).where(eq(subscriptionControlledOperations.id,plannedId)))[0]?.id).toBe(plannedId);
   entered.resolve();await release.promise;throw rollback;
  }).catch((error:unknown)=>{if(error!==rollback)throw error;});
  await Promise.race([entered.promise,savepoint.then(()=>{throw Error("Reach the actual inserted operation before rollback.");})]);
 },async read=>{if(read.inventory&&read.ordinal===injectedOrdinal&&savepoint){release.resolve();await savepoint;savepoint=undefined;}});
 try{await expect(controlledProviderJournal(ctx.tx,resourceId)).rejects.toMatchObject({code:"conflict"});}
 finally{release.resolve();if(savepoint)await savepoint;observation.spy.mockRestore();}
 if(!plannedId)throw Error("Use an ACTUAL guarded shared-service operation birth.");
 expect(await ctx.tx.select().from(subscriptionControlledOperations).where(eq(subscriptionControlledOperations.id,plannedId))).toEqual([]);
 expect(await originalRows(ctx.tx,resourceId)).toEqual(first);expectBase(await controlledProviderJournal(ctx.tx,resourceId),first);return true;
}});
describe.runIf(hasDatabase)("freshly certified actual controlled journal base data",{timeout:180000},()=>{
 let original:Awaited<ReturnType<typeof seedActualProviderSubscription80>>|undefined,f:Awaited<ReturnType<typeof actualControlledPeriod84>>|undefined;
 beforeAll(ready,60000);beforeEach(truncateSpine);afterEach(()=>{original?.fixture.cleanup();original=undefined;f?.cleanup();f=undefined;vi.restoreAllMocks();});afterAll(async()=>{await stopJobs();await closeDb();});
 async function prepare(extra?:Parameters<typeof controlledPeriodEdge84>[0]){original=await seedActualProviderSubscription80();const edge=controlledPeriodEdge84(extra);vi.spyOn(paymentAdapters,"paymentAdapter").mockReturnValue(edge.provider);const resource=await prepareControlledProviderCalendar.call({subscriptionId:original.accepted.subscription.id},OWNER);await stopJobs();return{resourceId:resource.resourceId,edge};}
 async function financial(){return{invoices:await db().select().from(invoices).orderBy(invoices.id),payments:await db().select().from(payments).orderBy(payments.id),grants:await db().select().from(entitlementGrants).orderBy(entitlementGrants.id)};}
 it("matches original rows and immutable certified views, isolates mutation, and misses in a new Tx",async()=>{
  const{resourceId}=await prepare();let pristine:Omit<History,"verificationViews">|undefined;
  await db().transaction(async tx=>{
   const expected=await originalRows(tx,resourceId),reads=observeContentReads(tx);pristine=structuredClone(expected);
   const first=await controlledProviderJournal(tx,resourceId);expectBase(first,expected);expect(reads.count()).toBe(3);
   for(const row of [...first.operations,...first.calls,...first.facts,...first.finishes,...first.stops,...first.verifications,...first.chargeOrigins,...first.closures])expect(row.createdAt).toBeInstanceOf(Date);
   const operation=first.operations[0],call=first.calls.find(row=>row.operationId===operation?.id);if(!operation||!call)throw Error("Use genuine signed request/admission JSON.");
   operation.createdAt.setUTCFullYear(1999);operation.originalRequest={changedNested:{string:"private caller mutation",number:1,boolean:false,nullValue:null,array:["a",null,1]}};call.admission.payload.changedOnlyReturnedObject=true;first.unfinished.push(randomUUID());
   expect(originalControlledCall(operation,call)).toBeNull();const second=await controlledProviderJournal(tx,resourceId);expectBase(second,expected);expect(second.verificationViews[0]).toBe(first.verificationViews[0]);expect(Object.isFrozen(second.verificationViews[0])).toBe(true);expect(reads.count()).toBe(5);reads.spy.mockRestore();
  });
  await db().transaction(async tx=>{const reads=observeContentReads(tx);if(!pristine)throw Error("Retain the independent original projection.");expectBase(await controlledProviderJournal(tx,resourceId),pristine);expect(reads.count()).toBe(3);reads.spy.mockRestore();});
 });
 it("certifies empty membership, bypasses absent roots, and sees later committed children in the same Tx",async()=>{
  original=await seedActualProviderSubscription80();const edge=controlledPeriodEdge84();vi.spyOn(paymentAdapters,"paymentAdapter").mockReturnValue(edge.provider);const resource=await retainControlledProviderResource.call({subscriptionId:original.accepted.subscription.id},system);
  await db().transaction(async tx=>{
   const reads=observeContentReads(tx),empty=await controlledProviderJournal(tx,resource.resourceId);expect(empty).toMatchObject({count:1,operations:[],calls:[],facts:[],unfinished:[],verificationViews:[]});expect(await controlledProviderJournal(tx,resource.resourceId)).toEqual(empty);expect(reads.count()).toBe(5);
   const missing=randomUUID();expect(await controlledProviderJournal(tx,missing)).toMatchObject({count:1,operations:[],verificationViews:[]});expect(await controlledProviderJournal(tx,missing)).toMatchObject({count:1,operations:[],verificationViews:[]});expect(reads.count()).toBe(11);
   const seeded=original;if(!seeded)throw Error("Keep the actual original subscription.");await prepareControlledProviderCalendar.call({subscriptionId:seeded.accepted.subscription.id},OWNER);await stopJobs();
   const populated=await controlledProviderJournal(tx,resource.resourceId);expect(populated.operations.length).toBeGreaterThan(0);expect(populated.revision).not.toBe(empty.revision);expectBase(populated,await originalRows(tx,resource.resourceId));expect(reads.count()).toBeGreaterThan(11);reads.spy.mockRestore();
  });
 });
 it("retains real unfinished and returned/thrown caller transitions instead of prior quiesced interpretations",async()=>{
  let hold=false;const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();const{resourceId,edge}=await prepare({extra:async(url,init)=>{if(hold&&init.method==="GET"&&url.pathname.startsWith("/v1/subscriptions/sub_")){entered.resolve();await release.promise;}return null;}});
  await db().transaction(async tx=>{
   const before=await controlledProviderJournal(tx,resourceId),planned=await planControlledProviderOperation.call({resourceId,kind:"read_bootstrap"},system);hold=true;const running=executeControlledOperation(planned.operationId,OWNER);
   try{await Promise.race([entered.promise,running.then(()=>{throw Error("Reach the real GET barrier.");})]);const current=await controlledProviderJournal(tx,resourceId);expect(current.revision).not.toBe(before.revision);expect(current.unfinished).toHaveLength(1);await expect(assertControlledCallersQuiesced(tx,resourceId)).rejects.toMatchObject({code:"conflict"});}
   finally{release.resolve();await running;hold=false;}
   expect((await controlledProviderJournal(tx,resourceId)).unfinished).toEqual([]);
   const read=edge.provider.inspectMerchantControlledBootstrap?.bind(edge.provider);if(!read)throw Error("Use the actual original calendar SDK method.");
   const fault=vi.spyOn(edge.provider,"inspectMerchantControlledBootstrap").mockImplementationOnce(async request=>{await read(request);throw Error("Scripted transport failure after real retained GET facts.");});
   const next=await planControlledProviderOperation.call({resourceId,kind:"read_bootstrap"},system);await expect(executeControlledOperation(next.operationId,OWNER)).rejects.toThrow();fault.mockRestore();
   const after=await controlledProviderJournal(tx,resourceId),call=after.calls.find(row=>row.operationId===next.operationId);if(!call)throw Error("Retain actual thrown FIN owner.");expect(after.finishes.find(row=>row.callId===call.id)?.actualResult.outcome).toBe("threw");expect(after.unfinished).toEqual([]);expectBase(after,await originalRows(tx,resourceId));
  });
 });
 it("refuses a real later two-PI raw/FIN cohort between hit certificates and retains every bank occurrence",async()=>{
  f=await actualControlledPeriod84();const open=await actualControlledOpenInvoice84(f);f.remote.externallyAttachPayment(open.providerInvoiceRef,2100,200);f.remote.externallyAttachPayment(open.providerInvoiceRef,2100,200);expect(await collectControlledCollection.call({collectionId:f.target.collectionId},OWNER)).toMatchObject({state:"money_retained",applied:false});await stopJobs();
  const resourceId=f.review.controlled.resourceId,beforeMoney=await financial(),receipts=await db().select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.providerInvoiceRef,open.providerInvoiceRef));expect(receipts).toHaveLength(2);
  await db().transaction(async tx=>{
   const first=await controlledProviderJournal(tx,resourceId),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();let reads=0;
   const tapped=observeContentReads(tx,async()=>{if(++reads===2){entered.resolve();await release.promise;}});
   const running=controlledProviderJournal(tx,resourceId),outcome=running.then(()=>({state:"returned" as const}),(error:unknown)=>({state:"refused" as const,error}));await entered.promise;
   try{const planned=await planControlledProviderOperation.call({resourceId,kind:"read_invoice",providerInvoiceRef:open.providerInvoiceRef},system);await executeControlledOperation(planned.operationId,OWNER);}finally{release.resolve();}
   expect((await outcome).state).toBe("refused");tapped.spy.mockRestore();const after=await controlledProviderJournal(tx,resourceId);expect(after.facts.length).toBeGreaterThan(first.facts.length);expect(after.revision).not.toBe(first.revision);for(const fact of first.facts)expect(after.facts).toContainEqual(fact);expect(after.unfinished).toEqual([]);
   for(const receipt of receipts)expect(await readControlledReceiptNamespace(tx,receipt.id)).toMatchObject({verified:true,financialCallerDebt:false});expect(await financial()).toEqual(beforeMoney);
  });
 });
 it("rejects an atomic J1 inventory when a genuine savepoint restores the before/after J0 certificate",async()=>{const{resourceId}=await prepare();const before=await financial();expect(await savepointABA.call({resourceId},system)).toBe(true);expect(await financial()).toEqual(before);});
 it("refuses fresh PG shape/domain/fingerprint faults and DB errors instead of returning an old snapshot",async()=>{
  const{resourceId}=await prepare();await db().transaction(async tx=>{
   const original=await controlledProviderJournal(tx,resourceId);
   for(const field of ["fingerprint","domain","counts"] as const){let once=false;const tapped=observeContentReads(tx,async()=>{},async(_read,rows)=>{if(once)return;once=true;if(!Array.isArray(rows))throw Error("Keep actual PG result array.");const row:unknown=rows[0];if(!row||typeof row!=="object"||Array.isArray(row))throw Error("Require actual PG certificate before deliberate transport corruption.");Reflect.set(row,field,field==="counts"?{}:"invalid content certificate");});await expect(controlledProviderJournal(tx,resourceId)).rejects.toMatchObject({code:"conflict"});tapped.spy.mockRestore();expect(await controlledProviderJournal(tx,resourceId)).toEqual(original);}
   const failure=Error("Deliberate failure before the genuine PG certificate read"),tapped=observeContentReads(tx,async()=>{throw failure;});await expect(controlledProviderJournal(tx,resourceId)).rejects.toBe(failure);tapped.spy.mockRestore();expect(await controlledProviderJournal(tx,resourceId)).toEqual(original);
   await expect(tx.transaction(nested=>nested.update(subscriptionControlledResources).set({originalSourceRevision:"f".repeat(64)}).where(eq(subscriptionControlledResources.id,resourceId)))).rejects.toThrow();expect(await controlledProviderJournal(tx,resourceId)).toEqual(original);
  });
 });
});
