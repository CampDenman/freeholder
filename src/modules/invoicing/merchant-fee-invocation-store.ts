// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: genuine pre-IO payment/namespace callers, no invented fee owner.
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {and,asc,eq,sql} from "drizzle-orm";
import {ServiceError,type ServiceContext,type Tx} from "@/core/service";
import {merchantPhysicalCaller} from "./merchant-physical-caller";
import {merchantFeeRefunds} from "./merchant-collection-schema";
import {merchantFeeRefundInvocations} from "./merchant-fee-invocation-schema";
import {merchantFeeInvocationCallerClosed,signMerchantFeeInvocation,verifiedMerchantFeeInvocation,verifiedMerchantFeeInvocationAdmission,verifiedMerchantFeePreflight} from "./merchant-fee-invocation-proof";
import {originalCashEvidenceKeys,originalCashSigningKey} from "./original-cash-recovery-store";
import {controlledAtomicFeeOwner,controlledAtomicRefundTarget,lockControlledAtomicRefundEvidence} from "./controlled-atomic-refund-target";
import {routingForPayment} from "./merchant-charge";
import {payments} from "./schema";
import type {MerchantFeeInvocationClaim} from "./merchant-fee-invocation-contract";
import {merchantPaymentEvidence} from "./merchant-payment-observations";
export {merchantFeeInvocationClaim,type MerchantFeeInvocationClaim} from "./merchant-fee-invocation-contract";
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
function refuse():never{throw new ServiceError("conflict","Restore the exact original fee invocation, real caller and current bank proof before I/O. A stop, timeout, empty lookup or later result cannot permit another original POST.");}
export async function requireMerchantFeeInvocations(ctx:ServiceContext){
 const[installed]=await ctx.tx.execute<{present:boolean}>(sql`select to_regprocedure('freeholder_merchant_fee_invocations_ready()') is not null as present`);if(!installed?.present)refuse();
 const[actual]=await ctx.tx.execute<{ready:boolean}>(sql`select freeholder_merchant_fee_invocations_ready() as ready`);if(actual?.ready!==true)refuse();
}
export async function feeInvocationOperationFingerprint(tx:Tx,id:string){
 const[row]=await tx.execute<{fingerprint:string}>(sql`select encode(sha256(convert_to((to_jsonb(fee)-array['status','provider_ref','dispatched_at','accepted_at','updated_at'])::text,'UTF8')),'hex') as fingerprint from merchant_fee_refunds fee where fee.id=${id}::uuid`);
 if(!row||!/^[a-f0-9]{64}$/.test(row.fingerprint))refuse();return row;
}
/** Ordinals belong to the actual original payment/namespace, including probes
 * with NO fee operation. A nullable fee FK never removes an unfinished GET. */
export async function merchantFeeInvocations(tx:Tx,paymentId:string){
 const rows=await tx.select().from(merchantFeeRefundInvocations).where(eq(merchantFeeRefundInvocations.paymentId,paymentId)).orderBy(asc(merchantFeeRefundInvocations.ordinal)).limit(5001);
 const keys=originalCashEvidenceKeys(),namespace=rows[0]?.namespaceKey;
 if(rows.length>5000||rows.some((row,index)=>row.ordinal!==index+1||row.namespaceKey!==namespace||!verifiedMerchantFeeInvocation(row,keys)
  ||(row.kind==="source_inspect"?(row.feeOperationId!==null||row.feeOperationFingerprint!==null):(row.feeOperationId===null||row.feeOperationFingerprint===null))))refuse();
 for(const row of rows)if(row.feeOperationId){const fingerprint=await feeInvocationOperationFingerprint(tx,row.feeOperationId);if(row.feeOperationFingerprint!==fingerprint.fingerprint)refuse();}
 const children=rows.filter(row=>row.request.readKind==="fee_preflight"),parents=[...new Set(children.map(row=>row.request.parentFeeInvocationId))];
 if(parents.length!==children.length||parents.some(id=>typeof id!=="string"))refuse();
 const fingerprints=parents.length?await tx.execute<{id:string;fingerprint:string}>(sql`select actual_parent.id::text,encode(sha256(convert_to((to_jsonb(actual_parent)||jsonb_build_object('first_result',null,'finish',null,'stop',null))::text,'UTF8')),'hex') as fingerprint from merchant_fee_refund_invocations actual_parent where actual_parent.id in(${sql.join(parents.map(id=>sql`${id}::uuid`),sql`, `)})`):[];
 for(const child of children){const parent=rows.find(row=>row.id===child.request.parentFeeInvocationId),actual=fingerprints.find(row=>row.id===parent?.id);if(!parent||!actual||!verifiedMerchantFeePreflight(child,parent,keys,actual.fingerprint))refuse();}
 return rows;
}
export async function merchantFeeInvocationPaymentCallers(tx:Tx,paymentId:string){
 const[installed]=await tx.execute<{present:boolean}>(sql`select to_regclass('merchant_fee_refund_invocations') is not null as present`);if(!installed?.present)return{applies:false,unfinishedIds:[] as string[]};
 const rows=await merchantFeeInvocations(tx,paymentId),keys=originalCashEvidenceKeys();
 return{applies:rows.length>0,unfinishedIds:rows.filter(row=>!merchantFeeInvocationCallerClosed(row,keys)).map(row=>row.id)};
}
export async function merchantFeeInvocationCallers(tx:Tx,feeOperationId:string){
 const[fee]=await tx.select().from(merchantFeeRefunds).where(eq(merchantFeeRefunds.id,feeOperationId));if(!fee)return{applies:false,unfinishedIds:[] as string[]};
 const callers=await merchantFeeInvocationPaymentCallers(tx,fee.paymentId);if(!callers.applies)return callers;
 const rows=await merchantFeeInvocations(tx,fee.paymentId);
 // A new source GET cannot retrospectively close an OLD untracked POST.
 const post=rows.find(row=>row.feeOperationId===fee.id&&row.kind==="post");
 return{applies:Boolean(post),unfinishedIds:callers.unfinishedIds};
}
export async function merchantFeeInvocationCallersClosed(tx:Tx,feeOperationId:string){
 const callers=await merchantFeeInvocationCallers(tx,feeOperationId);return callers.applies&&callers.unfinishedIds.length===0;
}
/** Actual causal ordinal plus wrapper FIN, never created_at/UUID ordering.
 * The matching raw observation was independently committed by the callback. */
export async function returnedMerchantFeeSource(tx:Tx,paymentId:string){
 const rows=await merchantFeeInvocations(tx,paymentId),source=rows.filter(row=>row.kind==="source_inspect"&&row.request.readKind==="payment_source").at(-1);
 if(!source||source.kind!=="source_inspect"||source.stop||source.finish?.body.outcome!=="returned")refuse();
 const result=merchantPaymentEvidence.safeParse(source.finish.body.returnedResult);if(!result.success)refuse();
 return{source,evidence:result.data};
}
export async function admitMerchantFeeInvocation(ctx:ServiceContext,input:{paymentId:string;feeOperationId:string|null;kind:MerchantFeeInvocationClaim["kind"];parentFeeInvocation?:MerchantFeeInvocationClaim}):Promise<MerchantFeeInvocationClaim>{
 await requireMerchantFeeInvocations(ctx);
 const owner=await controlledAtomicFeeOwner(ctx,input.paymentId);if(!owner)refuse();
 const context=await lockControlledAtomicRefundEvidence(ctx,input.paymentId);if(!context)refuse();
 if(context.coverage.entries.length+(input.kind==="post"?2:1)>5000)refuse();
 const parent=input.parentFeeInvocation?await merchantFeeInvocationHolder(ctx,input.parentFeeInvocation):null;
 if(parent&&(input.kind!=="source_inspect"||input.feeOperationId!==null||parent.paymentId!==input.paymentId||parent.originalChargeReceiptId!==owner.receiptId
  ||!["post","recover_get"].includes(parent.kind)||parent.firstResult||parent.finish||parent.stop))refuse();
 // The sole newly inserted reservation is not a historical SDK caller. It
 // must be born in THIS transaction, still unstarted, with its actual source
 // FIN already retained. The deferred birth guard also requires this POST
 // admission before that transaction may commit. No old reservation qualifies.
 const[birth]=input.kind==="post"&&input.feeOperationId?await ctx.tx.execute<{bornHere:boolean}>(sql`select (fee.xmin::text=txid_current()::text and fee.status='reserved' and fee.dispatched_at is null and fee.provider_ref is null) as "bornHere" from merchant_fee_refunds fee where fee.id=${input.feeOperationId}::uuid`):[];
 if(context.coverage.unfinishedCallers.some(caller=>!((birth?.bornHere===true&&caller.kind==="historical_fee"&&caller.id===input.feeOperationId)||(parent&&caller.kind==="fee_invocation"&&caller.id===parent.id))))refuse();
 await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`merchant-fee-invocation:${input.paymentId}`}))`);
 const rows=await merchantFeeInvocations(ctx.tx,input.paymentId),keys=originalCashEvidenceKeys();
 if(rows.some(row=>row.id!==parent?.id&&!merchantFeeInvocationCallerClosed(row,keys))||rows.length>=4998
  ||parent&&rows.some(row=>row.request.parentFeeInvocationId===parent.id))refuse();
 const[payment]=await ctx.tx.select().from(payments).where(eq(payments.id,input.paymentId));const routing=await routingForPayment(ctx,input.paymentId);
 if(!payment||!payment.providerRef||routing.originalChargeReceiptId!==owner.receiptId||!routing.providerPlatformAccountId||!routing.providerSubscriptionRef||!routing.providerInvoiceRef
  ||!routing.providerPaymentIntentRef||routing.providerApiVersion!=="2026-10-28.endive"||routing.applicationFeeMinor===undefined)refuse();
 const fee=input.feeOperationId?(await ctx.tx.select().from(merchantFeeRefunds).where(eq(merchantFeeRefunds.id,input.feeOperationId)).for("update"))[0]:null;
 let fingerprint:string|null=null,sourceInvocationId:string|null=null,targetRevision:string|null=null,expectedOriginalFeeMinor:number|null=null,expectedFeeRefundedMinor:number|null=null;
 if(input.kind==="source_inspect"){if(input.feeOperationId!==null)refuse();}
 else{
  if(!fee||fee.paymentId!==payment.id||fee.originalChargeReceiptId!==owner.receiptId||fee.applicationFeeRef!==owner.applicationFeeRef||fee.providerChargeRef!==owner.providerChargeRef)refuse();
  fingerprint=(await feeInvocationOperationFingerprint(ctx.tx,fee.id)).fingerprint;
  if(input.kind==="post"){
   const target=await controlledAtomicRefundTarget(ctx,payment.id),latest=rows.filter(row=>row.kind==="source_inspect"&&row.request.readKind==="payment_source").at(-1);
   if(!target||target.target===null||target.target!==fee.targetRetainedFeeMinor||!target.revision||fee.status!=="reserved"||rows.some(row=>row.feeOperationId===fee.id&&row.kind==="post")
    ||!latest||latest.kind!=="source_inspect"||latest.finish?.body.outcome!=="returned"||latest.stop)refuse();
   const[current]=await ctx.tx.execute<{ready:boolean}>(sql`select freeholder_merchant_fee_source_ready(${fee.id}::uuid,null::uuid) as ready`);if(current?.ready!==true)refuse();
   const returned=merchantPaymentEvidence.safeParse(latest.finish?.body.returnedResult);
   if(!returned.success||returned.data.observedApplicationFeeMinor===undefined||returned.data.observedFeeRefundedMinor===undefined)refuse();
   expectedOriginalFeeMinor=returned.data.observedApplicationFeeMinor;expectedFeeRefundedMinor=returned.data.observedFeeRefundedMinor;
   sourceInvocationId=latest.id;targetRevision=target.revision;
  }else if(!rows.some(row=>row.feeOperationId===fee.id&&row.kind==="post")||!["dispatching","unknown"].includes(fee.status))refuse();
 }
 const id=randomUUID(),nonce=randomBytes(32).toString("base64url"),createdAt=new Date();
 const[parentFingerprint]=parent?await ctx.tx.execute<{fingerprint:string}>(sql`select encode(sha256(convert_to(to_jsonb(actual_parent)::text,'UTF8')),'hex') as fingerprint from merchant_fee_refund_invocations actual_parent where actual_parent.id=${parent.id}::uuid`):[];
 const sourceReadKind=input.kind==="source_inspect"?(parent?"fee_preflight" as const:"payment_source" as const):null;
 const request={paymentId:payment.id,invoiceId:payment.invoiceId,originalChargeReceiptId:owner.receiptId,providerRef:payment.providerRef,providerChargeRef:owner.providerChargeRef,applicationFeeRef:owner.applicationFeeRef,
  providerPlatformAccountId:routing.providerPlatformAccountId,providerAccountId:routing.providerAccountId??null,destinationAccountId:routing.destinationAccountId??null,settlementMerchantAccountId:routing.settlementMerchantAccountId??null,
  providerApiVersion:routing.providerApiVersion,currency:payment.currency,amountMinor:fee?.amountMinor??null,idempotencyKey:fee?.idempotencyKey??null,targetRetainedFeeMinor:fee?.targetRetainedFeeMinor??null,
  originalPrincipalMinor:payment.amountMinor,originalApplicationFeeMinor:routing.applicationFeeMinor,observedOriginalFeeMinor:fee?.observedOriginalFeeMinor??routing.applicationFeeMinor,
  frozenBody:fee?new URLSearchParams({amount:String(fee.amountMinor),"metadata[freeholder_fee_refund_id]":fee.id}).toString():null,
  subscriptionOrigin:{providerSubscriptionRef:routing.providerSubscriptionRef,providerInvoiceRef:routing.providerInvoiceRef,providerPaymentIntentRef:routing.providerPaymentIntentRef},
  sourceInvocationId,targetRevision,sourceRevision:context.coverage.revision,originalOwnerRevision:owner.revision,readKind:sourceReadKind,parentFeeInvocationId:parent?.id??null,
  parentAdmissionDigest:parent?.digest??null,parentAdmissionFingerprint:parentFingerprint?.fingerprint??null,expectedOriginalFeeMinor,expectedFeeRefundedMinor};
 const unsigned={id,paymentId:payment.id,originalChargeReceiptId:owner.receiptId,namespaceKey:owner.namespaceKey,feeOperationId:fee?.id??null,ordinal:rows.length+1,kind:input.kind,feeOperationFingerprint:fingerprint,request,caller:merchantPhysicalCaller(),nonceHash:hash(nonce),firstResult:null,finish:null,stop:null,createdAt};
 await ctx.tx.execute(sql`select set_config('freeholder.merchant_fee_invocation_v1','1',true),set_config('freeholder.merchant_fee_invocation_nonce',${nonce},true),set_config('freeholder.merchant_fee_parent_nonce',${input.parentFeeInvocation?.nonce??""},true)`);
 await ctx.tx.insert(merchantFeeRefundInvocations).values({...unsigned,...signMerchantFeeInvocation(unsigned,originalCashSigningKey())});
 ctx.setSubject("payment",payment.id);
 return{invocationId:id,paymentId:payment.id,feeOperationId:fee?.id??null,kind:input.kind,sourceReadKind,nonce};
}

export async function merchantFeeInvocationHolder(ctx:ServiceContext,input:MerchantFeeInvocationClaim,finishing=false){
 // A raw/FIN callback waits for an identity cutover. It never drops its actual
 // held fact merely because the current contact/profile fingerprint changed.
 await ctx.tx.execute(sql`select pg_advisory_xact_lock_shared(hashtext('contact-identity-privacy'))`);
 await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`merchant-fee-invocation:${input.paymentId}`}))`);
 const[row]=await ctx.tx.select().from(merchantFeeRefundInvocations).where(and(eq(merchantFeeRefundInvocations.id,input.invocationId),eq(merchantFeeRefundInvocations.paymentId,input.paymentId)));
 if(!row||row.feeOperationId!==input.feeOperationId||(row.request.readKind??null)!==input.sourceReadKind||!verifiedMerchantFeeInvocation(row,originalCashEvidenceKeys())||row.caller.id!==merchantPhysicalCaller().id||row.nonceHash!==hash(input.nonce)||row.kind!==input.kind||row.stop||row.finish&&!finishing)refuse();
 // Raw ACK/FIN persistence authenticates its immutable admission, not today's
 // economic eligibility. Later policy/target drift cannot discard real facts.
 return row;
}
/** Retain actual raw observations through the immutable original admission.
 * This is deliberately NOT the SDK-admission predicate: late positive facts
 * remain recordable after a finish/stop or current owner/policy drift. */
export async function merchantFeeInvocationReceiptOrigin(ctx:ServiceContext,input:MerchantFeeInvocationClaim){
 await ctx.tx.execute(sql`select pg_advisory_xact_lock_shared(hashtext('contact-identity-privacy'))`);
 const read=async()=>{
  const[row]=await ctx.tx.select().from(merchantFeeRefundInvocations).where(eq(merchantFeeRefundInvocations.id,input.invocationId));
  if(!row||row.paymentId!==input.paymentId||row.feeOperationId!==input.feeOperationId||(row.request.readKind??null)!==input.sourceReadKind||row.kind!==input.kind
   ||row.caller.id!==merchantPhysicalCaller().id||row.nonceHash!==hash(input.nonce)||!verifiedMerchantFeeInvocationAdmission(row,originalCashEvidenceKeys()))refuse();return row;
 };
 const original=await read();
 await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`subscription-cash:${original.namespaceKey}`}))`);
 await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`merchant-fee-invocation:${original.paymentId}`}))`);
 const current=await read();if(current.digest!==original.digest||current.namespaceKey!==original.namespaceKey)refuse();return current;
}
