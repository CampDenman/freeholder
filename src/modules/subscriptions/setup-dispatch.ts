// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: every physical POST has a durable, independently settled outcome.
import {createHash} from "node:crypto";
import {and,eq,sql} from "drizzle-orm";
import {z} from "zod";
import {lockContactIdentity} from "@/core/contacts/identity-lock";
import {contactForActor} from "@/core/portal/service";
import {actorString,defineService,ServiceError} from "@/core/service";
import {originalSetupRequest,setupRequest} from "./card-setup";
import {subscriptionCardSetups,subscriptionSetupDispatches,subscriptions} from "./schema";

export const dispatchRequestHash=(request:z.infer<typeof setupRequest>)=>createHash("sha256").update(JSON.stringify(request)).digest("hex");
export const claimTrialSetupDispatch=defineService({
 name:"subscriptions.claimTrialSetupDispatch",summary:"Commit a physical customer or setup request before provider I/O.",
 kind:"mutation",permission:"authenticated",external:false,writeClass:"money",agentCallable:false,
 input:z.object({attemptId:z.uuid(),kind:z.enum(["customer","session"])}),
 output:z.object({dispatchId:z.uuid().nullable(),provider:z.string(),request:setupRequest,customerRef:z.string().nullable()}),
 handler:async(input,ctx)=>{
  await lockContactIdentity(ctx.tx);
  const contact=await contactForActor(ctx);
  const [owned]=await ctx.tx.select({id:subscriptions.id,status:subscriptions.status,cancelledAt:subscriptions.cancelledAt,signupPending:subscriptions.signupPending,paymentMethodId:subscriptions.paymentMethodId,signupInvoiceId:subscriptions.signupInvoiceId}).from(subscriptions).innerJoin(subscriptionCardSetups,eq(subscriptionCardSetups.subscriptionId,subscriptions.id)).where(and(eq(subscriptionCardSetups.id,input.attemptId),eq(subscriptions.contactId,contact.id))).for("update",{of:subscriptions});
  if(!owned)throw new ServiceError("not_found","This original setup is no longer available.");
  if(owned.cancelledAt || owned.status!=="paused" || !owned.signupPending || owned.paymentMethodId || owned.signupInvoiceId)throw new ServiceError("conflict","This trial no longer authorizes a setup request.");
  const [attempt]=await ctx.tx.select().from(subscriptionCardSetups).where(eq(subscriptionCardSetups.id,input.attemptId)).for("update");
  if(!attempt || attempt.erasureRequestId || attempt.closedAt || attempt.confirmedAt)throw new ServiceError("conflict","This setup is closed, verified or awaiting privacy cleanup.");
  const original=originalSetupRequest(attempt);
  if(input.kind==="customer" && attempt.providerCustomerRef)return {dispatchId:null,provider:attempt.provider,request:original,customerRef:attempt.providerCustomerRef};
  if(input.kind==="session" && !attempt.providerCustomerRef)throw new ServiceError("conflict","Commit the actual setup customer before opening Checkout.");
  const previous=await ctx.tx.select({expired:sql<boolean>`${subscriptionSetupDispatches.startedAt} <= clock_timestamp() - interval '23 hours'`}).from(subscriptionSetupDispatches).where(and(eq(subscriptionSetupDispatches.setupId,attempt.id),eq(subscriptionSetupDispatches.kind,input.kind))).orderBy(subscriptionSetupDispatches.startedAt).limit(1);
  if(previous[0]?.expired)throw new ServiceError("conflict","This original provider request needs reconciliation before another dispatch.");
  const request=setupRequest.parse({...original,providerCustomerRef:input.kind==="session"?attempt.providerCustomerRef:undefined});
  const [dispatch]=await ctx.tx.insert(subscriptionSetupDispatches).values({setupId:attempt.id,kind:input.kind,requestHash:dispatchRequestHash(request),customerAtStart:request.providerCustomerRef??null,initiatedBy:actorString(ctx.actor)}).returning({id:subscriptionSetupDispatches.id});
  ctx.setSubject("subscription",attempt.subscriptionId);
  return {dispatchId:dispatch!.id,provider:attempt.provider,request,customerRef:attempt.providerCustomerRef};
 },
});

/** Private operational evidence only; it never restores an erased customer or card. */
export const recordTrialSetupDispatch=defineService({
 name:"subscriptions.recordTrialSetupDispatch",auditInputFields:["dispatchId","outcome"],summary:"Record the actual outcome of one physical provider request.",
 kind:"mutation",permission:"system",external:false,
 input:z.object({dispatchId:z.uuid(),outcome:z.enum(["succeeded","unknown"]),providerAccountId:z.string().max(200).optional(),providerPlatformAccountId:z.string().max(200).optional(),providerRef:z.string().min(1).max(500).optional(),providerCustomerRef:z.string().min(1).max(500).optional(),errorCode:z.string().max(100).optional()}),
 output:z.object({accepted:z.boolean(),erasing:z.boolean(),customerRef:z.string().nullable()}),
 handler:async(input,ctx)=>{
  // No identity guard: this phase must retain actual I/O evidence even while
  // privacy owns identity. Both paths lock the setup before its dispatches.
  const [found]=await ctx.tx.select({setupId:subscriptionSetupDispatches.setupId}).from(subscriptionSetupDispatches).where(eq(subscriptionSetupDispatches.id,input.dispatchId));
  if(!found)return {accepted:false,erasing:true,customerRef:null};
  const [attempt]=await ctx.tx.select().from(subscriptionCardSetups).where(eq(subscriptionCardSetups.id,found.setupId)).for("update");
  const [dispatch]=await ctx.tx.select().from(subscriptionSetupDispatches).where(eq(subscriptionSetupDispatches.id,input.dispatchId)).for("update");
  if(!attempt || !dispatch)return {accepted:false,erasing:true,customerRef:null};
  const request=setupRequest.parse({...originalSetupRequest(attempt),providerCustomerRef:dispatch.customerAtStart??undefined});
  if(dispatch.requestHash!==dispatchRequestHash(request))throw new ServiceError("conflict","The original physical setup request is inconsistent.");
  if(dispatch.state!=="running"){
   const same=dispatch.state==="succeeded" && input.outcome==="succeeded" && (input.providerAccountId??"")===attempt.providerAccountId && (input.providerPlatformAccountId??null)===attempt.providerPlatformAccountId && attempt.providerCustomerRef===input.providerCustomerRef && dispatch.providerCustomerRef===input.providerCustomerRef && (dispatch.kind==="customer" || dispatch.providerRef===input.providerRef && attempt.providerCheckoutRef===input.providerRef);
   return {accepted:same,erasing:!!attempt.erasureRequestId,customerRef:attempt.providerCustomerRef};
  }
  const valid=input.outcome==="succeeded" && (input.providerAccountId??"")===attempt.providerAccountId && (input.providerPlatformAccountId??null)===attempt.providerPlatformAccountId && !!input.providerCustomerRef && (dispatch.kind==="customer" || !!input.providerRef && input.providerCustomerRef===dispatch.customerAtStart);
  await ctx.tx.update(subscriptionSetupDispatches).set({state:valid?"succeeded":"unknown",finishedAt:sql`clock_timestamp()`,providerCustomerRef:valid?input.providerCustomerRef!:null,providerRef:valid?(input.providerRef??null):null,unverifiedEvidence:valid?{}:{providerAccountId:input.providerAccountId??"",providerPlatformAccountId:input.providerPlatformAccountId??null,providerCustomerRef:input.providerCustomerRef??null,providerRef:input.providerRef??null,errorCode:input.errorCode??"unresolved"}}).where(eq(subscriptionSetupDispatches.id,dispatch.id));
  let accepted=valid;
  if(valid){
   if(attempt.providerCustomerRef && attempt.providerCustomerRef!==input.providerCustomerRef)accepted=false;
   else if(!attempt.providerCustomerRef)await ctx.tx.update(subscriptionCardSetups).set({providerCustomerRef:input.providerCustomerRef!}).where(eq(subscriptionCardSetups.id,attempt.id));
   if(dispatch.kind==="session" && accepted){
    if(attempt.providerCheckoutRef && attempt.providerCheckoutRef!==input.providerRef)accepted=false;
    else if(!attempt.providerCheckoutRef)await ctx.tx.update(subscriptionCardSetups).set({providerCheckoutRef:input.providerRef!}).where(eq(subscriptionCardSetups.id,attempt.id));
   }
  }
  ctx.setSubject("subscription",attempt.subscriptionId);
  return {accepted,erasing:!!attempt.erasureRequestId,customerRef:attempt.providerCustomerRef??(valid?input.providerCustomerRef!:null)};
 },
});

export default [claimTrialSetupDispatch,recordTrialSetupDispatch];
