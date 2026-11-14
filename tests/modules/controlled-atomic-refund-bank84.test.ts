// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN: actual bank HTTP, canonical receipts, shared refund/FIN spine.
import {eq,sql} from "drizzle-orm";
import {createHash,createHmac,randomUUID} from "node:crypto";
import {z} from "zod";
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from "vitest";
import {db} from "@/core/db";
import {defineService} from "@/core/service";
import {ready} from "@/core/runtime";
import {stopJobs} from "@/core/jobs";
import {payments,invoices} from "@/modules/invoicing/schema";
import {subscriptions,subscriptionProviderChargeReceipts} from "@/modules/subscriptions/schema";
import {entitlementGrants} from "@/core/entitlements/schema";
import {merchantFeeRefunds} from "@/modules/invoicing/merchant-collection-schema";
import {merchantRefundRequests} from "@/modules/invoicing/merchant-refund-schema";
import {merchantRefundObservationCaptures} from "@/modules/invoicing/merchant-refund-current-schema";
import {controlledCashApplicationBatches,controlledCashApplicationReceipts,controlledCashApplicationLinks} from "@/modules/invoicing/controlled-cash-application-protocol-schema";
import {collectControlledCollection} from "@/modules/subscriptions/controlled-provider-collection-orchestration";
import {inspectControlledCashReceipt,prepareControlledCashInspection} from "@/modules/invoicing/controlled-cash-inspection-service";
import {applyControlledCashReceipts} from "@/modules/invoicing/controlled-cash-application-service";
import {CONTROLLED_COLLECTION_PROTOCOL} from "@/modules/subscriptions/controlled-provider-collection-protocol";
import {submitProviderRefund} from "@/modules/invoicing/payment-provider-service";
import {reconcileMerchantRefundCurrentState} from "@/modules/invoicing/merchant-refund-current-service";
import {returnOriginalCash} from "@/modules/invoicing/original-cash-recovery";
import {inspectOriginalCashInventory} from "@/modules/invoicing/original-cash-recovery";
import {originalCashRecoveries,originalCashRecoveryOperations} from "@/modules/invoicing/original-cash-recovery-schema";
import {originalInventoryComparison} from "@/modules/invoicing/original-cash-inventory-causal-contract";
import {legacyBankFeedback} from "@/modules/invoicing/legacy-bank-feedback-schema";
import {retainPaymentProviderEvidence} from "@/modules/invoicing/payment-provider-service";
import {createStripePayments} from "@/adapters/payments/stripe";
import {ORIGINAL_CASH_RETURN_CONFIRMATION} from "@/modules/invoicing/original-cash-recovery-proof";
import {readControlledAtomicRefundBankState} from "@/modules/invoicing/controlled-atomic-refund-bank-state";
import {controlledAtomicRefundTarget} from "@/modules/invoicing/controlled-atomic-refund-target";
import {actualControlledPeriod84} from "../helpers/actual-controlled-period84";
import {actualControlledOpenInvoice84} from "../helpers/actual-controlled-open-invoice84";
import {retainActualControlledManifest84} from "../helpers/actual-controlled-current-manifest84";
import {closeDb,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";
const system={kind:"system"} as const;
const review=defineService({name:"invoicing.testAtomicCurrentRefundBank84",summary:"Verify actual HMAC bank/refund proof in the real shared query context.",kind:"query",permission:"system",external:false,
 input:z.object({tinyPaymentId:z.uuid(),feePaymentId:z.uuid(),requestId:z.uuid()}),output:z.object({target:z.number().int().nullable(),oldResolved:z.boolean(),inspectionId:z.uuid(),captureIds:z.array(z.uuid()).max(5000),physicalCount:z.number().int().max(5000),revision:z.string()}),handler:async(input,ctx)=>{
  const[old]=await ctx.tx.execute<{resolved:boolean}>(sql`select freeholder_original_refund_resolved(${input.requestId}::uuid,'succeeded',(select provider_ref from refunds where id=(select refund_id from merchant_refund_requests where id=${input.requestId}::uuid))) as resolved`);
  const current=await readControlledAtomicRefundBankState(ctx,input.tinyPaymentId);if(!current)throw Error("Exercise the genuine stale generic receipt, not the unchanged ordinary resolution path.");
  const target=await controlledAtomicRefundTarget(ctx,input.feePaymentId);if(!target)throw Error("Keep the actual original atomic cash epoch.");
  return{target:target.target,oldResolved:old?.resolved===true,inspectionId:current.inspectionId,captureIds:current.physicalEntries.filter(row=>row.table==="merchant_refund_observation_captures").map(row=>row.id),physicalCount:current.physicalEntries.length,revision:current.revision};
 }});
describe.runIf(hasDatabase)("actual controlled atomic current-refund bank continuation",{timeout:180000},()=>{
 let active:Awaited<ReturnType<typeof actualControlledPeriod84>>|undefined;
 beforeAll(ready,60000);beforeEach(truncateSpine);afterEach(()=>{active?.cleanup();active=undefined;});afterAll(async()=>{await stopJobs();await closeDb();});
 async function source(){
  active=await actualControlledPeriod84();const fixture=active,open=await actualControlledOpenInvoice84(fixture);
  fixture.remote.externallyAttachPayment(open.providerInvoiceRef,4199,400);fixture.remote.externallyAttachPayment(open.providerInvoiceRef,1,0);
  expect(await collectControlledCollection.call({collectionId:fixture.target.collectionId},OWNER)).toMatchObject({state:"money_retained",applied:false});await retainActualControlledManifest84(fixture);
  const receipts=await db().select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId,fixture.parent.id));expect(receipts).toHaveLength(2);
  for(const receipt of receipts)await inspectControlledCashReceipt.call({collectionId:fixture.target.collectionId,receiptId:receipt.id},OWNER);
  expect(await applyControlledCashReceipts.call({collectionId:fixture.target.collectionId,receiptIds:receipts.map(row=>row.id).sort(),requiredProtocol:CONTROLLED_COLLECTION_PROTOCOL},system)).toMatchObject({outstandingMinor:0});await stopJobs();
  const cash=await db().select().from(payments).where(eq(payments.invoiceId,fixture.target.invoiceId)),tiny=cash.find(row=>row.amountMinor===1),big=cash.find(row=>row.amountMinor===4199);
  if(!tiny||!big)throw Error("Keep the two actual generated canonical payment owners.");
  const returned=await submitProviderRefund.call({paymentId:tiny.id,amountMinor:1,reason:"Actual current-bank target continuation",idempotencyKey:`atomic-current-bank:${tiny.id}`},OWNER);
  const[request]=await db().select().from(merchantRefundRequests).where(eq(merchantRefundRequests.refundId,returned.id));if(!request)throw Error("Use the real original refund request.");
  await reconcileMerchantRefundCurrentState.call({requestId:request.id},OWNER);
  await returnOriginalCash.call({source:{kind:"payment",paymentId:tiny.id},confirmation:ORIGINAL_CASH_RETURN_CONFIRMATION},OWNER);
  for(const receipt of receipts)await inspectControlledCashReceipt.call({collectionId:fixture.target.collectionId,receiptId:receipt.id},OWNER);
  const receipt=receipts.find(row=>row.providerPaymentIntentRef===tiny.providerRef);if(!receipt)throw Error("Use only the tiny payment's actual receipt FK.");
  return{fixture,tiny,big,receipt,input:{tinyPaymentId:tiny.id,feePaymentId:big.id,requestId:request.id}};
 }
 async function money(){return{payments:await db().select().from(payments).orderBy(payments.id),invoices:await db().select().from(invoices).orderBy(invoices.id),batches:await db().select().from(controlledCashApplicationBatches),proofs:await db().select().from(controlledCashApplicationReceipts),links:await db().select().from(controlledCashApplicationLinks),parents:await db().select().from(subscriptions),grants:await db().select().from(entitlementGrants).orderBy(entitlementGrants.id),fees:await db().select().from(merchantFeeRefunds)};}
 it("retains ALL repeated captures and proves current399 without rewriting the stale generic receipt or moving money",async()=>{
  const s=await source(),before=await money(),captures=await db().select().from(merchantRefundObservationCaptures),posts=s.fixture.remote.counts();
  const value=await review.call(s.input,system);expect(value).toMatchObject({oldResolved:false,target:399});expect(value.physicalCount).toBeGreaterThan(0);
  for(const row of captures)expect(value.captureIds).toContain(row.id);
  expect(await review.call(s.input,system)).toEqual(value);expect(await money()).toEqual(before);expect(s.fixture.remote.counts()).toEqual(posts);
 });
 it("refuses a genuinely admitted unfinished later GET instead of selecting the older good bank read",async()=>{
  const s=await source(),before=await money();expect((await review.call(s.input,system)).target).toBe(399);
  const admitted=await prepareControlledCashInspection.call({collectionId:s.fixture.target.collectionId,receiptId:s.receipt.id},system);expect(admitted.inspectionId).toBeTruthy();
  await expect(review.call(s.input,system)).rejects.toThrow();expect(await money()).toEqual(before);expect(s.fixture.remote.counts().feeRefundPosts).toBe(0);
 });
 it("allows only a genuine earlier closed HMAC inspection's pending→current succeeded transition",async()=>{
  const s=await source(),before=await money(),refund=s.fixture.remote.externalRefunds().find(row=>row.payment_intent===s.tiny.providerRef);if(!refund)throw Error("Use the actual fictional-bank refund resource.");
  refund.status="pending";await inspectControlledCashReceipt.call({collectionId:s.fixture.target.collectionId,receiptId:s.receipt.id},OWNER);
  await expect(review.call(s.input,system)).rejects.toThrow();
  refund.status="succeeded";await inspectControlledCashReceipt.call({collectionId:s.fixture.target.collectionId,receiptId:s.receipt.id},OWNER);
  expect(await review.call(s.input,system)).toMatchObject({oldResolved:false,target:399});expect(await money()).toEqual(before);expect(s.fixture.remote.counts().feeRefundPosts).toBe(0);
 });
 it("retains a genuine foreign-charge refund callback but refuses target authority",async()=>{
  const s=await source(),before=await money(),refund=s.fixture.remote.externalRefunds().find(row=>row.payment_intent===s.tiny.providerRef);if(!refund)throw Error("Use the actual fictional-bank refund resource.");
  refund.charge="ch_actualForeignRefund";
  expect(await inspectControlledCashReceipt.call({collectionId:s.fixture.target.collectionId,receiptId:s.receipt.id},OWNER)).toMatchObject({bankReadReturned:true,completeInventory:true,suppliesMoneyAuthority:false});
  await expect(review.call(s.input,system)).rejects.toThrow();
  const[raw]=await db().execute<{retained:boolean}>(sql`select exists(select 1 from merchant_refund_observations where provider_ref=${String(refund.id)} and provider_charge_ref='ch_actualForeignRefund') as retained`);expect(raw?.retained).toBe(true);
  expect(await money()).toEqual(before);expect(s.fixture.remote.counts().feeRefundPosts).toBe(0);
 });
 it("invalidates an older controlled bank proof after a genuine later original-v2 GET and recovers only with a real new controlled bank read",async()=>{
  const s=await source(),before=await money(),selected=await review.call(s.input,system);expect(selected.target).toBe(399);
  const[owner]=await db().select().from(originalCashRecoveries).where(eq(originalCashRecoveries.paymentId,s.tiny.id));if(!owner)throw Error("Use the real original return owner.");
  const operationId=await inspectOriginalCashInventory(owner.id,OWNER),[operation]=await db().select().from(originalCashRecoveryOperations).where(eq(originalCashRecoveryOperations.id,operationId));
  const header=originalInventoryComparison.parse(operation?.request.inventoryComparison);expect(header.operationId).toBe(operationId);
  expect(header.preimageEntries.some(row=>row.table==="subscription_controlled_cash_inspection_lineages"&&row.id===selected.inspectionId)).toBe(true);
  await expect(review.call(s.input,system)).rejects.toThrow();
  expect(await inspectControlledCashReceipt.call({collectionId:s.fixture.target.collectionId,receiptId:s.receipt.id},OWNER)).toMatchObject({bankReadReturned:true,completeInventory:true});
  expect(await review.call(s.input,system)).toMatchObject({oldResolved:false,target:399});expect(await money()).toEqual(before);expect(s.fixture.remote.counts().feeRefundPosts).toBe(0);
 });
 it.each(["managed_known","raw_charge_only"] as const)("retains real signed late %s feedback and refuses the older success without moving canonical cash",async kind=>{
  const s=await source(),before=await money(),actual=s.fixture.remote.externalRefunds().find(row=>row.payment_intent===s.tiny.providerRef);if(!actual||!s.receipt.providerChargeRef)throw Error("Use the actual original bank refund and charge.");
  const ref=kind==="managed_known"?z.string().parse(actual.id):`re_lateUnknown${randomUUID().replaceAll("-","")}`,eventId=`evt_lateAtomic${randomUUID()}`,timestamp=Math.floor(Date.now()/1000),secret="whsec_late_atomic_fixture_only";
  const body=Buffer.from(JSON.stringify({id:eventId,type:"refund.updated",api_version:s.receipt.providerApiVersion,created:timestamp,...(s.receipt.chargeAccountId?{account:s.receipt.chargeAccountId}:{}),
   data:{object:{id:ref,payment_intent:kind==="managed_known"?s.tiny.providerRef:null,charge:s.receipt.providerChargeRef,amount:1,currency:s.tiny.currency.toLowerCase(),status:"pending"}}}));
  const signature=createHmac("sha256",secret).update(`${timestamp}.`).update(body).digest("hex"),receivedAt=new Date(timestamp*1000).toISOString();
  const adapter=createStripePayments({secretKey:"sk_late_atomic_fixture_only",webhookSecrets:[secret],fetch:async(input,init={})=>{
   const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url);
   if(url.href==="https://api.stripe.com/v1/account"&&(init.method??"GET")==="GET")return Response.json({id:s.receipt.providerPlatformAccountId});
   throw Error(`Unexpected late feedback verifier transport ${init.method??"GET"} ${url.origin}${url.pathname}`);
  }});
  const events=await adapter.verifyWebhook({body,receivedAt,headers:{"stripe-signature":`t=${timestamp},v1=${signature}`}});expect(events).toHaveLength(1);
  await retainPaymentProviderEvidence("stripe",events,{rawBodySha256:createHash("sha256").update(body).digest("hex"),receivedAt});
  if(kind==="raw_charge_only"){
   const[raw]=await db().select().from(legacyBankFeedback).where(sql`${legacyBankFeedback.evidence}->>'providerEventId'=${eventId}`);expect(raw?.evidence).toMatchObject({observedRefundRef:ref,observedPaymentRef:null,observedChargeRef:s.receipt.providerChargeRef,status:"pending"});
  }else{
   const[raw]=await db().execute<{retained:boolean}>(sql`select exists(select 1 from merchant_refund_observations where provider_ref=${ref} and payment_id=${s.tiny.id}::uuid and status='pending') as retained`);expect(raw?.retained).toBe(true);
   expect(await db().select().from(legacyBankFeedback).where(sql`${legacyBankFeedback.evidence}->>'providerEventId'=${eventId}`)).toEqual([]);
  }
  await expect(review.call(s.input,system)).rejects.toThrow();expect(await money()).toEqual(before);expect(s.fixture.remote.counts().feeRefundPosts).toBe(0);
 });
});
