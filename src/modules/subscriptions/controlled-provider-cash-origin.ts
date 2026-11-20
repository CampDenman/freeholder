// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: one canonical receipt, exact original controlled call/fact ancestry.
import { eq,sql } from "drizzle-orm";
import { z } from "zod";
import { ServiceError,type ServiceContext,type Tx } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { merchantIntentEvidence } from "@/adapters/payments/stripe-merchant-scope";
import { subscriptionMerchantScope } from "./merchant-scope-contract";
import { subscriptionMerchantScopes,subscriptionProviderChargeReceipts,subscriptions } from "./schema";
import { subscriptionControlledResources,subscriptionControlledOperations,subscriptionControlledCalls,subscriptionControlledFacts,subscriptionControlledChargeOrigins } from "./controlled-provider-schema";
import { originalControlledCall } from "./controlled-provider-proof";
import type { controlledProviderJournal } from "./controlled-provider-proof";
import { readComposedControlledProviderJournal,type ControlledJournalComposition } from "./controlled-provider-journal-composition";
const account=z.string().regex(/^acct_[A-Za-z0-9]+$/).max(200),reference=z.string().min(1).max(200);
export const controlledCashOrigin=z.object({resourceId:z.uuid(),callId:z.uuid(),factId:z.uuid()}).strict();
export const controlledCashEvidence=z.object({provider:z.literal("stripe"),subscriptionId:z.uuid(),providerSubscriptionRef:reference,providerPlatformAccountId:account,providerAccountId:account.optional(),
 providerInvoiceRef:reference,providerPaymentIntentRef:reference,providerChargeRef:reference.optional(),providerCustomerRef:reference,
 amountMinor:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),currency:z.string().regex(/^[A-Z]{3}$/),
 destinationAccountId:account.optional(),settlementMerchantAccountId:account.optional(),customerChargeVerified:z.boolean(),merchantRouteVerified:z.boolean()}).strip();
export type ControlledCashEvidence=z.infer<typeof controlledCashEvidence>;
export type ControlledCashOrigin=z.infer<typeof controlledCashOrigin>;
const record=z.record(z.string(),z.unknown());
const ref=(value:unknown)=>typeof value==="string"?value:value&&typeof value==="object"&&"id"in value&&typeof value.id==="string"?value.id:undefined;
function mismatch():never{throw new ServiceError("conflict","Retain the exact actual controlled bank occurrence and immutable original resource before adopting any canonical receipt; equal amounts or a current account cannot choose an owner.");}
function metadata(invoice:Record<string,unknown>){
 const parent=record.safeParse(invoice.parent),details=record.safeParse(parent.success?parent.data.subscription_details:invoice.subscription_details);
 return details.success?record.parse(details.data.metadata):{};
}
type ControlledChargeJournal=Awaited<ReturnType<typeof controlledProviderJournal>>;
type ControlledChargeRows={resource:typeof subscriptionControlledResources.$inferSelect|undefined;call:typeof subscriptionControlledCalls.$inferSelect|undefined;operation:typeof subscriptionControlledOperations.$inferSelect|undefined;fact:typeof subscriptionControlledFacts.$inferSelect|undefined;
 original:{subscription:typeof subscriptions.$inferSelect;scope:typeof subscriptionMerchantScopes.$inferSelect}|undefined};
/** Two pure stages preserve the scalar's exact pre-journal refusal ordering.
 * The closure is used immediately within this call, never persisted/cached. */
function validateOriginalControlledCharge(rows:ControlledChargeRows,input:ControlledCashEvidence,origin:ControlledCashOrigin){
 const{resource,call,operation,fact,original}=rows;
 if(!resource||!call||!operation||!fact||!original||operation.resourceId!==resource.id||fact.callId!==call.id||fact.actual.kind!=="cash_observed"
  ||!originalControlledCall(operation,call)||fact.actualDigest!==merchantTaxDigest(fact.actual)||input.subscriptionId!==resource.subscriptionId
  ||resource.originalScope.providerPlatformAccountId!==input.providerPlatformAccountId||(resource.originalScope.providerAccountId??null)!==(input.providerAccountId??null)
  ||resource.originalScope.providerCustomerRef!==input.providerCustomerRef||resource.originalScope.currency!==input.currency)mismatch();
 const expected=controlledCashEvidence.parse(JSON.parse(JSON.stringify(fact.actual.raw.cash)));
 if(merchantTaxDigest(expected)!==merchantTaxDigest(controlledCashEvidence.parse(JSON.parse(JSON.stringify(input)))))mismatch();
 const invoice=record.parse(fact.actual.raw.invoice),intent=record.parse(fact.actual.raw.intent),tag=metadata(invoice);
 const parent=record.safeParse(invoice.parent),details=record.safeParse(parent.success?parent.data.subscription_details:undefined),actualSub=ref(invoice.subscription)??(details.success?ref(details.data.subscription):undefined);
 if(ref(invoice.id)!==input.providerInvoiceRef||actualSub!==input.providerSubscriptionRef||ref(invoice.customer)!==input.providerCustomerRef||ref(intent.id)!==input.providerPaymentIntentRef
  ||ref(intent.customer)!==input.providerCustomerRef||intent.amount_received!==input.amountMinor||typeof intent.currency!=="string"||intent.currency.toUpperCase()!==input.currency
  ||input.providerChargeRef!==undefined&&ref(intent.latest_charge)!==input.providerChargeRef||tag.freeholder_controlled_subscription_version!=="1"
  ||tag.freeholder_subscription_id!==resource.subscriptionId||tag.freeholder_subscription_terms_id!==resource.termsId||tag.freeholder_controlled_generation!==String(resource.generation)
  ||tag.freeholder_platform_account_id!==input.providerPlatformAccountId)mismatch();
 const route=merchantIntentEvidence(resource.originalScope,intent);
 if(input.customerChargeVerified!==(intent.status==="succeeded"&&ref(intent.customer)===input.providerCustomerRef&&ref(invoice.customer)===input.providerCustomerRef)
  ||input.merchantRouteVerified!==route.merchantRouteVerified||input.destinationAccountId!==route.destinationAccountId||input.settlementMerchantAccountId!==route.settlementMerchantAccountId)mismatch();
 return(journal:ControlledChargeJournal)=>{
 const bootstrap=journal.operations.find(row=>row.kind==="bootstrap"&&row.id===tag.freeholder_bootstrap_operation_id);
 if(!bootstrap||bootstrap.requestDigest!==tag.freeholder_bootstrap_request_digest||!journal.facts.some(row=>{
  const creator=journal.calls.find(value=>value.id===row.callId),creatorOperation=creator?journal.operations.find(value=>value.id===creator.operationId):null;
  if(creator?.operationId===bootstrap.id&&row.actual.kind==="bootstrap_subscription"&&ref(row.actual.raw.id)===input.providerSubscriptionRef)return true;
  if(creatorOperation?.kind!=="discover_bootstrap"||row.actual.kind!=="subscription_list_read"||!Array.isArray(row.actual.raw.data))return false;
  return row.actual.raw.data.some(value=>{const actual=record.safeParse(value),actualTag=actual.success?record.safeParse(actual.data.metadata):null;
   return actual.success&&actualTag?.success&&ref(actual.data.id)===input.providerSubscriptionRef&&ref(actual.data.customer)===resource.originalScope.providerCustomerRef
    &&actualTag.data.freeholder_bootstrap_operation_id===bootstrap.id&&actualTag.data.freeholder_bootstrap_request_digest===bootstrap.requestDigest
    &&actualTag.data.freeholder_subscription_id===resource.subscriptionId&&actualTag.data.freeholder_subscription_terms_id===resource.termsId;});
 }))mismatch();
 const scope=subscriptionMerchantScope.parse(original.scope);
 if(scope.providerPlatformAccountId!==input.providerPlatformAccountId||scope.chargeAccountId!==(input.providerAccountId??null)||scope.providerScheduleApiVersion!==resource.originalScope.providerApiVersion)mismatch();
 return{...original,operation:null,controlledCash:expected,controlledOrigin:{...origin,operationId:operation.id,originalEvidenceDigest:merchantTaxDigest({resource,operation,call,fact,cash:expected})}};
 };
}
export async function readOriginalControlledChargeAuthority(tx:Tx,input:ControlledCashEvidence,origin:ControlledCashOrigin,composition?:ControlledJournalComposition){
 const[resource]=await tx.select().from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,origin.resourceId)).limit(1);
 const[call]=await tx.select().from(subscriptionControlledCalls).where(eq(subscriptionControlledCalls.id,origin.callId)).limit(1);
 const[operation]=call?await tx.select().from(subscriptionControlledOperations).where(eq(subscriptionControlledOperations.id,call.operationId)).limit(1):[];
 const[fact]=await tx.select().from(subscriptionControlledFacts).where(eq(subscriptionControlledFacts.id,origin.factId)).limit(1);
 const[original]=resource?await tx.select({subscription:subscriptions,scope:subscriptionMerchantScopes}).from(subscriptions).innerJoin(subscriptionMerchantScopes,eq(subscriptionMerchantScopes.subscriptionId,subscriptions.id)).where(eq(subscriptions.id,resource.subscriptionId)).limit(1):[];
 const validate=validateOriginalControlledCharge({resource,call,operation,fact,original},input,origin);
 if(!resource)mismatch();
 const journal=await readComposedControlledProviderJournal(tx,resource.id,composition);
 return validate(journal);
}
/** Common-resource ancestry may share one explicitly composed raw journal;
 * its final fresh certificate remains mandatory. No lock, business verdict,
 * bank eligibility or caller closure is supplied by this reader. */
export async function readOriginalControlledChargeAuthorities(tx:Tx,requested:{resourceId:string;occurrences:readonly{cash:ControlledCashEvidence;origin:ControlledCashOrigin}[]},composition?:ControlledJournalComposition){
 if(!z.uuid().safeParse(requested.resourceId).success||!requested.occurrences.length||requested.occurrences.length>5000
  ||new Set(requested.occurrences.map(row=>`${row.origin.callId}:${row.origin.factId}`)).size!==requested.occurrences.length
  ||requested.occurrences.some(row=>!controlledCashOrigin.safeParse(row.origin).success||row.origin.resourceId!==requested.resourceId))mismatch();
 const[actual]=await tx.select({resource:subscriptionControlledResources,postgresFingerprint:sql<string>`encode(sha256(convert_to(to_jsonb(${subscriptionControlledResources})::text,'UTF8')),'hex')`}).from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,requested.resourceId)).limit(1);
 if(!actual||!/^[a-f0-9]{64}$/.test(actual.postgresFingerprint))mismatch();const resource=actual.resource;
 const[original]=await tx.select({subscription:subscriptions,scope:subscriptionMerchantScopes}).from(subscriptions).innerJoin(subscriptionMerchantScopes,eq(subscriptionMerchantScopes.subscriptionId,subscriptions.id)).where(eq(subscriptions.id,resource.subscriptionId)).limit(1);
 const journal=await readComposedControlledProviderJournal(tx,resource.id,composition);
 if(!original)mismatch();
 const identities=new Set([`subscription_controlled_resources:${resource.id}`,`subscriptions:${original.subscription.id}`,`subscription_merchant_scopes:${original.scope.subscriptionId}`,
  ...journal.operations.map(row=>`subscription_controlled_operations:${row.id}`),...journal.calls.map(row=>`subscription_controlled_calls:${row.id}`),...journal.facts.map(row=>`subscription_controlled_facts:${row.id}`),
  ...journal.finishes.map(row=>`subscription_controlled_finishes:${row.callId}`),...journal.stops.map(row=>`subscription_controlled_stops:${row.callId}`),...journal.verifications.map(row=>`subscription_controlled_verifications:${row.operationId}`),
  ...journal.chargeOrigins.map(row=>`subscription_controlled_charge_origins:${row.receiptId}`),...journal.closures.map(row=>`subscription_controlled_closures:${row.resourceId}`)]);
 if(identities.size!==journal.count+2||identities.size>5000)mismatch();
 const calls=new Map(journal.calls.map(row=>[row.id,row])),operations=new Map(journal.operations.map(row=>[row.id,row])),facts=new Map(journal.facts.map(row=>[row.id,row]));
 const authorities=requested.occurrences.map(({cash,origin})=>{const call=calls.get(origin.callId),operation=call?operations.get(call.operationId):undefined,fact=facts.get(origin.factId);
  return validateOriginalControlledCharge({resource,call,operation,fact,original},cash,origin)(journal);
 });
 return{resource,postgresFingerprint:actual.postgresFingerprint,historyRevision:journal.revision,historyCount:journal.count,physicalCount:identities.size,authorities};
}
export async function originalControlledChargeAuthority(ctx:ServiceContext,input:ControlledCashEvidence,origin:ControlledCashOrigin){
 await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`controlled-provider:${origin.resourceId}`}))`);
 await ctx.tx.select({id:subscriptionControlledResources.id}).from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,origin.resourceId)).limit(1).for("update");
 return readOriginalControlledChargeAuthority(ctx.tx,input,origin);
}
export async function retainControlledChargeOrigin(ctx:ServiceContext,receiptId:string,authority:Awaited<ReturnType<typeof originalControlledChargeAuthority>>){
 const binding=authority.controlledOrigin;
 const[receipt]=await ctx.tx.select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.id,receiptId)).limit(1);
 const cash=authority.controlledCash;
 if(!receipt||receipt.subscriptionId!==authority.subscription.id||receipt.providerPlatformAccountId!==cash.providerPlatformAccountId||receipt.chargeAccountId!==(cash.providerAccountId??null)
  ||receipt.providerSubscriptionRef!==cash.providerSubscriptionRef||receipt.providerInvoiceRef!==cash.providerInvoiceRef||receipt.providerPaymentIntentRef!==cash.providerPaymentIntentRef
  ||receipt.amountMinor!==cash.amountMinor||receipt.currency!==cash.currency||receipt.providerChargeRef!==null&&cash.providerChargeRef!==undefined&&receipt.providerChargeRef!==cash.providerChargeRef)mismatch();
 const[prior]=await ctx.tx.select().from(subscriptionControlledChargeOrigins).where(eq(subscriptionControlledChargeOrigins.receiptId,receiptId)).limit(1);
 if(prior){if(prior.resourceId!==binding.resourceId)mismatch();return;}
 // The deferred causal guard additionally refuses adoption of any older
 // phase/generation-owned receipt, including the same amount/account.
 await ctx.tx.execute(sql`select set_config('freeholder.controlled_provider_v1','1',true)`);
 await ctx.tx.insert(subscriptionControlledChargeOrigins).values({receiptId,...binding});
}
