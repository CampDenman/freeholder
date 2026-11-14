// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Genuine factories, retained bank HTTP, shared callers/FIN;
// no row backfill, fake ServiceContext or policy override.
import {eq,sql} from "drizzle-orm";
import {z} from "zod";
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {db} from "@/core/db";
import {actorString,defineService} from "@/core/service";
import {ready} from "@/core/runtime";
import {stopJobs} from "@/core/jobs";
import {paymentAdapter} from "@/adapters/payments";
import {invoices,payments} from "@/modules/invoicing/schema";
import {entitlementGrants} from "@/core/entitlements/schema";
import {subscriptionProviderChargeReceipts} from "@/modules/subscriptions/schema";
import {collectControlledCollection} from "@/modules/subscriptions/controlled-provider-collection-orchestration";
import {inspectControlledCashReceipt} from "@/modules/invoicing/controlled-cash-inspection-service";
import {applyControlledCashReceipts} from "@/modules/invoicing/controlled-cash-application-service";
import {CONTROLLED_COLLECTION_PROTOCOL} from "@/modules/subscriptions/controlled-provider-collection-protocol";
import {controlledCashApplicationBatches,controlledCashApplicationReceipts,controlledCashApplicationLinks} from "@/modules/invoicing/controlled-cash-application-protocol-schema";
import {claimOriginalCashRecovery,claimOriginalCashInspection,originalCashRecoveryPhase,performOriginalCashRecovery,checkOriginalCashInventory,finalizeOriginalCashRecovery} from "@/modules/invoicing/original-cash-recovery-service";
import {inspectOriginalCashInventory,returnOriginalCash} from "@/modules/invoicing/original-cash-recovery";
import {ORIGINAL_CASH_RETURN_CONFIRMATION} from "@/modules/invoicing/original-cash-recovery-proof";
import {originalCashRecoveryOperations,originalCashRecoveryFacts,originalCashRecoveryClosures} from "@/modules/invoicing/original-cash-recovery-schema";
import {originalInventoryComparison,ORIGINAL_INVENTORY_CAUSAL_PROTOCOL} from "@/modules/invoicing/original-cash-inventory-causal-contract";
import {currentOriginalCashInventoryCausal} from "@/modules/invoicing/original-cash-inventory-causal";
import {currentOriginalCashClosure} from "@/modules/invoicing/original-cash-closure-current";
import {currentOriginalPartialCashClosure} from "@/modules/invoicing/original-cash-partial-closure-current";
import {originalCashPartialReturnCurrent} from "@/modules/invoicing/original-cash-partial-current";
import {reconcileOriginalPartialCashReturn} from "@/modules/invoicing/original-cash-partial";
import {finalizeOriginalPartialCashTarget} from "@/modules/invoicing/original-cash-partial-service";
import {ORIGINAL_PARTIAL_CASH_CONFIRMATION} from "@/modules/invoicing/original-cash-partial-contract";
import {merchantAgreementPaymentRoutes} from "@/modules/invoicing/merchant-agreement-schema";
import {readOriginalCashPrincipalHistory} from "@/modules/invoicing/original-cash-principal";
import {exportOriginalCashHistory} from "@/modules/invoicing/original-cash-invoice-history";
import {originalCashRecoveryFinancialWitness} from "@/modules/invoicing/original-cash-recovery-store";
import {submitProviderRefund} from "@/modules/invoicing/payment-provider-service";
import {reconcileMerchantRefundCurrentState} from "@/modules/invoicing/merchant-refund-current-service";
import {merchantRefundRequests} from "@/modules/invoicing/merchant-refund-schema";
import {actualControlledPeriod84} from "../helpers/actual-controlled-period84";
import {actualControlledOpenInvoice84} from "../helpers/actual-controlled-open-invoice84";
import {retainActualControlledManifest84} from "../helpers/actual-controlled-current-manifest84";
import {closeDb,hasDatabase,OWNER,truncateSpine} from "../helpers/spine";
const system={kind:"system"} as const;
const review=defineService({name:"invoicing.testOriginalInventoryCausal84",summary:"Review the real returned read in its real transaction without exposing private call evidence.",kind:"query",permission:"system",external:false,
 input:z.object({recoveryId:z.uuid(),operationId:z.uuid()}),output:z.object({protocol:z.string(),full:z.string(),causal:z.string(),ownRows:z.number().int(),fullRows:z.number().int()}),handler:async(input,ctx)=>{
  const value=await currentOriginalCashInventoryCausal(ctx,input.recoveryId,input.operationId);return{protocol:value.protocol,full:value.fullCurrentRevision,causal:value.causalRevision,ownRows:value.ownEvidenceEntries.length,fullRows:value.fullPhysicalCount};
 }});
const closureReview=defineService({name:"invoicing.testOriginalClosureCausal84",summary:"Verify only the exact original current closure through the actual shared context.",kind:"query",permission:"system",external:false,
 input:z.object({recoveryId:z.uuid(),closureId:z.uuid()}),output:z.object({closureId:z.uuid(),full:z.string(),preInsert:z.string()}),handler:async(input,ctx)=>{
  const value=await currentOriginalCashClosure(ctx,input.recoveryId,input.closureId);return{closureId:value.closure.id,full:value.fullCurrentRevision,preInsert:value.closurePreInsertRevision};
 }});
const partialReview=defineService({name:"invoicing.testOriginalPartialClosureCausal84",summary:"Read only the genuine current partial target, never whole/principal authority.",kind:"query",permission:"system",external:false,
 input:z.object({recoveryId:z.uuid(),closureFactId:z.uuid(),paymentId:z.uuid()}),output:z.object({targetFactId:z.uuid(),customerReturnedMinor:z.number().int(),feeTargetMinor:z.number().int(),recipientTargetMinor:z.number().int(),whole:z.literal(false),principal:z.literal(false)}).nullable(),handler:async(input,ctx)=>{
  const current=await originalCashPartialReturnCurrent(ctx,input.paymentId);if(!current)return null;const exact=await currentOriginalPartialCashClosure(ctx,input.recoveryId,input.closureFactId);
  if(current.targetFactId!==exact.targetFactId)throw Error("Use only this independently current exact partial closure.");return{targetFactId:current.targetFactId,customerReturnedMinor:current.customerReturnedMinor,feeTargetMinor:current.feeTargetMinor,recipientTargetMinor:current.recipientTargetMinor,whole:exact.suppliesWholeReturnAuthority,principal:exact.suppliesPrincipalAuthority};
 }});
const principalReview=defineService({name:"invoicing.testOriginalClosurePrincipal84",summary:"Read the genuine current principal and retain every existing debt flag.",kind:"query",permission:"system",external:false,
 input:z.object({paymentId:z.uuid()}),output:z.object({reviewRequired:z.boolean(),currentPrincipalMinor:z.number().int().nullable()}),handler:async({paymentId},ctx)=>{
  const value=await readOriginalCashPrincipalHistory(ctx,{kind:"payment",paymentId});return{reviewRequired:value.reviewRequired,currentPrincipalMinor:value.currentPrincipalMinor};
 }});
const archiveReview=defineService({name:"invoicing.testOriginalInventoryArchive84",summary:"Read the existing explicit safe financial projection through the real context.",kind:"query",permission:"system",external:false,
 input:z.object({paymentId:z.uuid()}),output:z.string(),handler:async({paymentId},ctx)=>JSON.stringify(exportOriginalCashHistory(await originalCashRecoveryFinancialWitness(ctx.tx,[paymentId],[])))});
function signal(){let resolve:()=>void=()=>{throw Error("Initialize the actual fixture barrier.");};const promise=new Promise<void>(accept=>{resolve=accept;});return{promise,resolve};}
let heldFinalization:{entered:ReturnType<typeof signal>;release:ReturnType<typeof signal>}|undefined;
const heldFinalizer=defineService({name:"invoicing.testHoldOriginalV2Finalization84",summary:"Hold the real finalizer prefix in its genuine outer transaction for a foreign-admission race control.",kind:"mutation",permission:"system",external:false,writeClass:"money",
 input:z.object({recoveryId:z.uuid(),operationId:z.uuid()}),output:z.object({closureId:z.uuid()}),handler:async(input,ctx)=>{
  const barrier=heldFinalization;if(!barrier)throw Error("Install the actual test barrier before calling the shared finalizer.");
  const result=await ctx.callAsSystem(finalizeOriginalCashRecovery,input);barrier.entered.resolve();await barrier.release.promise;return result;
 }});
const foreignAdmission=defineService({name:"invoicing.testForeignV2Admission84",summary:"Attempt a real foreign GET admission with a bounded actual PostgreSQL lock wait.",kind:"mutation",permission:"system",external:false,writeClass:"money",
 input:z.object({recoveryId:z.uuid()}),output:z.object({operationId:z.uuid()}),handler:async(input,ctx)=>{
  await ctx.tx.execute(sql`set local lock_timeout='150ms'`);
  const result=await ctx.callAsSystem(claimOriginalCashInspection,input);return{operationId:result.operationId};
 }});
function postgresCodes(error:unknown){const codes:string[]=[];for(let i=0;i<8;i++){const row=z.object({code:z.string().optional(),cause:z.unknown().optional()}).passthrough().safeParse(error);if(!row.success)break;if(row.data.code)codes.push(row.data.code);error=row.data.cause;}return codes;}
async function performRealInventory(claim:Awaited<ReturnType<typeof claimOriginalCashInspection.call>>){
 const source=await originalCashRecoveryPhase.call({recoveryId:claim.recoveryId},system),adapter=paymentAdapter("stripe");
 if(!adapter.inspectMerchantReturnedCash)throw Error("Use the actual returned-cash HTTP adapter.");
 await performOriginalCashRecovery(claim,observe=>adapter.inspectMerchantReturnedCash!({providerPlatformAccountId:source.platform,providerApiVersion:source.apiVersion,
  ...(source.account?{providerAccountId:source.account}:{}),paymentProviderRef:source.paymentRef,onOriginalCashObserved:value=>observe("primary",value),onRefundObserved:value=>observe("refund",value),onReturnStateObserved:value=>observe("state",value)}));
}
describe.runIf(hasDatabase)("actual v2 original inventory and exact closure causal comparison",{timeout:180000},()=>{
 let active:Awaited<ReturnType<typeof actualControlledPeriod84>>|undefined;
 beforeAll(ready,60000);beforeEach(truncateSpine);afterEach(()=>{heldFinalization?.release.resolve();heldFinalization=undefined;vi.useRealTimers();active?.cleanup();active=undefined;vi.restoreAllMocks();});afterAll(async()=>{await stopJobs();await closeDb();});
 async function paid(equal=false){
  active=await actualControlledPeriod84();const f=active,open=await actualControlledOpenInvoice84(f);
  if(equal){f.remote.externallyAttachPayment(open.providerInvoiceRef,2100,200);f.remote.externallyAttachPayment(open.providerInvoiceRef,2100,200);}
  else{f.remote.externallyAttachPayment(open.providerInvoiceRef,4199,400);f.remote.externallyAttachPayment(open.providerInvoiceRef,1,0);}
  expect(await collectControlledCollection.call({collectionId:f.target.collectionId},OWNER)).toMatchObject({state:"money_retained",applied:false});await retainActualControlledManifest84(f);
  const receipts=await db().select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.subscriptionId,f.parent.id));expect(receipts).toHaveLength(2);
  for(const receipt of receipts)expect(await inspectControlledCashReceipt.call({collectionId:f.target.collectionId,receiptId:receipt.id},OWNER)).toMatchObject({bankReadReturned:true,completeInventory:true});
  expect(await applyControlledCashReceipts.call({collectionId:f.target.collectionId,receiptIds:receipts.map(row=>row.id).sort(),requiredProtocol:CONTROLLED_COLLECTION_PROTOCOL},system)).toMatchObject({outstandingMinor:0});await stopJobs();
  const actual=await db().select().from(payments).where(eq(payments.invoiceId,f.target.invoiceId));
  const routes=await db().select().from(merchantAgreementPaymentRoutes).where(eq(merchantAgreementPaymentRoutes.subscriptionId,f.parent.id)),receiptOrder=[...receipts].sort((a,b)=>a.id.localeCompare(b.id));
  const firstRoute=routes.find(row=>row.originalChargeReceiptId===receiptOrder[0]?.id),secondRoute=routes.find(row=>row.originalChargeReceiptId===receiptOrder[1]?.id);
  const tiny=equal?actual.find(row=>row.id===firstRoute?.paymentId):actual.find(row=>row.amountMinor===1),big=equal?actual.find(row=>row.id===secondRoute?.paymentId):actual.find(row=>row.amountMinor===4199);
  if(!tiny||!big||tiny.id===big.id)throw Error("Use both real distinct canonical receipt owners through their actual original receipt FKs.");
  const owner=async(paymentId:string)=>claimOriginalCashRecovery.call({source:{kind:"payment",paymentId},authorizedBy:actorString(OWNER)},system);
  const bigOwner=await owner(big.id);return{f,tiny,big,bigOwner,owner};
 }
 async function money(invoiceId:string,subscriptionId:string){return{invoice:await db().select().from(invoices).where(eq(invoices.id,invoiceId)),payments:await db().select().from(payments).where(eq(payments.invoiceId,invoiceId)).orderBy(payments.id),batches:await db().select().from(controlledCashApplicationBatches),proofs:await db().select().from(controlledCashApplicationReceipts),links:await db().select().from(controlledCashApplicationLinks),grants:await db().select().from(entitlementGrants).where(eq(entitlementGrants.sourceSubscriptionId,subscriptionId)).orderBy(entitlementGrants.id)};}
 it("binds the genuine new GET's preimage and FIN while retaining full current rows and safe archive exclusions",async()=>{
  const{f,tiny,owner}=await paid(),recovery=await owner(tiny.id),before=await money(f.target.invoiceId,f.parent.id),claim=await claimOriginalCashInspection.call(recovery,system);
  await expect(checkOriginalCashInventory.call({...recovery,operationId:claim.operationId},system)).rejects.toThrow();
  await performRealInventory(claim);expect(await checkOriginalCashInventory.call({...recovery,operationId:claim.operationId},system)).toMatchObject({settled:false,applied:true});
  const[operation]=await db().select().from(originalCashRecoveryOperations).where(eq(originalCashRecoveryOperations.id,claim.operationId));if(!operation)throw Error("Retain the genuine new original admission.");
  const comparison=originalInventoryComparison.parse(operation.request.inventoryComparison);expect(comparison).toMatchObject({protocol:ORIGINAL_INVENTORY_CAUSAL_PROTOCOL,recoveryId:recovery.recoveryId,operationId:operation.id,callerId:operation.caller.id,nonceHash:operation.nonceHash,sourceRevision:operation.request.sourceRevision});
  expect(comparison.preimageEntries.some(row=>row.table==="original_cash_recovery_operations"&&row.id===operation.id)).toBe(false);
  const actual=await review.call({...recovery,operationId:claim.operationId},system);expect(actual.full).not.toBe(actual.causal);expect(actual.causal).toBe(comparison.sourceRevision);expect(actual.ownRows).toBeGreaterThan(3);expect(actual.fullRows).toBeGreaterThan(actual.ownRows);
  const facts=await db().select().from(originalCashRecoveryFacts).where(eq(originalCashRecoveryFacts.operationId,claim.operationId)).orderBy(originalCashRecoveryFacts.sequence);expect(facts.at(-1)).toMatchObject({kind:"finish",evidence:{callerInstanceId:operation.caller.id,outcome:"returned"}});
  const safe=await archiveReview.call({paymentId:tiny.id},system);expect(safe).not.toContain("inventoryComparison");expect(safe).not.toContain(operation.nonceHash);expect(safe).not.toContain(operation.authentication);expect(safe).not.toContain("preimageEntries");expect(await money(f.target.invoiceId,f.parent.id)).toEqual(before);
 });
 it("refuses a wrong owner and a genuine other completed GET appearing after this actual caller returned",async()=>{
  const{f,tiny,bigOwner,owner}=await paid(),recovery=await owner(tiny.id),before=await money(f.target.invoiceId,f.parent.id),claim=await claimOriginalCashInspection.call(recovery,system);
  await performRealInventory(claim);expect(await checkOriginalCashInventory.call({...recovery,operationId:claim.operationId},system)).toMatchObject({settled:false});
  await expect(checkOriginalCashInventory.call({...bigOwner,operationId:claim.operationId},system)).rejects.toThrow();
  const foreign=await inspectOriginalCashInventory(bigOwner.recoveryId,OWNER);expect(foreign).not.toBe(claim.operationId);
  await expect(checkOriginalCashInventory.call({...recovery,operationId:claim.operationId},system)).rejects.toThrow();
  const callerInstanceId:unknown=expect.any(String);expect(await db().select().from(originalCashRecoveryFacts).where(eq(originalCashRecoveryFacts.operationId,claim.operationId))).toEqual(expect.arrayContaining([expect.objectContaining({kind:"finish",evidence:{callerInstanceId,outcome:"returned"}})]));expect(await money(f.target.invoiceId,f.parent.id)).toEqual(before);
 });
 it("repeats only the independently current exact closure and rejects its old proof after a foreign read or genuine second closure",async()=>{
  const{f,tiny,bigOwner}=await paid();const refund=await submitProviderRefund.call({paymentId:tiny.id,amountMinor:1,reason:"Return the genuine tiny receipt",idempotencyKey:`causal-tiny:${tiny.id}`},OWNER);
  const[request]=await db().select().from(merchantRefundRequests).where(eq(merchantRefundRequests.refundId,refund.id));if(!request)throw Error("Use the actual original physical refund owner.");await reconcileMerchantRefundCurrentState.call({requestId:request.id},OWNER);
  const[tinyReceipt]=await db().select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.providerPaymentIntentRef,tiny.providerRef??""));if(!tinyReceipt)throw Error("Use the exact original tiny receipt/PI for its genuine post-refund bank read.");
  expect(await inspectControlledCashReceipt.call({collectionId:f.target.collectionId,receiptId:tinyReceipt.id},OWNER)).toMatchObject({bankReadReturned:true,completeInventory:true});
  const closed=await returnOriginalCash.call({source:{kind:"payment",paymentId:tiny.id},confirmation:ORIGINAL_CASH_RETURN_CONFIRMATION},OWNER),[closure]=await db().select().from(originalCashRecoveryClosures).where(eq(originalCashRecoveryClosures.id,closed.closureId));if(!closure)throw Error("Retain the actual current complete closure.");
  const before=await money(f.target.invoiceId,f.parent.id),counts=f.remote.counts();expect(await closureReview.call({recoveryId:closed.recoveryId,closureId:closure.id},system)).toMatchObject({closureId:closure.id,preInsert:closure.revision});
  expect(await finalizeOriginalCashRecovery.call({recoveryId:closed.recoveryId,operationId:closure.operationId},system)).toEqual({closureId:closure.id});
  expect(await principalReview.call({paymentId:tiny.id},system)).toEqual({reviewRequired:false,currentPrincipalMinor:0});
  await inspectOriginalCashInventory(bigOwner.recoveryId,OWNER);await expect(closureReview.call({recoveryId:closed.recoveryId,closureId:closure.id},system)).rejects.toThrow();await expect(finalizeOriginalCashRecovery.call({recoveryId:closed.recoveryId,operationId:closure.operationId},system)).rejects.toThrow();
  expect(await principalReview.call({paymentId:tiny.id},system)).toEqual({reviewRequired:true,currentPrincipalMinor:null});
  const currentRead=await inspectOriginalCashInventory(closed.recoveryId,OWNER),second=await finalizeOriginalCashRecovery.call({recoveryId:closed.recoveryId,operationId:currentRead},system);expect(second.closureId).not.toBe(closure.id);
  expect(await finalizeOriginalCashRecovery.call({recoveryId:closed.recoveryId,operationId:currentRead},system)).toEqual(second);await expect(closureReview.call({recoveryId:closed.recoveryId,closureId:closure.id},system)).rejects.toThrow();
  expect(await principalReview.call({paymentId:tiny.id},system)).toEqual({reviewRequired:false,currentPrincipalMinor:0});
  expect(await money(f.target.invoiceId,f.parent.id)).toEqual(before);expect(f.remote.counts().principalRefundPosts).toBe(counts.principalRefundPosts);expect(f.remote.counts().feeRefundPosts).toBe(counts.feeRefundPosts);
 });
 it("fences a genuine foreign namespace admission while the actual v2 finalizer holds its full money prefix",async()=>{
  const{f,tiny,bigOwner}=await paid(),refund=await submitProviderRefund.call({paymentId:tiny.id,amountMinor:1,reason:"Return tiny principal before the actual closure-prefix race",idempotencyKey:`causal-race:${tiny.id}`},OWNER);
  const[request]=await db().select().from(merchantRefundRequests).where(eq(merchantRefundRequests.refundId,refund.id));if(!request)throw Error("Use the real retained refund request.");await reconcileMerchantRefundCurrentState.call({requestId:request.id},OWNER);
  const closed=await returnOriginalCash.call({source:{kind:"payment",paymentId:tiny.id},confirmation:ORIGINAL_CASH_RETURN_CONFIRMATION},OWNER),[closure]=await db().select().from(originalCashRecoveryClosures).where(eq(originalCashRecoveryClosures.id,closed.closureId));if(!closure)throw Error("Use the actual completed closure.");
  const before=await money(f.target.invoiceId,f.parent.id),foreignBefore=await db().select().from(originalCashRecoveryOperations).where(eq(originalCashRecoveryOperations.recoveryId,bigOwner.recoveryId)),counts=f.remote.counts();
  const barrier={entered:signal(),release:signal()};heldFinalization=barrier;const holding=heldFinalizer.call({recoveryId:closed.recoveryId,operationId:closure.operationId},system);
  let refused:unknown;
  try{await Promise.race([barrier.entered.promise,holding.then(()=>{throw Error("The real outer finalizer must hold its prefix until the test releases it.");})]);
    try{await foreignAdmission.call(bigOwner,system);}catch(error){refused=error;}
  }finally{barrier.release.resolve();}
  expect(await holding).toEqual({closureId:closure.id});expect(postgresCodes(refused)).toContain("55P03");
  expect(await db().select().from(originalCashRecoveryOperations).where(eq(originalCashRecoveryOperations.recoveryId,bigOwner.recoveryId))).toEqual(foreignBefore);
  expect(await money(f.target.invoiceId,f.parent.id)).toEqual(before);expect(f.remote.counts().principalRefundPosts).toBe(counts.principalRefundPosts);expect(f.remote.counts().feeRefundPosts).toBe(counts.feeRefundPosts);
  // Actual admission succeeds only after the genuine prefix releases; that
  // new real completed foreign GET then invalidates the old closure proof.
  await inspectOriginalCashInventory(bigOwner.recoveryId,OWNER);await expect(closureReview.call({recoveryId:closed.recoveryId,closureId:closure.id},system)).rejects.toThrow();
 });

 it("retains a genuine v2 partial target, reads again after its birth, and keeps its exact partial closure current only until real foreign evidence changes",async()=>{
  const{f,tiny:selected,bigOwner}=await paid(true),refund=await submitProviderRefund.call({paymentId:selected.id,amountMinor:1050,reason:"Return half of this exact real receipt",idempotencyKey:`causal-partial:${selected.id}`},OWNER);
  const[request]=await db().select().from(merchantRefundRequests).where(eq(merchantRefundRequests.refundId,refund.id));if(!request)throw Error("Use the actual original partial-refund owner.");await reconcileMerchantRefundCurrentState.call({requestId:request.id},OWNER);
  const[selectedReceipt]=await db().select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.providerPaymentIntentRef,selected.providerRef??""));if(!selectedReceipt)throw Error("Use the actual selected original receipt.");await inspectControlledCashReceipt.call({collectionId:f.target.collectionId,receiptId:selectedReceipt.id},OWNER);
  const closed=await reconcileOriginalPartialCashReturn.call({paymentId:selected.id,confirmation:ORIGINAL_PARTIAL_CASH_CONFIRMATION},OWNER);
  const[target]=await db().select().from(originalCashRecoveryFacts).where(eq(originalCashRecoveryFacts.id,closed.targetFactId)),[closure]=await db().select().from(originalCashRecoveryFacts).where(eq(originalCashRecoveryFacts.id,closed.closureFactId));if(!target||!closure)throw Error("Retain actual signed target and independent partial closure facts.");
  const operationId=z.uuid().parse(closure.evidence.originalInventoryOperationId);expect(operationId).not.toBe(target.evidence.originalInventoryOperationId);
  const[operation]=await db().select().from(originalCashRecoveryOperations).where(eq(originalCashRecoveryOperations.id,operationId));if(!operation)throw Error("The post-declaration GET is a genuine separately admitted caller.");
  const header=originalInventoryComparison.parse(operation.request.inventoryComparison);expect(header.preimageEntries).toEqual(expect.arrayContaining([expect.objectContaining({table:"original_cash_recovery_facts",id:target.id})]));
  expect(await partialReview.call({recoveryId:closed.recoveryId,closureFactId:closure.id,paymentId:selected.id},system)).toEqual({targetFactId:target.id,customerReturnedMinor:1050,feeTargetMinor:100,recipientTargetMinor:1050,whole:false,principal:false});
  const before=await money(f.target.invoiceId,f.parent.id),counts=f.remote.counts();expect(await finalizeOriginalPartialCashTarget.call({recoveryId:closed.recoveryId,operationId,targetFactId:target.id},system)).toEqual({closureFactId:closure.id});
  await inspectOriginalCashInventory(bigOwner.recoveryId,OWNER);expect(await partialReview.call({recoveryId:closed.recoveryId,closureFactId:closure.id,paymentId:selected.id},system)).toBeNull();await expect(finalizeOriginalPartialCashTarget.call({recoveryId:closed.recoveryId,operationId,targetFactId:target.id},system)).rejects.toThrow();
  expect(await money(f.target.invoiceId,f.parent.id)).toEqual(before);expect(f.remote.counts().principalRefundPosts).toBe(counts.principalRefundPosts);expect(f.remote.counts().feeRefundPosts).toBe(counts.feeRefundPosts);
 });

});
