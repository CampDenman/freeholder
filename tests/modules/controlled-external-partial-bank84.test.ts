// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Real target, explicit external bank attachment, no pay POST.
import { eq } from "drizzle-orm";
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { stopJobs } from "@/core/jobs";
import { entitlementGrants } from "@/core/entitlements/schema";
import { invoices,payments } from "@/modules/invoicing/schema";
import { merchantCashReturnObservations } from "@/modules/invoicing/merchant-refund-schema";
import { merchantReturnedCashEvidenceSchema } from "@/modules/invoicing/merchant-returned-cash-contract";
import { inspectControlledCashReceipt } from "@/modules/invoicing/controlled-cash-inspection-service";
import { subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { collectControlledCollection } from "@/modules/subscriptions/controlled-provider-collection-orchestration";
import { actualControlledPeriod84 } from "../helpers/actual-controlled-period84";
import { actualControlledOpenInvoice84 } from "../helpers/actual-controlled-open-invoice84";
import { closeDb,hasDatabase,OWNER,truncateSpine } from "../helpers/spine";
describe.runIf(hasDatabase)("actual external partial principal on one owned canonical bank invoice",{timeout:120000},()=>{
 let f:Awaited<ReturnType<typeof actualControlledPeriod84>>|undefined;
 beforeAll(ready,60000);beforeEach(truncateSpine);afterEach(()=>{vi.useRealTimers();f?.cleanup();f=undefined;vi.restoreAllMocks();});afterAll(async()=>{await stopJobs();await closeDb();});
 it("retains a genuine one-minor bank receipt and 4199 remaining with fee0/transfer1, no synthetic full pay, canonical payment or access",async()=>{
  f=await actualControlledPeriod84();const open=await actualControlledOpenInvoice84(f),before=f.remote.counts();
  const attached=f.remote.externallyAttachPayment(open.providerInvoiceRef,1,0);expect(attached).toMatchObject({amountMinor:1,feeMinor:0});
  expect(await collectControlledCollection.call({collectionId:open.collectionId},OWNER)).toMatchObject({state:"money_retained",applied:false,suppliesAccessAuthority:false});
  const[receipt]=await db().select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId,f.parent.id));
  expect(receipt).toMatchObject({providerInvoiceRef:open.providerInvoiceRef,providerPaymentIntentRef:attached.providerPaymentIntentRef,amountMinor:1,currency:"CAD",customerChargeVerified:true,merchantRouteVerified:true});
  const bank=f.remote.invoices().find(row=>row.id===open.providerInvoiceRef);expect(bank).toMatchObject({total:4200,amount_paid:1,amount_remaining:4199,status:"open",application_fee_amount:400});
  const observed=await inspectControlledCashReceipt.call({collectionId:open.collectionId,receiptId:receipt!.id},OWNER);
  expect(observed).toMatchObject({bankReadReturned:true,completeInventory:true,amountMinor:1,currency:"CAD",amountRefundedMinor:0,suppliesMoneyAuthority:false});
  const states=await db().select().from(merchantCashReturnObservations).where(eq(merchantCashReturnObservations.inspectionId,observed.inspectionId)).orderBy(merchantCashReturnObservations.sequence);
  expect(merchantReturnedCashEvidenceSchema.parse(states.at(-1)?.evidence)).toMatchObject({amountMinor:1,feeFieldObserved:true,fee:null,transferFieldObserved:true,transfer:{amountMinor:1,reversedMinor:0},refundsComplete:true,refunds:[],disputesComplete:true,disputes:[]});
  expect(await db().select().from(payments).where(eq(payments.invoiceId,f.target.invoiceId))).toHaveLength(0);
  expect((await db().select().from(invoices).where(eq(invoices.id,f.target.invoiceId)))[0]).toMatchObject({paidMinor:0,creditedMinor:0,totalMinor:4200});
  expect(await db().select().from(entitlementGrants).where(eq(entitlementGrants.sourceSubscriptionId,f.parent.id))).toEqual(f.grants);
  expect(f.remote.counts()).toMatchObject({...before,payPosts:0,cashGets:expect.any(Number)});expect(f.remote.counts().cashGets).toBeGreaterThan(before.cashGets);expect(f.remote.externalAttachments()).toBe(1);
 });
});
