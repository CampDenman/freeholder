// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: real current accepted ancestry before a zero-only transport exists.
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { paymentMethods } from "@/modules/invoicing/schema";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptionChargeScope, subscriptionMerchantScope, subscriptionMethodScopeMatches } from "./merchant-scope-contract";
import { subscriptionMerchantScopes } from "./schema";
import { controlledFinancialReadiness } from "./controlled-provider-readiness";
import { originalProductAdmission } from "./provider-phase-products";
import { verifiedOriginalPhaseProduct, verifiedPreparatoryPhaseProducts } from "./provider-phase-product-proof";
import { subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "./provider-schedule-schema";
import { subscriptionControlledResources } from "./controlled-provider-schema";
import type { MerchantControlledSubscriptionScope } from "@/adapters/payments";
export async function requireControlledProviderSchema(ctx:ServiceContext){
 const[ready]=await ctx.tx.execute<{ready:boolean}>(sql`select count(*)=12 as ready from pg_trigger where not tgisinternal and tgenabled in('O','A') and(tgrelid,tgname) in
  ((to_regclass('subscription_controlled_resources'),'subscription_controlled_resources_guard'),(to_regclass('subscription_controlled_operations'),'subscription_controlled_operations_guard'),
   (to_regclass('subscription_controlled_calls'),'subscription_controlled_calls_guard'),(to_regclass('subscription_controlled_facts'),'subscription_controlled_facts_guard'),
   (to_regclass('subscription_controlled_finishes'),'subscription_controlled_finishes_guard'),(to_regclass('subscription_controlled_stops'),'subscription_controlled_stops_guard'),
   (to_regclass('subscription_controlled_verifications'),'subscription_controlled_verifications_guard'),(to_regclass('subscription_controlled_closures'),'subscription_controlled_closures_guard'),(to_regclass('subscription_controlled_charge_origins'),'subscription_controlled_origins_guard'),(to_regclass('subscription_provider_charge_receipts'),'subscription_controlled_charge_origin_guard'),(to_regclass('subscription_provider_schedule_operations'),'subscription_controlled_legacy_charge_guard'),(to_regclass('subscription_provider_schedule_resources'),'subscription_controlled_financial_stop_guard'))`);
 if(!ready?.ready)throw new ServiceError("conflict","Install the complete controlled original caller/fact and authentic canonical cash-origin guards before creating provider resources.");
}
/** Initial admission is limited to a genuinely uncreated provider resource,
 * with only independently verified actual nonfinancial product work. Existing
 * paid/scheduled resources need their separate authentic migration/recovery;
 * a zero bootstrap cannot silently replace them or manufacture old credit. */
export async function initialControlledProviderSource(ctx:ServiceContext,subscriptionId:string){
 await requireControlledProviderSchema(ctx);
 const financialReadiness=await controlledFinancialReadiness(ctx,subscriptionId);
 const{parent,terms}=await originalProductAdmission(ctx,subscriptionId);
 const[resource]=await ctx.tx.select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId,parent.id)).limit(1).for("update");
 const operations=await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.subscriptionId,parent.id)).orderBy(subscriptionProviderScheduleOperations.operationRevision).limit(5001);
 const[scope]=await ctx.tx.select().from(subscriptionMerchantScopes).where(eq(subscriptionMerchantScopes.subscriptionId,parent.id)).limit(1);
 const parsedScope=subscriptionMerchantScope.safeParse(scope);
 const[method]=parent.paymentMethodId?await ctx.tx.select().from(paymentMethods).where(eq(paymentMethods.id,parent.paymentMethodId)).limit(1).for("share"):[];
 const providerProductRef=operations.length?verifiedOriginalPhaseProduct(operations[operations.length-1]!):null;
 if(!resource||!scope||!parsedScope.success||operations.length>5000||!verifiedPreparatoryPhaseProducts(resource,operations)||!providerProductRef
  ||!method||method.status!=="active"||method.provider!=="stripe"||method.contactId!==parent.contactId||!method.providerCustomerRef
  ||!subscriptionMethodScopeMatches(subscriptionChargeScope(parsedScope.data),method))throw new ServiceError("conflict","Restore the actual original uncreated calendar, verified product and active original-account method before controlled preparation.");
 const originalScope:MerchantControlledSubscriptionScope={...subscriptionChargeScope(parsedScope.data),providerApiVersion:"2026-10-28.endive",providerPlatformAccountId:scope.providerPlatformAccountId,
  subscriptionId:parent.id,termsId:terms.id,generation:1,providerCustomerRef:method.providerCustomerRef,providerMethodRef:method.providerMethodRef,providerProductRef,currency:parent.currency,
  interval:terms.snapshot.interval,intervalCount:terms.snapshot.intervalCount,acceptedPeriodEnd:parent.currentPeriodEnd.toISOString(),acceptedTrialEnd:parent.trialEndsAt?.toISOString()??null};
 return{parent,terms,scope,method,resource,operations,originalScope,sourceRevision:merchantTaxDigest({parent,terms,scope,method,resource,operations,originalScope,financialReadiness})};
}
export const retainControlledProviderResource=defineService({name:"subscriptions.retainControlledProviderResource",summary:"Retain the real original accepted zero-only preparation ancestry; no positive phase, application access or replacement bank resource is admitted.",
 kind:"mutation",permission:"system",external:false,writeClass:"money",input:z.object({subscriptionId:z.uuid()}),output:z.object({resourceId:z.uuid(),generation:z.number().int().positive()}),
 handler:async(input,ctx)=>{
  const source=await initialControlledProviderSource(ctx,input.subscriptionId);
  const prior=await ctx.tx.select().from(subscriptionControlledResources).where(eq(subscriptionControlledResources.subscriptionId,input.subscriptionId)).orderBy(subscriptionControlledResources.generation).limit(5001);
  if(prior.length>5000)throw new ServiceError("conflict","Restore every original controlled generation before preparing another resource.");
  if(prior.length){const original=prior[0]!;
   if(prior.length!==1||original.generation!==1||original.termsId!==source.terms.id||merchantTaxDigest(original.originalScope)!==merchantTaxDigest(source.originalScope))
    throw new ServiceError("conflict","Recover the existing real controlled generation before changing its accepted terms, method, namespace or calendar.");
   return{resourceId:original.id,generation:original.generation};
  }
  const id=randomUUID();await ctx.tx.execute(sql`select set_config('freeholder.controlled_provider_v1','1',true)`);
  await ctx.tx.insert(subscriptionControlledResources).values({id,subscriptionId:source.parent.id,termsId:source.terms.id,generation:1,originalScope:source.originalScope,originalSourceRevision:source.sourceRevision});
  ctx.setSubject("subscription",source.parent.id);return{resourceId:id,generation:1};
 }
});

export const assertControlledProviderPreparationReady=defineService({name:"subscriptions.assertControlledProviderPreparationReady",summary:"Require the installed causal schema and actual parent financial coverage reader before any preparatory provider SDK work.",kind:"query",permission:"system",external:false,
 input:z.object({subscriptionId:z.uuid()}),output:z.object({ready:z.literal(true)}),handler:async({subscriptionId},ctx)=>{
  await requireControlledProviderSchema(ctx);await controlledFinancialReadiness(ctx,subscriptionId);return{ready:true as const};
 }});
