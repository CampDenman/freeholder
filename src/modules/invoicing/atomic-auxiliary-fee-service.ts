// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: short genuine owner phases; actual bank I/O stays outside this TX.
import {randomUUID} from "node:crypto";
import {sql} from "drizzle-orm";
import {z} from "zod";
import {defineService,ServiceError,type ServiceContext} from "@/core/service";
import {originalCashRecoveryCashWitness} from "./original-cash-recovery-store";
import {appendOriginalCashFact,admitOriginalCashOperation,auxiliaryFactsResolved} from "./original-cash-recovery-service";
import {merchantCashAuxiliaryBody} from "@/adapters/payments/stripe-cash-auxiliary";
import {atomicAuxiliaryFeeBasis} from "./atomic-auxiliary-fee-target";
import {ATOMIC_AUXILIARY_FEE_CLOSURE,atomicAuxiliaryFeeTarget,atomicAuxiliaryFeeClosure} from "./atomic-auxiliary-fee-contract";
import {controlledAtomicRefundFeeState} from "./controlled-atomic-refund-target";
import {merchantTaxDigest} from "./merchant-tax-store";
const selection=z.object({recoveryId:z.uuid(),operationId:z.uuid(),requestedBy:z.string().min(1)}).strict();
const selectedTarget=selection.extend({targetFactId:z.uuid()});
const claimInput=z.discriminatedUnion("phase",[selectedTarget.extend({phase:z.literal("admit")}),selectedTarget.extend({phase:z.literal("before_post"),actualOperationId:z.uuid(),nonce:z.string().min(40)})]);
async function ready(ctx:ServiceContext){
 const[installed]=await ctx.tx.execute<{present:boolean}>(sql`select to_regprocedure('freeholder_atomic_auxiliary_fee_ready()') is not null as present`);
 if(!installed?.present)throw new ServiceError("conflict","Install the complete authenticated same-owner atomic fee journal protocol before another operation.");
 const[valid]=await ctx.tx.execute<{ready:boolean}>(sql`select freeholder_atomic_auxiliary_fee_ready() as ready`);if(valid?.ready!==true)throw new ServiceError("conflict","Restore every exact atomic fee lifecycle guard, index and original bank prerequisite.");
}
export const retainAtomicAuxiliaryFeeTarget=defineService({name:"invoicing.retainAtomicAuxiliaryFeeTarget",summary:"Freeze an exact fee-only atomic target in its genuine existing original auxiliary owner, without a customer or recipient waiver.",kind:"mutation",permission:"system",external:false,writeClass:"money",input:selection,output:z.object({targetFactId:z.uuid().nullable(),pendingTargetFactIds:z.array(z.uuid()).max(5000)}),handler:async(input,ctx)=>{
 await ready(ctx);const basis=await atomicAuxiliaryFeeBasis(ctx,input);ctx.setSubject("payment",basis.union.binding.payment.id);
 const witness=await originalCashRecoveryCashWitness(ctx.tx,basis.current.cash),existing=witness.facts.filter(row=>row.kind==="atomic_fee_target"&&row.evidence.targetKey===basis.targetKey);
 const pendingTargetFactIds=existing.filter(row=>!witness.facts.some(closure=>closure.kind==="atomic_fee_closure"&&closure.evidence.targetFactId===row.id)).map(row=>row.id);
 if(!basis.body)return{targetFactId:null,pendingTargetFactIds};
 if(existing.length>1)throw new ServiceError("conflict","Preserve conflicting original atomic fee target ownership for review.");
 if(existing[0]){const target=atomicAuxiliaryFeeTarget.parse(existing[0].evidence);if(target.paymentId!==basis.body.paymentId||target.economicRevision!==basis.body.economicRevision)throw new ServiceError("conflict","Restore this exact original economic target.");return{targetFactId:existing[0].id,pendingTargetFactIds};}
 if(basis.locked.coverage.entries.length+1>5000)throw new ServiceError("conflict","The complete original financial inventory cannot admit another declaration within its bound.");
 const id=randomUUID();await appendOriginalCashFact(ctx,input.recoveryId,null,"atomic_fee_target",basis.body,id);return{targetFactId:id,pendingTargetFactIds:[id]};
}});
export const claimAtomicAuxiliaryFeeReturn=defineService({name:"invoicing.claimAtomicAuxiliaryFeeReturn",summary:"Admit only one actual original fee return against a retained atomic target under the same existing owner and full current locks.",kind:"mutation",permission:"system",external:false,writeClass:"money",auditInputFields:["recoveryId","operationId","targetFactId","phase","actualOperationId"],input:claimInput,output:z.object({recoveryId:z.uuid(),operationId:z.uuid(),nonce:z.string(),request:z.record(z.string(),z.unknown())}).nullable(),handler:async(input,ctx)=>{
 await ready(ctx);if(input.phase==="before_post"){const{assertAtomicAuxiliaryFeeBeforePost}=await import("./atomic-auxiliary-fee-before-post");await assertAtomicAuxiliaryFeeBeforePost(ctx,input);return null;}
 const basis=await atomicAuxiliaryFeeBasis(ctx,input),witness=await originalCashRecoveryCashWitness(ctx.tx,basis.current.cash);ctx.setSubject("payment",basis.union.binding.payment.id);
 const fact=witness.facts.find(row=>row.id===input.targetFactId&&row.kind==="atomic_fee_target");if(!fact)throw new ServiceError("conflict","Restore this exact retained atomic fee target.");const frozen=atomicAuxiliaryFeeTarget.parse(fact.evidence);
 if(!frozen||!basis.body||frozen.targetKey!==basis.targetKey||frozen.economicRevision!==basis.economicRevision||frozen.priorReturnedMinor!==basis.union.returnedMinor||frozen.amountMinor!==basis.amountMinor||!auxiliaryFactsResolved(witness))throw new ServiceError("conflict","Refresh the actual complete original bank inventory and same atomic target; old or unknown calls cannot add another generation.");
 const prior=witness.operations.filter(row=>row.kind==="fee"&&row.request.targetFactId===fact.id);if(prior.length>1)throw new ServiceError("conflict","Restore the lifetime unique original atomic fee caller.");if(prior.length)return null;
 if(basis.locked.coverage.entries.length+1>5000)throw new ServiceError("conflict","The complete original financial inventory cannot admit another actual caller within its bound.");
 const id=randomUUID();return admitOriginalCashOperation(ctx,input.recoveryId,"fee",{kind:"fee",operationId:id,targetFactId:fact.id,atomicFeeProtocol:"freeholder.original-cash-atomic-fee-operation.v1",admissionInventoryOperationId:input.operationId,providerPlatformAccountId:frozen.platform,providerApiVersion:basis.current.cash.providerApiVersion,
  originalChargeRef:frozen.chargeRef,originalAccountId:frozen.account,parentRef:frozen.feeRef,originalAmountMinor:frozen.originalFeeMinor,alreadyReturnedMinor:frozen.priorReturnedMinor,amountMinor:frozen.amountMinor,currency:frozen.currency,
  idempotencyKey:`original-cash-atomic-fee:${fact.id}`,frozenBody:merchantCashAuxiliaryBody(id,frozen.amountMinor)},id);
}});
export const finalizeAtomicAuxiliaryFeeReturn=defineService({name:"invoicing.finalizeAtomicAuxiliaryFeeReturn",summary:"Retain only exact actual accepted fee return plus fresh current bank closure; original principal and recipient duties remain separate.",kind:"mutation",permission:"system",external:false,writeClass:"money",input:selectedTarget,output:z.object({closureFactId:z.uuid()}),handler:async(input,ctx)=>{
 await ready(ctx);const basis=await atomicAuxiliaryFeeBasis(ctx,input),witness=await originalCashRecoveryCashWitness(ctx.tx,basis.current.cash),fact=witness.facts.find(row=>row.id===input.targetFactId&&row.kind==="atomic_fee_target");
 ctx.setSubject("payment",basis.union.binding.payment.id);
 const frozen=fact?atomicAuxiliaryFeeTarget.parse(fact.evidence):null,state=await controlledAtomicRefundFeeState(ctx,basis.union.binding.payment.id);
 if(!frozen||frozen.targetKey!==basis.targetKey||frozen.economicRevision!==basis.economicRevision||basis.amountMinor!==0||!state||state.pending||!auxiliaryFactsResolved(witness)||state.proof.targetRetainedFeeMinor!==frozen.targetRetainedFeeMinor||state.proof.acceptedReturnedFeeMinor!==basis.union.returnedMinor)throw new ServiceError("conflict","Keep fee debt until genuine accepted resource/FIN and latest returned bank agree with this exact target.");
 const body=atomicAuxiliaryFeeClosure.parse({protocol:ATOMIC_AUXILIARY_FEE_CLOSURE,targetFactId:input.targetFactId,targetKey:frozen.targetKey,recoveryId:input.recoveryId,paymentId:frozen.paymentId,receiptId:frozen.receiptId,originalInventoryOperationId:input.operationId,
  bankInspectionId:state.proof.inspectionId,bankObservationId:state.proof.bankObservationId,targetRetainedFeeMinor:frozen.targetRetainedFeeMinor,acceptedReturnedMinor:basis.union.returnedMinor,revision:merchantTaxDigest({basisRevision:basis.locked.coverage.revision,unionRevision:basis.union.revision,proof:state.proof})});
 const existing=witness.facts.find(row=>row.kind==="atomic_fee_closure"&&row.evidence.targetFactId===input.targetFactId&&row.evidence.revision===body.revision);if(existing)return{closureFactId:existing.id};
 if(basis.locked.coverage.entries.length+1>5000)throw new ServiceError("conflict","The complete original financial inventory cannot admit another declaration within its bound.");
 const id=randomUUID();await appendOriginalCashFact(ctx,input.recoveryId,null,"atomic_fee_closure",body,id);return{closureFactId:id};
}});
export default[retainAtomicAuxiliaryFeeTarget,claimAtomicAuxiliaryFeeReturn,finalizeAtomicAuxiliaryFeeReturn];
