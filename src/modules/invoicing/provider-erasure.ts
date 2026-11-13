// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: account-scoped provider cleanup survives local erasure.
import {createHash,randomUUID} from "node:crypto";
import {eq} from "drizzle-orm";
import {z} from "zod";
import {paymentAdapter} from "@/adapters/payments";
import {defineJob,enqueueJob} from "@/core/jobs";
import {completeErasureJob} from "@/core/privacy/service";
import {getService,ServiceError,type Tx} from "@/core/service";
import {merchantTaxDigest} from "./merchant-tax-store";
import {paymentMethods,paymentProviderCustomers} from "./schema";

export const providerCustomerErasureScope="commerce.money";
export const providerCustomerErasurePayload=z.object({requestId:z.uuid(),originalJobId:z.uuid(),provider:z.string().min(1).max(100),providerAccountId:z.string().max(200),providerPlatformAccountId:z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200).nullable().default(null),providerCustomerRef:z.string().min(1).max(500),buyerMoneyFinisherJobId:z.uuid().optional()});
export const erasePaymentProviderCustomer=defineJob({
 name:"invoicing.eraseProviderCustomer",
 summary:"Delete an erased contact's original provider customer and saved methods, then acknowledge its privacy task.",
 concurrency:1,leaseSeconds:300,
 retry:{limit:40,delaySeconds:60,backoff:true,maxDelaySeconds:3600},
 handler:async(data,context)=>{
  if(!context)throw new Error("Payment-provider erasure requires a durable job identity.");
  const input=providerCustomerErasurePayload.parse(data);
  if(input.buyerMoneyFinisherJobId){
   if(context.id!==input.originalJobId)throw new ServiceError("permission","The provider customer task does not match its original durable job.");
   const ready=getService("invoicing.prepareBuyerCustomerErasure");
   if(!ready)throw new ServiceError("conflict","Restore the original buyer customer-erasure preflight before provider I/O.");
   const allowed=z.object({ready:z.boolean(),recoveryRequired:z.boolean()}).parse(await ready.call({requestId:input.requestId,providerJobId:input.originalJobId,moneyJobId:input.buyerMoneyFinisherJobId,payloadDigest:merchantTaxDigest(data)},{kind:"system"}));
   if(!allowed.ready)throw new ServiceError("conflict",allowed.recoveryRequired?"Restore the original buyer erasure artifact before provider I/O.":"Original buyer schedules, cash or holds still require this provider customer.");
  }
  await context.throwIfCancelled();
  const adapter=paymentAdapter(input.provider);
  if(adapter.id!==input.provider || !adapter.status.available || !adapter.eraseCustomer)throw new Error("This payment provider cannot yet acknowledge customer erasure; the privacy task remains pending.");
  await adapter.eraseCustomer({providerCustomerRef:input.providerCustomerRef,providerAccountId:input.providerAccountId||undefined,providerPlatformAccountId:input.providerPlatformAccountId??undefined,idempotencyKey:`privacy-customer:${input.originalJobId}`});
  await context.throwIfCancelled();
  await completeErasureJob.call({requestId:input.requestId,scope:providerCustomerErasureScope,jobId:input.originalJobId},{kind:"system"});
  return {erased:true};
 },
});
export type OriginalProviderCustomer = { provider: string; providerAccountId: string; providerPlatformAccountId: string | null; providerCustomerRef: string };
export const originalProviderCustomerKey = (customer: OriginalProviderCustomer): string => customer.providerPlatformAccountId
  ? `platform:${createHash("sha256").update(JSON.stringify([customer.provider,customer.providerPlatformAccountId,customer.providerAccountId,customer.providerCustomerRef])).digest("hex")}`
  : JSON.stringify([customer.provider,customer.providerAccountId,customer.providerCustomerRef]);
/** Capture the exact existing provider namespaces before local minimization.
 * The deferred privacy finisher uses these same originals for real tasks. */
export async function originalProviderCustomersForErasure(tx:Tx,contactId:string):Promise<OriginalProviderCustomer[]>{
  const customers=await tx.select({provider:paymentProviderCustomers.provider,providerAccountId:paymentProviderCustomers.providerAccountId,providerPlatformAccountId:paymentProviderCustomers.providerPlatformAccountId,providerCustomerRef:paymentProviderCustomers.providerCustomerRef}).from(paymentProviderCustomers).where(eq(paymentProviderCustomers.contactId,contactId)).for("update");
  const methods=await tx.select({provider:paymentMethods.provider,providerAccountId:paymentMethods.providerAccountId,providerPlatformAccountId:paymentMethods.providerPlatformAccountId,providerCustomerRef:paymentMethods.providerCustomerRef}).from(paymentMethods).where(eq(paymentMethods.contactId,contactId)).for("update");
  const targets=new Map(customers.map(customer=>[originalProviderCustomerKey(customer),customer]));
  for(const method of methods)if(method.providerCustomerRef){
   const customer={...method,providerCustomerRef:method.providerCustomerRef};
   targets.set(originalProviderCustomerKey(customer),customer);
  }
  return [...targets.values()];
}
/** The existing commerce.money hold owns both local and external customer data. */
export async function queuePaymentProviderErasure(tx:Tx,contactId:string,context:{requestId:string}):Promise<{pendingJobs:string[]}>{
  return queueOriginalPaymentProviderCustomers(tx, await originalProviderCustomersForErasure(tx,contactId), context);
}
export async function queueOriginalPaymentProviderCustomers(tx:Tx,targets:OriginalProviderCustomer[],context:{requestId:string}):Promise<{pendingJobs:string[]}>{
  const pendingJobs:string[]=[];
  for(const customer of targets){
   const originalJobId=randomUUID();
   const {providerPlatformAccountId,...original}=customer;
   const job=await enqueueJob(tx,erasePaymentProviderCustomer.name,{requestId:context.requestId,originalJobId,...original,...(providerPlatformAccountId?{providerPlatformAccountId}:{})},{id:originalJobId,idempotencyKey:`privacy-customer:${context.requestId}:${originalProviderCustomerKey(customer)}`,startAfter:60});
   pendingJobs.push(job.id);
  }
  return {pendingJobs};
}
