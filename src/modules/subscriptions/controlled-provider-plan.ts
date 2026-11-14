// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Original resource facts select each next request; callers never supply arbitrary bank references.
import { randomUUID } from "node:crypto";
import { eq,sql } from "drizzle-orm";
import { z } from "zod";
import { defineService,ServiceError } from "@/core/service";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { moduleSettings } from "@/core/settings/schema";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptions,subscriptionCommercialTerms } from "./schema";
import { subscriptionControlledResources,subscriptionControlledOperations,subscriptionControlledVerifications,CONTROLLED_PROVIDER_KINDS } from "./controlled-provider-schema";
import { controlledProviderJournal } from "./controlled-provider-proof";
import { controlledFinancialReadiness,controlledWorkNeedsParentReadiness } from "./controlled-provider-readiness";
import { requireControlledProviderSchema } from "./controlled-provider-source";
const kind=z.enum(["bootstrap","discover_bootstrap","read_bootstrap","pause_drafts","read_invoice","read_customer_financials","list_invoices","read_calendar","cancel_calendar","create_product","read_product"]);
const input=z.object({resourceId:z.uuid(),kind,providerInvoiceRef:z.string().regex(/^in_[A-Za-z0-9_]+$/).max(200).optional()}).strict();
const ref=(value:unknown)=>typeof value==="string"?value:value&&typeof value==="object"&&"id"in value&&typeof value.id==="string"?value.id:undefined;
export const planControlledProviderOperation=defineService({name:"subscriptions.planControlledProviderOperation",summary:"Freeze a next exact zero-only preparation or independent financial read from genuine original resource facts before its actual caller is admitted.",
 kind:"mutation",permission:"system",external:false,writeClass:"money",input,output:z.object({operationId:z.uuid()}),handler:async(request,ctx)=>{
  await lockContactIdentityForRead(ctx.tx);await requireControlledProviderSchema(ctx);
  await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`controlled-provider:${request.resourceId}`}))`);
  const[resource]=await ctx.tx.select().from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,request.resourceId)).limit(1).for("update");
  if(!resource)throw new ServiceError("not_found","There is no such original controlled resource.");
  const history=await controlledProviderJournal(ctx.tx,resource.id);
  if(history.closures.length)throw new ServiceError("conflict","This exact original zero-only transport is genuinely closed. Its closure cannot authorize a replacement calendar or another physical caller.");
  if(history.unfinished.length)throw new ServiceError("conflict","Finish or genuinely stop every actual original controlled caller before planning another bank request.");
  const[parent]=await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id,resource.subscriptionId)).limit(1);
  const[terms]=await ctx.tx.select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.id,resource.termsId)).limit(1);
  if(!parent||!terms||terms.subscriptionId!==resource.subscriptionId)throw new ServiceError("conflict","Restore the original accepted subscription and immutable terms before resource recovery.");
  const[enabled]=await ctx.tx.select().from(moduleSettings).where(eq(moduleSettings.module,"subscriptions")).limit(1);
  const creates=request.kind==="bootstrap"||request.kind==="create_product";
  if(creates&&(!enabled?.enabled||parent.cancelledAt||parent.cancelAtPeriodEnd||!["active","trialing"].includes(parent.status)))throw new ServiceError("conflict","Disabled or stopped original agreements cannot create new provider resources.");
  if(creates){const existing=history.operations.find(row=>row.kind===request.kind);if(existing)return{operationId:existing.id};}
  const bootstrap=history.operations.find(row=>row.kind==="bootstrap");
  const payload:Record<string,unknown>={};
  if(request.kind==="create_product"){
   const ready=history.verifications.some(row=>history.operations.some(operation=>operation.id===row.operationId&&operation.kind==="read_bootstrap")&&row.actualResult.collectionPausedAsDraft===true);
   if(!ready)throw new ServiceError("conflict","Prove this real zero-only resource's draft pause before creating its merchant-tax collection product.");
   payload.name=`${terms.snapshot.name} / merchant-declared tax collection`;payload.component="merchant_declared_tax_collection";
  }else if(request.kind!=="bootstrap"){
   if(!bootstrap)throw new ServiceError("conflict","Retain the original zero-only bootstrap intent before bank discovery or verification.");
   payload.bootstrapOperationId=bootstrap.id;payload.bootstrapRequestDigest=bootstrap.requestDigest;
   if(request.kind!=="discover_bootstrap"&&request.kind!=="read_product"){
    const originals=history.facts.filter(fact=>fact.actual.kind==="bootstrap_subscription"&&history.calls.some(call=>call.id===fact.callId&&call.operationId===bootstrap.id)).flatMap(fact=>ref(fact.actual.raw.id)?[ref(fact.actual.raw.id)!]:[]);
    for(const verified of history.verifications){const operation=history.operations.find(row=>row.id===verified.operationId);
     if(operation?.kind!=="discover_bootstrap")continue;
     const matches=z.object({complete:z.literal(true),matches:z.array(z.object({providerSubscriptionRef:z.string(),providerInvoiceRef:z.string().nullable()})).max(5000)}).safeParse(verified.actualResult);
     if(matches.success)originals.push(...matches.data.matches.map(row=>row.providerSubscriptionRef));
    }
    const refs=[...new Set(originals)];
    if(refs.length!==1)throw new ServiceError("conflict","Discover every original bootstrap resource through a new actual GET; missing or multiple physical ACKs cannot be chosen by amount or a later successful row.");
    payload.providerSubscriptionRef=refs[0];
   }
  }
  if(request.kind==="pause_drafts"){
   const actual=history.verifications.filter(row=>history.operations.some(operation=>operation.id===row.operationId&&operation.kind==="read_bootstrap")).at(-1)?.actualResult;
   if(!actual||actual.completeZeroRecurringItem!==true||actual.providerSubscriptionRef!==payload.providerSubscriptionRef)throw new ServiceError("conflict","Independently verify the exact actual original zero-only resource before its pause mutation.");
  }
  if(request.kind==="read_invoice"){
   const invoiceRef=request.providerInvoiceRef;
   const acknowledged=invoiceRef&&history.facts.some(fact=>{
    if(!["bootstrap_subscription","subscription_read","invoice_read","calendar_updated","calendar_canceled","invoice_list_read","controlled_draft_created","controlled_invoice_paid"].includes(fact.actual.kind))return false;
    return ref(fact.actual.raw.latest_invoice)===invoiceRef||["invoice_read","controlled_draft_created","controlled_invoice_paid"].includes(fact.actual.kind)&&ref(fact.actual.raw.id)===invoiceRef||fact.actual.kind==="invoice_list_read"&&Array.isArray(fact.actual.raw.data)&&fact.actual.raw.data.some(row=>ref(row)===invoiceRef);
   });
   if(!invoiceRef||!acknowledged)throw new ServiceError("conflict","Only an actual original bank ACK/inventory can select an invoice; do not supply an unrelated reference.");
   payload.providerInvoiceRef=invoiceRef;
  }
  if(request.kind==="read_product"){
   const creator=history.operations.find(row=>row.kind==="create_product");
   if(!creator)throw new ServiceError("conflict","Retain the actual original auxiliary product request before verification.");
   const refs=[...new Set(history.facts.filter(fact=>fact.actual.kind==="product_created"&&history.calls.some(call=>call.id===fact.callId&&call.operationId===creator.id)).flatMap(fact=>ref(fact.actual.raw.id)?[ref(fact.actual.raw.id)!]:[]))];
   if(refs.length!==1)throw new ServiceError("conflict","Recover the original actual product ACK; no replacement POST or guessed product is admitted.");
   payload.createdProductRef=refs[0];payload.originalProductOperationId=creator.id;payload.originalProductRequestDigest=creator.requestDigest;
   payload.name=creator.originalRequest.payload&&typeof creator.originalRequest.payload==="object"?Reflect.get(creator.originalRequest.payload,"name"):undefined;
   payload.component="merchant_declared_tax_collection";
  }
  if(history.count>=5000)throw new ServiceError("conflict","The complete original controlled history exceeds its bounded admission capacity.");
  const id=randomUUID(),ordinal=(history.operations.at(-1)?.ordinal??0)+1,idempotencyKey=request.kind==="bootstrap"?`controlled:${resource.id}:bootstrap`:`controlled:${resource.id}:${request.kind}:${id}`;
  const parentReadiness=controlledWorkNeedsParentReadiness(request.kind)?await controlledFinancialReadiness(ctx,resource.subscriptionId):null;
  const originalRequest=z.record(z.string(),z.unknown()).parse(JSON.parse(JSON.stringify({scopeDigest:merchantTaxDigest(resource.originalScope),payload,parentFinancialRevision:parentReadiness?.revision??null})));
  await ctx.tx.execute(sql`select set_config('freeholder.controlled_provider_v1','1',true)`);
  await ctx.tx.insert(subscriptionControlledOperations).values({id,resourceId:resource.id,kind:request.kind,ordinal,originalRequest,requestDigest:merchantTaxDigest(originalRequest),idempotencyKey,
   previousEvidenceRevision:history.revision,acceptedQuoteDigest:terms.acceptedQuoteDigest});
  ctx.setSubject("subscription",resource.subscriptionId);return{operationId:id};
 }});
const sha=z.string().regex(/^[a-f0-9]{64}$/),account=z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200);
const operationResult=z.object({id:z.uuid(),resourceId:z.uuid(),kind:z.enum(CONTROLLED_PROVIDER_KINDS),ordinal:z.number().int().positive(),originalRequest:z.record(z.string(),z.unknown()),
 requestDigest:sha,idempotencyKey:z.string().min(1).max(200),previousEvidenceRevision:sha,acceptedQuoteDigest:sha,createdAt:z.date()});
const scopeResult=z.object({providerApiVersion:z.literal("2026-10-28.endive"),providerPlatformAccountId:account,providerAccountId:account.optional(),destinationAccountId:account.optional(),settlementMerchantAccountId:account.optional(),
 subscriptionId:z.uuid(),termsId:z.uuid(),generation:z.number().int().positive(),providerCustomerRef:z.string().regex(/^cus_[A-Za-z0-9_]+$/).max(200),providerMethodRef:z.string().regex(/^pm_[A-Za-z0-9_]+$/).max(200),
 providerProductRef:z.string().regex(/^prod_[A-Za-z0-9_]+$/).max(200),currency:z.string().regex(/^[A-Z]{3}$/),interval:z.enum(["day","week","month","year"]),intervalCount:z.number().int().positive(),acceptedPeriodEnd:z.iso.datetime(),acceptedTrialEnd:z.iso.datetime().nullable()}).strict();
export const controlledOperationRequest=defineService({name:"subscriptions.controlledOperationRequest",summary:"Read one exact frozen original controlled request for its private SDK orchestrator; no current account or reconstructed parameters replace it.",
 kind:"query",permission:"system",external:false,input:z.object({operationId:z.uuid()}),output:z.object({operation:operationResult,scope:scopeResult,verifiedResult:z.record(z.string(),z.unknown()).nullable()}),
 handler:async({operationId},ctx)=>{
  const[operation]=await ctx.tx.select().from(subscriptionControlledOperations).where(eq(subscriptionControlledOperations.id,operationId)).limit(1);
  const[resource]=operation?await ctx.tx.select().from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,operation.resourceId)).limit(1):[];
  if(!operation||!resource||merchantTaxDigest(operation.originalRequest)!==operation.requestDigest||operation.originalRequest.scopeDigest!==merchantTaxDigest(resource.originalScope))throw new ServiceError("conflict","Restore the actual original controlled request and immutable resource.");
  const[verified]=await ctx.tx.select().from(subscriptionControlledVerifications).where(eq(subscriptionControlledVerifications.operationId,operation.id)).limit(1);
  return{operation,scope:resource.originalScope,verifiedResult:verified?.actualResult??null};
 }});
export const controlledPreparationState=defineService({name:"subscriptions.controlledPreparationState",summary:"Read genuine original creation admission and returned zero/pause verification without substituting a successor bank request.",kind:"query",permission:"system",external:false,
 input:z.object({resourceId:z.uuid()}),output:z.object({bootstrapAdmitted:z.boolean(),pausedZeroVerified:z.boolean(),closed:z.boolean()}),handler:async({resourceId},ctx)=>{
  const history=await controlledProviderJournal(ctx.tx,resourceId),bootstrap=history.operations.find(row=>row.kind==="bootstrap");
  return{bootstrapAdmitted:!!bootstrap&&history.calls.some(row=>row.operationId===bootstrap.id),closed:history.closures.length>0,
   pausedZeroVerified:history.verifications.some(row=>history.operations.some(operation=>operation.id===row.operationId&&operation.kind==="read_bootstrap")&&row.actualResult.completeZeroRecurringItem===true&&row.actualResult.collectionPausedAsDraft===true)};
 }});
export default[planControlledProviderOperation,controlledOperationRequest,controlledPreparationState];
