// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Actual HTTP cash facts and fresh real database transactions.
import {eq} from "drizzle-orm";
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {db} from "@/core/db";
import {ready} from "@/core/runtime";
import {stopJobs} from "@/core/jobs";
import {invoices,payments} from "@/modules/invoicing/schema";
import {entitlementGrants} from "@/core/entitlements/schema";
import {subscriptionProviderChargeReceipts} from "@/modules/subscriptions/schema";
import {subscriptionControlledChargeOrigins,subscriptionControlledResources} from "@/modules/subscriptions/controlled-provider-schema";
import {collectControlledCollection} from "@/modules/subscriptions/controlled-provider-collection-orchestration";
import {planControlledProviderOperation} from "@/modules/subscriptions/controlled-provider-plan";
import {executeControlledOperation} from "@/modules/subscriptions/controlled-provider-execution";
import {controlledProviderJournal} from "@/modules/subscriptions/controlled-provider-proof";
import * as journalApi from "@/modules/subscriptions/controlled-provider-proof";
import {readControlledReceiptNamespace} from "@/modules/subscriptions/controlled-provider-cash-namespace";
import * as originApi from "@/modules/subscriptions/controlled-provider-cash-origin";
import {controlledCashEvidence,readOriginalControlledChargeAuthority,readOriginalControlledChargeAuthorities} from "@/modules/subscriptions/controlled-provider-cash-origin";
import {actualControlledPeriod84} from "../helpers/actual-controlled-period84";
import {actualControlledOpenInvoice84} from "../helpers/actual-controlled-open-invoice84";
import {runControlledCashOriginPreUpgradeMalformed} from "../helpers/controlled-cash-origin-old-protocol88";
import {OWNER,hasDatabase,truncateSpine,closeDb} from "../helpers/spine";
const system={kind:"system"} as const;
describe.runIf(hasDatabase)("genuine same-pass controlled cash ancestry",{timeout:180000},()=>{
 let f:Awaited<ReturnType<typeof actualControlledPeriod84>>|undefined;
 beforeAll(ready,60000);beforeEach(truncateSpine);afterEach(()=>{f?.cleanup();f=undefined;vi.restoreAllMocks();});afterAll(async()=>{await stopJobs();await closeDb();});
 async function actual(){
  f=await actualControlledPeriod84();const open=await actualControlledOpenInvoice84(f);f.remote.externallyAttachPayment(open.providerInvoiceRef,2100,200);f.remote.externallyAttachPayment(open.providerInvoiceRef,2100,200);
  expect(await collectControlledCollection.call({collectionId:f.target.collectionId},OWNER)).toMatchObject({state:"money_retained",applied:false});await stopJobs();
  const receipts=await db().select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.providerInvoiceRef,open.providerInvoiceRef));expect(receipts).toHaveLength(2);const receipt=receipts[0];if(!receipt)throw Error("Retain actual independent bank PIs.");
  const[origin]=await db().select().from(subscriptionControlledChargeOrigins).where(eq(subscriptionControlledChargeOrigins.receiptId,receipt.id));if(!origin)throw Error("Retain the real original cash bridge.");
  return{open,receipts,receipt,origin,resourceId:f.review.controlled.resourceId};
 }
 async function readInvoice(resourceId:string,providerInvoiceRef:string){const planned=await planControlledProviderOperation.call({resourceId,kind:"read_invoice",providerInvoiceRef},system);await executeControlledOperation(planned.operationId,OWNER);return planned.operationId;}
 async function financial(){return{invoices:await db().select().from(invoices).orderBy(invoices.id),payments:await db().select().from(payments).orderBy(payments.id),grants:await db().select().from(entitlementGrants).orderBy(entitlementGrants.id)};}
 it("matches every original scalar digest, retains distinct duplicate cash facts and performs exactly two full journal reads per namespace",async()=>{
  const source=await actual();if(!f)throw Error("Keep the real bank fixture.");await readInvoice(source.resourceId,source.open.providerInvoiceRef);
  const history=await db().transaction(tx=>controlledProviderJournal(tx,source.resourceId)),occurrences=history.facts.flatMap(fact=>{if(fact.actual.kind!=="cash_observed")return[];const cash=controlledCashEvidence.parse(fact.actual.raw.cash);return cash.providerPaymentIntentRef===source.receipt.providerPaymentIntentRef?[{cash,origin:{resourceId:source.resourceId,callId:fact.callId,factId:fact.id}}]:[];});expect(occurrences.length).toBeGreaterThan(1);
  const batch=await db().transaction(tx=>readOriginalControlledChargeAuthorities(tx,{resourceId:source.resourceId,occurrences}));expect(batch.authorities).toHaveLength(occurrences.length);expect(batch.physicalCount).toBe(history.count+2);
  for(const[index,request]of occurrences.entries())expect(batch.authorities[index]).toEqual(await db().transaction(tx=>readOriginalControlledChargeAuthority(tx,request.cash,request.origin)));
  const before=await financial(),bank=f.remote.counts(),calls=vi.spyOn(journalApi,"controlledProviderJournal");const namespace=await db().transaction(tx=>readControlledReceiptNamespace(tx,source.receipt.id));expect(calls).toHaveBeenCalledTimes(2);calls.mockRestore();
  expect(namespace).toMatchObject({applies:true,verified:true,financialCallerDebt:false,principalCallerDebt:false,inventoryCount:history.count});expect(await db().transaction(tx=>readControlledReceiptNamespace(tx,source.receipt.id))).toEqual(namespace);expect(await financial()).toEqual(before);expect(f.remote.counts()).toEqual(bank);
  // Equal amounts never choose ownership: another REAL positive fact belongs
  // to its own exact PI and cannot satisfy this original cash input.
  const foreign=history.facts.find(fact=>fact.actual.kind==="cash_observed"&&controlledCashEvidence.parse(fact.actual.raw.cash).providerPaymentIntentRef!==source.receipt.providerPaymentIntentRef),first=occurrences[0];if(!foreign||!first)throw Error("Use both real equal-value namespaces.");
  await expect(db().transaction(tx=>readOriginalControlledChargeAuthorities(tx,{resourceId:source.resourceId,occurrences:[{cash:first.cash,origin:{resourceId:source.resourceId,callId:foreign.callId,factId:foreign.id}}]}))).rejects.toThrow();
  await expect(db().transaction(tx=>readOriginalControlledChargeAuthorities(tx,{resourceId:source.resourceId,occurrences:[first,first]}))).rejects.toThrow();expect(await financial()).toEqual(before);
 });
 it("refuses a genuinely later cash/FIN cohort between the prior journal and the batch, preserving all retained facts",async()=>{
  const source=await actual(),before=await financial(),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),read=originApi.readOriginalControlledChargeAuthorities;
  const fault=vi.spyOn(originApi,"readOriginalControlledChargeAuthorities").mockImplementationOnce(async(tx,input)=>{entered.resolve();await release.promise;return read(tx,input);});
  const running=db().transaction(tx=>readControlledReceiptNamespace(tx,source.receipt.id));const outcome=running.then(()=>({state:"returned" as const}),(error:unknown)=>({state:"refused" as const,error}));
  await entered.promise;const prior=await db().transaction(tx=>controlledProviderJournal(tx,source.resourceId));
  try{await readInvoice(source.resourceId,source.open.providerInvoiceRef);}finally{release.resolve();}
  expect((await outcome).state).toBe("refused");fault.mockRestore();const after=await db().transaction(tx=>controlledProviderJournal(tx,source.resourceId));expect(after.revision).not.toBe(prior.revision);expect(after.facts.length).toBeGreaterThan(prior.facts.length);expect(after.unfinished).toEqual([]);for(const fact of prior.facts)expect(after.facts).toContainEqual(fact);
  expect(await db().transaction(tx=>readControlledReceiptNamespace(tx,source.receipt.id))).toMatchObject({verified:true,financialCallerDebt:false});expect(await financial()).toEqual(before);
 });
 it("keeps a real currently running GET as caller debt, then separately observes its real finish",async()=>{
  const source=await actual();if(!f)throw Error("Keep the genuine bank adapter.");const before=await financial(),provider=f.remote.provider,inspect=provider.inspectMerchantControlledInvoice?.bind(provider);if(!inspect)throw Error("Use the actual provider read method.");
  const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();const blocked=vi.spyOn(provider,"inspectMerchantControlledInvoice").mockImplementationOnce(async request=>{entered.resolve();await release.promise;return inspect.call(provider,request);});
  const planned=await planControlledProviderOperation.call({resourceId:source.resourceId,kind:"read_invoice",providerInvoiceRef:source.open.providerInvoiceRef},system),running=executeControlledOperation(planned.operationId,OWNER);
  try{await Promise.race([entered.promise,running.then(()=>{throw Error("Reach the actual original GET barrier before completion.");})]);expect(await db().transaction(tx=>readControlledReceiptNamespace(tx,source.receipt.id))).toMatchObject({verified:true,financialCallerDebt:true,principalCallerDebt:true});}
  finally{release.resolve();await running;blocked.mockRestore();}
  expect(await db().transaction(tx=>readControlledReceiptNamespace(tx,source.receipt.id))).toMatchObject({verified:true,financialCallerDebt:false,principalCallerDebt:false});expect(await financial()).toEqual(before);
 });
 it("retains the immutable resource guard and rejects changed complete canonical or PostgreSQL resource observations",async()=>{
  const source=await actual(),before=await db().select().from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,source.resourceId));
  await expect(db().update(subscriptionControlledResources).set({originalSourceRevision:"f".repeat(64)}).where(eq(subscriptionControlledResources.id,source.resourceId))).rejects.toThrow();expect(await db().select().from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,source.resourceId))).toEqual(before);
  // Deliberate helper-contract fault injection after its REAL DB fetch. No
  // fabricated row is retained and no fake transaction/context is supplied.
  const read=originApi.readOriginalControlledChargeAuthorities;
  for(const mode of ["canonical","postgres"] as const){const fault=vi.spyOn(originApi,"readOriginalControlledChargeAuthorities").mockImplementationOnce(async(tx,input)=>{const actual=await read(tx,input);return mode==="canonical"?{...actual,resource:{...actual.resource,createdAt:new Date(actual.resource.createdAt.getTime()+1)}}:{...actual,postgresFingerprint:actual.postgresFingerprint==="f".repeat(64)?"e".repeat(64):"f".repeat(64)};});await expect(db().transaction(tx=>readControlledReceiptNamespace(tx,source.receipt.id))).rejects.toThrow();fault.mockRestore();}
  expect(await db().select().from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,source.resourceId))).toEqual(before);expect(await db().transaction(tx=>readControlledReceiptNamespace(tx,source.receipt.id))).toMatchObject({verified:true});
 });
 it("retains a scripted malformed late cash callback through the real holder and keeps its raw review flag",async()=>{
  const evidence=await runControlledCashOriginPreUpgradeMalformed();expect(evidence).toMatchObject({sourceCommit:"426009a1983711c81cef0447862120c682598515",databasePreserved:true,migrations:86,lastMigration:"0085_controlled_collection_application",passed:1,failed:0,timeoutMs:180000});
 });
});
