// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: actual wrapper-only results; raw ACKs commit before this proof.
import {eq,sql} from "drizzle-orm";
import {z} from "zod";
import {defineService,ServiceError} from "@/core/service";
import {merchantPaymentEvidence} from "./merchant-payment-observations";
import {merchantFeeRefundInvocations} from "./merchant-fee-invocation-schema";
import {lockControlledAtomicRefundEvidence,lockControlledAtomicRefundTarget} from "./controlled-atomic-refund-target";
import {merchantFeeInvocationClaim,merchantFeePreflightResult,type MerchantFeeInvocationClaim} from "./merchant-fee-invocation-contract";
import {admitMerchantFeeInvocation,merchantFeeInvocationHolder,merchantFeeInvocationReceiptOrigin} from "./merchant-fee-invocation-store";
import {signMerchantFeeInvocationProof,verifiedMerchantFeePreflight} from "./merchant-fee-invocation-proof";
import {originalCashEvidenceKeys,originalCashSigningKey} from "./original-cash-recovery-store";
const feeResult=z.object({providerRef:z.string().regex(/^fr_[A-Za-z0-9]+$/),applicationFeeRef:z.string().regex(/^fee_[A-Za-z0-9]+$/),amountMinor:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),currency:z.string().regex(/^[A-Z]{3}$/),bindingVerified:z.boolean().optional()});
type Holder={claim:MerchantFeeInvocationClaim;nonce:string;running:boolean;hasRun:boolean;preflightUsed?:boolean;preflightCompleted?:boolean;postReleased?:boolean;firstResult?:unknown;outcome?:"returned"|"threw";returnedResult?:unknown;finishedAt?:string};
const slot=Symbol.for("freeholder.merchant.fee-invocations.v1"),processState=globalThis as typeof globalThis&{[slot]?:Map<string,Holder>};
const held=processState[slot]??=new Map<string,Holder>();
const failure=()=>new ServiceError("permission","Only the actual original fee caller may retain its held result or finish. A process stop, public metadata or another call cannot manufacture it.");
const actualResult=(claim:MerchantFeeInvocationClaim,value:unknown)=>value===null&&claim.kind==="recover_get"?null:claim.kind==="source_inspect"?claim.sourceReadKind==="fee_preflight"?merchantFeePreflightResult(value):merchantPaymentEvidence.parse(value):feeResult.parse(value);
export const assertMerchantFeeInvocation=defineService({name:"invoicing.assertMerchantFeeInvocation",summary:"Refuse a foreign, finished, stopped or repeated original fee caller before any actual SDK call.",kind:"query",permission:"system",external:false,
 input:merchantFeeInvocationClaim,output:z.literal(true),handler:async(input,ctx)=>{
  // Prefix precedes the invocation latch. This is execution of the actual
  // already admitted caller, not a bank-proof or money-safety read exemption.
  const context=await lockControlledAtomicRefundEvidence(ctx,input.paymentId);
  const row=await merchantFeeInvocationHolder(ctx,input);
  const parentLocal=row.request.readKind==="fee_preflight"&&typeof row.request.parentFeeInvocationId==="string"?held.get(row.request.parentFeeInvocationId):null;
  let parentId:string|null=null;
  if(parentLocal){
   if(!parentLocal.running||!parentLocal.preflightUsed||parentLocal.preflightCompleted||parentLocal.firstResult!==undefined||parentLocal.postReleased)throw failure();
   const parent=await merchantFeeInvocationHolder(ctx,parentLocal.claim);
   const[birth]=await ctx.tx.execute<{fingerprint:string}>(sql`select encode(sha256(convert_to((to_jsonb(actual_parent)||jsonb_build_object('first_result',null,'finish',null,'stop',null))::text,'UTF8')),'hex') as fingerprint from merchant_fee_refund_invocations actual_parent where actual_parent.id=${parent.id}::uuid`);
   if(!birth||!verifiedMerchantFeePreflight(row,parent,originalCashEvidenceKeys(),birth.fingerprint))throw failure();parentId=parent.id;
  }else if(row.request.readKind==="fee_preflight")throw failure();
  if(!context||context.coverage.unfinishedCallers.some(caller=>caller.kind!=="fee_invocation"||caller.id!==row.id&&caller.id!==parentId))throw failure();
  if(row.kind==="post"){
   await ctx.tx.execute(sql`select set_config('freeholder.merchant_fee_invocation_nonce',${input.nonce},true)`);
   if(!row.feeOperationId)throw failure();
   await lockControlledAtomicRefundTarget(ctx,input.paymentId);
   const[current]=await ctx.tx.execute<{ready:boolean}>(sql`select freeholder_merchant_fee_source_ready(${row.feeOperationId}::uuid,${row.id}::uuid) as ready`);if(current?.ready!==true)throw failure();
  }
  return true as const;
 }});
export const prepareMerchantFeePreflight=defineService({name:"invoicing.prepareMerchantFeePreflight",summary:"Admit one actual child fee-resource GET under only its real running original unstarted POST or recovery holder.",kind:"mutation",permission:"system",external:false,writeClass:"money",
 input:merchantFeeInvocationClaim,output:merchantFeeInvocationClaim,handler:async(input,ctx)=>{
  const parent=held.get(input.invocationId);if(!parent||parent.nonce!==input.nonce||!parent.running||!parent.preflightUsed||parent.preflightCompleted||parent.postReleased||parent.firstResult!==undefined||!["post","recover_get"].includes(input.kind))throw failure();
  return admitMerchantFeeInvocation(ctx,{paymentId:input.paymentId,feeOperationId:null,kind:"source_inspect",parentFeeInvocation:input});
 }});
export const assertMerchantFeePostPreflight=defineService({name:"invoicing.assertMerchantFeePostPreflight",summary:"Recheck the exact completed actual child fee read and full current graph immediately before this one original POST.",kind:"query",permission:"system",external:false,
 input:merchantFeeInvocationClaim,output:z.literal(true),handler:async(input,ctx)=>{
  const local=held.get(input.invocationId);if(!local||local.nonce!==input.nonce||input.kind!=="post"||!local.running||!local.preflightCompleted||local.postReleased||local.firstResult!==undefined)throw failure();
  await ctx.callAsSystem(assertMerchantFeeInvocation,input);
  const[actual]=await ctx.tx.execute<{ready:boolean}>(sql`select freeholder_merchant_fee_preflight_ready(${input.invocationId}::uuid) as ready`);if(actual?.ready!==true)throw failure();
  local.postReleased=true;return true as const;
 }});
export const persistMerchantFeeInvocation=defineService({name:"invoicing.persistMerchantFeeInvocation",summary:"Retain only the actual held first result or wrapper outcome of this exact original fee caller.",kind:"mutation",permission:"system",external:false,writeClass:"money",auditInputFields:["invocationId","feeOperationId","phase"],
 input:merchantFeeInvocationClaim.extend({phase:z.enum(["first_result","finish"])}),output:z.object({retained:z.literal(true)}),handler:async(input,ctx)=>{
  const local=held.get(input.invocationId);if(!local||local.nonce!==input.nonce)throw failure();
  const row=await merchantFeeInvocationHolder(ctx,input,true);
  const identity={invocationId:row.id,admissionDigest:row.digest,callerInstanceId:row.caller.id};
  await ctx.tx.execute(sql`select set_config('freeholder.merchant_fee_invocation_v1','1',true),set_config('freeholder.merchant_fee_invocation_nonce',${input.nonce},true)`);
  if(input.phase==="first_result"){
   if(local.firstResult===undefined)throw failure();
   const proof=signMerchantFeeInvocationProof(row,"first_result",{...identity,result:local.firstResult},originalCashSigningKey());
   if(row.firstResult){if(row.firstResult.digest!==proof.digest)throw failure();return{retained:true as const};}
   if(row.finish)throw failure();
   await ctx.tx.update(merchantFeeRefundInvocations).set({firstResult:proof}).where(eq(merchantFeeRefundInvocations.id,row.id));
  }else{
   if(!local.hasRun||!local.outcome||!local.finishedAt)throw failure();
   const proof=signMerchantFeeInvocationProof(row,"finish",{...identity,outcome:local.outcome,firstResultDigest:row.firstResult?.digest??null,returnedResult:local.returnedResult??null,postDispatchReleased:row.kind==="post"?local.postReleased===true:null,finishedAt:local.finishedAt},originalCashSigningKey());
   if(row.finish){if(row.finish.digest!==proof.digest)throw failure();return{retained:true as const};}
   await ctx.tx.update(merchantFeeRefundInvocations).set({finish:proof}).where(eq(merchantFeeRefundInvocations.id,row.id));
  }
  ctx.setSubject("payment",row.paymentId);return{retained:true as const};
 }});
export const recordMerchantFeeInvocationObservation=defineService({name:"invoicing.recordMerchantFeeInvocationObservation",summary:"Retain an actual original SDK callback through its immutable admission under identity/cash/caller fences before later projection.",kind:"mutation",permission:"system",external:false,writeClass:"money",auditInputFields:["invocation"],
 input:z.object({invocation:merchantFeeInvocationClaim,paymentEvidence:merchantPaymentEvidence.optional(),feeObservation:feeResult.optional()}).strict(),output:z.object({legacyRecorded:z.boolean()}),handler:async(input,ctx)=>{
  const original=await merchantFeeInvocationReceiptOrigin(ctx,input.invocation);
  if(original.kind==="source_inspect"&&original.request.readKind==="payment_source"){
   if(!input.paymentEvidence||input.feeObservation)throw failure();
   const{recordMerchantPaymentObservation,merchantObservationRef}=await import("./merchant-payment-observations");
   const actual=await ctx.callAsSystem(recordMerchantPaymentObservation,{paymentId:original.paymentId,providerEventRef:merchantObservationRef(input.paymentEvidence),evidence:input.paymentEvidence});return{legacyRecorded:actual.recorded};
  }
  if(!["post","recover_get"].includes(original.kind)||!original.feeOperationId||input.paymentEvidence||!input.feeObservation)throw failure();
  const{recordMerchantFeeObservation}=await import("./merchant-fee-service");
  await ctx.callAsSystem(recordMerchantFeeObservation,{operationId:original.feeOperationId,observation:{...input.feeObservation,bindingVerified:input.feeObservation.bindingVerified===true}});return{legacyRecorded:true};
 }});

/** Real call wrapper. The caller's SDK callback must commit raw provider facts
 * FIRST, then pass its actual observation to retain(). A late refused proof
 * therefore cannot erase physical money already stored in the old raw table. */
export async function performMerchantFeeInvocation<T>(claim:MerchantFeeInvocationClaim,work:(retain:(value:unknown)=>Promise<void>)=>Promise<T>):Promise<T>{
 const previous=held.get(claim.invocationId);if(previous?.hasRun||previous?.running)throw failure();
 const local:Holder={claim,nonce:claim.nonce,running:true,hasRun:true};held.set(claim.invocationId,local);
 const retain=async(value:unknown)=>{const actual=actualResult(claim,value);if(local.firstResult===undefined)local.firstResult=actual;await persistMerchantFeeInvocation.call({...claim,phase:"first_result"},{kind:"system"});};
 try{await assertMerchantFeeInvocation.call(claim,{kind:"system"});const result=await work(retain);local.returnedResult=actualResult(claim,result);local.outcome="returned";return result;}
 catch(error){local.outcome="threw";throw error;}
 finally{
  local.running=false;local.finishedAt=new Date().toISOString();
  if(local.firstResult!==undefined)await persistMerchantFeeInvocation.call({...claim,phase:"first_result"},{kind:"system"});
  await persistMerchantFeeInvocation.call({...claim,phase:"finish"},{kind:"system"});held.delete(claim.invocationId);
 }
}
/** Called only by the genuine SDK's preparation thunk, never a shared DTO.
 * Child admission commits BEFORE GET; its actual first response and FIN commit
 * BEFORE the SDK classifies counters or can reach the original POST. */
export async function performMerchantFeePreflight(parent:MerchantFeeInvocationClaim,read:()=>Promise<Record<string,unknown>>){
 const local=held.get(parent.invocationId);if(!local||local.nonce!==parent.nonce||!local.running||local.preflightUsed||local.postReleased)throw failure();local.preflightUsed=true;
 const child=await prepareMerchantFeePreflight.call(parent,{kind:"system"});
 const actual=await performMerchantFeeInvocation(child,async retain=>{const response=await read();await retain(response);return response;});
 local.preflightCompleted=true;return actual;
}
/** Orchestrator-only: retry persistence of outcomes ACTUALLY held by the same
 * original process. Never perform provider I/O or call this inside a TX. */
export async function flushMerchantFeeInvocationFinishes(paymentId:string){
 for(const[id,local]of held){
  if(local.claim.paymentId!==paymentId||local.running||!local.outcome)continue;
  if(local.firstResult!==undefined)await persistMerchantFeeInvocation.call({...local.claim,phase:"first_result"},{kind:"system"});
  await persistMerchantFeeInvocation.call({...local.claim,phase:"finish"},{kind:"system"});held.delete(id);
 }
}
export default [assertMerchantFeeInvocation,prepareMerchantFeePreflight,assertMerchantFeePostPreflight,persistMerchantFeeInvocation,recordMerchantFeeInvocationObservation];
