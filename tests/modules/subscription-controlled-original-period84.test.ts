// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Actual services; no hand-inserted financial/admission rows.
import { eq } from "drizzle-orm";
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import * as paymentAdapters from "@/adapters/payments";
import { db } from "@/core/db";
import { stopJobs } from "@/core/jobs";
import { ready } from "@/core/runtime";
import { invoices,invoiceLines,payments,creditNotes } from "@/modules/invoicing/schema";
import { subscriptions,subscriptionCommercialTerms } from "@/modules/subscriptions/schema";
import { subscriptionControlledCollections,subscriptionControlledComponents } from "@/modules/subscriptions/controlled-provider-collection-schema";
import { prepareControlledProviderCalendar } from "@/modules/subscriptions/controlled-provider-execution";
import { quoteControlledPeriod } from "@/modules/subscriptions/controlled-provider-period-quote";
import { prepareControlledPeriodTarget } from "@/modules/subscriptions/controlled-provider-period-target";
import { planControlledCollectionOperation } from "@/modules/subscriptions/controlled-provider-collection-plan";
import { seedActualProviderSubscription80 } from "../helpers/merchant-subscription80";
import { controlledPeriodEdge84 } from "../helpers/merchant-controlled-period84";
import { closeDb,hasDatabase,OWNER,truncateSpine } from "../helpers/spine";
describe.runIf(hasDatabase)("actual original posttrial and renewal controlled target",{timeout:90000},()=>{
 let original:Awaited<ReturnType<typeof seedActualProviderSubscription80>>|undefined;
 beforeAll(ready,60000);beforeEach(truncateSpine);afterEach(()=>{vi.useRealTimers();original?.fixture.cleanup();original=undefined;vi.restoreAllMocks();});afterAll(async()=>{await stopJobs();await closeDb();});
 async function review(trial=false){
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(Math.floor(Date.now()/1000)*1000-(trial?0:43200000));
  original=await seedActualProviderSubscription80(trial?{}:{paidProrationDay:true});vi.useRealTimers();
  const remote=controlledPeriodEdge84();vi.spyOn(paymentAdapters,"paymentAdapter").mockReturnValue(remote.provider);
  const id=original.accepted.subscription.id,prepared=await prepareControlledProviderCalendar.call({subscriptionId:id},OWNER);
  const[parent]=await db().select().from(subscriptions).where(eq(subscriptions.id,id));if(!parent)throw Error("The actual original parent is required.");
  const quote=await quoteControlledPeriod.call({id,resourceId:prepared.resourceId,previewAt:remote.previewAt(trial).toISOString(),locale:"en"},OWNER);
  return{parent,remote,quote};
 }
 it("issues the actual next paid day once, retaining the complete original mandate and old access despite a different provider preparation calendar",async()=>{
  const f=await review(),before=await db().select().from(payments),notes=await db().select().from(creditNotes);
  const target=await prepareControlledPeriodTarget.call({quoteId:f.quote.controlled.quoteId,resourceId:f.quote.controlled.resourceId},OWNER);
  const[invoice]=await db().select().from(invoices).where(eq(invoices.id,target.invoiceId)),[collection]=await db().select().from(subscriptionControlledCollections).where(eq(subscriptionControlledCollections.id,target.collectionId));
  const[terms]=await db().select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.id,f.quote.previousTermsId));
  expect(invoice).toMatchObject({sourceId:`${f.parent.id}:${f.parent.currentPeriodEnd.toISOString()}`,subtotalMinor:4000,taxMinor:200,totalMinor:4200,paidMinor:0,creditedMinor:0});
  expect(collection).toMatchObject({kind:"period",termsId:terms!.id,prorationId:null,creditNoteId:null,originalConsentDigest:terms!.acceptedQuoteDigest,acceptedQuoteDigest:f.quote.quoteDigest});
  expect(collection!.originalConsentDigest).not.toBe(collection!.acceptedQuoteDigest);
  expect(await prepareControlledPeriodTarget.call({quoteId:f.quote.controlled.quoteId,resourceId:f.quote.controlled.resourceId},OWNER)).toEqual(target);
  expect((await db().select().from(subscriptions).where(eq(subscriptions.id,f.parent.id)))[0]).toEqual(f.parent);
  expect(await db().select().from(payments)).toEqual(before);expect(await db().select().from(creditNotes)).toEqual(notes);expect(f.remote.previewPosts()).toBe(2);
 });
 it("preserves the genuine original trial end and charges setup exactly once on its future canonical first paid period, with zero old credit",async()=>{
  const f=await review(true);expect(f.parent.status).toBe("trialing");expect(f.quote.calendar.proposedPeriodStart).toBe(f.parent.trialEndsAt!.toISOString());
  expect(f.quote).toMatchObject({creditNetMinor:0,creditTaxMinor:0,creditAppliedMinor:0,debitNetMinor:4500,debitTaxMinor:225,cashDueMinor:4725});
  const target=await prepareControlledPeriodTarget.call({quoteId:f.quote.controlled.quoteId,resourceId:f.quote.controlled.resourceId},OWNER),lines=await db().select().from(invoiceLines).where(eq(invoiceLines.invoiceId,target.invoiceId)).orderBy(invoiceLines.position);
  expect(lines.map(line=>({amount:line.unitAmountMinor,component:line.snapshot.subscriptionComponent}))).toEqual([{amount:4000,component:"period"},{amount:500,component:"setup"}]);
  const components=await db().select().from(subscriptionControlledComponents).where(eq(subscriptionControlledComponents.collectionId,target.collectionId));
  expect(components.filter(row=>row.kind==="net").map(row=>row.provenance)).toEqual(expect.arrayContaining([expect.objectContaining({canonicalComponent:"period",canonicalInvoiceLineId:lines[0]!.id}),expect.objectContaining({canonicalComponent:"setup",canonicalInvoiceLineId:lines[1]!.id})]));
  const[parent]=await db().select().from(subscriptions).where(eq(subscriptions.id,f.parent.id));expect(parent).toMatchObject({status:"trialing",trialEndsAt:f.parent.trialEndsAt,currentPeriodStart:f.parent.currentPeriodStart,currentPeriodEnd:f.parent.currentPeriodEnd,setupFeeInvoiceId:target.invoiceId});
  await expect(planControlledCollectionOperation.call({collectionId:target.collectionId,kind:"pay_invoice"},{kind:"system"})).rejects.toMatchObject({code:"conflict"});
  expect(await db().select().from(payments)).toHaveLength(0);expect(await db().select().from(creditNotes)).toHaveLength(0);
 });
 it("refuses a second quote/second invoice for the same accepted canonical source while preserving the original recoverable target",async()=>{
  const f=await review(),target=await prepareControlledPeriodTarget.call({quoteId:f.quote.controlled.quoteId,resourceId:f.quote.controlled.resourceId},OWNER),before=await db().select().from(invoices);
  await expect(quoteControlledPeriod.call({id:f.parent.id,resourceId:f.quote.controlled.resourceId,previewAt:f.remote.previewAt().toISOString(),locale:"en"},OWNER)).rejects.toMatchObject({code:"conflict"});
  expect(await db().select().from(invoices)).toEqual(before);expect((await db().select().from(subscriptionControlledCollections))[0]?.id).toBe(target.collectionId);expect(f.remote.previewPosts()).toBe(2);
 });
});
