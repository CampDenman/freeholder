// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: genuine original runtime stop, distinct from a bank outcome or actual finish.
import { eq,sql } from "drizzle-orm";
import { z } from "zod";
import { actorString,defineService,ServiceError } from "@/core/service";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { merchantCallerLiveness,merchantPhysicalCaller } from "@/modules/invoicing/merchant-physical-caller";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptionControlledCalls,subscriptionControlledOperations,subscriptionControlledResources,subscriptionControlledStops } from "./controlled-provider-schema";
import { controlledCaller,controlledProviderJournal,originalControlledCall,stoppedControlledCall,CONTROLLED_CALL_PURPOSE } from "./controlled-provider-proof";
import { requireControlledProviderSchema } from "./controlled-provider-source";
import { providerReaderStopVerdict,signProviderReadProof } from "./provider-read-signatures";
export const CONTROLLED_PROVIDER_STOP_CONFIRMATION="ORIGINAL CONTROLLED PROVIDER RUNTIME STOP VERIFIED";
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const recoveryRow=z.object({resourceId:z.uuid(),operationId:z.uuid(),callId:z.uuid(),kind:z.string(),callerId:z.uuid(),admissionDigest:sha,currentEvidenceRevision:sha,
 liveness:z.enum(["live","absent","unobservable"]),reviewed:z.boolean()});
export const controlledProviderRecoveryPlan=defineService({name:"invoicing.controlledProviderRecoveryPlan",summary:"Review every actual original controlled provider caller, including resources that have no invoice or canonical cash receipt yet.",
 kind:"query",permission:"scoped",input:z.object({subscriptionId:z.uuid()}),output:z.array(recoveryRow).max(5000),handler:async({subscriptionId},ctx)=>{
  await requireControlledProviderSchema(ctx);
  const resources=await ctx.tx.select().from(subscriptionControlledResources).where(eq(subscriptionControlledResources.subscriptionId,subscriptionId)).orderBy(subscriptionControlledResources.generation).limit(5001);
  if(resources.length>5000)throw new ServiceError("conflict","Restore the complete bounded original controlled generation inventory.");
  const rows:Array<z.infer<typeof recoveryRow>>=[];let count=0;
  for(const resource of resources){const history=await controlledProviderJournal(ctx.tx,resource.id);count+=history.count;if(count>5000)throw new ServiceError("conflict","The complete original controlled recovery history exceeds its aggregate bound; no caller can be omitted.");
   for(const call of history.calls){if(history.finishes.some(row=>row.callId===call.id))continue;
    const operation=history.operations.find(row=>row.id===call.operationId),proof=operation?originalControlledCall(operation,call):null;
    if(!operation||!proof)throw new ServiceError("conflict","Restore the exact original signed caller and immutable request before runtime review.");
    const caller=controlledCaller.parse(proof.payload.caller),stop=history.stops.find(row=>row.callId===call.id)??null;
    rows.push({resourceId:resource.id,operationId:operation.id,callId:call.id,kind:operation.kind,callerId:caller.id,admissionDigest:call.admissionDigest,currentEvidenceRevision:history.revision,
     liveness:caller.id===merchantPhysicalCaller().id?"live":merchantCallerLiveness(caller),reviewed:stoppedControlledCall(operation,call,stop)});
   }
  }return rows;
 }});
export const reviewControlledProviderCallerStopped=defineService({name:"invoicing.reviewControlledProviderCallerStopped",summary:"Freshly review an actual original controlled provider runtime stop; no successor, API key or agent can fabricate its finish or bank outcome.",
 kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,writeClass:"money",auditInputFields:["resourceId","operationId","callId","expectedCallerId","expectedAdmissionDigest","expectedSourceRevision"],
 input:z.object({resourceId:z.uuid(),operationId:z.uuid(),callId:z.uuid(),expectedCallerId:z.uuid(),expectedAdmissionDigest:sha,expectedSourceRevision:sha,
  hostingEvidence:z.string().trim().min(30).max(2000),stoppedRuntimeReference:z.string().trim().min(8).max(300).optional(),stoppedRuntimeAt:z.iso.datetime().optional(),confirmation:z.literal(CONTROLLED_PROVIDER_STOP_CONFIRMATION)}).strict(),
 output:z.object({reviewed:z.literal(true),mechanicalCheck:z.enum(["original_process_absent","unobservable_host_review"])}),handler:async(input,ctx)=>{
  if(ctx.actor.kind!=="user"||ctx.actor.keyScopes)throw new ServiceError("permission","A freshly verified signed-in person must review actual hosting evidence for this exact original process birth.");
  await lockContactIdentityForRead(ctx.tx);await requireControlledProviderSchema(ctx);
  await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`controlled-provider:${input.resourceId}`}))`);
  const[resource]=await ctx.tx.select().from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,input.resourceId)).limit(1).for("update");
  const[operation]=await ctx.tx.select().from(subscriptionControlledOperations).where(eq(subscriptionControlledOperations.id,input.operationId)).limit(1);
  const[call]=await ctx.tx.select().from(subscriptionControlledCalls).where(eq(subscriptionControlledCalls.id,input.callId)).limit(1);
  const proof=operation&&call?originalControlledCall(operation,call):null;
  if(!resource||!operation||!call||!proof||operation.resourceId!==resource.id||call.operationId!==operation.id)throw new ServiceError("conflict","Restore the exact original controlled generation, operation and signed caller admission.");
  const history=await controlledProviderJournal(ctx.tx,resource.id),prior=history.stops.find(row=>row.callId===call.id),caller=controlledCaller.parse(proof.payload.caller);
  if(prior){if(!stoppedControlledCall(operation,call,prior)||prior.proof.payload.currentEvidenceRevision!==input.expectedSourceRevision||call.admissionDigest!==input.expectedAdmissionDigest||caller.id!==input.expectedCallerId)
    throw new ServiceError("conflict","Preserve the first genuine independent runtime stop and its exact reviewed source.");
   return{reviewed:true as const,mechanicalCheck:z.enum(["original_process_absent","unobservable_host_review"]).parse(prior.proof.payload.mechanicalCheck)};
  }
  const liveness=caller.id===merchantPhysicalCaller().id?"live" as const:merchantCallerLiveness(caller);
  const verdict=providerReaderStopVerdict({...input,actualAdmissionDigest:call.admissionDigest,actualSourceRevision:history.revision,actualCallerId:caller.id,
   finished:history.finishes.some(row=>row.callId===call.id),liveness,runtimeEvidence:!!input.stoppedRuntimeReference&&!!input.stoppedRuntimeAt&&Date.parse(input.stoppedRuntimeAt)<=Date.now()});
  if(verdict==="live")throw new ServiceError("conflict","The exact original runtime birth remains live. Actually finish or stop it before approving its stop.");
  if(verdict==="changed_or_finished")throw new ServiceError("conflict","The actual original caller or evidence changed or finished. Reload its current exact review.");
  if(verdict==="missing_runtime_evidence")throw new ServiceError("conflict","Supply the actual stopped runtime reference and time from hosting evidence for this unobservable original birth.");
  if(history.count>=5000)throw new ServiceError("conflict","Restore the bounded complete controlled stop inventory; a reviewed caller cannot be hidden by truncation.");
  const stopped=signProviderReadProof("stop_review",{purpose:CONTROLLED_CALL_PURPOSE,callId:call.id,operationId:operation.id,resourceId:resource.id,requestDigest:operation.requestDigest,
   callerId:caller.id,admissionDigest:call.admissionDigest,originalAdmission:call.admission,currentEvidenceRevision:history.revision,reviewedBy:actorString(ctx.actor),mechanicalCheck:verdict,
   reviewedAt:new Date().toISOString(),reviewerRuntime:merchantPhysicalCaller(),hostingEvidenceDigest:merchantTaxDigest({hostingEvidence:input.hostingEvidence,stoppedRuntimeReference:input.stoppedRuntimeReference??null,stoppedRuntimeAt:input.stoppedRuntimeAt??null,originalCaller:caller})});
  await ctx.tx.execute(sql`select set_config('freeholder.controlled_provider_v1','1',true)`);
  await ctx.tx.insert(subscriptionControlledStops).values({callId:call.id,proof:stopped,proofDigest:merchantTaxDigest(stopped)});
  ctx.setSubject("subscription",resource.subscriptionId);return{reviewed:true as const,mechanicalCheck:verdict};
 }});
export default[controlledProviderRecoveryPlan,reviewControlledProviderCallerStopped];

export const controlledProviderResourceStatus=defineService({name:"invoicing.controlledProviderResourceStatus",summary:"Read the exact original controlled generations and outstanding actual callers without exposing bank method/customer or hosting evidence.",kind:"query",permission:"scoped",
 input:z.object({subscriptionId:z.uuid()}),output:z.array(z.object({resourceId:z.uuid(),generation:z.number().int().positive(),closed:z.boolean(),unfinishedCallers:z.number().int().nonnegative(),zeroTransport:z.boolean()})).max(5000),handler:async({subscriptionId},ctx)=>{
  await requireControlledProviderSchema(ctx);const resources=await ctx.tx.select().from(subscriptionControlledResources).where(eq(subscriptionControlledResources.subscriptionId,subscriptionId)).orderBy(subscriptionControlledResources.generation).limit(5001);
  let count=0;const rows=[];for(const resource of resources){const history=await controlledProviderJournal(ctx.tx,resource.id);count+=history.count;if(count>5000)throw new ServiceError("conflict","Restore every original controlled generation within the complete aggregate bound.");
   rows.push({resourceId:resource.id,generation:resource.generation,closed:history.closures.length>0,unfinishedCallers:history.unfinished.length,zeroTransport:history.operations.every(row=>!["update_calendar","pay_invoice","finalize_invoice","create_schedule"].includes(row.kind))});
  }return rows;
 }});
