// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: PREPARED / UNRUN. Actual shared producers/physical adapters;
// synthetic bank-edge responses only. No financial row/context backfill.
import { eq,sql } from "drizzle-orm";
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import * as paymentAdapters from "@/adapters/payments";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { stopJobs } from "@/core/jobs";
import { contactReferences } from "@/core/contacts/service";
import { controlledProviderFinancialReadiness } from "@/modules/invoicing/controlled-provider-financial-readiness";
import { controlledFinancialWitness,controlledCashFinancialHistory,exportControlledFinancialHistory } from "@/modules/invoicing/controlled-provider-financial-witness";
import { merchantRefundDependencyFingerprints } from "@/modules/invoicing/merchant-refund-dependencies";
import { originalReceiptPrincipalReview } from "@/modules/invoicing/principal-authority";
import { merchantTaxPaymentDebt } from "@/modules/invoicing/merchant-payment-debt";
import { merchantTaxProfiles } from "@/modules/invoicing/merchant-tax-schema";
import { invoices,payments } from "@/modules/invoicing/schema";
import { subscriptionProviderChargeObservations,subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { prepareControlledProviderCalendar,stopControlledProviderCalendar,recoverControlledProviderOperation } from "@/modules/subscriptions/controlled-provider-execution";
import { planControlledProviderOperation } from "@/modules/subscriptions/controlled-provider-plan";
import { closeControlledZeroProviderResource } from "@/modules/subscriptions/controlled-provider-zero-closure";
import { seedActualProviderSubscription80 } from "../helpers/merchant-subscription80";
import { controlledProviderEdge80 } from "../helpers/merchant-controlled-provider80";
import { closeDb,hasDatabase,OWNER,truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("actual controlled parent original financial witnesses",{timeout:90000},()=>{
 let source:Awaited<ReturnType<typeof seedActualProviderSubscription80>>|undefined;
 beforeAll(ready,60000);beforeEach(truncateSpine);
 afterEach(()=>{source?.fixture.cleanup();source=undefined;vi.restoreAllMocks();});
 afterAll(async()=>{await stopJobs();await closeDb();});
 async function original(){
  source=await seedActualProviderSubscription80();const remote=controlledProviderEdge80();vi.spyOn(paymentAdapters,"paymentAdapter").mockReturnValue(remote.provider);
  const subscriptionId=source.accepted.subscription.id,prepared=await prepareControlledProviderCalendar.call({subscriptionId},OWNER);
  const[profile]=await db().select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id,source.fixture.profiles[0]!.profileId));
  if(!profile?.contactId)throw Error("The actual accepted merchant profile has no original contact");
  return{subscriptionId,prepared,remote,profileId:profile.id,merchantContactId:profile.contactId};
 }
 it("keeps readiness equal only for the exact empty owned operation and separates active-zero admission from privacy quiescence",async()=>{
  const actual=await original(),before=await controlledProviderFinancialReadiness.call({subscriptionId:actual.subscriptionId},{kind:"system"});
  const planned=await planControlledProviderOperation.call({resourceId:actual.prepared.resourceId,kind:"read_bootstrap"},{kind:"system"});
  const same=await controlledProviderFinancialReadiness.call({subscriptionId:actual.subscriptionId,excludeUnadmittedOperationId:planned.operationId},{kind:"system"});
  expect(same.revision).toBe(before.revision);
  await expect(controlledProviderFinancialReadiness.call({subscriptionId:actual.subscriptionId,excludeUnadmittedOperationId:"10000000-0000-4000-8000-000000000999"},{kind:"system"})).rejects.toMatchObject({code:"conflict"});
  expect(await merchantTaxPaymentDebt.call({profileId:actual.profileId},{kind:"system"})).toMatchObject({pending:true,hasHistory:true,paymentIds:[]});
  expect(await db().select().from(payments)).toHaveLength(0);expect(actual.remote.bootstrapPosts()).toBe(1);
 });
 it("retains actual NULL-payment cash and exact origin witnesses across principal refusal and safe merchant export",async()=>{
  const actual=await original();actual.remote.externallyPayUnexpectedInvoice();
  await stopControlledProviderCalendar.call({resourceId:actual.prepared.resourceId},OWNER);
  const[receipt]=await db().select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId,actual.subscriptionId));
  if(!receipt)throw Error("The actual unexpected positive cash receipt was not retained");
  const[observation]=await db().select().from(subscriptionProviderChargeObservations).where(eq(subscriptionProviderChargeObservations.providerPaymentIntentRef,receipt.providerPaymentIntentRef));
  if(!observation)throw Error("The actual original cash occurrence was not retained");
  const controlled=await db().transaction(tx=>controlledCashFinancialHistory(tx,[receipt.id]));
  expect(controlled.namespaces).toEqual([expect.objectContaining({receiptId:receipt.id,applies:true,verified:true})]);
  const children=await db().transaction(tx=>merchantRefundDependencyFingerprints(tx,{paymentIds:[],subscriptionChargeReceiptIds:[receipt.id]}));
  expect(children.incomplete).toBe(false);
  for(const entry of controlled.entries)expect(children.entries).toContainEqual(entry);
  expect(await originalReceiptPrincipalReview.call({receiptId:receipt.id,observationId:observation.id},{kind:"system"})).toMatchObject({paymentId:null,principalSafe:false,currentPrincipalMinor:null,reviewRequired:true,receiptOnly:true});
  await expect(controlledProviderFinancialReadiness.call({subscriptionId:actual.subscriptionId},{kind:"system"})).rejects.toMatchObject({code:"conflict"});
  const safe=await db().transaction(tx=>exportControlledFinancialHistory(tx,{profileIds:[actual.profileId],receiptIds:[receipt.id]}));
  expect(safe.exported.originalCashReceipts[0]).toMatchObject({id:receipt.id,amountMinor:500,currency:"CAD"});
  expect(JSON.stringify(safe.exported)).not.toMatch(/nonce|signature|publicKey|pm_actual|cus_actual|hostingEvidence|pidNamespace/);
  expect(await db().select().from(subscriptionProviderChargeReceipts)).toEqual([receipt]);expect(await db().select().from(payments)).toHaveLength(0);
  expect(await db().select().from(invoices).where(sql`${invoices.sourceType}='subscription' and split_part(${invoices.sourceId},':',1)=${actual.subscriptionId}`)).toHaveLength(0);
 });
 it("binds the real seller policy snapshot before any invoice and refuses its old undo after a new actual bank read",async()=>{
  const actual=await original(),reference=contactReferences().find(row=>row.table==="subscription_market_policies");
  if(!reference?.captureForUndo||!reference.restoreAfterUndo)throw Error("The actual seller policy has no original merge snapshot/undo hooks");
  const capture=reference.captureForUndo,restore=reference.restoreAfterUndo;
  const buyerId=source!.fixture.buyer.id;
  const before=await db().transaction(tx=>capture(tx,actual.merchantContactId,buyerId));
  expect(before.undoable).toBe(true);
  const first=await db().transaction(tx=>controlledFinancialWitness(tx,{subscriptionIds:[actual.subscriptionId]}));
  const planned=await planControlledProviderOperation.call({resourceId:actual.prepared.resourceId,kind:"read_bootstrap"},{kind:"system"});
  await recoverControlledProviderOperation.call({operationId:planned.operationId},OWNER);
  const after=await db().transaction(tx=>controlledFinancialWitness(tx,{subscriptionIds:[actual.subscriptionId]}));
  expect(after.entries).not.toEqual(first.entries);
  await expect(db().transaction(tx=>restore(tx,before.state,before.state,actual.merchantContactId,buyerId))).rejects.toMatchObject({code:"conflict"});
  await stopControlledProviderCalendar.call({resourceId:actual.prepared.resourceId},OWNER);await closeControlledZeroProviderResource.call({resourceId:actual.prepared.resourceId},OWNER);
  expect(await merchantTaxPaymentDebt.call({profileId:actual.profileId},{kind:"system"})).toMatchObject({pending:false,hasHistory:true,paymentIds:[],incomplete:false});
  expect(actual.remote.bootstrapPosts()).toBe(1);expect(await db().select().from(payments)).toHaveLength(0);
 });
});
