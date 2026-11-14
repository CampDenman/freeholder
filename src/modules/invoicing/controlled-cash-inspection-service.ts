// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: real shared commit→GET/callbacks→finish, with no return/payment intent.
import { createHash,randomBytes } from "node:crypto";
import { eq,sql } from "drizzle-orm";
import { z } from "zod";
import { paymentAdapter } from "@/adapters/payments";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { defineService,defineOrchestratedService,ServiceError,type ServiceContext } from "@/core/service";
import { subscriptionControlledCollections,subscriptionControlledQuotes } from "@/modules/subscriptions/controlled-provider-collection-schema";
import { subscriptionControlledResources } from "@/modules/subscriptions/controlled-provider-schema";
import { subscriptions } from "@/modules/subscriptions/schema";
import { requireControlledCollectionSchema } from "@/modules/subscriptions/controlled-provider-collection-schema-guard";
import { retainControlledCashInspectionLineage } from "@/modules/subscriptions/controlled-cash-inspection-lineage";
import { readControlledCashObservationSource } from "@/modules/subscriptions/controlled-provider-cash-observation-source";
import { cashInspectionStops } from "./merchant-cash-inspection-stops";
import { merchantPhysicalCaller } from "./merchant-physical-caller";
import { controlledCashObservationAuthority } from "./controlled-cash-inspection-observation-context";
import { merchantCashReturnInspections,merchantCashReturnInspectionFinishes } from "./merchant-refund-schema";
import { cashInspectionEvidence } from "./merchant-cash-inspection-evidence";
import { performMerchantCashReturnInspection,recordCashReturnPrimaryObservation,recordCashReturnObservation } from "./merchant-cash-return-service";
import { recordMerchantRefundObservation } from "./merchant-refund-observations";
import { merchantPaymentEvidence } from "./merchant-payment-observations";
import { merchantReturnedCashEvidenceSchema } from "./merchant-returned-cash-contract";
import { allowOriginalMerchantRefundWrites } from "./merchant-refund-store";
import { queueOriginalMerchantRefundRepair } from "./merchant-refund-privacy-repair";
const scope=z.object({collectionId:z.uuid(),receiptId:z.uuid()}).strict(),nonce=z.string().regex(/^[A-Za-z0-9_-]{43}$/),sha=z.string().regex(/^[a-f0-9]{64}$/);
const outcomeSchema=z.object({inspectionId:z.uuid(),observationId:z.uuid().nullable(),bankReadReturned:z.literal(true),completeInventory:z.boolean(),paymentIntentStatus:z.string().nullable(),amountMinor:z.number().int().nonnegative().nullable(),currency:z.string().nullable(),amountRefundedMinor:z.number().int().nonnegative().nullable(),suppliesMoneyAuthority:z.literal(false)});
async function lockSource(ctx:ServiceContext,collectionId:string){
 await lockContactIdentityForRead(ctx.tx);await requireControlledCollectionSchema(ctx);
 const[reference]=await ctx.tx.select({resourceId:subscriptionControlledQuotes.resourceId,subscriptionId:subscriptionControlledResources.subscriptionId}).from(subscriptionControlledCollections)
  .innerJoin(subscriptionControlledQuotes,eq(subscriptionControlledQuotes.id,subscriptionControlledCollections.quoteId)).innerJoin(subscriptionControlledResources,eq(subscriptionControlledResources.id,subscriptionControlledQuotes.resourceId)).where(eq(subscriptionControlledCollections.id,collectionId)).limit(1);
 if(!reference)throw new ServiceError("not_found","Restore the actual accepted controlled target before inspecting its original cash.");
 await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`controlled-provider:${reference.resourceId}`}))`);
 await ctx.tx.select({id:subscriptionControlledResources.id}).from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,reference.resourceId)).for("update");
 await ctx.tx.select({id:subscriptions.id}).from(subscriptions).where(eq(subscriptions.id,reference.subscriptionId)).for("update");
}
export const prepareControlledCashInspection=defineService({name:"invoicing.prepareControlledCashInspection",summary:"Admit exactly one original receipt-owned GET under genuine complete parent observation coverage before physical SDK work.",kind:"mutation",permission:"system",external:false,writeClass:"money",auditInputFields:["collectionId","receiptId"],input:scope,
 output:z.object({inspectionId:z.uuid(),completionNonce:nonce,providerPlatformAccountId:z.string(),providerAccountId:z.string().nullable(),providerApiVersion:z.literal("2026-10-28.endive"),paymentProviderRef:z.string(),sourceRevision:sha}),handler:async(input,ctx)=>{
  await lockSource(ctx,input.collectionId);
  // Admission NEVER supplies inspectionId: ALL prior real readers/callers must
  // actually be closed; neither a later success nor an exclusion can hide them.
  const initial=await controlledCashObservationAuthority(ctx,input),source=initial.source;
  await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`subscription-cash:${source.providerPlatformAccountId}:${source.chargeAccountId??""}:${source.providerPaymentIntentRef}`}))`);
  const current=await controlledCashObservationAuthority(ctx,input);
  if(current.source.sourceRevision!==source.sourceRevision||current.authority.revision!==initial.authority.revision||current.authority.causalSourceRevision!==initial.authority.causalSourceRevision)throw new ServiceError("conflict","The actual complete original observation graph changed before admission. Preserve every occurrence and review again before any bank GET.");
  const completionNonce=randomBytes(32).toString("base64url");await allowOriginalMerchantRefundWrites(ctx.tx);
  const[saved]=await ctx.tx.insert(merchantCashReturnInspections).values({paymentId:null,originalObservationId:null,subscriptionChargeReceiptId:source.receiptId,subscriptionChargeObservationId:source.observationId,
   providerPlatformAccountId:source.providerPlatformAccountId,chargeAccountId:source.chargeAccountId,providerApiVersion:source.providerApiVersion,originalPaymentRef:source.providerPaymentIntentRef,originalCashAmountMinor:source.amountMinor,currency:source.currency,
   sourceHistoryDigest:current.authority.causalSourceRevision,caller:merchantPhysicalCaller(),completionNonceHash:createHash("sha256").update(completionNonce).digest("hex")}).returning();
  if(!saved)throw new ServiceError("conflict","Retain the genuine original inspection admission before physical work.");
  await retainControlledCashInspectionLineage(ctx,{inspectionId:saved.id,completionNonce});
  ctx.setSubject("subscription_provider_charge",source.receiptId);queueOriginalMerchantRefundRepair(ctx,{kind:"cash_read",id:saved.id});
  return{inspectionId:saved.id,completionNonce,providerPlatformAccountId:source.providerPlatformAccountId,providerAccountId:source.chargeAccountId,providerApiVersion:source.providerApiVersion,paymentProviderRef:source.providerPaymentIntentRef,sourceRevision:source.sourceRevision};
 }});
export const controlledCashInspectionOutcome=defineService({name:"invoicing.controlledCashInspectionOutcome",summary:"Report the exact actual returned read and retained bank state as review evidence, without claiming money authority.",kind:"query",permission:"system",external:false,auditInputFields:["collectionId","receiptId","inspectionId"],input:scope.extend({inspectionId:z.uuid()}).strict(),
 output:outcomeSchema,handler:async(input,ctx)=>{
  await lockSource(ctx,input.collectionId);const original=await readControlledCashObservationSource(ctx.tx,input);
  const[inspection]=await ctx.tx.select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id,input.inspectionId)).limit(1),[finish]=await ctx.tx.select().from(merchantCashReturnInspectionFinishes).where(eq(merchantCashReturnInspectionFinishes.inspectionId,input.inspectionId)).limit(1);
  if(!inspection||inspection.subscriptionChargeReceiptId!==original.receiptId||inspection.subscriptionChargeObservationId!==original.observationId||!finish||finish.callerInstanceId!==inspection.caller.id||finish.outcome!=="returned")throw new ServiceError("conflict","Preserve this exact original read's real returned finish; another caller or a stop receipt is not a returned bank result.");
  if((await cashInspectionStops(ctx.tx,[inspection])).length)throw new ServiceError("conflict","An independent stop cannot supply this actual returned-read outcome.");
  const owned=await cashInspectionEvidence(ctx.tx,inspection.id),observation=owned.observations.at(-1),bank=merchantReturnedCashEvidenceSchema.safeParse(observation?.evidence);
  return{inspectionId:inspection.id,observationId:observation?.id??null,bankReadReturned:true as const,completeInventory:bank.success&&bank.data.refundsComplete&&bank.data.disputesComplete,paymentIntentStatus:bank.success?bank.data.paymentIntentStatus:null,amountMinor:bank.success?bank.data.amountMinor:null,currency:bank.success?bank.data.currency:null,amountRefundedMinor:bank.success?bank.data.amountRefundedMinor:null,suppliesMoneyAuthority:false as const};
 }});
export const inspectControlledCashReceipt=defineOrchestratedService({name:"invoicing.inspectControlledCashReceipt",summary:"Perform one genuine original receipt bank GET and retain all actual primary/refund/dispute evidence for review; no charge, refund or access mutation.",kind:"mutation",permission:"scoped",writeClass:"money",auditInputFields:["collectionId","receiptId"],input:scope,output:outcomeSchema,
 handler:async(input,actor)=>{
  const adapter=paymentAdapter("stripe"),inspect=adapter.inspectMerchantReturnedCash?.bind(adapter);if(!inspect)throw new ServiceError("conflict","Restore the original-account complete cash/refund/dispute GET adapter before admitting work.");
  const system={kind:"system",request:actor.request} as const,claim=await prepareControlledCashInspection.call(input,system);
  // The exact source observation is already sealed by the actual admission.
  // recordMerchantRefundObservation uses the real receipt FK; it never needs
  // a fabricated local payment or return intent to retain actual refund money.
  await performMerchantCashReturnInspection(claim,()=>inspect({providerPlatformAccountId:claim.providerPlatformAccountId,providerApiVersion:claim.providerApiVersion,...(claim.providerAccountId?{providerAccountId:claim.providerAccountId}:{}),paymentProviderRef:claim.paymentProviderRef,
   onOriginalCashObserved:async evidence=>{await recordCashReturnPrimaryObservation.call({...claim,evidence:merchantPaymentEvidence.extend({amountMinor:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),currency:z.string().regex(/^[A-Z]{3}$/)}).parse(evidence)},system);},
   onRefundObserved:async evidence=>{await recordMerchantRefundObservation.call({source:{kind:"subscription",receiptId:input.receiptId},inspectionId:claim.inspectionId,inspectionCompletionNonce:claim.completionNonce,evidence:{...evidence,providerApiVersion:evidence.providerApiVersion??null,status:evidence.providerStatus??null}},system);},
   onReturnStateObserved:async evidence=>{await recordCashReturnObservation.call({...claim,evidence},system);}}));
  return controlledCashInspectionOutcome.call({...input,inspectionId:claim.inspectionId},system);
 }});
export default[prepareControlledCashInspection,controlledCashInspectionOutcome,inspectControlledCashReceipt];
