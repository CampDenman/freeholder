// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED / UNRUN. Real Ed25519 proofs, no database/provider authority is mocked.
import { randomUUID } from "node:crypto";
import { describe,expect,it } from "vitest";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { merchantPhysicalCaller } from "@/modules/invoicing/merchant-physical-caller";
import { CONTROLLED_CALL_PURPOSE,originalControlledCall,finishedControlledCall,stoppedControlledCall } from "@/modules/subscriptions/controlled-provider-proof";
import { signProviderReadProof } from "@/modules/subscriptions/provider-read-signatures";
import type { subscriptionControlledOperations,subscriptionControlledCalls,subscriptionControlledFinishes,subscriptionControlledStops } from "@/modules/subscriptions/controlled-provider-schema";
function original(){
 const caller=merchantPhysicalCaller(),request={scopeDigest:"a".repeat(64),payload:{},parentFinancialRevision:"b".repeat(64)};
 const operation={id:randomUUID(),resourceId:randomUUID(),kind:"bootstrap",ordinal:1,originalRequest:request,requestDigest:merchantTaxDigest(request),idempotencyKey:"original-controlled-proof",previousEvidenceRevision:"c".repeat(64),acceptedQuoteDigest:"d".repeat(64),createdAt:new Date()} satisfies typeof subscriptionControlledOperations.$inferSelect;
 const id=randomUUID(),admission=signProviderReadProof("admission",{purpose:CONTROLLED_CALL_PURPOSE,operationId:operation.id,resourceId:operation.resourceId,kind:operation.kind,callId:id,requestDigest:operation.requestDigest,callerId:caller.id,caller,completionDigest:"e".repeat(64),admittedSourceRevision:operation.previousEvidenceRevision});
 const call={id,operationId:operation.id,admission,admissionDigest:merchantTaxDigest(admission),createdAt:new Date()} satisfies typeof subscriptionControlledCalls.$inferSelect;
 return{operation,call};
}
function finish(source:ReturnType<typeof original>,patch:Record<string,unknown>={}){
 const{operation,call}=source,actualResult={outcome:"returned",result:{providerSubscriptionRef:"sub_actualOriginal"}},proof=signProviderReadProof("finish",{purpose:CONTROLLED_CALL_PURPOSE,operationId:operation.id,resourceId:operation.resourceId,callId:call.id,requestDigest:operation.requestDigest,admissionDigest:call.admissionDigest,callerId:call.admission.payload.callerId,completionDigest:call.admission.payload.completionDigest,outcome:actualResult.outcome,factsDigest:merchantTaxDigest(actualResult),...patch});
 return{callId:call.id,proof,proofDigest:merchantTaxDigest(proof),actualResult,createdAt:new Date()} satisfies typeof subscriptionControlledFinishes.$inferSelect;
}
function stop(source:ReturnType<typeof original>,patch:Record<string,unknown>={}){
 const{operation,call}=source,proof=signProviderReadProof("stop_review",{purpose:CONTROLLED_CALL_PURPOSE,operationId:operation.id,resourceId:operation.resourceId,callId:call.id,requestDigest:operation.requestDigest,callerId:call.admission.payload.callerId,admissionDigest:call.admissionDigest,originalAdmission:call.admission,reviewedBy:`user:${randomUUID()}`,mechanicalCheck:"original_process_absent",hostingEvidenceDigest:"f".repeat(64),currentEvidenceRevision:"0".repeat(64),...patch});
 return{callId:call.id,proof,proofDigest:merchantTaxDigest(proof),createdAt:new Date()} satisfies typeof subscriptionControlledStops.$inferSelect;
}
describe("exact original controlled physical caller proof",()=>{
 it("authenticates original operation, kind, actual process birth, immutable request and call identity",()=>{
  const source=original();expect(originalControlledCall(source.operation,source.call)).not.toBeNull();
  expect(originalControlledCall({...source.operation,id:randomUUID()},source.call)).toBeNull();expect(originalControlledCall({...source.operation,kind:"pause_drafts"},source.call)).toBeNull();
  expect(originalControlledCall({...source.operation,originalRequest:{...source.operation.originalRequest,payload:{replaced:true}}},source.call)).toBeNull();
 });
 it("accepts only the real signed original returned/thrown result, refusing another nonce, request or altered bank value",()=>{
  const source=original(),actual=finish(source);expect(finishedControlledCall(source.operation,source.call,actual)).toBe(true);
  expect(finishedControlledCall(source.operation,source.call,{...actual,actualResult:{outcome:"returned",result:{providerSubscriptionRef:"sub_replacement"}}})).toBe(false);
  for(const patch of[{completionDigest:"0".repeat(64)},{requestDigest:"0".repeat(64)},{callerId:randomUUID()},{resourceId:randomUUID()}])expect(finishedControlledCall(source.operation,source.call,finish(source,patch))).toBe(false);
 });
 it("retains an independent signed stop without converting it into a returned bank finish",()=>{
  const source=original(),actual=stop(source);expect(stoppedControlledCall(source.operation,source.call,actual)).toBe(true);
  expect(finishedControlledCall(source.operation,source.call,{...actual,actualResult:{outcome:"returned"}})).toBe(false);
 });
 it("refuses agent/key-shaped review, substituted original admission and tampered stop proof",()=>{
  const source=original();for(const patch of[{reviewedBy:"agent:review"},{originalAdmission:{}},{callId:randomUUID()},{callerId:randomUUID()}])expect(stoppedControlledCall(source.operation,source.call,stop(source,patch))).toBe(false);
  expect(stoppedControlledCall(source.operation,source.call,{...stop(source),proofDigest:"0".repeat(64)})).toBe(false);
 });
 it("does not let any genuinely completed successor discharge an earlier actual outstanding caller",()=>{
  const first=original(),later=original();expect(finishedControlledCall(later.operation,later.call,finish(later))).toBe(true);
  expect(finishedControlledCall(first.operation,first.call,finish(later))).toBe(false);expect(stoppedControlledCall(first.operation,first.call,stop(later))).toBe(false);
 });
});
