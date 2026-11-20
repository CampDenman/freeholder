// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: authenticate both real ledgers before counting physical money.
import {z} from "zod";
import {eq,sql} from "drizzle-orm";
import {ServiceError,type ServiceContext} from "@/core/service";
import {merchantFeeRefunds,merchantFeeObservations} from "./merchant-collection-schema";
import {payments} from "./schema";
import {merchantAgreementPaymentRoutes} from "./merchant-agreement-schema";
import {subscriptionProviderChargeReceipts} from "@/modules/subscriptions/schema";
import {controlledAtomicFeeOwner} from "./controlled-atomic-refund-target";
import {merchantFeeInvocations} from "./merchant-fee-invocation-store";
import {originalCashRecoveryFinancialWitness} from "./original-cash-recovery-store";
import {merchantTaxDigest} from "./merchant-tax-store";
import {atomicFeeResourceUnion,type AtomicFeeResource} from "./atomic-fee-resource-union";
function refuse():never{throw new ServiceError("conflict","Restore the exact original physical fee resources, authenticated owners, actual returned observers and complete ACK/FIN evidence from both ledgers. Unknown or equal-value resources cannot close this duty.");}
export async function readAtomicFeeReturnResources(ctx:ServiceContext,paymentId:string){
 const owner=await controlledAtomicFeeOwner(ctx,paymentId);if(!owner)return null;
 const[payment]=await ctx.tx.select().from(payments).where(eq(payments.id,paymentId));
 const[receipt]=await ctx.tx.select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.id,owner.receiptId));
 const[route]=await ctx.tx.select().from(merchantAgreementPaymentRoutes).where(eq(merchantAgreementPaymentRoutes.paymentId,paymentId));
 if(!payment||!receipt||!route||route.originalChargeReceiptId!==receipt.id||payment.invoiceId!==owner.invoiceId||payment.providerRef!==receipt.providerPaymentIntentRef||route.providerPlatformAccountId!==receipt.providerPlatformAccountId||route.chargeAccountId!==receipt.chargeAccountId||!receipt.providerChargeRef)refuse();
 const fees=await ctx.tx.select().from(merchantFeeRefunds).where(eq(merchantFeeRefunds.paymentId,paymentId)).limit(5001);
 const calls=await merchantFeeInvocations(ctx.tx,paymentId);
 const old=await originalCashRecoveryFinancialWitness(ctx.tx,[paymentId],[owner.receiptId]);
 const actualOwner=old.owners.filter(row=>row.owner.cash.providerPlatformAccountId===receipt.providerPlatformAccountId&&row.owner.cash.chargeAccountId===receipt.chargeAccountId&&row.owner.cash.providerRef===receipt.providerPaymentIntentRef);
 if(actualOwner.length>1||old.owners.length!==actualOwner.length)refuse();
 const values:AtomicFeeResource[]=[],unfinishedIds:string[]=[],pendingOperationIds:string[]=[];
 let budget=fees.length+calls.length+old.owners.length+old.operations.length+old.facts.length+old.closures.length+old.feedback.length;
 for(const call of calls)if(!call.finish&&!call.stop)unfinishedIds.push(call.id);
 for(const fee of fees){
  if(["reserved","dispatching","unknown"].includes(fee.status))pendingOperationIds.push(fee.id);
  const observed=await ctx.tx.select().from(merchantFeeObservations).where(eq(merchantFeeObservations.operationId,fee.id)).limit(5001);budget+=observed.length;if(budget>5000)refuse();
  if(fee.status!=="accepted"){if(observed.length)refuse();continue;}
  if(!fee.providerRef||!owner.applicationFeeRef||fee.applicationFeeRef!==owner.applicationFeeRef||fee.providerChargeRef!==receipt.providerChargeRef||fee.originalChargeReceiptId!==owner.receiptId||fee.providerPlatformAccountId!==receipt.providerPlatformAccountId||fee.currency!==payment.currency)refuse();
  const acknowledgements=observed.filter(row=>row.bindingVerified&&row.providerRef===fee.providerRef&&row.applicationFeeRef===fee.applicationFeeRef&&row.amountMinor===fee.amountMinor&&row.currency===fee.currency);
  if(!acknowledgements.length||acknowledgements.length!==observed.length)refuse();
  const physicalRef=fee.providerRef;
  const returned=calls.filter(row=>{const result=z.object({providerRef:z.literal(physicalRef),applicationFeeRef:z.literal(fee.applicationFeeRef),amountMinor:z.literal(fee.amountMinor),currency:z.literal(fee.currency)}).safeParse(row.firstResult?.body.result);return row.feeOperationId===fee.id&&row.finish?.body.outcome==="returned"&&row.finish.body.firstResultDigest===row.firstResult?.digest&&result.success;});
  if(!returned.length)refuse();
  values.push({ledger:"merchant_fee",paymentId,receiptId:owner.receiptId,operationId:fee.id,platform:fee.providerPlatformAccountId,feeRef:fee.applicationFeeRef,chargeRef:fee.providerChargeRef,account:route.recipientAccountId,providerRef:fee.providerRef,amountMinor:fee.amountMinor,currency:fee.currency,evidenceDigest:merchantTaxDigest({fee,acknowledgements,returned})});
 }
 for(const operation of old.operations){
  const facts=old.facts.filter(row=>row.operationId===operation.id),finish=facts.find(row=>row.kind==="finish"),stop=facts.find(row=>row.kind==="stop");
  if(!finish&&!stop)unfinishedIds.push(operation.id);
  if(operation.kind!=="fee")continue;
  const original=actualOwner.find(row=>row.id===operation.recoveryId);if(!original||!owner.applicationFeeRef||operation.request.parentRef!==owner.applicationFeeRef||operation.request.originalChargeRef!==receipt.providerChargeRef||operation.request.originalAccountId!==route.recipientAccountId||operation.request.providerPlatformAccountId!==receipt.providerPlatformAccountId||operation.request.currency!==payment.currency)refuse();
  const observers=old.operations.filter(row=>row.id===operation.id||row.kind==="inspection"&&row.recoveryId===operation.recoveryId&&row.request.auxiliaryOperationId===operation.id);
  const resources=old.facts.filter(row=>row.kind==="resource"&&observers.some(observer=>observer.id===row.operationId));
  if(!resources.length){pendingOperationIds.push(operation.id);continue;}
  for(const resource of resources){
   const observer=observers.find(row=>row.id===resource.operationId);if(!observer)refuse();
   const own=old.facts.filter(row=>row.operationId===observer.id);
   const body=resource.evidence;
   if(body.bindingVerified!==true||body.operationId!==operation.id||body.parentRef!==operation.request.parentRef||body.amountMinor!==operation.request.amountMinor||body.currency!==operation.request.currency||typeof body.providerRef!=="string"
    ||!own.some(row=>row.kind==="ack"&&row.evidence.providerRef===body.providerRef&&(observer.id===operation.id||row.evidence.auxiliaryOperationId===operation.id)) )refuse();
   const confirmed=resources.some(candidate=>{if(candidate.evidence.providerRef!==body.providerRef)return false;const currentObserver=observers.find(row=>row.id===candidate.operationId);if(!currentObserver)return false;const currentFacts=old.facts.filter(row=>row.operationId===currentObserver.id);return currentFacts.some(row=>row.kind==="finish"&&row.evidence.outcome==="returned"&&row.evidence.callerInstanceId===currentObserver.caller.id)&&!currentFacts.some(row=>row.kind==="stop")&&currentFacts.some(row=>row.kind==="ack"&&row.evidence.providerRef===body.providerRef&&(currentObserver.id===operation.id||row.evidence.auxiliaryOperationId===operation.id));});
   if(!confirmed){pendingOperationIds.push(operation.id);continue;}
   const amount=operation.request.amountMinor;if(typeof amount!=="number"||!Number.isSafeInteger(amount)||amount<=0)refuse();
   values.push({ledger:"original_auxiliary",paymentId,receiptId:owner.receiptId,operationId:operation.id,platform:receipt.providerPlatformAccountId,feeRef:owner.applicationFeeRef,chargeRef:receipt.providerChargeRef??"",account:route.recipientAccountId,providerRef:body.providerRef,amountMinor:amount,currency:payment.currency,evidenceDigest:merchantTaxDigest({original,operation,observer,own,resource})});
  }
 }
 if(budget>5000)refuse();
 let union:ReturnType<typeof atomicFeeResourceUnion>;try{union=atomicFeeResourceUnion(values);}catch{refuse();}
 if(union.returnedMinor>route.applicationFeeMinor)refuse();
 const references=union.resources.map(resource=>resource.providerRef);
 if(references.length){const[foreign]=await ctx.tx.execute<{conflict:boolean}>(sql`select exists(select 1 from merchant_fee_refunds another where another.provider_platform_account_id=${receipt.providerPlatformAccountId} and another.provider_ref in(select jsonb_array_elements_text(${JSON.stringify(references)}::jsonb)) and another.payment_id<>${paymentId}::uuid)
  or exists(select 1 from original_cash_recovery_facts actual_resource join original_cash_recoveries another on another.id=actual_resource.recovery_id where actual_resource.kind='resource' and actual_resource.evidence->>'providerRef' in(select jsonb_array_elements_text(${JSON.stringify(references)}::jsonb)) and another.owner->'cash'->>'providerPlatformAccountId'=${receipt.providerPlatformAccountId} and another.payment_id is distinct from ${paymentId}::uuid and another.subscription_charge_receipt_id is distinct from ${receipt.id}::uuid) as conflict`);if(foreign?.conflict!==false)refuse();}
 return{owner,binding:{payment,receipt,route},original:old,...union,unfinishedIds:[...new Set(unfinishedIds)].sort(),pendingOperationIds:[...new Set(pendingOperationIds)].sort(),revision:merchantTaxDigest({owner,resources:union.resources,fees,calls,original:old,unfinishedIds,pendingOperationIds})};
}
