// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: immutable first requests and agreement-specific saved-method proof.
import {createHash,randomUUID} from "node:crypto";
import {and,asc,desc,eq,sql} from "drizzle-orm";
import {z} from "zod";
import {registerContactPrivacySource} from "@/core/privacy/service";
import {ServiceError,type ServiceContext,type Tx} from "@/core/service";
import {paymentMethods} from "@/modules/invoicing/schema";
import {subscriptionCardSetups,subscriptionSetupDispatches,subscriptions} from "./schema";

export const setupRequest=z.object({
 setupAttemptId:z.uuid(),subscriptionId:z.uuid(),contactId:z.uuid(),currency:z.string().regex(/^[A-Z]{3}$/),
 providerAccountId:z.string().regex(/^(?:|acct_[A-Za-z0-9]+)$/).max(200).optional(),
 customer:z.object({email:z.email(),name:z.string().max(200).optional()}),
 providerCustomerRef:z.string().min(1).max(500).optional(),
 successUrl:z.url(),cancelUrl:z.url(),idempotencyKey:z.string().min(8).max(240),
});
export type SetupRequest=z.infer<typeof setupRequest>;
export type CardSetup=typeof subscriptionCardSetups.$inferSelect;
export function originalSetupRequest(attempt:CardSetup):SetupRequest{
 const request=setupRequest.parse(attempt.request);
 if(request.setupAttemptId!==attempt.id || request.subscriptionId!==attempt.subscriptionId || (request.providerAccountId??"")!==attempt.providerAccountId || createHash("sha256").update(JSON.stringify(request)).digest("hex")!==attempt.requestHash) throw new ServiceError("conflict","Reconcile this card setup's immutable original request before retrying.");
 return request;
}

export async function claimSetup(ctx:ServiceContext,input:{subscriptionId:string;contactId:string;provider:string;providerAccountId?:string;customer:{email:string|null;name:string};providerCustomerRef?:string;currency:string;successUrl:string;cancelUrl:string}){
 const attempts=await ctx.tx.select().from(subscriptionCardSetups).where(eq(subscriptionCardSetups.subscriptionId,input.subscriptionId)).orderBy(desc(subscriptionCardSetups.createdAt),desc(subscriptionCardSetups.id)).for("update");
 const pending=attempts.find(attempt=>!attempt.confirmedAt&&!attempt.closedAt);
 let existing=pending;
 if(!existing){
  const latest=attempts[0];
  if(latest?.confirmedMethodId && !latest.closedAt){
   const [method]=await ctx.tx.select().from(paymentMethods).where(and(eq(paymentMethods.id,latest.confirmedMethodId),eq(paymentMethods.status,"active"),eq(paymentMethods.contactId,input.contactId)));
   if(method)existing=latest;
  }
 }
 if(existing){
  if(existing.provider!==input.provider || existing.providerAccountId!==(input.providerAccountId??""))throw new ServiceError("conflict","This card setup belongs to its original payment provider and account.");
  const request=originalSetupRequest(existing);
  if(existing.erasureRequestId)throw new ServiceError("conflict","This original setup is awaiting privacy cleanup.");
  if(existing.confirmedMethodId)return {attempt:existing,request,url:request.successUrl,recover:false};
  if(existing.checkoutUrl){
   if(existing.expiresAt && existing.expiresAt.getTime()<=Date.now())return {attempt:existing,request,url:null,recover:true};
   return {attempt:existing,request,url:existing.checkoutUrl,recover:false};
  }
  const kind=existing.providerCustomerRef?"session":"customer";
  const [first]=await ctx.tx.select({expired:sql<boolean>`${subscriptionSetupDispatches.startedAt} <= clock_timestamp() - interval '23 hours'`}).from(subscriptionSetupDispatches).where(and(eq(subscriptionSetupDispatches.setupId,existing.id),eq(subscriptionSetupDispatches.kind,kind))).orderBy(asc(subscriptionSetupDispatches.startedAt)).limit(1);
  if(first?.expired)return {attempt:existing,request,url:null,recover:true};
  return {attempt:existing,request,url:null,recover:false};
 }
 if(!input.customer.email)throw new ServiceError("conflict","Verify your email before saving a card.");
 const attemptId=randomUUID();
 const request=setupRequest.parse({setupAttemptId:attemptId,subscriptionId:input.subscriptionId,contactId:input.contactId,currency:input.currency,providerAccountId:input.providerAccountId,customer:{email:input.customer.email,name:input.customer.name.slice(0,200)},providerCustomerRef:input.providerCustomerRef??(attempts[0]?.closedReason==="provider_cancelled" && attempts[0]?.provider===input.provider && attempts[0]?.providerAccountId===(input.providerAccountId??"") ? attempts[0].providerCustomerRef??undefined:undefined),successUrl:input.successUrl,cancelUrl:input.cancelUrl,idempotencyKey:`trial-card:${input.subscriptionId}:${attemptId}`});
 const [attempt]=await ctx.tx.insert(subscriptionCardSetups).values({id:attemptId,subscriptionId:input.subscriptionId,provider:input.provider,providerAccountId:input.providerAccountId??"",request,requestHash:createHash("sha256").update(JSON.stringify(request)).digest("hex"),providerCustomerRef:request.providerCustomerRef??null}).returning();
 return {attempt:attempt!,request,url:null,recover:false};
}

/** Called only inside authenticated provider application, never from a public caller. */
export async function bindSetupEvidence(ctx:ServiceContext,input:{provider:string;providerAccountId:string;contactId?:string;customerRef?:string;methodRef:string;setup:{attemptId:string;subscriptionId:string;checkoutRef:string;setupIntentRef:string}}){
 const [attempt]=await ctx.tx.select().from(subscriptionCardSetups).where(eq(subscriptionCardSetups.id,input.setup.attemptId)).for("update");
 // Erasure removes completed local setup copies. A late callback cannot recreate them.
 if(!attempt)return null;
 if(attempt.erasureRequestId)return null;
 if(attempt.closedAt)throw new ServiceError("conflict","This saved-card setup was already reconciled as closed.");
 const request=originalSetupRequest(attempt);
 const [sub]=await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id,attempt.subscriptionId));
 if(!sub || !attempt.providerCustomerRef || sub.id!==input.setup.subscriptionId || request.contactId!==input.contactId || attempt.provider!==input.provider || attempt.providerAccountId!==input.providerAccountId || !input.customerRef || (attempt.providerCustomerRef && attempt.providerCustomerRef!==input.customerRef) || (attempt.providerCheckoutRef && attempt.providerCheckoutRef!==input.setup.checkoutRef) || (attempt.providerSetupIntentRef && attempt.providerSetupIntentRef!==input.setup.setupIntentRef))throw new ServiceError("conflict","The saved card does not match its original setup request.");
 if(attempt.confirmedMethodId){
  const [method]=await ctx.tx.select().from(paymentMethods).where(eq(paymentMethods.id,attempt.confirmedMethodId));
  if(!method || method.providerMethodRef!==input.methodRef)throw new ServiceError("conflict","This setup already confirmed a different saved method.");
 }
 return {attempt,contactId:sub.contactId};
}

export async function applySetupEvidence(tx:Tx,input:{attemptId:string;methodId:string;customerRef:string;checkoutRef:string;setupIntentRef:string;occurredAt:Date}){
 await tx.update(subscriptionCardSetups).set({providerCustomerRef:input.customerRef,providerCheckoutRef:input.checkoutRef,providerSetupIntentRef:input.setupIntentRef,confirmedMethodId:input.methodId,confirmedAt:sql`coalesce(${subscriptionCardSetups.confirmedAt},${input.occurredAt.toISOString()}::timestamptz)`}).where(eq(subscriptionCardSetups.id,input.attemptId));
}

registerContactPrivacySource({
 scope:"subscriptions.cardSetups",tables:["subscription_card_setups","subscription_setup_dispatches"],retentionScopes:["commerce.money"],eraseOrder:5,
 exportData:async(tx,contactId)=>{
  const rows=await tx.select({attempt:subscriptionCardSetups}).from(subscriptionCardSetups).innerJoin(subscriptions,eq(subscriptions.id,subscriptionCardSetups.subscriptionId)).where(eq(subscriptions.contactId,contactId));
  return rows.map(({attempt})=>({id:attempt.id,subscriptionId:attempt.subscriptionId,provider:attempt.provider,createdAt:attempt.createdAt,confirmedAt:attempt.confirmedAt,customer:originalSetupRequest(attempt).customer}));
 },
 erase:async(tx,contactId,context)=>{
  const {queueTrialSetupErasure}=await import("./setup-erasure");
  return queueTrialSetupErasure(tx,contactId,context.requestId);
 }
});
