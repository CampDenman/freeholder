// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.19/C12.38: genuine original refund services with synthetic Stripe transport.
import {createHash,createHmac} from "node:crypto";
import {afterAll,describe,expect,it,vi} from "vitest";
import {z} from "zod";
import {eq} from "drizzle-orm";
import * as adapters from "@/adapters/payments";
import {createStripePayments} from "@/adapters/payments/stripe";
import {db} from "@/core/db";
import {ready} from "@/core/runtime";
import {stopJobs} from "@/core/jobs";
import {recoverReturnBankRefunds,submitReturnProviderRefund} from "@/modules/catalog/service";
import {retainPaymentProviderEvidence,processPaymentProviderEvents} from "@/modules/invoicing/payment-provider-service";
import {payments,refunds} from "@/modules/invoicing/schema";
import {legacyBankCurrentReceipts} from "@/modules/invoicing/legacy-bank-read-schema";
import {closeDb,OWNER} from "../helpers/spine";

const input=z.object({mode:z.enum(["prepare","confirm"]),returnId:z.uuid(),refundId:z.uuid().optional()}).parse({
 mode:process.env.FREEHOLDER_RETURN_FIXTURE_MODE,
 returnId:process.env.FREEHOLDER_RETURN_FIXTURE_RETURN_ID,
 refundId:process.env.FREEHOLDER_RETURN_FIXTURE_REFUND_ID||undefined,
});
const secret="whsec_return_browser_fixture_only";

describe("genuine original provider refunds for the browser journey",()=>{
 afterAll(async()=>{vi.restoreAllMocks();await closeDb();});
 it("prepares pending callers or applies one exact signed callback",async()=>{
  await ready();await stopJobs();
  const fetcher=vi.fn<typeof fetch>(async(resource,init={})=>{
   const url=new URL(typeof resource==="string"?resource:resource instanceof URL?resource.href:resource.url);
   expect(url.origin).toBe("https://api.stripe.com");
   if(url.pathname==="/v1/account"&&init.method==="GET")return Response.json({id:"acct_ReturnBrowserFixture"});
   const allRefunds=await db().select().from(refunds).where(eq(refunds.provider,"stripe"));
   const confirmed=new Set((await db().select({refundId:legacyBankCurrentReceipts.refundId}).from(legacyBankCurrentReceipts).where(eq(legacyBankCurrentReceipts.status,"succeeded"))).map(row=>row.refundId));
   const rawRefund=(row:typeof allRefunds[number])=>({id:row.providerRef,payment_intent:null,charge:`ch_fixture_${row.paymentId.replaceAll("-","")}`,amount:row.amountMinor,currency:row.currency.toLowerCase(),status:row.id===input.refundId||confirmed.has(row.id)?"succeeded":"pending",failure_balance_transaction:null});
   if(url.pathname.startsWith("/v1/refunds/")&&init.method==="GET"){
    const row=allRefunds.find(item=>item.providerRef===decodeURIComponent(url.pathname.slice("/v1/refunds/".length)));
    if(!row)throw new Error("The original provider refund resource is missing.");
    const [payment]=await db().select().from(payments).where(eq(payments.id,row.paymentId));
    return Response.json({...rawRefund(row),payment_intent:payment?.providerRef});
   }
   if(url.pathname.startsWith("/v1/payment_intents/")&&init.method==="GET"){
    const [payment]=await db().select().from(payments).where(eq(payments.providerRef,decodeURIComponent(url.pathname.slice("/v1/payment_intents/".length))));
    if(!payment)throw new Error("The original provider payment resource is missing.");
    return Response.json({id:payment.providerRef,status:"succeeded",amount_received:payment.amountMinor,currency:payment.currency.toLowerCase(),latest_charge:`ch_fixture_${payment.id.replaceAll("-","")}`,amount_capturable:0});
   }
   if(url.pathname.startsWith("/v1/charges/")&&init.method==="GET"){
    const chargeId=decodeURIComponent(url.pathname.slice("/v1/charges/".length));
    const payment=(await db().select().from(payments)).find(row=>`ch_fixture_${row.id.replaceAll("-","")}`===chargeId);
    if(!payment)throw new Error("The original provider charge resource is missing.");
    return Response.json({id:`ch_fixture_${payment.id.replaceAll("-","")}`,payment_intent:payment.providerRef,amount_captured:payment.amountMinor,amount_refunded:allRefunds.filter(row=>row.paymentId===payment.id&&(row.id===input.refundId||confirmed.has(row.id))).reduce((sum,row)=>sum+row.amountMinor,0),currency:payment.currency.toLowerCase(),paid:true,captured:true,refunded:false,application_fee:null,transfer:null});
   }
   if(url.pathname==="/v1/refunds"&&init.method==="GET"){
    const paymentRef=url.searchParams.get("payment_intent"),allPayments=await db().select().from(payments);
    const scoped=allRefunds.filter(row=>allPayments.find(payment=>payment.id===row.paymentId)?.providerRef===paymentRef);
    return Response.json({data:scoped.map(row=>({...rawRefund(row),payment_intent:paymentRef})),has_more:false});
   }
   if(url.pathname==="/v1/disputes"&&init.method==="GET")return Response.json({data:[],has_more:false});
   expect(url.pathname).toBe("/v1/refunds");expect(init.method).toBe("POST");
   if(!(init.body instanceof URLSearchParams)&&typeof init.body!=="string")throw new Error("The original Stripe form body must be URLSearchParams or a string.");
   const body=init.body instanceof URLSearchParams?init.body:new URLSearchParams(init.body);
   const paymentRef=body.get("payment_intent"),amount=Number(body.get("amount"));
   if(!paymentRef?.startsWith("pi_fixture_")||!Number.isSafeInteger(amount)||amount<=0)throw new Error("The original fixture payment is missing.");
   const payment=(await db().select().from(payments)).find(row=>row.providerRef===paymentRef&&row.amountMinor===amount&&row.status==="succeeded");
   if(!payment)throw new Error("The refund does not match its original fixture payment.");
   return Response.json({id:`re_fixture_${payment.id.replaceAll("-","")}`,payment_intent:paymentRef,amount,currency:payment.currency.toLowerCase(),status:"pending"});
  });
  const factory=createStripePayments({secretKey:"sk_return_browser_fixture_only",webhookSecrets:[secret],fetch:fetcher});
  vi.spyOn(adapters,"paymentAdapter").mockReturnValue(factory);
  if(input.mode==="prepare"){
   const result=await submitReturnProviderRefund.call({id:input.returnId,idempotencyKey:`browser-return-prepare-${input.returnId}`},OWNER);
   expect(result.return.status).toBe("received");
   const rows=await db().select().from(refunds);
   expect(rows.length).toBeGreaterThan(0);
   expect(rows.filter(row=>row.provider==="stripe").every(row=>row.status==="processing"&&row.providerRef)).toBe(true);
   expect(fetcher).toHaveBeenCalledTimes(rows.filter(row=>row.provider==="stripe").length);
   return;
  }
  const [refund]=await db().select().from(refunds).where(eq(refunds.id,z.uuid().parse(input.refundId)));
  if(!refund?.providerRef||refund.status!=="processing")throw new Error("The exact pending original refund is missing.");
  const [payment]=await db().select().from(payments).where(eq(payments.id,refund.paymentId));
  if(!payment?.providerRef)throw new Error("The exact original payment is missing.");
  const now=Math.floor(Date.now()/1000);
  const body=Buffer.from(JSON.stringify({id:`evt_return_browser_${refund.id}`,type:"refund.updated",api_version:"2026-02-25.clover",created:now,data:{object:{id:refund.providerRef,payment_intent:payment.providerRef,charge:`ch_fixture_${payment.id.replaceAll("-","")}`,amount:refund.amountMinor,currency:refund.currency.toLowerCase(),status:"succeeded",failure_balance_transaction:null}}}));
  const signature=createHmac("sha256",secret).update(`${now}.`).update(body).digest("hex"),receivedAt=new Date(now*1000).toISOString(),bodySha256=createHash("sha256").update(body).digest("hex");
  const verified=await factory.verifyWebhook({body,headers:{"stripe-signature":`t=${now},v1=${signature}`},receivedAt});
  const events=await retainPaymentProviderEvidence("stripe",verified,{rawBodySha256:bodySha256,receivedAt});
  await processPaymentProviderEvents.call({provider:"stripe",events,receivedAt,bodySha256},{kind:"system"});
  await recoverReturnBankRefunds.call({id:input.returnId},OWNER);
  expect((await db().select().from(refunds).where(eq(refunds.id,refund.id)))[0]?.status).toBe("succeeded");
 });
});
