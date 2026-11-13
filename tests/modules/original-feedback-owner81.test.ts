// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: PREPARED/UNRUN real services; synthetic provider HTTP only.
// The subscription helper is the existing combined b8e source, unchanged.
import { createHash, createHmac, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createStripePayments } from "@/adapters/payments/stripe";
import { db } from "@/core/db";
import { outboxEvents } from "@/core/events/schema";
import { stopJobs, reconcileJobDeploymentAdmission } from "@/core/jobs";
import { ready } from "@/core/runtime";
import { merchantPaymentObservations } from "@/modules/invoicing/merchant-collection-schema";
import { legacyBankFeedback } from "@/modules/invoicing/legacy-bank-feedback-schema";
import { retainLegacyBankFeedback } from "@/modules/invoicing/legacy-bank-feedback-service";
import { originalBankFeedbackOwner } from "@/modules/invoicing/original-cash-feedback-owner";
import { originalCashRecoveries, originalCashRecoveryOperations } from "@/modules/invoicing/original-cash-recovery-schema";
import { originalMerchantRefundRepairSource, ORIGINAL_REFUND_EVIDENCE_EVENT } from "@/modules/invoicing/merchant-refund-privacy-repair";
import { paymentWebhookRoute } from "@/modules/invoicing/payment-webhook-route";
import { invoices, payments, refunds } from "@/modules/invoicing/schema";
import { subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { partialCashFixture } from "../helpers/original-cash-partial";
import { seedActualProviderSubscription80 } from "../helpers/merchant-subscription80";
import { closeDb, hasDatabase, truncateSpine } from "../helpers/spine";

const phaseSchema=z.object({start_date:z.number(),end_date:z.number(),metadata:z.record(z.string(),z.string()),items:z.array(z.object({price:z.string()})).length(1)});
async function signedRawRefund(input:{ref:string;intent:string;charge:string;amount:number;currency:string}) {
  const secret="whsec_feedback_owner_fixture_only",timestamp=Math.floor(Date.now()/1000),receivedAt=new Date(timestamp*1000).toISOString();
  const body=Buffer.from(JSON.stringify({id:`evt_Owner${randomUUID()}`,type:"refund.updated",api_version:"2026-10-28.endive",created:timestamp,data:{object:{id:input.ref,payment_intent:input.intent,charge:input.charge,amount:input.amount,currency:input.currency.toLowerCase(),status:"succeeded"}}}));
  const signature=createHmac("sha256",secret).update(`${timestamp}.`).update(body).digest("hex"),adapter=createStripePayments({secretKey:"sk_feedback_owner_fixture_only",webhookSecrets:[secret]});
  const events=await adapter.verifyWebhook({body,receivedAt,headers:{"stripe-signature":`t=${timestamp},v1=${signature}`}});expect(events).toHaveLength(1);
  if(!events[0])throw new Error("Actual verified original feedback was not decoded.");
  return retainLegacyBankFeedback.call({provider:"stripe",event:{...events[0]},rawBodySha256:createHash("sha256").update(body).digest("hex"),receivedAt},{kind:"system"});
}
describe.runIf(hasDatabase)("actual original raw feedback privacy owner81",{timeout:60000},()=>{
  let paymentSource:Awaited<ReturnType<typeof partialCashFixture>>|undefined;
  let subscriptionSource:Awaited<ReturnType<typeof seedActualProviderSubscription80>>|undefined;
  beforeAll(ready,60000);beforeEach(truncateSpine);
  afterEach(async()=>{vi.useRealTimers();paymentSource?.release.resolve();paymentSource?.base.cleanup();subscriptionSource?.fixture.cleanup();paymentSource=undefined;subscriptionSource=undefined;vi.restoreAllMocks();await stopJobs();await reconcileJobDeploymentAdmission();await closeDb();});afterAll(closeDb);
  it("repairs a real unassigned positive payment callback before any cash owner/GET without creating a refund",async()=>{
    paymentSource=await partialCashFixture({unapplied:true});const external=paymentSource.dashboardRefund(paymentSource.amount/3);
    await paymentSource.signedDashboard(external);
    const rows=await db().select().from(legacyBankFeedback);expect(rows).toHaveLength(1);const raw=rows[0]!;
    const beforePayment=await db().select().from(payments),beforeRefunds=await db().select().from(refunds);
    await expect(db().transaction(tx=>originalBankFeedbackOwner(tx,{...raw,authentication:"0".repeat(64)}))).rejects.toMatchObject({code:"conflict"});
    const owner=await db().transaction(tx=>originalBankFeedbackOwner(tx,raw));expect(owner).toMatchObject({kind:"payment",paymentId:paymentSource.paymentId,subscriptionChargeReceiptId:null});
    const repaired=await originalMerchantRefundRepairSource.call({kind:"legacy_bank_feedback",id:raw.id},{kind:"system"});expect(repaired.profileId).toBe(paymentSource.base.profiles[0]!.profileId);
    expect((await db().select().from(outboxEvents).where(eq(outboxEvents.eventName,ORIGINAL_REFUND_EVIDENCE_EVENT))).some(event=>{const parsed=z.object({id:z.uuid()}).safeParse(event.payload);return parsed.success&&parsed.data.id===raw.id;})).toBe(true);
    expect(await db().select().from(originalCashRecoveries)).toHaveLength(0);expect(await db().select().from(originalCashRecoveryOperations)).toHaveLength(0);
    expect(await db().select().from(payments)).toEqual(beforePayment);expect(await db().select().from(refunds)).toEqual(beforeRefunds);expect(paymentSource.posts).toEqual([]);
    expect(await db().select().from(legacyBankFeedback)).toEqual(rows);
  });
  it("keeps the real original request resource as owner when authenticated feedback asserts a contradictory PI",async()=>{
    paymentSource=await partialCashFixture();await paymentSource.returnOne();
    const [original]=await db().select().from(refunds);if(!original?.providerRef)throw new Error("The actual original refund has no retained resource ACK.");
    const before=await db().select().from(payments);
    const captured=(await db().select().from(merchantPaymentObservations).where(eq(merchantPaymentObservations.paymentId,paymentSource.paymentId))).find(row=>row.status==="succeeded"&&row.providerChargeRef!==null);
    if(!captured?.providerChargeRef)throw new Error("The actual retained original capture has no charge identity.");
    const retained=await signedRawRefund({ref:original.providerRef,intent:"pi_ContradictoryFeedback",charge:captured.providerChargeRef,amount:original.amountMinor,currency:original.currency});
    const [raw]=await db().select().from(legacyBankFeedback).where(eq(legacyBankFeedback.id,retained.feedbackId));if(!raw)throw new Error("The actual contradictory signed resource was not retained.");
    expect(raw.evidence.observedPaymentRef).toBe("pi_ContradictoryFeedback");
    expect(await db().transaction(tx=>originalBankFeedbackOwner(tx,raw))).toMatchObject({kind:"payment",paymentId:paymentSource.paymentId,subscriptionChargeReceiptId:null});
    expect((await originalMerchantRefundRepairSource.call({kind:"legacy_bank_feedback",id:raw.id},{kind:"system"})).profileId).toBe(paymentSource.base.profiles[0]!.profileId);
    expect(await db().select().from(payments)).toEqual(before);expect(paymentSource.posts).toEqual(["customer"]);
  });
  it("repairs actual NULL-payment receipt feedback after real signed paid cash survives a later canonical line rejection",async()=>{
    let observed:{phase:z.infer<typeof phaseSchema>;amount:number;fee:number;invoice:Record<string,unknown>}|undefined;
    subscriptionSource=await seedActualProviderSubscription80({extra:async url=>{
      if(!observed)throw new Error("Create the actual admitted original phase before its paid receipt.");
      const {phase,amount,fee,invoice}=observed;
      if(url.pathname==="/v1/invoices/in_feedbackOwner")return Response.json(invoice);
      if(url.pathname==="/v1/invoice_payments")return Response.json({data:[{id:"inpay_feedbackOwner",invoice:"in_feedbackOwner",status:"paid",amount_paid:amount,amount_requested:amount,currency:"cad",payment:{type:"payment_intent",payment_intent:"pi_feedbackOwner"}}],has_more:false});
      if(url.pathname==="/v1/payment_intents/pi_feedbackOwner")return Response.json({id:"pi_feedbackOwner",object:"payment_intent",status:"succeeded",amount_received:amount,amount_capturable:0,amount,currency:"cad",customer:"cus_actualProducer",latest_charge:"ch_feedbackOwner",application_fee_amount:fee,transfer_data:{destination:"acct_fixtureSeller0"},on_behalf_of:"acct_fixtureSeller0"});
      if(url.pathname==="/v1/charges/ch_feedbackOwner")return Response.json({id:"ch_feedbackOwner",payment_intent:"pi_feedbackOwner",status:"succeeded",paid:true,captured:true,amount_captured:amount,currency:"cad",application_fee:"fee_feedbackOwner",transfer:"tr_feedbackOwner"});
      if(url.pathname==="/v1/application_fees/fee_feedbackOwner")return Response.json({id:"fee_feedbackOwner",account:"acct_fixtureSeller0",originating_transaction:"ch_feedbackOwner",amount:fee,currency:"cad",amount_refunded:0});
      if(url.pathname==="/v1/transfers/tr_feedbackOwner")return Response.json({id:"tr_feedbackOwner",destination:"acct_fixtureSeller0",source_transaction:"ch_feedbackOwner",amount,currency:"cad",amount_reversed:0,reversed:false});
      if(url.pathname==="/v1/invoices/in_feedbackOwner/lines")return Response.json({data:[{id:"il_feedbackOwner",invoice:"in_feedbackOwner",amount,currency:"cad",quantity:1,quantity_decimal:"1.000000000001",parent:{type:"subscription_item_details",subscription_item_details:{proration:false}},period:{start:phase.start_date,end:phase.end_date},pricing:{price_details:{price:phase.items[0]!.price}},discount_amounts:[],discounts:[],taxes:[],pretax_credit_amounts:[]}],has_more:false});
      return null;
    }});
    expect((await subscriptionSource.create()).verified).toBe(true);
    const phase=z.object({phases:z.array(phaseSchema).min(1)}).parse(subscriptionSource.remote.schedule()).phases[0]!;
    const amount=z.object({unit_amount:z.number()}).parse(subscriptionSource.remote.prices().get(phase.items[0]!.price)).unit_amount;
    const operation=(await subscriptionSource.operations()).find(row=>row.kind==="create");if(!operation)throw new Error("The real original schedule has no admitted create operation.");
    const fee=z.object({phases:z.array(z.object({applicationFeeMinor:z.number()})).min(1)}).parse(operation.originalRequest).phases[0]!.applicationFeeMinor;
    const invoice={id:"in_feedbackOwner",object:"invoice",customer:"cus_actualProducer",status:"paid",paid_out_of_band:false,currency:"cad",subtotal:amount,total:amount,amount_paid:amount,amount_remaining:0,collection_method:"charge_automatically",automatic_tax:{enabled:false},starting_balance:0,ending_balance:0,amount_shipping:0,pre_payment_credit_notes_amount:0,post_payment_credit_notes_amount:0,discounts:[],total_discount_amounts:[],total_taxes:[],parent:{type:"subscription_details",subscription_details:{subscription:"sub_actualProducer",metadata:phase.metadata}},lines:{has_more:false,data:[{type:"subscription",period:{start:phase.start_date,end:phase.end_date}}]}};
    observed={phase,amount,fee,invoice};subscriptionSource.remote.activate();
    const timestamp=Math.floor(Date.now()/1000),body=JSON.stringify({id:"evt_feedbackOwnerCash",type:"invoice.paid",created:timestamp,data:{object:invoice}}),signature=createHmac("sha256","whsec_actual_producer_fixture").update(`${timestamp}.${body}`).digest("hex");
    const response=await paymentWebhookRoute("stripe")(new Request("https://freeholder.example.test/api/webhooks/payments/stripe",{method:"POST",headers:{"stripe-signature":`t=${timestamp},v1=${signature}`,"content-type":"application/json"},body}));
    expect(response.status).toBe(503);expect(await db().select().from(payments)).toHaveLength(0);expect(await db().select().from(invoices)).toHaveLength(0);
    const receipts=await db().select().from(subscriptionProviderChargeReceipts);expect(receipts).toHaveLength(1);const receipt=receipts[0]!;
    if(!receipt.providerChargeRef)throw new Error("Retain the actual original receipt charge before feedback.");
    const retained=await signedRawRefund({ref:"re_feedbackOwnerDashboard",intent:receipt.providerPaymentIntentRef,charge:receipt.providerChargeRef,amount:receipt.amountMinor/3,currency:receipt.currency});
    const [raw]=await db().select().from(legacyBankFeedback).where(eq(legacyBankFeedback.id,retained.feedbackId));if(!raw)throw new Error("Retain the actual original receipt's refund feedback.");
    expect(await db().transaction(tx=>originalBankFeedbackOwner(tx,raw))).toMatchObject({kind:"subscription",paymentId:null,subscriptionChargeReceiptId:receipt.id});
    expect((await originalMerchantRefundRepairSource.call({kind:"legacy_bank_feedback",id:raw.id},{kind:"system"})).profileId).toBe(subscriptionSource.fixture.profiles[0]!.profileId);
    expect(await db().select().from(payments)).toHaveLength(0);expect(await db().select().from(refunds)).toHaveLength(0);expect(await db().select().from(originalCashRecoveries)).toHaveLength(0);
    expect(await db().select().from(subscriptionProviderChargeReceipts)).toEqual(receipts);
  });
});
