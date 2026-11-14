// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: authentic original caller proof; no proof is a bank/settlement grant.
import {z} from "zod";
import type {merchantFeeRefundInvocations,MerchantFeeInvocationProof} from "./merchant-fee-invocation-schema";
import {merchantTaxDigest} from "./merchant-tax-store";
import {signOriginalCashRecovery,verifyOriginalCashRecovery} from "./original-cash-recovery-proof";
type Invocation=typeof merchantFeeRefundInvocations.$inferSelect;
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const terminal=z.object({invocationId:z.uuid(),admissionDigest:sha,callerInstanceId:z.uuid(),outcome:z.enum(["returned","threw"]),firstResultDigest:sha.nullable(),returnedResult:z.unknown().nullable(),postDispatchReleased:z.boolean().nullable(),finishedAt:z.iso.datetime()}).strict();
const stopped=z.object({invocationId:z.uuid(),admissionDigest:sha,callerInstanceId:z.uuid(),admissionFingerprint:sha,mechanicalCheck:z.literal("absent"),reviewedBy:z.string().regex(/^user:[0-9a-f-]{36}$/),reviewRevision:sha,hostingEvidenceDigest:sha,reviewedAt:z.iso.datetime()}).strict();
export function merchantFeeInvocationBody(row:Omit<Invocation,"digest"|"authentication">){return{paymentId:row.paymentId,originalChargeReceiptId:row.originalChargeReceiptId,namespaceKey:row.namespaceKey,feeOperationId:row.feeOperationId,ordinal:row.ordinal,kind:row.kind,feeOperationFingerprint:row.feeOperationFingerprint,request:row.request,caller:row.caller,nonceHash:row.nonceHash};}
export function signMerchantFeeInvocation(row:Omit<Invocation,"digest"|"authentication">,key:string){const digest=merchantTaxDigest(merchantFeeInvocationBody(row));return{digest,authentication:signOriginalCashRecovery("merchant_fee_invocation.v1",{id:row.id,createdAt:row.createdAt,digest},key)};}
export function signMerchantFeeInvocationProof(row:Invocation,kind:"first_result"|"finish"|"stop",body:Record<string,unknown>,key:string):MerchantFeeInvocationProof{
 const digest=merchantTaxDigest(body);return{body,digest,authentication:signOriginalCashRecovery(`merchant_fee_invocation_${kind}.v1`,{id:row.id,createdAt:row.createdAt,digest},key)};
}
export function verifiedMerchantFeeInvocationAdmission(row:Invocation,keys:readonly string[]){
 if(!z.uuid().safeParse(row.paymentId).success||!z.uuid().safeParse(row.originalChargeReceiptId).success||!row.namespaceKey
  ||!z.enum(["source_inspect","post","recover_get"]).safeParse(row.kind).success||!Number.isSafeInteger(row.ordinal)||row.ordinal<1||row.ordinal>5000
  ||row.request.paymentId!==row.paymentId||row.request.originalChargeReceiptId!==row.originalChargeReceiptId
  ||row.namespaceKey!==`${row.request.providerPlatformAccountId}:${row.request.providerAccountId??""}:${row.request.providerRef}`
  ||(row.kind==="source_inspect"&&!z.enum(["payment_source","fee_preflight"]).safeParse(row.request.readKind).success)
  ||(row.kind==="source_inspect"?(row.feeOperationId!==null||row.feeOperationFingerprint!==null):(!z.uuid().safeParse(row.feeOperationId).success||!sha.safeParse(row.feeOperationFingerprint).success)))return false;
 return verifyOriginalCashRecovery("merchant_fee_invocation.v1",row,merchantFeeInvocationBody(row),keys);
}
export function verifiedMerchantFeeInvocation(row:Invocation,keys:readonly string[]){
 if(!verifiedMerchantFeeInvocationAdmission(row,keys)||row.finish&&row.stop)return false;
 for(const[kind,proof]of [["first_result",row.firstResult],["finish",row.finish],["stop",row.stop]] as const){
  if(!proof)continue;
  if(!verifyOriginalCashRecovery(`merchant_fee_invocation_${kind}.v1`,{id:row.id,createdAt:row.createdAt,digest:proof.digest,authentication:proof.authentication},proof.body,keys)
   ||proof.body.invocationId!==row.id||proof.body.admissionDigest!==row.digest||proof.body.callerInstanceId!==row.caller.id)return false;
 }
 if(row.finish){const body=terminal.safeParse(row.finish.body);if(!body.success||body.data.firstResultDigest!==(row.firstResult?.digest??null)||(row.kind==="post"?(body.data.postDispatchReleased===null||body.data.outcome==="returned"&&body.data.postDispatchReleased!==true):body.data.postDispatchReleased!==null))return false;}
 if(row.stop&&!stopped.safeParse(row.stop.body).success)return false;
 return true;
}
/** Closure means only this actual original local caller has ended. A thrown
 * finish or independent stop cannot supply a successful fee/bank result. */
export function merchantFeeInvocationCallerClosed(row:Invocation,keys:readonly string[]){return verifiedMerchantFeeInvocation(row,keys)&&Boolean(row.finish||row.stop);}
/** parentBirthFingerprint is the actual PostgreSQL parent row with ONLY its
 * known append-once first_result/finish/stop reconstructed to birth NULLs. It
 * is never equated to the separate canonical admission digest. */
export function verifiedMerchantFeePreflight(child:Invocation,parent:Invocation,keys:readonly string[],parentBirthFingerprint:string){
 return verifiedMerchantFeeInvocation(child,keys)&&verifiedMerchantFeeInvocation(parent,keys)&&child.kind==="source_inspect"&&child.request.readKind==="fee_preflight"
  &&["post","recover_get"].includes(parent.kind)&&child.paymentId===parent.paymentId&&child.originalChargeReceiptId===parent.originalChargeReceiptId&&child.namespaceKey===parent.namespaceKey
  &&child.ordinal>parent.ordinal&&child.nonceHash!==parent.nonceHash&&child.caller.id===parent.caller.id&&child.request.parentFeeInvocationId===parent.id
  &&child.request.parentAdmissionDigest===parent.digest&&child.request.parentAdmissionFingerprint===parentBirthFingerprint;
}
