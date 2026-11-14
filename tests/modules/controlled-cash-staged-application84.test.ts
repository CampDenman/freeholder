// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Genuine services/bank/GETs; no fake context or money rows.
import { randomUUID } from "node:crypto";
import { eq,inArray,sql } from "drizzle-orm";
import { z } from "zod";
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import { db } from "@/core/db";
import { defineService } from "@/core/service";
import { ready } from "@/core/runtime";
import { stopJobs } from "@/core/jobs";
import { entitlementGrants } from "@/core/entitlements/schema";
import { invoices,payments,moneyStateEvents } from "@/modules/invoicing/schema";
import { subscriptions,subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { subscriptionControlledCollections,subscriptionControlledQuotes,subscriptionControlledInvoiceProofs } from "@/modules/subscriptions/controlled-provider-collection-schema";
import { subscriptionControlledResources,subscriptionControlledOperations } from "@/modules/subscriptions/controlled-provider-schema";
import { CONTROLLED_COLLECTION_PROTOCOL } from "@/modules/subscriptions/controlled-provider-collection-protocol";
import { collectControlledCollection } from "@/modules/subscriptions/controlled-provider-collection-orchestration";
import { inspectControlledCashReceipt } from "@/modules/invoicing/controlled-cash-inspection-service";
import { applyControlledCashReceipts } from "@/modules/invoicing/controlled-cash-application-service";
import { controlledCashApplicationBatches,controlledCashApplicationReceipts,controlledCashApplicationLinks } from "@/modules/invoicing/controlled-cash-application-protocol-schema";
import { merchantAgreementPaymentRoutes } from "@/modules/invoicing/merchant-agreement-schema";
import { CONTROLLED_CASH_ATOMIC_PROTOCOL } from "@/modules/invoicing/controlled-cash-application-protocol";
import { actualControlledPeriod84 } from "../helpers/actual-controlled-period84";
import { actualControlledOpenInvoice84 } from "../helpers/actual-controlled-open-invoice84";
import { retainActualControlledManifest84 } from "../helpers/actual-controlled-current-manifest84";
import { closeDb,hasDatabase,OWNER,truncateSpine } from "../helpers/spine";
const system={kind:"system"} as const;
const atomic=defineService({name:"invoicing.testControlledCashBatchAtomic84",summary:"Verify real writer access isolation and refusal-only later SQL failure in one actual transaction.",kind:"mutation",permission:"system",external:false,writeClass:"money",auditInputFields:["collectionId","receiptIds"],
 input:applyControlledCashReceipts.def.input.extend({refuseLater:z.boolean().default(false)}),output:applyControlledCashReceipts.def.output,
 handler:async(input,ctx)=>{
  const[reference]=await ctx.tx.select({subscriptionId:subscriptionControlledResources.subscriptionId}).from(subscriptionControlledCollections).innerJoin(subscriptionControlledQuotes,eq(subscriptionControlledQuotes.id,subscriptionControlledCollections.quoteId))
   .innerJoin(subscriptionControlledResources,eq(subscriptionControlledResources.id,subscriptionControlledQuotes.resourceId)).where(eq(subscriptionControlledCollections.id,input.collectionId)).limit(1);if(!reference)throw Error("Use an actual accepted target.");
  const[parent]=await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id,reference.subscriptionId)),grants=await ctx.tx.select().from(entitlementGrants).where(eq(entitlementGrants.sourceSubscriptionId,reference.subscriptionId)).orderBy(entitlementGrants.id);
  if(input.refuseLater){const ids=[...input.receiptIds].sort(),first=ids[0],later=ids[1];if(ids.length!==2||!first||!later)throw Error("Use exactly two actual retained receipt IDs.");
   await ctx.tx.execute(sql`select set_config('freeholder.test_cash_collection84',${input.collectionId},true),set_config('freeholder.test_cash_first84',${first},true),set_config('freeholder.test_cash_later84',${later},true)`);
   // Additional REFUSAL only; no old guard is replaced/disabled. This function
   // and trigger are created inside the SAME TX and disappear on its rollback.
   await ctx.tx.execute(sql`create function pg_temp.refuse_actual_later_receipt84() returns trigger language plpgsql as $$
    begin
     if NEW.idempotency_key='controlled-receipt:'||current_setting('freeholder.test_cash_collection84')||':'||current_setting('freeholder.test_cash_later84') then
      if not exists(select 1 from payments p join controlled_cash_application_links l on l.payment_id=p.id where l.receipt_id=current_setting('freeholder.test_cash_first84')::uuid and p.status='succeeded') then raise exception 'The genuine earlier receipt never settled before the fault';end if;
      raise exception 'Reject actual later receipt after real earlier settlement' using errcode='23514';
     end if;return NEW;
    end $$`);
   await ctx.tx.execute(sql`create trigger zz_test_refuse_actual_later_receipt84 before insert on payments for each row execute function pg_temp.refuse_actual_later_receipt84()`);
  }
  const actual=await ctx.callAsSystem(applyControlledCashReceipts,{collectionId:input.collectionId,receiptIds:input.receiptIds,requiredProtocol:input.requiredProtocol});
  expect((await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id,reference.subscriptionId)))[0]).toEqual(parent);
  expect(await ctx.tx.select().from(entitlementGrants).where(eq(entitlementGrants.sourceSubscriptionId,reference.subscriptionId)).orderBy(entitlementGrants.id)).toEqual(grants);
  return actual;
 }});
describe.runIf(hasDatabase)("genuine signed admission and staged canonical receipt batch",{timeout:180000},()=>{
 let f:Awaited<ReturnType<typeof actualControlledPeriod84>>|undefined;
 beforeAll(ready,60000);beforeEach(truncateSpine);afterEach(()=>{vi.useRealTimers();f?.cleanup();f=undefined;vi.restoreAllMocks();});afterAll(async()=>{await stopJobs();await closeDb();});
 async function retained(){const fixture=f;if(!fixture)throw Error("Use the actual accepted target first.");
  expect(await collectControlledCollection.call({collectionId:fixture.target.collectionId},OWNER)).toMatchObject({state:"money_retained",applied:false});
  await retainActualControlledManifest84(fixture);
  const receipts=await db().select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId,fixture.parent.id)).orderBy(subscriptionProviderChargeReceipts.id);
  for(const receipt of receipts)expect(await inspectControlledCashReceipt.call({collectionId:fixture.target.collectionId,receiptId:receipt.id},OWNER)).toMatchObject({bankReadReturned:true,completeInventory:true,suppliesMoneyAuthority:false});
  return receipts;
 }
 async function snapshot(){return{invoices:await db().select().from(invoices).orderBy(invoices.id),payments:await db().select().from(payments).orderBy(payments.id),events:await db().select().from(moneyStateEvents).orderBy(moneyStateEvents.id),
  batches:await db().select().from(controlledCashApplicationBatches).orderBy(controlledCashApplicationBatches.id),receiptProofs:await db().select().from(controlledCashApplicationReceipts).orderBy(controlledCashApplicationReceipts.id),links:await db().select().from(controlledCashApplicationLinks).orderBy(controlledCashApplicationLinks.receiptId),
  receipts:await db().select().from(subscriptionProviderChargeReceipts).orderBy(subscriptionProviderChargeReceipts.id),grants:await db().select().from(entitlementGrants).orderBy(entitlementGrants.id)};}
 function input(receiptIds:string[]){if(!f)throw Error("Use the actual target.");return{collectionId:f.target.collectionId,receiptIds,requiredProtocol:CONTROLLED_COLLECTION_PROTOCOL};}
 async function noNewBankCall<T>(run:()=>Promise<T>){const fixture=f;if(!fixture)throw Error("Use the actual bank first.");const before=fixture.remote.counts(),actual=await run();expect(fixture.remote.counts()).toEqual(before);return actual;}
 it("commits a real full receipt through shared payment/route/observation/settlement, preserving money-TX access",async()=>{
  f=await actualControlledPeriod84();const receipts=await retained();expect(receipts).toHaveLength(1);const before=await snapshot(),actual=await noNewBankCall(()=>atomic.call(input(receipts.map(row=>row.id)),system));
  expect(actual).toMatchObject({invoiceId:f.target.invoiceId,outstandingMinor:0,suppliesAccessAuthority:false});expect(actual.payments).toHaveLength(1);
  const[invoice]=await db().select().from(invoices).where(eq(invoices.id,f.target.invoiceId));expect(invoice).toMatchObject({paidMinor:4200,creditedMinor:0,status:"paid"});
  const links=await db().select().from(controlledCashApplicationLinks).where(eq(controlledCashApplicationLinks.batchId,actual.batchId));expect(links.map(row=>({receiptId:row.receiptId,paymentId:row.paymentId}))).toEqual(actual.payments);
  expect(await db().select().from(subscriptionProviderChargeReceipts).orderBy(subscriptionProviderChargeReceipts.id)).toEqual(before.receipts);
  const repeated=await snapshot();await expect(atomic.call(input(receipts.map(row=>row.id)),system)).rejects.toMatchObject({code:"conflict"});const afterRetry=await snapshot();for(const family of ["invoices","payments","events","batches","receiptProofs","links","receipts"] as const)expect(afterRetry[family]).toEqual(repeated[family]);
 });
 it("refuses the genuinely stale pre-pay manifest without writes, then retains a new actual GET before applying the same cash",async()=>{
  f=await actualControlledPeriod84();const fixture=f;
  expect(await collectControlledCollection.call({collectionId:fixture.target.collectionId},OWNER)).toMatchObject({state:"money_retained",applied:false});
  const receipts=await db().select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId,fixture.parent.id));expect(receipts).toHaveLength(1);
  const receipt=receipts[0];if(!receipt)throw Error("Retain the actual original positive receipt.");
  const operations=await db().select().from(subscriptionControlledOperations).where(eq(subscriptionControlledOperations.resourceId,fixture.review.controlled.resourceId)).orderBy(subscriptionControlledOperations.ordinal);
  const proofs=await db().select().from(subscriptionControlledInvoiceProofs).where(eq(subscriptionControlledInvoiceProofs.collectionId,fixture.target.collectionId));
  const old=operations.filter(row=>row.kind==="read_manifest"&&proofs.some(proof=>proof.operationId===row.id)).at(-1),pay=operations.find(row=>row.kind==="pay_invoice");
  if(!old||!pay)throw Error("The actual retained pre-pay manifest and original bank pay must exist.");expect(old.ordinal).toBeLessThan(pay.ordinal);
  expect(await inspectControlledCashReceipt.call({collectionId:fixture.target.collectionId,receiptId:receipt.id},OWNER)).toMatchObject({bankReadReturned:true,completeInventory:true});
  const before=await snapshot(),counts=fixture.remote.counts();
  await expect(atomic.call(input([receipt.id]),system)).rejects.toMatchObject({code:"conflict"});expect(await snapshot()).toEqual(before);expect(fixture.remote.counts()).toEqual(counts);
  const fresh=await retainActualControlledManifest84(fixture);
  const[newRead]=await db().select().from(subscriptionControlledOperations).where(eq(subscriptionControlledOperations.id,fresh.operationId));expect(newRead?.ordinal).toBeGreaterThan(pay.ordinal);
  const retainedProofs=await db().select().from(subscriptionControlledInvoiceProofs).where(eq(subscriptionControlledInvoiceProofs.collectionId,fixture.target.collectionId));
  expect(retainedProofs).toContainEqual(expect.objectContaining({id:fresh.proofId,operationId:fresh.operationId}));for(const original of proofs)expect(retainedProofs).toContainEqual(original);
  expect(await inspectControlledCashReceipt.call({collectionId:fixture.target.collectionId,receiptId:receipt.id},OWNER)).toMatchObject({bankReadReturned:true,completeInventory:true});
  expect(await noNewBankCall(()=>atomic.call(input([receipt.id]),system))).toMatchObject({outstandingMinor:0,suppliesAccessAuthority:false});expect(fixture.remote.counts().payPosts).toBe(1);
 });
 it("keeps a real one-minor partial unpaid, then applies genuine later4199 with exact fee residual across commits",async()=>{
  f=await actualControlledPeriod84();const open=await actualControlledOpenInvoice84(f);f.remote.externallyAttachPayment(open.providerInvoiceRef,1,0);
  const first=await retained();expect(first).toHaveLength(1);const one=await noNewBankCall(()=>atomic.call(input(first.map(row=>row.id)),system));expect(one.outstandingMinor).toBe(4199);
  expect((await db().select().from(invoices).where(eq(invoices.id,f.target.invoiceId)))[0]).toMatchObject({paidMinor:1,status:"partially_paid",paidAt:null});expect(await db().select().from(entitlementGrants).where(eq(entitlementGrants.sourceSubscriptionId,f.parent.id))).toEqual(f.grants);
  f.remote.externallyAttachPayment(open.providerInvoiceRef,4199,400);const both=await retained(),remaining=both.filter(row=>!first.some(old=>old.id===row.id));expect(remaining).toHaveLength(1);
  expect((await noNewBankCall(()=>atomic.call(input(remaining.map(row=>row.id)),system)))).toMatchObject({outstandingMinor:0});
  const targetPayments=await db().select().from(payments).where(eq(payments.invoiceId,f.target.invoiceId)).orderBy(payments.amountMinor);expect(targetPayments.map(row=>({amount:row.amountMinor,status:row.status}))).toEqual([{amount:1,status:"succeeded"},{amount:4199,status:"succeeded"}]);
  const routes=await db().select().from(merchantAgreementPaymentRoutes).where(inArray(merchantAgreementPaymentRoutes.paymentId,targetPayments.map(row=>row.id)));expect(routes.map(row=>row.applicationFeeMinor).sort((a,b)=>a-b)).toEqual([0,400]);
 });
 it("applies two distinct equal2100 receipts atomically without adopting one by amount",async()=>{
  f=await actualControlledPeriod84();const open=await actualControlledOpenInvoice84(f);f.remote.externallyAttachPayment(open.providerInvoiceRef,2100,200);f.remote.externallyAttachPayment(open.providerInvoiceRef,2100,200);
  const receipts=await retained();expect(receipts).toHaveLength(2);const actual=await noNewBankCall(()=>atomic.call(input(receipts.map(row=>row.id)),system));expect(actual.outstandingMinor).toBe(0);expect(new Set(actual.payments.map(row=>row.receiptId)).size).toBe(2);expect(new Set(actual.payments.map(row=>row.paymentId)).size).toBe(2);
  expect((await db().select().from(invoices).where(eq(invoices.id,f.target.invoiceId)))[0]).toMatchObject({paidMinor:4200,creditedMinor:0,status:"paid"});
 });
 it.each([[1,0,4199,400],[4199,400,1,0]])("applies genuine uneven bank captures %i/%i then %i/%i with their original fees in one atomic batch",async(amount,fee,later,laterFee)=>{
  f=await actualControlledPeriod84();const open=await actualControlledOpenInvoice84(f);f.remote.externallyAttachPayment(open.providerInvoiceRef,amount,fee);f.remote.externallyAttachPayment(open.providerInvoiceRef,later,laterFee);
  const receipts=await retained(),before=await snapshot();expect(receipts).toHaveLength(2);
  const actual=await noNewBankCall(()=>atomic.call(input(receipts.map(row=>row.id)),system));expect(actual.outstandingMinor).toBe(0);
  const[batch]=await db().select().from(controlledCashApplicationBatches).where(eq(controlledCashApplicationBatches.id,actual.batchId));expect(batch).toMatchObject({protocol:CONTROLLED_CASH_ATOMIC_PROTOCOL,expectedCashMinor:4200,expectedFeeMinor:400});
  const targetPayments=await db().select().from(payments).where(eq(payments.invoiceId,f.target.invoiceId));expect(targetPayments).toHaveLength(2);
  const routes=await db().select().from(merchantAgreementPaymentRoutes).where(inArray(merchantAgreementPaymentRoutes.paymentId,targetPayments.map(row=>row.id)));
  for(const payment of targetPayments){const route=routes.find(row=>row.paymentId===payment.id),original=receipts.find(row=>row.id===route?.originalChargeReceiptId);expect(original).toBeDefined();expect(payment).toMatchObject({amountMinor:original?.amountMinor,providerRef:original?.providerPaymentIntentRef,status:"succeeded"});expect(route?.applicationFeeMinor).toBe(payment.amountMinor===1?0:400);}
  expect(await db().select().from(subscriptionProviderChargeReceipts).orderBy(subscriptionProviderChargeReceipts.id)).toEqual(before.receipts);
 });
 it("retains every real bank receipt but refuses an incorrect atomic fee endpoint before core3 or canonical writes",async()=>{
  f=await actualControlledPeriod84();const open=await actualControlledOpenInvoice84(f);f.remote.externallyAttachPayment(open.providerInvoiceRef,4199,399);f.remote.externallyAttachPayment(open.providerInvoiceRef,1,0);
  const receipts=await retained(),before=await snapshot(),counts=f.remote.counts();expect(receipts).toHaveLength(2);await expect(atomic.call(input(receipts.map(row=>row.id)),system)).rejects.toMatchObject({code:"conflict"});expect(await snapshot()).toEqual(before);expect(f.remote.counts()).toEqual(counts);
 });
 it("rolls back the genuinely settled first receipt and all core3/events/access if the second actual SQL insert refuses",async()=>{
  f=await actualControlledPeriod84();const open=await actualControlledOpenInvoice84(f);f.remote.externallyAttachPayment(open.providerInvoiceRef,2100,200);f.remote.externallyAttachPayment(open.providerInvoiceRef,2100,200);
  const receipts=await retained(),before=await snapshot(),counts=f.remote.counts();expect(receipts).toHaveLength(2);
  await expect(atomic.call({...input(receipts.map(row=>row.id)),refuseLater:true},system)).rejects.toThrow("Reject actual later receipt after real earlier settlement");
  expect(await snapshot()).toEqual(before);expect(f.remote.counts()).toEqual(counts);expect(f.remote.externalAttachments()).toBe(2);
  expect((await db().execute<{absent:boolean}>(sql`select not exists(select 1 from pg_trigger where tgname='zz_test_refuse_actual_later_receipt84') as absent`))[0]?.absent).toBe(true);
 });
 it("cannot commit an uneven intermediate fee prefix when the later real receipt fails",async()=>{
  f=await actualControlledPeriod84();const open=await actualControlledOpenInvoice84(f);f.remote.externallyAttachPayment(open.providerInvoiceRef,4199,400);f.remote.externallyAttachPayment(open.providerInvoiceRef,1,0);
  const receipts=await retained(),before=await snapshot(),counts=f.remote.counts();expect(receipts).toHaveLength(2);await expect(atomic.call({...input(receipts.map(row=>row.id)),refuseLater:true},system)).rejects.toThrow("Reject actual later receipt after real earlier settlement");
  expect(await snapshot()).toEqual(before);expect(f.remote.externalAttachments()).toBe(2);expect(f.remote.counts()).toEqual(counts);
 });
 it.each(["duplicate","foreign"] as const)("refuses %s receipt membership before canonical writes while retaining genuine raw cash",async change=>{
  f=await actualControlledPeriod84();const receipts=await retained(),first=receipts[0];if(!first)throw Error("Use the actual retained receipt.");const before=await snapshot();await expect(atomic.call(input(change==="duplicate"?[first.id,first.id]:[randomUUID()]),system)).rejects.toMatchObject({code:"conflict"});expect(await snapshot()).toEqual(before);
 });
});
