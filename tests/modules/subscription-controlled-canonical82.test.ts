// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Requires actual 15-family parent composition + both new tails.
// All subscription/invoice/payment/credit/admission rows use real services.
import { eq } from "drizzle-orm";
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import * as paymentAdapters from "@/adapters/payments";
import { db } from "@/core/db";
import { stopJobs } from "@/core/jobs";
import { ready } from "@/core/runtime";
import { invoices,creditNotes,payments } from "@/modules/invoicing/schema";
import { recordOfflineRefund } from "@/modules/invoicing/payment-provider-service";
import { invoiceCreditFunding,invoiceCreditApplications } from "@/modules/invoicing/credit-application-schema";
import { createListing } from "@/modules/members/listings";
import { getProductVariants } from "@/modules/catalog/variants";
import { subscriptions } from "@/modules/subscriptions/schema";
import { savePlan } from "@/modules/subscriptions/service";
import { prepareControlledProviderCalendar } from "@/modules/subscriptions/controlled-provider-execution";
import { quoteControlledProration } from "@/modules/subscriptions/controlled-provider-proration-quote";
import { acceptControlledProration } from "@/modules/subscriptions/controlled-provider-proration-acceptance";
import { subscriptionControlledQuotes,subscriptionControlledCollections } from "@/modules/subscriptions/controlled-provider-collection-schema";
import { seedActualProviderSubscription80 } from "../helpers/merchant-subscription80";
import { controlledProrationEdge82 } from "../helpers/merchant-controlled-proration82";
import { closeDb,hasDatabase,OWNER,truncateSpine } from "../helpers/spine";
describe.runIf(hasDatabase)("actual controlled canonical consent and original paid credit",{timeout:90000},()=>{
 let original:Awaited<ReturnType<typeof seedActualProviderSubscription80>>|undefined;
 beforeAll(ready,60000);beforeEach(truncateSpine);afterEach(()=>{vi.useRealTimers();original?.fixture.cleanup();original=undefined;vi.restoreAllMocks();});afterAll(async()=>{await stopJobs();await closeDb();});
 async function review(){
  // Choose the original producer's application clock before creating terms;
  // never mutate a stored accepted period or use the clock as money proof.
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(Math.floor(Date.now()/1000)*1000-43200000);
  original=await seedActualProviderSubscription80({paidProrationDay:true});vi.useRealTimers();
  const remote=controlledProrationEdge82();vi.spyOn(paymentAdapters,"paymentAdapter").mockReturnValue(remote.provider);
  const subscriptionId=original.accepted.subscription.id,prepared=await prepareControlledProviderCalendar.call({subscriptionId},OWNER),seller=original.fixture.sellers[0];
  if(!seller)throw Error("The actual current original merchant is required.");
  const listing=await createListing.call({title:"Controlled actual 60 CAD day",kind:"digital",price:"60",acceptPolicy:true},seller),variant=(await getProductVariants.call({productId:listing.productId},OWNER)).variants[0];
  if(!variant)throw Error("The actual offered target variant is required.");
  const plan=await savePlan.call({productId:listing.productId,name:"Actual controlled new day",interval:"day",intervalCount:1,billingMode:"provider",proration:"create_prorations",status:"active"},OWNER);
  const[parent]=await db().select().from(subscriptions).where(eq(subscriptions.id,subscriptionId)),[invoice]=await db().select().from(invoices).where(eq(invoices.id,original.accepted.invoiceId!));
  if(!parent||!invoice)throw Error("Retain the actual original paid period before the new quote.");
  expect(invoice).toMatchObject({status:"paid",subtotalMinor:4000,taxMinor:200,totalMinor:4200,paidMinor:4200,creditedMinor:0});
  const review=await quoteControlledProration.call({id:subscriptionId,resourceId:prepared.resourceId,planId:plan.id,productVariantId:variant.id,effectiveAt:remote.quarterDayInstant().toISOString(),taxDestination:{country:"CA",region:"BC"},locale:"en"},OWNER);
  return{remote,parent,invoice,review,plan};
 }
 it("uses the actual canonical paid old line even when the original zero-NET transport's native credit estimate is zero",async()=>{
  const f=await review();expect(f.review.calendar.nativeUnusedCreditMinor).toBe(0);expect(f.review.creditNetMinor+f.review.creditTaxMinor).toBeGreaterThan(0);expect(f.review.debitNetMinor).toBe(4500);expect(f.review.debitTaxMinor).toBe(225);
  const accepted=await acceptControlledProration.call({quoteId:f.review.controlled.quoteId,resourceId:f.review.controlled.resourceId,previousTermsId:f.review.previousTermsId,acceptedQuoteDigest:f.review.quoteDigest,confirm:true},OWNER);
  const[target]=await db().select().from(invoices).where(eq(invoices.id,accepted.invoiceId!)),[credit]=await db().select().from(creditNotes).where(eq(creditNotes.id,accepted.creditNoteId!));
  expect(target).toMatchObject({sourceId:f.review.canonicalSourceId,subtotalMinor:4500,taxMinor:225,totalMinor:4725,paidMinor:0,creditedMinor:f.review.creditAppliedMinor});
  expect(credit).toMatchObject({invoiceId:f.invoice.id,status:"issued",totalMinor:f.review.creditNetMinor+f.review.creditTaxMinor});
  const funding=await db().select().from(invoiceCreditFunding).where(eq(invoiceCreditFunding.creditNoteId,credit!.id));expect(funding.reduce((n,row)=>n+row.amountMinor,0)).toBe(credit!.totalMinor);
  expect(await db().select().from(invoiceCreditApplications).where(eq(invoiceCreditApplications.invoiceId,target!.id))).not.toHaveLength(0);
  expect((await db().select().from(invoices).where(eq(invoices.id,f.invoice.id)))[0]).toEqual(f.invoice);
  const[after]=await db().select().from(subscriptions).where(eq(subscriptions.id,f.parent.id));expect(after).toMatchObject({planId:f.parent.planId,pendingPlanId:f.plan.id,currentPeriodStart:f.parent.currentPeriodStart,currentPeriodEnd:f.parent.currentPeriodEnd});
  const[quote]=await db().select().from(subscriptionControlledQuotes).where(eq(subscriptionControlledQuotes.id,f.review.controlled.quoteId)),[collection]=await db().select().from(subscriptionControlledCollections).where(eq(subscriptionControlledCollections.id,accepted.collectionId));
  expect(quote!.quotedParentRevision).toBe(f.review.controlled.quotedParentRevision);expect(collection!.acceptedCurrentParentRevision).not.toBe(quote!.quotedParentRevision);expect(f.remote.previewPosts()).toBe(2);
 });
 it("returns the identical original canonical promise on a retry instead of duplicating debit, issued credit or bank preview",async()=>{
  const f=await review(),input={quoteId:f.review.controlled.quoteId,resourceId:f.review.controlled.resourceId,previousTermsId:f.review.previousTermsId,acceptedQuoteDigest:f.review.quoteDigest,confirm:true as const};
  const first=await acceptControlledProration.call(input,OWNER),moneyBefore=await db().select().from(payments),notesBefore=await db().select().from(creditNotes);
  expect(await acceptControlledProration.call(input,OWNER)).toEqual(first);expect(await db().select().from(payments)).toEqual(moneyBefore);expect(await db().select().from(creditNotes)).toEqual(notesBefore);expect(f.remote.previewPosts()).toBe(2);
 });
 it("refuses new credit after a genuine actual original principal refund and preserves the historical unaccepted quote",async()=>{
  const f=await review(),[payment]=await db().select().from(payments).where(eq(payments.invoiceId,f.invoice.id));if(!payment)throw Error("The actual attested original principal is required.");
  await recordOfflineRefund.call({paymentId:payment.id,amountMinor:1,reference:"fictional-controlled-original-return",reason:"Explicit actual external principal return before consent",idempotencyKey:"controlled-original-return"},OWNER);
  const[before]=await db().select().from(subscriptionControlledQuotes).where(eq(subscriptionControlledQuotes.id,f.review.controlled.quoteId));
  await expect(acceptControlledProration.call({quoteId:f.review.controlled.quoteId,resourceId:f.review.controlled.resourceId,previousTermsId:f.review.previousTermsId,acceptedQuoteDigest:f.review.quoteDigest,confirm:true},OWNER)).rejects.toMatchObject({code:"conflict"});
  expect(await db().select().from(creditNotes)).toHaveLength(0);expect(await db().select().from(subscriptionControlledCollections)).toHaveLength(0);
  expect((await db().select().from(subscriptionControlledQuotes).where(eq(subscriptionControlledQuotes.id,f.review.controlled.quoteId)))[0]).toEqual(before);expect(f.remote.previewPosts()).toBe(2);
 });
});
