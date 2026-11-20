// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN: actual services/HTTP/raw commits; fictional external bank only.
import { eq } from "drizzle-orm";
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { stopJobs } from "@/core/jobs";
import { entitlementGrants } from "@/core/entitlements/schema";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { invoices,payments,moneyStateEvents } from "@/modules/invoicing/schema";
import { controlledCashApplicationBatches,controlledCashApplicationReceipts,controlledCashApplicationLinks } from "@/modules/invoicing/controlled-cash-application-protocol-schema";
import { applyControlledCashReceipts } from "@/modules/invoicing/controlled-cash-application-service";
import { inspectControlledCashReceipt } from "@/modules/invoicing/controlled-cash-inspection-service";
import { CONTROLLED_COLLECTION_PROTOCOL } from "@/modules/subscriptions/controlled-provider-collection-protocol";
import { subscriptionProviderChargeReceipts,subscriptions } from "@/modules/subscriptions/schema";
import { subscriptionControlledFacts,subscriptionControlledCalls,subscriptionControlledOperations,subscriptionControlledResources } from "@/modules/subscriptions/controlled-provider-schema";
import { controlledProviderJournal } from "@/modules/subscriptions/controlled-provider-proof";
import { controlledRawFinancialReview } from "@/modules/subscriptions/controlled-provider-raw-financial-review";
import { planControlledProviderOperation } from "@/modules/subscriptions/controlled-provider-plan";
import { planControlledCollectionOperation } from "@/modules/subscriptions/controlled-provider-collection-plan";
import { executeControlledOperation } from "@/modules/subscriptions/controlled-provider-execution";
import { retainControlledInvoiceProof } from "@/modules/subscriptions/controlled-provider-collection-retention";
import { actualControlledPeriod84 } from "../helpers/actual-controlled-period84";
import { actualControlledOpenInvoice84 } from "../helpers/actual-controlled-open-invoice84";
import { closeDb,hasDatabase,OWNER,truncateSpine } from "../helpers/spine";
const system={kind:"system"} as const;
describe.runIf(hasDatabase)("actual external bank anomalies retain money without canonical adoption",{timeout:180000},()=>{
 let f:Awaited<ReturnType<typeof actualControlledPeriod84>>|undefined;
 beforeAll(ready,60000);beforeEach(truncateSpine);afterEach(()=>{vi.useRealTimers();f?.cleanup();f=undefined;vi.restoreAllMocks();});afterAll(async()=>{await stopJobs();await closeDb();});
 async function canonical(){return{invoices:await db().select().from(invoices).orderBy(invoices.id),payments:await db().select().from(payments).orderBy(payments.id),events:await db().select().from(moneyStateEvents).orderBy(moneyStateEvents.id),
  batches:await db().select().from(controlledCashApplicationBatches).orderBy(controlledCashApplicationBatches.id),receipts:await db().select().from(controlledCashApplicationReceipts).orderBy(controlledCashApplicationReceipts.id),links:await db().select().from(controlledCashApplicationLinks).orderBy(controlledCashApplicationLinks.receiptId),parents:await db().select().from(subscriptions).orderBy(subscriptions.id),grants:await db().select().from(entitlementGrants).orderBy(entitlementGrants.id)};}
 it.each(["wrong_currency","overage"] as const)("retains exact %s HTTP positive facts and refuses money admission without a new collection or clipped payment",async kind=>{
  f=await actualControlledPeriod84();const fixture=f,open=await actualControlledOpenInvoice84(fixture),before=await canonical(),beforeFacts=await db().select().from(subscriptionControlledFacts).orderBy(subscriptionControlledFacts.id),counts=fixture.remote.counts();
  const attached=kind==="wrong_currency"?fixture.remote.externallyAttachWrongCurrencyPayment(open.providerInvoiceRef):fixture.remote.externallyOverpayInvoice(open.providerInvoiceRef);
  const planned=await planControlledProviderOperation.call({resourceId:fixture.review.controlled.resourceId,kind:"read_invoice",providerInvoiceRef:open.providerInvoiceRef},system);
  if(kind==="wrong_currency")await expect(executeControlledOperation(planned.operationId,OWNER)).rejects.toMatchObject({code:"conflict"});
  else expect(await executeControlledOperation(planned.operationId,OWNER)).toMatchObject({providerInvoiceRef:open.providerInvoiceRef,totalMinor:4200,paidMinor:4201,remainingMinor:0,status:"paid",suppliesPaidAuthority:false});
  const history=await db().transaction(tx=>controlledProviderJournal(tx,fixture.review.controlled.resourceId)),operation=history.operations.find(row=>row.id===planned.operationId),call=history.calls.find(row=>row.operationId===planned.operationId);
  if(!operation||!call)throw Error("Retain the genuine actual original admitted GET.");
  const positive=history.facts.filter(row=>row.callId===call.id&&row.actual.kind==="cash_observed");expect(positive).toHaveLength(1);const fact=positive[0];if(!fact)throw Error("The exact positive HTTP fact must commit before later refusal.");
  expect(fact.actualDigest).toBe(merchantTaxDigest(fact.actual));expect(fact.actual.raw).toMatchObject({cash:{providerInvoiceRef:open.providerInvoiceRef,providerPaymentIntentRef:attached.providerPaymentIntentRef,amountMinor:attached.amountMinor,currency:attached.currency},intent:{id:attached.providerPaymentIntentRef,amount_received:attached.amountMinor,currency:attached.currency.toLowerCase()}});
  const[resource]=await db().select().from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,fixture.review.controlled.resourceId));if(!resource)throw Error("Retain the actual original resource.");expect(controlledRawFinancialReview(resource,history).rawPositiveFactIds).toContain(fact.id);
  expect(history.finishes.find(row=>row.callId===call.id)?.actualResult.outcome).toBe(kind==="wrong_currency"?"threw":"returned");expect(history.unfinished).toEqual([]);
  const receipts=await db().select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId,fixture.parent.id));
  if(kind==="wrong_currency")expect(receipts).toHaveLength(0);
  else{
   expect(receipts).toHaveLength(1);const receipt=receipts[0];if(!receipt)throw Error("The whole overage must retain its genuine receipt.");expect(receipt).toMatchObject({amountMinor:4201,currency:"CAD",providerPaymentIntentRef:attached.providerPaymentIntentRef});
   const manifest=await planControlledCollectionOperation.call({collectionId:open.collectionId,kind:"read_manifest"},system);expect(await executeControlledOperation(manifest.operationId,OWNER)).toMatchObject({exactManifest:true,suppliesPaidAuthority:false,inventory:{paidMinor:4201,totalMinor:4200,remainingMinor:0}});await retainControlledInvoiceProof.call({collectionId:open.collectionId,operationId:manifest.operationId},system);
   expect(await inspectControlledCashReceipt.call({collectionId:open.collectionId,receiptId:receipt.id},OWNER)).toMatchObject({bankReadReturned:true,completeInventory:true,amountMinor:4201,suppliesMoneyAuthority:false});
   await expect(applyControlledCashReceipts.call({collectionId:open.collectionId,receiptIds:[receipt.id],requiredProtocol:CONTROLLED_COLLECTION_PROTOCOL},system)).rejects.toMatchObject({code:"conflict"});
  }
  expect(await canonical()).toEqual(before);const originalFacts=await db().select().from(subscriptionControlledFacts);for(const original of beforeFacts)expect(originalFacts.find(row=>row.id===original.id)).toEqual(original);expect(originalFacts.find(row=>row.id===fact.id)).toEqual(fact);
  const beforeRetry=fixture.remote.counts();if(kind==="wrong_currency")await expect(executeControlledOperation(planned.operationId,OWNER)).rejects.toThrow();else expect(await executeControlledOperation(planned.operationId,OWNER)).toMatchObject({paidMinor:4201});expect(fixture.remote.counts()).toEqual(beforeRetry);
  const operations=await db().select().from(subscriptionControlledOperations).orderBy(subscriptionControlledOperations.ordinal),calls=await db().select().from(subscriptionControlledCalls).orderBy(subscriptionControlledCalls.id);
  await expect(planControlledCollectionOperation.call({collectionId:open.collectionId,kind:"pay_invoice"},system)).rejects.toMatchObject({code:"conflict"});expect(await db().select().from(subscriptionControlledOperations).orderBy(subscriptionControlledOperations.ordinal)).toEqual(operations);expect(await db().select().from(subscriptionControlledCalls).orderBy(subscriptionControlledCalls.id)).toEqual(calls);
  const after=fixture.remote.counts();for(const key of ["updatePosts","draftPosts","itemPosts","feePosts","finalizePosts","payPosts"] as const)expect(after[key]).toBe(counts[key]);expect(after.payPosts).toBe(0);expect(fixture.remote.externalAttachments()).toBe(1);expect(await canonical()).toEqual(before);
 });
});
