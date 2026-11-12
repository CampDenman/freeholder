// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.26/C12.38: actual mixed checkout and earnings; synthetic payment edge only.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { InvoiceForCharge } from "@/adapters/payments";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { ready } from "@/core/runtime";
import { beginPaymentCheckout, completePaymentCheckout } from "@/modules/invoicing/payment-provider-service";
import { merchantSettlement } from "@/modules/invoicing/merchant-settlement";
import { getInvoice } from "@/modules/invoicing/invoice-service";
import { invoiceMerchantAllocations } from "@/modules/invoicing/schema";
import { memberPayouts } from "@/modules/members/schema";
import { recordPayouts, reversePayouts } from "@/modules/members/payouts";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
import { seedMerchantCheckout80 } from "../helpers/merchant-checkout80";
const SYSTEM={kind:"system"} as const;
describe.runIf(hasDatabase)("original per-business merchant earnings80",{timeout:60000},()=>{
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
 it.each(["direct","destination"] as const)("records both sellers from their original %s portions without dispatching another payout",async kind=>{
  const {invoiceId,orderId}=await paid(kind);
  // The actual paid event records these earnings; explicit replay adds none.
  expect(await recordPayouts.call({orderId},SYSTEM)).toEqual({recorded:0});
  const allocations=await db().select().from(invoiceMerchantAllocations).where(eq(invoiceMerchantAllocations.invoiceId,invoiceId));
  const rows=await db().select().from(memberPayouts);
  expect(rows).toHaveLength(2);
  for(const seller of fixture!.sellers){
   const original=allocations.find(value=>value.sellerUserId===seller.userId)!;
   expect(rows.find(value=>value.sellerId===seller.userId)).toMatchObject({model:"seller_merchant",state:"paid",grossMinor:original.revenueMinor,feeMinor:original.feeMinor,netMinor:original.revenueMinor-original.feeMinor,reference:`stripe-${kind}:${original.id}`});
   expect(await merchantSettlement.call({invoiceId,sellerUserId:seller.userId},SYSTEM)).toMatchObject({state:"paid",reference:`stripe-${kind}:${original.id}`});
  }
  // A repeated refund listener cannot turn the other seller's paid portion
  // into a new transfer or overwrite it with an invoice-wide guess.
  expect(await reversePayouts.call({invoiceId,amountMinor:5250},SYSTEM)).toEqual({changed:2});
  expect((await db().select().from(memberPayouts)).every(value=>value.state==="paid")).toBe(true);
 });
 it("keeps an original portion in review until its actual settlement evidence is verified",async()=>{
  const {invoiceId,orderId}=await paid("destination",true);
  expect(await recordPayouts.call({orderId},SYSTEM)).toEqual({recorded:0});
  const rows=await db().select().from(memberPayouts);
  expect(rows.map(value=>value.state).sort()).toEqual(["paid","review"]);
  expect((await getInvoice.call({id:invoiceId},OWNER)).invoice.paidMinor).toBe(5250);
 });
});
