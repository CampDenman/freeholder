// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: real mixed-invoice return must select its original seller cash.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { InvoiceForCharge } from "@/adapters/payments";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { ready } from "@/core/runtime";
import { beginPaymentCheckout, completePaymentCheckout } from "@/modules/invoicing/payment-provider-service";
import { getInvoice } from "@/modules/invoicing/invoice-service";
import { invoiceMerchantAllocations } from "@/modules/invoicing/schema";
import { merchantPaymentRoutes } from "@/modules/invoicing/merchant-collection-schema";
import { orderItems, returnRefundAllocations } from "@/modules/catalog/schema";
import { requestReturn, decideReturn, receiveReturn } from "@/modules/catalog/fulfillment";
import { prepareReturnRefund } from "@/modules/catalog/return-refunds";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
import { seedMerchantCheckout80 } from "../helpers/merchant-checkout80";
describe.runIf(hasDatabase)("original seller return allocation80",{timeout:60000},()=>{
 let fixture:Awaited<ReturnType<typeof seedMerchantCheckout80>>|undefined;
 beforeAll(ready,60000);beforeEach(truncateSpine);
 afterEach(()=>{fixture?.cleanup();fixture=undefined;vi.restoreAllMocks();});afterAll(closeDb);
 async function paid(kind:"direct"|"destination",unverifiedFirst=false){
  fixture=await seedMerchantCheckout80(kind,2);
  const placed=await fixture.checkout(),invoiceId=placed.order.invoiceId!;
  const requests=new Map<string,InvoiceForCharge>();
  fixture.stripe.createCheckout=async request=>{
   const ref=`cs_original${requests.size}`,paymentRef=`pi_original${requests.size}`;requests.set(ref,request);
   return{providerRef:ref,paymentRef,url:`https://checkout.example.test/${ref}`,providerPlatformAccountId:request.providerPlatformAccountId,
    providerAccountId:request.providerAccountId,destinationAccountId:request.destinationAccountId,settlementMerchantAccountId:request.settlementMerchantAccountId,applicationFeeMinor:request.applicationFeeMinor};
  };
  fixture.stripe.captureCheckout=async request=>{
   const original=requests.get(request.checkoutRef)!;const ordinal=Number(request.checkoutRef.slice(-1));
   return{...original,providerRef:`pi_original${ordinal}`,status:"succeeded",amountMinor:original.amountMinor,currency:original.currency,
    customerChargeVerified:true,merchantRouteVerified:true,merchantSettlementVerified:!(unverifiedFirst&&ordinal===0),
    providerChargeRef:`ch_original${ordinal}`,applicationFeeRef:`fee_original${ordinal}`,transferRef:kind==="destination"?`tr_original${ordinal}`:undefined,
    observedApplicationFeeMinor:original.applicationFeeMinor,applicationFeeCurrency:original.currency,observedFeeRefundedMinor:0};
  };
  for(let i=0;i<2;i++){
   const begun=await beginPaymentCheckout.call({invoiceId,provider:"stripe",successUrl:env().APP_URL,cancelUrl:env().APP_URL,idempotencyKey:randomUUID()},OWNER);
   expect((await completePaymentCheckout.call({paymentId:begun.payment.id,idempotencyKey:randomUUID()},OWNER)).status).toBe("succeeded");
  }
  expect((await getInvoice.call({id:invoiceId},OWNER)).invoice).toMatchObject({status:"paid",paidMinor:5250});
  return{invoiceId,orderId:placed.order.id};
 }
 it("reserves a returned line only against its own seller's original payment",async()=>{
  const {invoiceId,orderId}=await paid("destination");
  const invoice=await getInvoice.call({id:invoiceId},OWNER);
  const originalPayments=invoice.payments.filter(payment=>payment.status==="succeeded").sort((a,b)=>a.createdAt.getTime()-b.createdAt.getTime()||a.id.localeCompare(b.id));
  expect(originalPayments).toHaveLength(2);
  const target=originalPayments[1]!;
  const [route]=await db().select().from(merchantPaymentRoutes).where(eq(merchantPaymentRoutes.paymentId,target.id));
  const [original]=await db().select().from(invoiceMerchantAllocations).where(eq(invoiceMerchantAllocations.id,route!.allocationId));
  const lines=await db().select().from(orderItems).where(eq(orderItems.orderId,orderId));
  const returned=lines.find(line=>line.snapshot.sellerUserId===original!.sellerUserId)!;
  expect(returned).toBeDefined();
  const requested=await requestReturn.call({orderId,reason:"Synthetic original seller return",restock:false,items:[{orderItemId:returned.id,quantity:1}]},OWNER);
  await decideReturn.call({id:requested.return.id,decision:"approved"},OWNER);
  await receiveReturn.call({id:requested.return.id,restock:false},OWNER);
  await prepareReturnRefund.call({id:requested.return.id,idempotencyKey:randomUUID()},OWNER);
  const reservations=await db().select().from(returnRefundAllocations).where(eq(returnRefundAllocations.returnId,requested.return.id));
  expect(reservations).toHaveLength(1);
  expect(reservations[0]).toMatchObject({paymentId:route!.paymentId,amountMinor:original!.totalMinor,currency:"CAD"});
 });
});
