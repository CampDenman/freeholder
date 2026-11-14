// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN: actual existing original owner; no synthetic contexts/rows.
import {eq,inArray} from "drizzle-orm";
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {db} from "@/core/db";
import {ready} from "@/core/runtime";
import {stopJobs} from "@/core/jobs";
import {actorString} from "@/core/service";
import {entitlementGrants} from "@/core/entitlements/schema";
import {invoices,payments} from "@/modules/invoicing/schema";
import {subscriptionProviderChargeReceipts} from "@/modules/subscriptions/schema";
import {collectControlledCollection} from "@/modules/subscriptions/controlled-provider-collection-orchestration";
import {CONTROLLED_COLLECTION_PROTOCOL} from "@/modules/subscriptions/controlled-provider-collection-protocol";
import {applyControlledCashReceipts} from "@/modules/invoicing/controlled-cash-application-service";
import {inspectControlledCashReceipt} from "@/modules/invoicing/controlled-cash-inspection-service";
import {controlledCashApplicationBatches,controlledCashApplicationReceipts,controlledCashApplicationLinks} from "@/modules/invoicing/controlled-cash-application-protocol-schema";
import {merchantAgreementPaymentRoutes} from "@/modules/invoicing/merchant-agreement-schema";
import {merchantFeeRefunds} from "@/modules/invoicing/merchant-collection-schema";
import {claimOriginalCashRecovery,recordOriginalCashFact} from "@/modules/invoicing/original-cash-recovery-service";
import {originalCashRecoveries,originalCashRecoveryFacts,originalCashRecoveryOperations} from "@/modules/invoicing/original-cash-recovery-schema";
import {originalCashRecoveryFinancialWitness} from "@/modules/invoicing/original-cash-recovery-store";
import {returnOriginalCash} from "@/modules/invoicing/original-cash-recovery";
import {ORIGINAL_CASH_RETURN_CONFIRMATION} from "@/modules/invoicing/original-cash-recovery-proof";
import {submitProviderRefund} from "@/modules/invoicing/payment-provider-service";
import {merchantRefundRequests} from "@/modules/invoicing/merchant-refund-schema";
import {reconcileMerchantRefundCurrentState} from "@/modules/invoicing/merchant-refund-current-service";
import {reconcileMerchantApplicationFee} from "@/modules/invoicing/merchant-fee-service";
import {claimAtomicAuxiliaryFeeReturn} from "@/modules/invoicing/atomic-auxiliary-fee-service";
import {reviewAtomicFeeReconciliation} from "@/modules/invoicing/controlled-atomic-fee-review";
import {actualControlledPeriod84} from "../helpers/actual-controlled-period84";
import {actualControlledOpenInvoice84} from "../helpers/actual-controlled-open-invoice84";
import {retainActualControlledManifest84} from "../helpers/actual-controlled-current-manifest84";
import {closeDb,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";
const system={kind:"system"} as const;
async function canonical(invoiceId:string,subscriptionId:string){return{invoice:await db().select().from(invoices).where(eq(invoices.id,invoiceId)),payments:await db().select().from(payments).where(eq(payments.invoiceId,invoiceId)).orderBy(payments.id),routes:await db().select().from(merchantAgreementPaymentRoutes).orderBy(merchantAgreementPaymentRoutes.paymentId),batches:await db().select().from(controlledCashApplicationBatches),receipts:await db().select().from(controlledCashApplicationReceipts),links:await db().select().from(controlledCashApplicationLinks),grants:await db().select().from(entitlementGrants).where(eq(entitlementGrants.sourceSubscriptionId,subscriptionId)).orderBy(entitlementGrants.id)};}
describe.runIf(hasDatabase)("same-owner receipt-backed original atomic fee-only return",{timeout:180000},()=>{
 let fixture:Awaited<ReturnType<typeof actualControlledPeriod84>>|undefined;
 beforeAll(ready,60000);beforeEach(truncateSpine);afterEach(()=>{fixture?.cleanup();fixture=undefined;vi.restoreAllMocks();});afterAll(async()=>{await stopJobs();await closeDb();});
 async function original(){
  fixture=await actualControlledPeriod84();const f=fixture,open=await actualControlledOpenInvoice84(f);
  f.remote.externallyAttachPayment(open.providerInvoiceRef,4199,400);f.remote.externallyAttachPayment(open.providerInvoiceRef,1,0);
  expect(await collectControlledCollection.call({collectionId:f.target.collectionId},OWNER)).toMatchObject({state:"money_retained",applied:false});await retainActualControlledManifest84(f);
  const receipts=await db().select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId,f.parent.id));expect(receipts).toHaveLength(2);
  for(const receipt of receipts)await inspectControlledCashReceipt.call({collectionId:f.target.collectionId,receiptId:receipt.id},OWNER);
  expect((await applyControlledCashReceipts.call({collectionId:f.target.collectionId,receiptIds:receipts.map(row=>row.id).sort(),requiredProtocol:CONTROLLED_COLLECTION_PROTOCOL},system)).outstandingMinor).toBe(0);await stopJobs();
  const money=await db().select().from(payments).where(eq(payments.invoiceId,f.target.invoiceId)),big=money.find(row=>row.amountMinor===4199),tiny=money.find(row=>row.amountMinor===1);if(!big?.providerRef||!tiny)throw Error("Use both actual original applied receipts.");
  // Genuine existing owner, independently created BEFORE sibling refund. No
  // full customer return or fabricated zero fee operation is performed.
  const originalReceipt=receipts.find(row=>row.providerPaymentIntentRef===big.providerRef);if(!originalReceipt)throw Error("Use the actual original receipt of this applied payment.");
  const[originalProof]=await db().select().from(controlledCashApplicationReceipts).where(eq(controlledCashApplicationReceipts.receiptId,originalReceipt.id));if(!originalProof)throw Error("Use its actual issued canonical application proof and original observation FK.");
  const owner=await claimOriginalCashRecovery.call({source:{kind:"subscription",receiptId:originalReceipt.id,observationId:originalProof.originalObservationId},authorizedBy:actorString(OWNER)},system);
  const refunded=await submitProviderRefund.call({paymentId:tiny.id,amountMinor:1,reason:"Return the genuine tiny original principal",idempotencyKey:`atomic-owner-tiny:${tiny.id}`},OWNER);
  const[request]=await db().select().from(merchantRefundRequests).where(eq(merchantRefundRequests.refundId,refunded.id));if(!request)throw Error("The actual customer refund must retain its original request.");await reconcileMerchantRefundCurrentState.call({requestId:request.id},OWNER);
  await returnOriginalCash.call({source:{kind:"payment",paymentId:tiny.id},confirmation:ORIGINAL_CASH_RETURN_CONFIRMATION},OWNER);
  for(const receipt of receipts)await inspectControlledCashReceipt.call({collectionId:f.target.collectionId,receiptId:receipt.id},OWNER);
  return{f,big,tiny,owner,receipts};
 }
 it("returns the sibling-induced cent through the same real auxiliary owner and requires fresh bank/FIN closure without creating an old fee operation",async()=>{
  const{f,big,tiny,owner}=await original(),before=await canonical(f.target.invoiceId,f.parent.id);
  expect((await reviewAtomicFeeReconciliation.call({invoiceId:f.target.invoiceId},OWNER)).find(row=>row.paymentId===big.id)).toMatchObject({originalFeeMinor:400,targetRetainedFeeMinor:399,pending:true});
  expect(await reconcileMerchantApplicationFee.call({paymentId:big.id},OWNER)).toMatchObject({state:"accepted",operation:null});
  expect(await db().select().from(merchantFeeRefunds).where(inArray(merchantFeeRefunds.paymentId,[big.id,tiny.id]))).toHaveLength(0);
  const journal=await db().transaction(tx=>originalCashRecoveryFinancialWitness(tx,[big.id],[])),fee=journal.operations.filter(row=>row.kind==="fee");expect(journal.owners.map(row=>row.id)).toEqual([owner.recoveryId]);expect(fee).toHaveLength(1);
  const actual=fee[0];if(!actual)throw Error("Use the actual original auxiliary fee caller.");
  expect(actual.request).toMatchObject({atomicFeeProtocol:"freeholder.original-cash-atomic-fee-operation.v1",originalAmountMinor:400,alreadyReturnedMinor:0,amountMinor:1});
  expect(journal.facts.filter(row=>row.kind==="atomic_fee_target")).toHaveLength(1);expect(journal.facts.filter(row=>row.kind==="atomic_fee_closure")).toHaveLength(1);
  expect(journal.facts.filter(row=>row.operationId===actual.id&&row.kind==="finish")).toMatchObject([{evidence:{outcome:"returned",callerInstanceId:actual.caller.id}}]);
  const ack=journal.facts.find(row=>row.operationId===actual.id&&row.kind==="ack"),resource=journal.facts.find(row=>row.operationId===actual.id&&row.kind==="resource");expect(resource?.evidence).toMatchObject({providerRef:ack?.evidence.providerRef,operationId:actual.id,amountMinor:1,bindingVerified:true});
  const closure=journal.facts.find(row=>row.kind==="atomic_fee_closure");expect(closure?.evidence).toMatchObject({targetRetainedFeeMinor:399,acceptedReturnedMinor:1});
  expect((await reviewAtomicFeeReconciliation.call({invoiceId:f.target.invoiceId},OWNER)).find(row=>row.paymentId===big.id)).toMatchObject({originalFeeMinor:400,targetRetainedFeeMinor:399,actualRetainedFeeMinor:399,pending:false});
  expect(await reconcileMerchantApplicationFee.call({paymentId:big.id},OWNER)).toMatchObject({state:"satisfied",operation:null});expect(f.remote.counts().feeRefundPosts).toBe(1);
  expect(await canonical(f.target.invoiceId,f.parent.id)).toEqual(before);expect(await db().select().from(originalCashRecoveries).where(eq(originalCashRecoveries.id,owner.recoveryId))).toEqual(journal.owners);
 });
 it("preserves a genuine thrown original observer, recovers its exact positive resource by a new returned GET and never creates another POST",async()=>{
  const{f,big,owner}=await original(),before=await canonical(f.target.invoiceId,f.parent.id);
  const call=recordOriginalCashFact.call.bind(recordOriginalCashFact);let injected=false;
  const fault=vi.spyOn(recordOriginalCashFact,"call").mockImplementation(async(input,actor,options)=>{const parsed=recordOriginalCashFact.def.input.parse(input),actual=await call(parsed,actor,options);const[row]=await db().select().from(originalCashRecoveryFacts).where(eq(originalCashRecoveryFacts.id,parsed.factId));if(!injected&&row?.kind==="resource"&&row.recoveryId===owner.recoveryId){injected=true;throw Error("Fictional caller fails only AFTER the real raw resource committed.");}return actual;});
  await expect(reconcileMerchantApplicationFee.call({paymentId:big.id},OWNER)).rejects.toThrow();fault.mockRestore();expect(injected).toBe(true);expect(f.remote.counts().feeRefundPosts).toBe(1);
  const calls=await db().select().from(originalCashRecoveryOperations).where(eq(originalCashRecoveryOperations.recoveryId,owner.recoveryId)),post=calls.find(row=>row.kind==="fee");if(!post)throw Error("Retain the genuine original fee caller.");
  const[firstFinish]=await db().select().from(originalCashRecoveryFacts).where(eq(originalCashRecoveryFacts.operationId,post.id)).then(rows=>rows.filter(row=>row.kind==="finish"));expect(firstFinish?.evidence.outcome).toBe("threw");
  expect(await reconcileMerchantApplicationFee.call({paymentId:big.id},OWNER)).toMatchObject({state:"satisfied",operation:null});expect(f.remote.counts().feeRefundPosts).toBe(1);
  const journal=await db().transaction(tx=>originalCashRecoveryFinancialWitness(tx,[big.id],[]));expect(journal.operations.filter(row=>row.kind==="fee")).toEqual([post]);expect(journal.facts.find(row=>row.id===firstFinish?.id)).toEqual(firstFinish);
  const recovery=journal.operations.filter(row=>row.kind==="inspection"&&row.request.auxiliaryOperationId===post.id);expect(recovery.length).toBeGreaterThan(0);expect(recovery.some(row=>journal.facts.some(fact=>fact.operationId===row.id&&fact.kind==="finish"&&fact.evidence.outcome==="returned"&&fact.evidence.callerInstanceId===row.caller.id))).toBe(true);
  expect(journal.facts.filter(row=>row.kind==="atomic_fee_closure")).toHaveLength(1);expect(await canonical(f.target.invoiceId,f.parent.id)).toEqual(before);
 });
 it("retains a genuine external preflight counter before refusing the same-owner POST and does not turn an empty GET into another admission",async()=>{
  const{f,big,owner}=await original(),before=await canonical(f.target.invoiceId,f.parent.id),providerRef=big.providerRef;
  if(!providerRef)throw Error("Preserve the real original provider reference.");
  const call=claimAtomicAuxiliaryFeeReturn.call.bind(claimAtomicAuxiliaryFeeReturn),fault=vi.spyOn(claimAtomicAuxiliaryFeeReturn,"call").mockImplementation(async(input,actor,options)=>{const parsed=claimAtomicAuxiliaryFeeReturn.def.input.parse(input),actual=await call(parsed,actor,options);if(parsed.phase==="admit"&&actual)f.remote.externallyReturnFee(providerRef,1);return actual;});
  await expect(reconcileMerchantApplicationFee.call({paymentId:big.id},OWNER)).rejects.toThrow();fault.mockRestore();
  const ops=await db().select().from(originalCashRecoveryOperations).where(eq(originalCashRecoveryOperations.recoveryId,owner.recoveryId)),fee=ops.find(row=>row.kind==="fee");if(!fee)throw Error("The actual admitted original request remains reserved.");
  const facts=await db().select().from(originalCashRecoveryFacts).where(eq(originalCashRecoveryFacts.operationId,fee.id));expect(facts.filter(row=>row.kind==="parent")).toMatchObject([{evidence:{amountMinor:400,returnedMinor:1}}]);expect(facts.find(row=>row.kind==="finish")?.evidence.outcome).toBe("threw");expect(facts.some(row=>row.kind==="ack"||row.kind==="resource")).toBe(false);expect(f.remote.counts().feeRefundPosts).toBe(0);
  await expect(reconcileMerchantApplicationFee.call({paymentId:big.id},OWNER)).rejects.toThrow();expect(f.remote.counts().feeRefundPosts).toBe(0);
  expect(await db().select().from(originalCashRecoveryOperations).where(eq(originalCashRecoveryOperations.recoveryId,owner.recoveryId))).toEqual(expect.arrayContaining([fee]));expect(await db().select().from(merchantFeeRefunds).where(eq(merchantFeeRefunds.paymentId,big.id))).toHaveLength(0);expect(await canonical(f.target.invoiceId,f.parent.id)).toEqual(before);
 });
});
