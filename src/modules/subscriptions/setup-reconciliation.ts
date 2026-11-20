// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: human-confirmed operational evidence is distinct from provider I/O.
import {and,eq,gt,sql} from "drizzle-orm";
import {z} from "zod";
import {paymentAdapter} from "@/adapters/payments";
import {lockContactIdentity} from "@/core/contacts/identity-lock";
import {actorString,defineOrchestratedService,defineService,hasModuleAccess,ServiceError,type Actor,type Tx} from "@/core/service";
import {dispatchRequestHash} from "./setup-dispatch";
import {originalSetupRequest,setupRequest} from "./card-setup";
import {subscriptionCardSetups,subscriptionSetupDispatches} from "./schema";

const confirmation=z.object({
 dispatchId:z.uuid(),outcome:z.enum(["completed","cancelled"]),
 providerOperationRef:z.string().trim().min(8).max(300),
 providerEvidence:z.string().trim().min(20).max(2_000),
 callerStopEvidence:z.string().trim().min(20).max(2_000),
 confirmation:z.literal("PROVIDER OUTCOME CONFIRMED"),
 providerCustomerRef:z.string().min(1).max(500).optional(),
 providerRef:z.string().min(1).max(500).optional(),
});
function requireRecoveryManager(actor:Actor):void{
 if(actor.kind!=="user" || actor.keyScopes)throw new ServiceError("permission","Sign in as a person to record actual provider and stopped-caller evidence.");
 if(!hasModuleAccess(actor,"subscriptions","manage"))throw new ServiceError("permission","Managing card setup recovery requires permission to manage subscriptions.");
}
const state=z.enum(["running","unknown","succeeded","provider_completed","provider_cancelled"]);
const recordedEvidence=z.object({source:z.literal("human_provider_confirmation").optional(),providerOperationRef:z.string().optional(),providerEvidence:z.string().optional(),callerStopEvidence:z.string().optional()});
const result=z.object({dispatchId:z.uuid(),state,source:z.enum(["provider_response","human_provider_confirmation"])});
async function locked(ctx:{tx:Tx},id:string){
 const [found]=await ctx.tx.select({setupId:subscriptionSetupDispatches.setupId}).from(subscriptionSetupDispatches).where(eq(subscriptionSetupDispatches.id,id));
 if(!found)throw new ServiceError("not_found","This physical setup request is no longer available.");
 const [attempt]=await ctx.tx.select().from(subscriptionCardSetups).where(eq(subscriptionCardSetups.id,found.setupId)).for("update");
 const [dispatch]=await ctx.tx.select().from(subscriptionSetupDispatches).where(eq(subscriptionSetupDispatches.id,id)).for("update");
 if(!attempt || !dispatch)throw new ServiceError("not_found","This physical setup request is no longer available.");
 const request=setupRequest.parse({...originalSetupRequest(attempt),providerCustomerRef:dispatch.customerAtStart??undefined});
 if(dispatch.requestHash!==dispatchRequestHash(request))throw new ServiceError("conflict","The original physical provider request is inconsistent.");
 return {attempt,dispatch,request};
}

export const claimTrialSetupReconciliation=defineService({
 name:"subscriptions.claimTrialSetupReconciliation",auditInputFields:["dispatchId","outcome"],orchestratedBy:"subscriptions.reconcileTrialSetupDispatch",summary:"Read exact original inputs for a fresh human's provider-outcome reconciliation.",
 kind:"mutation",permission:"scoped",external:false,agentCallable:false,stepUp:true,writeClass:"money",
 input:confirmation,output:z.object({provider:z.string(),request:setupRequest,kind:z.enum(["customer","session"]),state,createdAt:z.string(),customerAtStart:z.string().nullable()}),
 handler:async(input,ctx)=>{
  requireRecoveryManager(ctx.actor);
  await lockContactIdentity(ctx.tx);
  const current=await locked(ctx,input.dispatchId);
  ctx.setSubject("subscription",current.attempt.subscriptionId);
  return {provider:current.attempt.provider,request:current.request,kind:current.dispatch.kind,state:current.dispatch.state,createdAt:current.attempt.createdAt.toISOString(),customerAtStart:current.dispatch.customerAtStart};
 },
});

export const applyTrialSetupReconciliation=defineService({
 name:"subscriptions.applyTrialSetupReconciliation",auditInputFields:["dispatchId","outcome"],orchestratedBy:"subscriptions.reconcileTrialSetupDispatch",summary:"Record exact human-confirmed final provider and stopped-caller evidence.",
 kind:"mutation",permission:"scoped",external:false,agentCallable:false,stepUp:true,writeClass:"money",
 input:confirmation.extend({requestHash:z.string().length(64),providerAccountId:z.string().optional(),providerPlatformAccountId:z.string().optional(),verifiedCustomerRef:z.string().optional(),verifiedProviderRef:z.string().optional()}),output:result,
 handler:async(input,ctx)=>{
  requireRecoveryManager(ctx.actor);
  await lockContactIdentity(ctx.tx);
  const {attempt,dispatch,request}=await locked(ctx,input.dispatchId);
  if(dispatch.requestHash!==input.requestHash)throw new ServiceError("conflict","The original request changed during provider reconciliation.");
  if(!["running","unknown"].includes(dispatch.state)){
   if((input.outcome==="cancelled")!==(dispatch.state==="provider_cancelled"))throw new ServiceError("conflict","This physical request already has another settled outcome.");
   return {dispatchId:dispatch.id,state:dispatch.state,source:dispatch.state==="succeeded"?"provider_response" as const:"human_provider_confirmation" as const};
  }
  if(input.outcome==="completed" && ((input.providerAccountId??"")!==attempt.providerAccountId || (input.providerPlatformAccountId??null)!==attempt.providerPlatformAccountId || !input.verifiedCustomerRef || (dispatch.kind==="session" && (!input.verifiedProviderRef || input.verifiedCustomerRef!==dispatch.customerAtStart))))throw new ServiceError("conflict","The completed resource was not verified on this dispatch's original account.");
  const resolved=input.outcome==="completed"?"provider_completed" as const:"provider_cancelled" as const;
  await ctx.tx.update(subscriptionSetupDispatches).set({state:resolved,finishedAt:sql`clock_timestamp()`,providerCustomerRef:input.outcome==="completed"?input.verifiedCustomerRef!:null,providerRef:input.outcome==="completed"?input.verifiedProviderRef??null:null,resolution:{source:"human_provider_confirmation",actor:actorString(ctx.actor),providerOperationRef:input.providerOperationRef,providerEvidence:input.providerEvidence,callerStopEvidence:input.callerStopEvidence,originalRequestHash:dispatch.requestHash,originalIdempotencyKey:request.idempotencyKey}}).where(eq(subscriptionSetupDispatches.id,dispatch.id));
  if(input.outcome==="completed"){
   // All actual references stay on their dispatch even if another caller
   // established a different canonical resource. Privacy cleans every one.
   if(!attempt.providerCustomerRef)await ctx.tx.update(subscriptionCardSetups).set({providerCustomerRef:input.verifiedCustomerRef!}).where(eq(subscriptionCardSetups.id,attempt.id));
   if(dispatch.kind==="session" && !attempt.providerCheckoutRef && (!attempt.providerCustomerRef || attempt.providerCustomerRef===input.verifiedCustomerRef))await ctx.tx.update(subscriptionCardSetups).set({providerCheckoutRef:input.verifiedProviderRef!}).where(eq(subscriptionCardSetups.id,attempt.id));
  }
  if(input.outcome==="cancelled" && !attempt.closedAt && !attempt.confirmedAt && !attempt.providerCheckoutRef && !attempt.providerSetupIntentRef){
   const all=await ctx.tx.select({kind:subscriptionSetupDispatches.kind,state:subscriptionSetupDispatches.state}).from(subscriptionSetupDispatches).where(eq(subscriptionSetupDispatches.setupId,attempt.id));
   if(!all.some(item=>item.state==="running"||item.state==="unknown"||(item.kind==="session"&&(item.state==="succeeded"||item.state==="provider_completed"))))await ctx.tx.update(subscriptionCardSetups).set({closedAt:sql`clock_timestamp()`,closedReason:"provider_cancelled"}).where(eq(subscriptionCardSetups.id,attempt.id));
  }
  ctx.setSubject("subscription",attempt.subscriptionId);
  return {dispatchId:dispatch.id,state:resolved,source:"human_provider_confirmation" as const};
 },
});

export const reconcileTrialSetupDispatch=defineOrchestratedService({
 name:"subscriptions.reconcileTrialSetupDispatch",auditInputFields:["dispatchId","outcome"],summary:"Record a human's exact final provider guarantee and stopped-caller evidence; unresolved work stays pending.",
 kind:"mutation",permission:"scoped",agentCallable:false,stepUp:true,writeClass:"money",input:confirmation,output:result,
 handler:async(input,actor)=>{
  requireRecoveryManager(actor);
  if(input.outcome==="cancelled" && (input.providerCustomerRef || input.providerRef))throw new ServiceError("validation","A guaranteed no-resource cancellation must leave resource fields empty.");
  const claimed=await claimTrialSetupReconciliation.call(input,actor);
  if(!["running","unknown"].includes(claimed.state))return applyTrialSetupReconciliation.call({...input,requestHash:dispatchRequestHash(claimed.request)},actor);
  let providerAccountId:string|undefined,providerPlatformAccountId:string|undefined,verifiedCustomerRef:string|undefined,verifiedProviderRef:string|undefined;
  if(input.outcome==="completed"){
   if(!input.providerCustomerRef || (claimed.kind==="session" && (!input.providerRef || input.providerCustomerRef!==claimed.customerAtStart)))throw new ServiceError("validation","Supply the exact completed resource from the original provider account.");
   const adapter=paymentAdapter(claimed.provider);
   if(adapter.id!==claimed.provider || !adapter.status.available || !adapter.recoverMethodSetup)throw new ServiceError("conflict","This provider cannot verify the original completed setup resource.");
   const recovered=await adapter.recoverMethodSetup({...claimed.request,providerCustomerRef:input.providerCustomerRef,providerRef:input.providerRef,createdAt:claimed.createdAt,verifyCustomerCreation:claimed.kind==="customer"});
   if(recovered.state==="unresolved" || recovered.providerCustomerRef!==input.providerCustomerRef || (recovered.providerAccountId??"")!==(claimed.request.providerAccountId??"") || recovered.providerPlatformAccountId!==claimed.request.providerPlatformAccountId || (claimed.kind==="session" && (recovered.state==="customer_only" || recovered.providerRef!==input.providerRef)))throw new ServiceError("conflict","The provider did not verify this exact original resource.");
   providerAccountId=recovered.providerAccountId;providerPlatformAccountId=recovered.providerPlatformAccountId;verifiedCustomerRef=recovered.providerCustomerRef;verifiedProviderRef=claimed.kind==="session"?recovered.providerRef:undefined;
  }
  return applyTrialSetupReconciliation.call({...input,requestHash:dispatchRequestHash(claimed.request),providerAccountId,providerPlatformAccountId,verifiedCustomerRef,verifiedProviderRef},actor);
 },
});

export const listTrialSetupDispatches=defineService({
 name:"subscriptions.listTrialSetupDispatches",summary:"Inspect the original account and physical request identities needed for human provider recovery.",kind:"query",permission:"scoped",agentCallable:false,stepUp:true,
 input:z.object({subscriptionId:z.uuid(),afterId:z.uuid().optional(),limit:z.number().int().min(1).max(100).default(50)}),output:z.object({rows:z.array(z.object({id:z.uuid(),attemptId:z.uuid(),kind:z.enum(["customer","session"]),state,provider:z.string(),providerAccountId:z.string(),idempotencyKey:z.string(),requestHash:z.string(),providerCustomerRef:z.string().nullable(),providerRef:z.string().nullable(),startedAt:z.date(),privacyPending:z.boolean(),resolution:recordedEvidence})),nextCursor:z.uuid().nullable()}),
 handler:async(input,ctx)=>{
  requireRecoveryManager(ctx.actor);
  const rows=await ctx.tx.select({dispatch:subscriptionSetupDispatches,attempt:subscriptionCardSetups}).from(subscriptionSetupDispatches).innerJoin(subscriptionCardSetups,eq(subscriptionCardSetups.id,subscriptionSetupDispatches.setupId)).where(and(eq(subscriptionCardSetups.subscriptionId,input.subscriptionId),input.afterId?gt(subscriptionSetupDispatches.id,input.afterId):undefined)).orderBy(subscriptionSetupDispatches.id).limit(input.limit+1);
  const page=rows.slice(0,input.limit);
  return {rows:page.map(({dispatch,attempt})=>({id:dispatch.id,attemptId:attempt.id,kind:dispatch.kind,state:dispatch.state,provider:attempt.provider,providerAccountId:attempt.providerAccountId,idempotencyKey:originalSetupRequest(attempt).idempotencyKey+(dispatch.kind==="customer"?":customer":""),requestHash:dispatch.requestHash,providerCustomerRef:dispatch.providerCustomerRef,providerRef:dispatch.providerRef,startedAt:dispatch.startedAt,privacyPending:!!attempt.erasureRequestId,resolution:recordedEvidence.parse(dispatch.resolution)})),nextCursor:rows.length>input.limit?page.at(-1)!.dispatch.id:null};
 },
});

export default [claimTrialSetupReconciliation,applyTrialSetupReconciliation,reconcileTrialSetupDispatch,listTrialSetupDispatches];
