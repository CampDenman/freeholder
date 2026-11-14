// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Real original factory, HTTP bank and shared money/refund spine.
import {eq,inArray} from "drizzle-orm";
import {z} from "zod";
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {db} from "@/core/db";
import {defineService} from "@/core/service";
import {ready} from "@/core/runtime";
import {stopJobs} from "@/core/jobs";
import {entitlementGrants} from "@/core/entitlements/schema";
import {invoices,payments,refunds} from "@/modules/invoicing/schema";
import {subscriptionProviderChargeReceipts,subscriptions} from "@/modules/subscriptions/schema";
import {collectControlledCollection} from "@/modules/subscriptions/controlled-provider-collection-orchestration";
import {inspectControlledCashReceipt} from "@/modules/invoicing/controlled-cash-inspection-service";
import {applyControlledCashReceipts} from "@/modules/invoicing/controlled-cash-application-service";
import {CONTROLLED_COLLECTION_PROTOCOL} from "@/modules/subscriptions/controlled-provider-collection-protocol";
import {merchantAgreementPaymentRoutes} from "@/modules/invoicing/merchant-agreement-schema";
import {merchantFeeRefunds,merchantFeeObservations} from "@/modules/invoicing/merchant-collection-schema";
import {merchantFeeRefundInvocations} from "@/modules/invoicing/merchant-fee-invocation-schema";
import {verifiedMerchantFeeInvocation} from "@/modules/invoicing/merchant-fee-invocation-proof";
import {originalCashEvidenceKeys} from "@/modules/invoicing/original-cash-recovery-store";
import {merchantRefundRequests} from "@/modules/invoicing/merchant-refund-schema";
import {controlledCashApplicationBatches,controlledCashApplicationReceipts,controlledCashApplicationLinks} from "@/modules/invoicing/controlled-cash-application-protocol-schema";
import {submitProviderRefund} from "@/modules/invoicing/payment-provider-service";
import {reconcileMerchantRefundCurrentState} from "@/modules/invoicing/merchant-refund-current-service";
import {claimMerchantFeeReconciliation,prepareMerchantFeeDispatchInvocation,reconcileMerchantApplicationFee} from "@/modules/invoicing/merchant-fee-service";
import {controlledAtomicRefundTarget,controlledAtomicRefundFeeState} from "@/modules/invoicing/controlled-atomic-refund-target";
import {merchantPaymentRecoveryDebt} from "@/modules/invoicing/merchant-payment-debt";
import {returnOriginalCash} from "@/modules/invoicing/original-cash-recovery";
import {ORIGINAL_CASH_RETURN_CONFIRMATION} from "@/modules/invoicing/original-cash-recovery-proof";
import {actualControlledPeriod84} from "../helpers/actual-controlled-period84";
import {actualControlledOpenInvoice84} from "../helpers/actual-controlled-open-invoice84";
import {retainActualControlledManifest84} from "../helpers/actual-controlled-current-manifest84";
import {closeDb,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";
const system={kind:"system"} as const;
const review=defineService({name:"invoicing.testAtomicRefundReview84",summary:"Read actual signed original fee epoch and retained debt inside a genuine service transaction.",kind:"query",permission:"system",external:false,
 input:z.object({paymentId:z.uuid()}),output:z.object({target:z.number().int().nullable(),pending:z.boolean()}),handler:async({paymentId},ctx)=>{
  const target=await controlledAtomicRefundTarget(ctx,paymentId),state=await controlledAtomicRefundFeeState(ctx,paymentId);
  if(!target||!state)throw Error("The authentic committed atomic refund owner must be present.");return{target:target.target,pending:state.pending};
 }});
describe.runIf(hasDatabase)("actual atomic original-fee refund residual",{timeout:180000},()=>{
 let f:Awaited<ReturnType<typeof actualControlledPeriod84>>|undefined;
 beforeAll(ready,60000);beforeEach(truncateSpine);afterEach(()=>{vi.useRealTimers();f?.cleanup();f=undefined;vi.restoreAllMocks();});afterAll(async()=>{await stopJobs();await closeDb();});
 it("keeps the one-cent debt after tiny principal return, returns only the original fee cent, and closes only after a genuine current bank read",async()=>{
  f=await actualControlledPeriod84();const fixture=f,open=await actualControlledOpenInvoice84(fixture);
  fixture.remote.externallyAttachPayment(open.providerInvoiceRef,4199,400);fixture.remote.externallyAttachPayment(open.providerInvoiceRef,1,0);
  expect(await collectControlledCollection.call({collectionId:fixture.target.collectionId},OWNER)).toMatchObject({state:"money_retained",applied:false});
  await retainActualControlledManifest84(fixture);
  const receipts=await db().select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId,fixture.parent.id));expect(receipts).toHaveLength(2);
  for(const receipt of receipts)expect(await inspectControlledCashReceipt.call({collectionId:fixture.target.collectionId,receiptId:receipt.id},OWNER)).toMatchObject({bankReadReturned:true,completeInventory:true});
  const applied=await applyControlledCashReceipts.call({collectionId:fixture.target.collectionId,receiptIds:receipts.map(row=>row.id).sort(),requiredProtocol:CONTROLLED_COLLECTION_PROTOCOL},system);expect(applied.outstandingMinor).toBe(0);
  await stopJobs();
  const cash=await db().select().from(payments).where(eq(payments.invoiceId,fixture.target.invoiceId)),big=cash.find(row=>row.amountMinor===4199),tiny=cash.find(row=>row.amountMinor===1);
  if(!big||!tiny)throw Error("Use both distinct genuine original canonical receipts.");
  const routes=await db().select().from(merchantAgreementPaymentRoutes).where(inArray(merchantAgreementPaymentRoutes.paymentId,[big.id,tiny.id]));expect(routes.find(row=>row.paymentId===big.id)?.applicationFeeMinor).toBe(400);expect(routes.find(row=>row.paymentId===tiny.id)?.applicationFeeMinor).toBe(0);
  const originalCore={batches:await db().select().from(controlledCashApplicationBatches),proofs:await db().select().from(controlledCashApplicationReceipts),links:await db().select().from(controlledCashApplicationLinks)};
  // An initial/satisfied GET is a real caller even with NO fee operation.
  expect(await reconcileMerchantApplicationFee.call({paymentId:big.id},OWNER)).toMatchObject({state:"satisfied",operation:null});
  expect(await db().select().from(merchantFeeRefunds).where(eq(merchantFeeRefunds.paymentId,big.id))).toHaveLength(0);
  const initialCalls=await db().select().from(merchantFeeRefundInvocations).where(eq(merchantFeeRefundInvocations.paymentId,big.id));expect(initialCalls).toHaveLength(1);
  const initialCall=initialCalls[0];if(!initialCall)throw Error("Retain the actual pre-operation source GET.");
  expect(initialCall).toMatchObject({kind:"source_inspect",feeOperationId:null,feeOperationFingerprint:null,originalChargeReceiptId:routes.find(row=>row.paymentId===big.id)?.originalChargeReceiptId});
  expect(initialCall.finish?.body.outcome).toBe("returned");expect(initialCall.firstResult?.body.result).toMatchObject({providerRef:big.providerRef,status:"succeeded",amountMinor:4199,currency:big.currency});
  expect(initialCall.finish?.body.returnedResult).toMatchObject({observedApplicationFeeMinor:400,observedFeeRefundedMinor:0});expect(verifiedMerchantFeeInvocation(initialCall,originalCashEvidenceKeys())).toBe(true);
  await expect(db().update(merchantFeeRefundInvocations).set({feeOperationId:initialCall.id}).where(eq(merchantFeeRefundInvocations.id,initialCall.id))).rejects.toThrow();
  expect((await db().select().from(merchantFeeRefundInvocations).where(eq(merchantFeeRefundInvocations.id,initialCall.id)))[0]).toEqual(initialCall);
  const returned=await submitProviderRefund.call({paymentId:tiny.id,amountMinor:1,reason:"Return only the actual tiny original principal",idempotencyKey:`atomic-tiny:${tiny.id}`},OWNER);
  // Real independent current resource recovery supplies the ordinary resolved
  // refund witness; an ACK/status alone cannot choose the whole-target policy.
  const[request]=await db().select().from(merchantRefundRequests).where(eq(merchantRefundRequests.refundId,returned.id));if(!request)throw Error("The real original refund request must own this returned resource.");
  await reconcileMerchantRefundCurrentState.call({requestId:request.id},OWNER);
  expect((await db().select().from(refunds).where(eq(refunds.id,returned.id)))[0]).toMatchObject({paymentId:tiny.id,amountMinor:1,status:"succeeded"});
  expect(await review.call({paymentId:big.id},system)).toEqual({target:399,pending:true});expect(fixture.remote.counts().feeRefundPosts).toBe(0);
  expect((await merchantPaymentRecoveryDebt.call({paymentId:big.id},system)).reasons).toContain("commission");
  // Independently return the tiny payment's actual destination resource. The
  // other charge's commission is not adopted by this zero-fee return owner.
  await returnOriginalCash.call({source:{kind:"payment",paymentId:tiny.id},confirmation:ORIGINAL_CASH_RETURN_CONFIRMATION},OWNER);
  for(const receipt of receipts)expect(await inspectControlledCashReceipt.call({collectionId:fixture.target.collectionId,receiptId:receipt.id},OWNER)).toMatchObject({bankReadReturned:true,completeInventory:true});
  // The genuine old private claim cannot commit a naked new fee operation:
  // independent deferred SQL requires its exact same-TX POST admission.
  await expect(claimMerchantFeeReconciliation.call({paymentId:big.id,initiatedBy:"system"},system)).rejects.toThrow();
  expect(await db().select().from(merchantFeeRefunds).where(eq(merchantFeeRefunds.paymentId,big.id))).toHaveLength(0);expect(fixture.remote.counts().feeRefundPosts).toBe(0);
  const before={invoice:await db().select().from(invoices).where(eq(invoices.id,fixture.target.invoiceId)),payments:await db().select().from(payments).where(eq(payments.invoiceId,fixture.target.invoiceId)).orderBy(payments.id),parent:await db().select().from(subscriptions).where(eq(subscriptions.id,fixture.parent.id)),grants:await db().select().from(entitlementGrants).where(eq(entitlementGrants.sourceSubscriptionId,fixture.parent.id)).orderBy(entitlementGrants.id)};
  expect(await reconcileMerchantApplicationFee.call({paymentId:big.id},OWNER)).toMatchObject({state:"accepted",operation:{amountMinor:1}});
  const feeOps=await db().select().from(merchantFeeRefunds).where(eq(merchantFeeRefunds.paymentId,big.id));expect(feeOps).toHaveLength(1);expect(feeOps[0]).toMatchObject({targetRetainedFeeMinor:399,observedOriginalFeeMinor:400,amountMinor:1,status:"accepted",originalChargeReceiptId:routes.find(row=>row.paymentId===big.id)?.originalChargeReceiptId});
  const feeOp=feeOps[0];if(!feeOp)throw Error("Retain the actual original application-fee return operation.");
  const callers=await db().select().from(merchantFeeRefundInvocations).where(eq(merchantFeeRefundInvocations.paymentId,big.id)).orderBy(merchantFeeRefundInvocations.ordinal);
  expect(callers.map(row=>row.kind)).toEqual(["source_inspect","source_inspect","post","source_inspect"]);expect(callers.every(row=>verifiedMerchantFeeInvocation(row,originalCashEvidenceKeys())&&row.finish?.body.outcome==="returned"&&!row.stop)).toBe(true);
  const post=callers.find(row=>row.kind==="post"),sourceCall=callers.find(row=>row.id===post?.request.sourceInvocationId);if(!post||!sourceCall)throw Error("Use the actual source FIN and original POST admission.");
  const children=callers.filter(row=>row.request.readKind==="fee_preflight");expect(children).toHaveLength(1);expect(children[0]).toMatchObject({feeOperationId:null,request:{parentFeeInvocationId:post.id,parentAdmissionDigest:post.digest}});
  expect(children[0]?.firstResult?.body.result).toMatchObject({source:"fee_preflight",applicationFeeRef:feeOp.applicationFeeRef,amountMinor:400,returnedMinor:0});
  expect(post.feeOperationId).toBe(feeOp.id);expect(post.request.sourceInvocationId).toBe(sourceCall.id);expect(post.firstResult?.body.result).toMatchObject({providerRef:feeOp.providerRef,applicationFeeRef:feeOp.applicationFeeRef,amountMinor:1,currency:feeOp.currency});
  expect(await db().select().from(merchantFeeObservations).where(eq(merchantFeeObservations.operationId,feeOp.id))).toMatchObject([{amountMinor:1,bindingVerified:true}]);
  expect(await review.call({paymentId:big.id},system)).toEqual({target:399,pending:true});
  const original=receipts.find(row=>row.providerPaymentIntentRef===big.providerRef);if(!original)throw Error("Preserve exact original receipt/PI ownership.");
  expect(await inspectControlledCashReceipt.call({collectionId:fixture.target.collectionId,receiptId:original.id},OWNER)).toMatchObject({bankReadReturned:true,completeInventory:true});
  expect(await review.call({paymentId:big.id},system)).toEqual({target:399,pending:false});
  expect((await merchantPaymentRecoveryDebt.call({paymentId:big.id},system)).reasons).not.toContain("commission");
  expect(await reconcileMerchantApplicationFee.call({paymentId:big.id},OWNER)).toMatchObject({state:"satisfied",operation:null});expect(fixture.remote.counts()).toMatchObject({principalRefundPosts:1,feeRefundPosts:1,transferReturnPosts:1,payPosts:0});
  expect(await db().select().from(merchantAgreementPaymentRoutes).where(inArray(merchantAgreementPaymentRoutes.paymentId,[big.id,tiny.id]))).toEqual(routes);
  expect({batches:await db().select().from(controlledCashApplicationBatches),proofs:await db().select().from(controlledCashApplicationReceipts),links:await db().select().from(controlledCashApplicationLinks)}).toEqual(originalCore);
  expect({invoice:await db().select().from(invoices).where(eq(invoices.id,fixture.target.invoiceId)),payments:await db().select().from(payments).where(eq(payments.invoiceId,fixture.target.invoiceId)).orderBy(payments.id),parent:await db().select().from(subscriptions).where(eq(subscriptions.id,fixture.parent.id)),grants:await db().select().from(entitlementGrants).where(eq(entitlementGrants.sourceSubscriptionId,fixture.parent.id)).orderBy(entitlementGrants.id)}).toEqual(before);
 });
 it("retains the actual child preflight's newly returned fee counter before refusing POST and never adopts a same-amount dashboard return",async()=>{
  f=await actualControlledPeriod84();const fixture=f,open=await actualControlledOpenInvoice84(fixture);
  fixture.remote.externallyAttachPayment(open.providerInvoiceRef,4199,400);fixture.remote.externallyAttachPayment(open.providerInvoiceRef,1,0);
  expect(await collectControlledCollection.call({collectionId:fixture.target.collectionId},OWNER)).toMatchObject({state:"money_retained",applied:false});await retainActualControlledManifest84(fixture);
  const receipts=await db().select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId,fixture.parent.id));expect(receipts).toHaveLength(2);
  for(const receipt of receipts)await inspectControlledCashReceipt.call({collectionId:fixture.target.collectionId,receiptId:receipt.id},OWNER);
  expect((await applyControlledCashReceipts.call({collectionId:fixture.target.collectionId,receiptIds:receipts.map(row=>row.id).sort(),requiredProtocol:CONTROLLED_COLLECTION_PROTOCOL},system)).outstandingMinor).toBe(0);await stopJobs();
  const actualCash=await db().select().from(payments).where(eq(payments.invoiceId,fixture.target.invoiceId)),big=actualCash.find(row=>row.amountMinor===4199),tiny=actualCash.find(row=>row.amountMinor===1);
  if(!big?.providerRef||!tiny)throw Error("Use both actual immutable original receipt-owned captures.");
  const returned=await submitProviderRefund.call({paymentId:tiny.id,amountMinor:1,reason:"Actual tiny original principal only",idempotencyKey:`atomic-preflight-tiny:${tiny.id}`},OWNER);
  const[q]=await db().select().from(merchantRefundRequests).where(eq(merchantRefundRequests.refundId,returned.id));if(!q)throw Error("Preserve the genuine original refund request.");await reconcileMerchantRefundCurrentState.call({requestId:q.id},OWNER);
  await returnOriginalCash.call({source:{kind:"payment",paymentId:tiny.id},confirmation:ORIGINAL_CASH_RETURN_CONFIRMATION},OWNER);
  for(const receipt of receipts)await inspectControlledCashReceipt.call({collectionId:fixture.target.collectionId,receiptId:receipt.id},OWNER);
  const before={cash:await db().select().from(payments).where(eq(payments.invoiceId,fixture.target.invoiceId)).orderBy(payments.id),invoice:await db().select().from(invoices).where(eq(invoices.id,fixture.target.invoiceId)),links:await db().select().from(controlledCashApplicationLinks),grants:await db().select().from(entitlementGrants).where(eq(entitlementGrants.sourceSubscriptionId,fixture.parent.id)).orderBy(entitlementGrants.id)};
  // Real service call commits the exact claim/header first. The external bank
  // then changes independently before the genuine SDK preparation GET.
  const original=prepareMerchantFeeDispatchInvocation.call.bind(prepareMerchantFeeDispatchInvocation),providerRef=big.providerRef;
  const fault=vi.spyOn(prepareMerchantFeeDispatchInvocation,"call").mockImplementation(async(input,actor,options)=>{const actual=await original(input,actor,options);if(actual.invocation?.kind==="post"&&actual.invocation.paymentId===big.id)fixture.remote.externallyReturnFee(providerRef,1);return actual;});
  await expect(reconcileMerchantApplicationFee.call({paymentId:big.id},OWNER)).rejects.toThrow();fault.mockRestore();
  const rows=await db().select().from(merchantFeeRefundInvocations).where(eq(merchantFeeRefundInvocations.paymentId,big.id)).orderBy(merchantFeeRefundInvocations.ordinal),post=rows.find(row=>row.kind==="post"),child=rows.find(row=>row.request.readKind==="fee_preflight");
  if(!post||!child)throw Error("Retain both real original holder and its exact preparation GET before refusal.");
  expect(rows.every(row=>verifiedMerchantFeeInvocation(row,originalCashEvidenceKeys()))).toBe(true);
  expect(child.request.parentFeeInvocationId).toBe(post.id);expect(child.firstResult?.body.result).toMatchObject({source:"fee_preflight",amountMinor:400,returnedMinor:1});expect(child.finish?.body.outcome).toBe("returned");
  expect(post.firstResult).toBeNull();expect(post.finish?.body).toMatchObject({outcome:"threw",postDispatchReleased:false});
  expect(await db().select().from(merchantFeeRefunds).where(eq(merchantFeeRefunds.paymentId,big.id))).toMatchObject([{amountMinor:1,status:"unknown",providerRef:null}]);expect(fixture.remote.counts().feeRefundPosts).toBe(0);
  expect(await review.call({paymentId:big.id},system)).toEqual({target:399,pending:true});
  expect(await reconcileMerchantApplicationFee.call({paymentId:big.id},OWNER)).toMatchObject({state:"pending",operation:{status:"unknown"}});expect(fixture.remote.counts().feeRefundPosts).toBe(0);
  expect({cash:await db().select().from(payments).where(eq(payments.invoiceId,fixture.target.invoiceId)).orderBy(payments.id),invoice:await db().select().from(invoices).where(eq(invoices.id,fixture.target.invoiceId)),links:await db().select().from(controlledCashApplicationLinks),grants:await db().select().from(entitlementGrants).where(eq(entitlementGrants.sourceSubscriptionId,fixture.parent.id)).orderBy(entitlementGrants.id)}).toEqual(before);
 });

});
