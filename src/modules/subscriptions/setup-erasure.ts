// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: provider creation remains pending until every dispatch settles.
import {createHash,randomUUID} from "node:crypto";
import {eq,sql} from "drizzle-orm";
import {z} from "zod";
import {paymentAdapter} from "@/adapters/payments";
import {defineJob,enqueueJob} from "@/core/jobs";
import {completeErasureJob} from "@/core/privacy/service";
import {defineService,ServiceError,type Tx} from "@/core/service";
import {subscriptionCardSetups,subscriptionSetupDispatches,subscriptions} from "./schema";

const scope="subscriptions.cardSetups";
const task=z.object({attemptId:z.uuid(),requestId:z.uuid(),originalJobId:z.uuid()});
const target=z.object({provider:z.string(),providerAccountId:z.string(),providerPlatformAccountId:z.string().nullable(),customerRefs:z.array(z.string())});
const fingerprint=(value:z.infer<typeof target>)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function cleanupTarget(tx:Tx,attemptId:string,requestId:string,jobId:string){
 const [attempt]=await tx.select().from(subscriptionCardSetups).where(eq(subscriptionCardSetups.id,attemptId)).for("update");
 if(!attempt)return null;
 if(attempt.erasureRequestId!==requestId || attempt.erasureJobId!==jobId)throw new ServiceError("conflict","This setup belongs to another original privacy task.");
 const dispatches=await tx.select().from(subscriptionSetupDispatches).where(eq(subscriptionSetupDispatches.setupId,attempt.id)).for("update");
 if(dispatches.some(item=>item.state==="running"||item.state==="unknown"))throw new ServiceError("conflict","A dispatched provider request is unresolved. Its actual outcome or cancellation guarantee must be reconciled before cleanup can finish.");
 const customerRefs=[...new Set([attempt.providerCustomerRef,...dispatches.map(item=>item.providerCustomerRef)].filter((ref):ref is string=>!!ref))].sort();
 return {attempt,target:{provider:attempt.provider,providerAccountId:attempt.providerAccountId,providerPlatformAccountId:attempt.providerPlatformAccountId,customerRefs}};
}

export const claimTrialSetupErasure=defineService({
 name:"subscriptions.claimTrialSetupErasure",summary:"Read a fully settled original setup's private customer cleanup targets.",kind:"mutation",permission:"system",external:false,
 input:task,output:z.object({missing:z.boolean(),target:target.optional(),fingerprint:z.string().optional()}),
 handler:async(input,ctx)=>{
  const current=await cleanupTarget(ctx.tx,input.attemptId,input.requestId,input.originalJobId);
  if(!current)return {missing:true};
  ctx.setSubject("subscription",current.attempt.subscriptionId);
  return {missing:false,target:current.target,fingerprint:fingerprint(current.target)};
 },
});

export const finishTrialSetupErasure=defineService({
 name:"subscriptions.finishTrialSetupErasure",summary:"Remove settled setup copies only after their original customers were actually erased.",kind:"mutation",permission:"system",external:false,
 input:task.extend({fingerprint:z.string().length(64)}),output:z.object({ok:z.literal(true)}),
 handler:async(input,ctx)=>{
  const current=await cleanupTarget(ctx.tx,input.attemptId,input.requestId,input.originalJobId);
  if(current){
   if(fingerprint(current.target)!==input.fingerprint)throw new ServiceError("conflict","The original setup cleanup targets changed; retry their actual cleanup.");
   await ctx.tx.update(subscriptionCardSetups).set({cleanupCompletedAt:sql`clock_timestamp()`}).where(eq(subscriptionCardSetups.id,input.attemptId));
   await ctx.tx.delete(subscriptionCardSetups).where(eq(subscriptionCardSetups.id,input.attemptId));
   ctx.setSubject("subscription",current.attempt.subscriptionId);
  }
  await ctx.call(completeErasureJob,{requestId:input.requestId,scope,jobId:input.originalJobId});
  return {ok:true as const};
 },
});

export const eraseTrialSetupCustomers=defineJob({
 name:"subscriptions.eraseTrialSetupCustomers",summary:"Wait for every original setup dispatch, delete its actual provider customers, and acknowledge privacy cleanup.",
 concurrency:1,leaseSeconds:300,retry:{limit:40,delaySeconds:60,backoff:true,maxDelaySeconds:3600},
 handler:async(data,context)=>{
  if(!context)throw new Error("Card-setup privacy cleanup requires its original durable task identity.");
  const input=task.parse(data);await context.throwIfCancelled();
  const claimed=await claimTrialSetupErasure.call(input,{kind:"system"});
  if(claimed.missing){
   // The SQL deletion fence permits this replay only after acknowledged
   // cleanup, or when no provider request/resource ever existed.
   await completeErasureJob.call({requestId:input.requestId,scope,jobId:input.originalJobId},{kind:"system"});
   return {erased:true};
  }
  const original=claimed.target!,adapter=paymentAdapter(original.provider);
  if(original.customerRefs.length && (adapter.id!==original.provider || !adapter.status.available || !adapter.eraseCustomer))throw new Error("The original provider cannot acknowledge setup customer erasure; cleanup remains pending.");
  for(const customerRef of original.customerRefs){
   await context.throwIfCancelled();
   await adapter.eraseCustomer!({providerCustomerRef:customerRef,providerAccountId:original.providerAccountId||undefined,providerPlatformAccountId:original.providerPlatformAccountId??undefined,idempotencyKey:`privacy-setup:${input.originalJobId}:${createHash("sha256").update(customerRef).digest("hex").slice(0,32)}`});
  }
  await context.throwIfCancelled();
  await finishTrialSetupErasure.call({...input,fingerprint:claimed.fingerprint!},{kind:"system"});
  return {erased:true};
 },
});

export async function queueTrialSetupErasure(tx:Tx,contactId:string,requestId:string):Promise<{affected:number;pendingJobs:string[]}>{
 const rows=await tx.select({attempt:subscriptionCardSetups}).from(subscriptionCardSetups).innerJoin(subscriptions,eq(subscriptions.id,subscriptionCardSetups.subscriptionId)).where(eq(subscriptions.contactId,contactId)).for("update",{of:subscriptionCardSetups});
 const pendingJobs:string[]=[];
 for(const {attempt} of rows){
  const dispatches=await tx.select({id:subscriptionSetupDispatches.id}).from(subscriptionSetupDispatches).where(eq(subscriptionSetupDispatches.setupId,attempt.id)).for("update");
  if(!attempt.providerCustomerRef && !dispatches.length){
   await tx.delete(subscriptionCardSetups).where(eq(subscriptionCardSetups.id,attempt.id));
   continue;
  }
  if(attempt.erasureRequestId && attempt.erasureRequestId!==requestId)throw new ServiceError("conflict","Another original setup privacy task is still pending.");
  const originalJobId=attempt.erasureJobId??randomUUID();
  await tx.update(subscriptionCardSetups).set({erasureRequestId:requestId,erasureJobId:originalJobId}).where(eq(subscriptionCardSetups.id,attempt.id));
  const job=await enqueueJob(tx,eraseTrialSetupCustomers.name,{attemptId:attempt.id,requestId,originalJobId},{id:originalJobId,idempotencyKey:`privacy-setup:${requestId}:${attempt.id}`,startAfter:60});
  pendingJobs.push(job.id);
 }
 return {affected:rows.length,pendingJobs};
}

export default [claimTrialSetupErasure,finishTrialSetupErasure];
