// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.25/C12.38: real booking, original invoice and provider collection spine.
import { randomUUID } from "node:crypto";
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import { eq } from "drizzle-orm";
import type { InvoiceForCharge } from "@/adapters/payments";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { env } from "@/core/env";
import { ready } from "@/core/runtime";
import { availableSlots } from "@/core/scheduling/resolver-service";
import { createListing } from "@/modules/members/listings";
import { offerBookableService } from "@/modules/members/member-services";
import { recordInvoicePayout } from "@/modules/members/member-subscriptions";
import { memberPayouts } from "@/modules/members/schema";
import { bookPublicService,publicBookingQuote } from "@/modules/catalog/public-booking";
import { beginPaymentCheckout,completePaymentCheckout } from "@/modules/invoicing/payment-provider-service";
import { getInvoiceMarketPolicy } from "@/modules/invoicing/market-policy";
import { merchantSettlement } from "@/modules/invoicing/merchant-settlement";
import { closeDb,hasDatabase,OWNER,truncateSpine } from "../helpers/spine";
import { MERCHANT_FIXTURE_BUYER_EMAIL,MERCHANT_FIXTURE_DESTINATION,seedMerchantCheckout80 } from "../helpers/merchant-checkout80";
const SYSTEM={kind:"system"} as const;
const BUYER={kind:"user",userId:"00000000-0000-4000-8000-0000000000c3",role:"customer",grants:[]} as const;
describe.runIf(hasDatabase)("original single-source merchant earnings80",{timeout:60000},()=>{
 let fixture:Awaited<ReturnType<typeof seedMerchantCheckout80>>|undefined;
 beforeAll(ready,60000);beforeEach(truncateSpine);afterEach(()=>{fixture?.cleanup();fixture=undefined;vi.restoreAllMocks();});afterAll(closeDb);
 it.each(["direct","destination"] as const)("records an actual %s booking against its original merchant settlement",async kind=>{
  fixture=await seedMerchantCheckout80(kind);
  await db().insert(users).values({id:BUYER.userId,email:MERCHANT_FIXTURE_BUYER_EMAIL,role:"customer"});
  await db().update(contacts).set({userId:BUYER.userId}).where(eq(contacts.id,fixture.buyer.id));
  const seller=fixture.sellers[0]!;
  const listing=await createListing.call({title:"Original merchant appointment",kind:"service",price:"80",acceptPolicy:true},seller);
  await offerBookableService.call({productId:listing.productId,durationMin:60,hours:[0,1,2,3,4,5,6].map(weekday=>({weekday,starts:"09:00",ends:"17:00"}))},seller);
  const selection={productId:listing.productId,currency:"CAD",mode:"full" as const,seats:1,taxDestination:MERCHANT_FIXTURE_DESTINATION};
  const quote=await publicBookingQuote.call(selection,BUYER);expect(quote.merchant).not.toBeNull();expect(quote.totalMinor).toBe(8400);
  const day=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
  const [slot]=await availableSlots.call({productId:listing.productId,serviceOfferingId:quote.offeringId,from:day,to:day,seats:1,limit:50},BUYER);expect(slot).toBeTruthy();
  const booked=await bookPublicService.call({...selection,calendarId:slot!.calendarId,startsAt:slot!.startsAt.toISOString(),termsHash:quote.termsHash,acceptedTerms:true,requestKey:randomUUID(),taxQuoteDigest:quote.merchant!.taxQuoteDigest,commercialQuoteDigest:quote.merchant!.commercialQuoteDigest},BUYER);
  const invoiceId=booked.invoiceId!;let original:InvoiceForCharge|undefined;
  fixture.stripe.createCheckout=async request=>{original=request;return{...request,providerRef:"cs_originalBooking",paymentRef:"pi_originalBooking",url:"https://checkout.example.test/booking"};};
  fixture.stripe.captureCheckout=async()=>({...original!,status:"succeeded",providerRef:"pi_originalBooking",amountMinor:original!.amountMinor,currency:original!.currency,customerChargeVerified:true,merchantRouteVerified:true,merchantSettlementVerified:true,providerChargeRef:"ch_originalBooking",applicationFeeRef:"fee_originalBooking",observedApplicationFeeMinor:original!.applicationFeeMinor,applicationFeeCurrency:"CAD",observedFeeRefundedMinor:0,...(kind==="destination"?{transferRef:"tr_originalBooking"}:{})});
  const begun=await beginPaymentCheckout.call({invoiceId,provider:"stripe",successUrl:env().APP_URL,cancelUrl:env().APP_URL,idempotencyKey:randomUUID()},OWNER);
  expect((await completePaymentCheckout.call({paymentId:begun.payment.id,idempotencyKey:randomUUID()},OWNER)).status).toBe("succeeded");
  const policy=await getInvoiceMarketPolicy.call({invoiceId},SYSTEM);
  expect(await recordInvoicePayout.call({invoiceId},SYSTEM)).toEqual({recorded:false});
  expect(await merchantSettlement.call({invoiceId,sellerUserId:seller.userId},SYSTEM)).toMatchObject({state:"paid",reference:`stripe-${kind}:${invoiceId}`});
  expect(await db().select().from(memberPayouts).where(eq(memberPayouts.invoiceId,invoiceId))).toMatchObject([{sellerId:seller.userId,state:"paid",grossMinor:8000,feeMinor:policy!.feeMinor,netMinor:8000-policy!.feeMinor}]);
 });
});
