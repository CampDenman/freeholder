// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: a plain original-source reader for the parent cash/refund/principal boundary.
import { and,eq,sql } from "drizzle-orm";
import type { Tx } from "@/core/service";
import { ServiceError } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptionProviderChargeReceipts } from "./schema";
import { subscriptionControlledChargeOrigins,subscriptionControlledResources,subscriptionControlledFacts,subscriptionControlledCalls,subscriptionControlledOperations } from "./controlled-provider-schema";
import { controlledCashEvidence,readOriginalControlledChargeAuthority } from "./controlled-provider-cash-origin";
import { controlledProviderJournal } from "./controlled-provider-proof";
const primaryKinds=new Set(["bootstrap","discover_bootstrap","pause_drafts","read_bootstrap","list_invoices","create_schedule","read_calendar","update_calendar","read_invoice","finalize_invoice","pay_invoice","cancel_calendar","void_invoice","delete_draft"]);
/** verified is ancestry, never paid/refunded/settled authority. The parent must
 * still prove actual principal/route/refunds/disputes/current bank inventory.
 * A missing bridge for an exact controlled namespace cannot fall through as
 * historical/non-controlled. No lookup uses a buyer, present account or amount. */
export async function readControlledReceiptNamespace(tx:Tx,receiptId:string){
 const[receipt]=await tx.select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.id,receiptId)).limit(1);
 if(!receipt)throw new ServiceError("not_found","Restore the actual original canonical receipt before reading controlled ancestry.");
 const[origin]=await tx.select().from(subscriptionControlledChargeOrigins).where(eq(subscriptionControlledChargeOrigins.receiptId,receiptId)).limit(1);
 const candidates=await tx.select({resource:subscriptionControlledResources}).from(subscriptionControlledResources)
  .innerJoin(subscriptionControlledOperations,eq(subscriptionControlledOperations.resourceId,subscriptionControlledResources.id))
  .innerJoin(subscriptionControlledCalls,eq(subscriptionControlledCalls.operationId,subscriptionControlledOperations.id))
  .innerJoin(subscriptionControlledFacts,eq(subscriptionControlledFacts.callId,subscriptionControlledCalls.id))
  .where(and(eq(subscriptionControlledResources.subscriptionId,receipt.subscriptionId),sql`${subscriptionControlledResources.originalScope}->>'providerPlatformAccountId'=${receipt.providerPlatformAccountId}`,
   sql`coalesce(${subscriptionControlledResources.originalScope}->>'providerAccountId','')=coalesce(${receipt.chargeAccountId},'')`,
   sql`((${subscriptionControlledFacts.actual}->>'kind'='bootstrap_subscription' and ${subscriptionControlledFacts.actual}->'raw'->>'id'=${receipt.providerSubscriptionRef}) or (${subscriptionControlledFacts.actual}->>'kind'='cash_observed' and ${subscriptionControlledFacts.actual}->'raw'->'cash'->>'providerPaymentIntentRef'=${receipt.providerPaymentIntentRef})
    or(${subscriptionControlledFacts.actual}->>'kind'='subscription_list_read' and ${subscriptionControlledOperations.kind}='discover_bootstrap' and exists(
     select 1 from jsonb_array_elements(case when jsonb_typeof(${subscriptionControlledFacts.actual}->'raw'->'data')='array' then ${subscriptionControlledFacts.actual}->'raw'->'data' else '[]'::jsonb end) discovered
     where discovered->>'id'=${receipt.providerSubscriptionRef}
      and (case jsonb_typeof(discovered->'customer') when 'string' then discovered->>'customer' when 'object' then discovered->'customer'->>'id' else null end)=${subscriptionControlledResources.originalScope}->>'providerCustomerRef'
      and discovered->'metadata'->>'freeholder_controlled_subscription_version'='1'
      and discovered->'metadata'->>'freeholder_subscription_id'=${subscriptionControlledResources.subscriptionId}::text
      and discovered->'metadata'->>'freeholder_subscription_terms_id'=${subscriptionControlledResources.termsId}::text
      and discovered->'metadata'->>'freeholder_controlled_generation'=${subscriptionControlledResources.generation}::text
      and discovered->'metadata'->>'freeholder_platform_account_id'=${subscriptionControlledResources.originalScope}->>'providerPlatformAccountId'
      and exists(select 1 from subscription_controlled_operations bootstrap where bootstrap.resource_id=${subscriptionControlledResources.id} and bootstrap.kind='bootstrap'
       and bootstrap.id::text=discovered->'metadata'->>'freeholder_bootstrap_operation_id' and bootstrap.request_digest=discovered->'metadata'->>'freeholder_bootstrap_request_digest')))
)`)).limit(5001);
 const resourceIds=[...new Set(candidates.map(row=>row.resource.id))];
 if(!origin&&!resourceIds.length)return{applies:false as const,verified:false,resourceId:null,operationId:null,factId:null,financialCallerDebt:false,principalCallerDebt:false,rawCashReview:false,inventoryCount:0,revision:merchantTaxDigest({receiptId,controlled:false})};
 if(candidates.length>5000||resourceIds.length!==1||!origin||!resourceIds.includes(origin.resourceId))return{applies:true as const,verified:false,resourceId:origin?.resourceId??null,operationId:origin?.operationId??null,factId:origin?.factId??null,
  financialCallerDebt:true,principalCallerDebt:true,rawCashReview:true,inventoryCount:candidates.length,revision:merchantTaxDigest({receipt,origin,resourceIds,incomplete:true})};
 const history=await controlledProviderJournal(tx,origin.resourceId),fact=history.facts.find(row=>row.id===origin.factId);
 if(!fact||fact.actual.kind!=="cash_observed")throw new ServiceError("conflict","Restore the original controlled cash bridge's exact actual positive occurrence.");
 const cash=controlledCashEvidence.parse(fact.actual.raw.cash);
 const authority=await readOriginalControlledChargeAuthority(tx,cash,{resourceId:origin.resourceId,callId:origin.callId,factId:origin.factId});
 const verified=authority.controlledOrigin.operationId===origin.operationId&&authority.controlledOrigin.originalEvidenceDigest===origin.originalEvidenceDigest
  &&cash.providerSubscriptionRef===receipt.providerSubscriptionRef&&cash.providerInvoiceRef===receipt.providerInvoiceRef&&cash.providerPaymentIntentRef===receipt.providerPaymentIntentRef
  &&cash.amountMinor===receipt.amountMinor&&cash.currency===receipt.currency&&(!receipt.providerChargeRef||!cash.providerChargeRef||receipt.providerChargeRef===cash.providerChargeRef);
 const primaryDebt=history.calls.some(call=>history.unfinished.includes(call.id)&&history.operations.some(operation=>operation.id===call.operationId&&primaryKinds.has(operation.kind)));
 let rawCashReview=false;
 for(const occurrence of history.facts){
  if(occurrence.actual.kind!=="cash_observed")continue;
  const actual=controlledCashEvidence.safeParse(occurrence.actual.raw.cash);
  if(!actual.success){rawCashReview=true;continue;}
  // Exact original PI namespace/owner chooses a source, never equal amounts.
  if(actual.data.providerPlatformAccountId!==receipt.providerPlatformAccountId||(actual.data.providerAccountId??null)!==receipt.chargeAccountId||actual.data.providerPaymentIntentRef!==receipt.providerPaymentIntentRef)continue;
  if(actual.data.providerSubscriptionRef!==receipt.providerSubscriptionRef||actual.data.providerInvoiceRef!==receipt.providerInvoiceRef||actual.data.amountMinor!==receipt.amountMinor||actual.data.currency!==receipt.currency
   ||actual.data.providerChargeRef&&receipt.providerChargeRef&&actual.data.providerChargeRef!==receipt.providerChargeRef)rawCashReview=true;
  await readOriginalControlledChargeAuthority(tx,actual.data,{resourceId:origin.resourceId,callId:occurrence.callId,factId:occurrence.id});
 }
 return{applies:true as const,verified,resourceId:origin.resourceId,operationId:origin.operationId,factId:origin.factId,financialCallerDebt:history.unfinished.length>0,principalCallerDebt:primaryDebt,
  rawCashReview:rawCashReview||!verified,inventoryCount:history.count,revision:merchantTaxDigest({receipt,origin,historyRevision:history.revision,verified,rawCashReview})};
}
