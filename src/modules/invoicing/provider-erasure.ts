// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: account-scoped provider cleanup survives local erasure.
import {createHash,randomUUID} from "node:crypto";
import {eq} from "drizzle-orm";
import {z} from "zod";
import {paymentAdapter} from "@/adapters/payments";
import {defineJob,enqueueJob} from "@/core/jobs";
import {completeErasureJob} from "@/core/privacy/service";
import type {Tx} from "@/core/service";
import {paymentMethods,paymentProviderCustomers} from "./schema";

export const providerCustomerErasureScope="commerce.money";
const payload=z.object({requestId:z.uuid(),originalJobId:z.uuid(),provider:z.string().min(1).max(100),providerAccountId:z.string().max(200),providerPlatformAccountId:z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200).nullable().default(null),providerCustomerRef:z.string().min(1).max(500)});
export const erasePaymentProviderCustomer=defineJob({
 name:"invoicing.eraseProviderCustomer",
 summary:"Delete an erased contact's original provider customer and saved methods, then acknowledge its privacy task.",
 concurrency:1,leaseSeconds:300,
 retry:{limit:40,delaySeconds:60,backoff:true,maxDelaySeconds:3600},
 handler:async(data,context)=>{
  if(!context)throw new Error("Payment-provider erasure requires a durable job identity.");
  const input=payload.parse(data);
  await context.throwIfCancelled();
  const adapter=paymentAdapter(input.provider);
  if(adapter.id!==input.provider || !adapter.status.available || !adapter.eraseCustomer)throw new Error("This payment provider cannot yet acknowledge customer erasure; the privacy task remains pending.");
  await adapter.eraseCustomer({providerCustomerRef:input.providerCustomerRef,providerAccountId:input.providerAccountId||undefined,providerPlatformAccountId:input.providerPlatformAccountId??undefined,idempotencyKey:`privacy-customer:${input.originalJobId}`});
  await context.throwIfCancelled();
  await completeErasureJob.call({requestId:input.requestId,scope:providerCustomerErasureScope,jobId:input.originalJobId},{kind:"system"});
  return {erased:true};
 },
});
/** The existing commerce.money hold owns both local and external customer data. */
export async function queuePaymentProviderErasure(tx:Tx,contactId:string,context:{requestId:string}):Promise<{pendingJobs:string[]}>{
  const customers=await tx.select({provider:paymentProviderCustomers.provider,providerAccountId:paymentProviderCustomers.providerAccountId,providerPlatformAccountId:paymentProviderCustomers.providerPlatformAccountId,providerCustomerRef:paymentProviderCustomers.providerCustomerRef}).from(paymentProviderCustomers).where(eq(paymentProviderCustomers.contactId,contactId)).for("update");
  const methods=await tx.select({provider:paymentMethods.provider,providerAccountId:paymentMethods.providerAccountId,providerPlatformAccountId:paymentMethods.providerPlatformAccountId,providerCustomerRef:paymentMethods.providerCustomerRef}).from(paymentMethods).where(eq(paymentMethods.contactId,contactId)).for("update");
  const key=(customer:{provider:string;providerAccountId:string;providerPlatformAccountId:string|null;providerCustomerRef:string})=>customer.providerPlatformAccountId
    ? `platform:${createHash("sha256").update(JSON.stringify([customer.provider,customer.providerPlatformAccountId,customer.providerAccountId,customer.providerCustomerRef])).digest("hex")}`
    : JSON.stringify([customer.provider,customer.providerAccountId,customer.providerCustomerRef]);
  const targets=new Map(customers.map(customer=>[key(customer),customer]));
  for(const method of methods)if(method.providerCustomerRef){
   const customer={...method,providerCustomerRef:method.providerCustomerRef};
   targets.set(key(customer),customer);
  }
  const pendingJobs:string[]=[];
  for(const customer of targets.values()){
   const originalJobId=randomUUID();
   const {providerPlatformAccountId,...original}=customer;
   const job=await enqueueJob(tx,erasePaymentProviderCustomer.name,{requestId:context.requestId,originalJobId,...original,...(providerPlatformAccountId?{providerPlatformAccountId}:{})},{id:originalJobId,idempotencyKey:`privacy-customer:${context.requestId}:${key(customer)}`,startAfter:60});
   pendingJobs.push(job.id);
  }
  return {pendingJobs};
}
