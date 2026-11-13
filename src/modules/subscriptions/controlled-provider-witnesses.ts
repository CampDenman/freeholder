// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Cashless original resources and every actual caller/fact are financial/privacy history.
import { and,eq,inArray,or,sql } from "drizzle-orm";
import type { Tx } from "@/core/service";
import { subscriptionCommercialTerms,subscriptionProviderChargeReceipts } from "./schema";
import { subscriptionControlledResources as resourcesTable,subscriptionControlledOperations as operationsTable,subscriptionControlledCalls as callsTable,
 subscriptionControlledFacts as factsTable,subscriptionControlledFinishes as finishesTable,subscriptionControlledStops as stopsTable,
 subscriptionControlledVerifications as verificationsTable,subscriptionControlledChargeOrigins as originsTable,subscriptionControlledClosures as closuresTable } from "./controlled-provider-schema";
const empty=()=>({resources:[],operations:[],calls:[],facts:[],finishes:[],stops:[],verifications:[],chargeOrigins:[],closures:[],incomplete:false});
/** Select only real subscription/receipt/FK/frozen-term profile ancestry. A
 * missing receipt/invoice never erases an original zero-only or unknown caller.
 * Full SQL row hashes include private bodies without exporting them. */
export async function controlledProviderWitnesses(tx:Tx,input:{subscriptionIds?:readonly string[];receiptIds?:readonly string[];profileId?:string}){
 const subscriptionIds=[...new Set(input.subscriptionIds??[])],receiptIds=[...new Set(input.receiptIds??[])];
 if(subscriptionIds.length+receiptIds.length>5000)return{...empty(),incomplete:true};
 if(!subscriptionIds.length&&!receiptIds.length&&!input.profileId)return empty();
 const receiptResourceIds=receiptIds.length?await tx.select({id:originsTable.resourceId}).from(originsTable).where(inArray(originsTable.receiptId,receiptIds)).limit(5001):[];
 // Preserve missing-bridge debt too: actual bootstrap/cash references in the
 // original charge namespace discover a canonical receipt, never its amount.
 const rawResourceIds=receiptIds.length?await tx.select({id:operationsTable.resourceId}).from(factsTable).innerJoin(callsTable,eq(callsTable.id,factsTable.callId))
  .innerJoin(operationsTable,eq(operationsTable.id,callsTable.operationId)).innerJoin(resourcesTable,eq(resourcesTable.id,operationsTable.resourceId))
  .innerJoin(subscriptionProviderChargeReceipts,and(eq(subscriptionProviderChargeReceipts.subscriptionId,resourcesTable.subscriptionId),
   sql`${resourcesTable.originalScope}->>'providerPlatformAccountId'=${subscriptionProviderChargeReceipts.providerPlatformAccountId}`,
   sql`coalesce(${resourcesTable.originalScope}->>'providerAccountId','')=coalesce(${subscriptionProviderChargeReceipts.chargeAccountId},'')`,
   sql`((${factsTable.actual}->>'kind'='bootstrap_subscription' and ${factsTable.actual}->'raw'->>'id'=${subscriptionProviderChargeReceipts.providerSubscriptionRef})
    or(${factsTable.actual}->>'kind'='cash_observed' and ${factsTable.actual}->'raw'->'cash'->>'providerPaymentIntentRef'=${subscriptionProviderChargeReceipts.providerPaymentIntentRef})
    or(${factsTable.actual}->>'kind'='subscription_list_read' and ${operationsTable.kind}='discover_bootstrap' and exists(
     select 1 from jsonb_array_elements(case when jsonb_typeof(${factsTable.actual}->'raw'->'data')='array' then ${factsTable.actual}->'raw'->'data' else '[]'::jsonb end) discovered
     where discovered->>'id'=${subscriptionProviderChargeReceipts.providerSubscriptionRef}
      and (case jsonb_typeof(discovered->'customer') when 'string' then discovered->>'customer' when 'object' then discovered->'customer'->>'id' else null end)=${resourcesTable.originalScope}->>'providerCustomerRef'
      and discovered->'metadata'->>'freeholder_controlled_subscription_version'='1'
      and discovered->'metadata'->>'freeholder_subscription_id'=${resourcesTable.subscriptionId}::text
      and discovered->'metadata'->>'freeholder_subscription_terms_id'=${resourcesTable.termsId}::text
      and discovered->'metadata'->>'freeholder_controlled_generation'=${resourcesTable.generation}::text
      and discovered->'metadata'->>'freeholder_platform_account_id'=${resourcesTable.originalScope}->>'providerPlatformAccountId'
      and exists(select 1 from subscription_controlled_operations bootstrap where bootstrap.resource_id=${resourcesTable.id} and bootstrap.kind='bootstrap'
       and bootstrap.id::text=discovered->'metadata'->>'freeholder_bootstrap_operation_id' and bootstrap.request_digest=discovered->'metadata'->>'freeholder_bootstrap_request_digest')))
)`))
  .where(inArray(subscriptionProviderChargeReceipts.id,receiptIds)).limit(5001):[];
 if(receiptResourceIds.length>5000||rawResourceIds.length>5000)return{...empty(),incomplete:true};
 const exactResourceIds=[...new Set([...receiptResourceIds,...rawResourceIds].map(row=>row.id))];
 const hash=(row:unknown)=>sql<string>`encode(sha256(convert_to(to_jsonb(${row})::text,'UTF8')),'hex')`;
 const selectors=[...(subscriptionIds.length?[inArray(resourcesTable.subscriptionId,subscriptionIds)]:[]),...(exactResourceIds.length?[inArray(resourcesTable.id,exactResourceIds)]:[]),
  ...(input.profileId?[eq(subscriptionCommercialTerms.profileId,input.profileId)]:[])];
 if(!selectors.length)return empty();
 const resources=await tx.select({id:resourcesTable.id,subscriptionId:resourcesTable.subscriptionId,termsId:resourcesTable.termsId,profileId:subscriptionCommercialTerms.profileId,
  profileVersion:subscriptionCommercialTerms.profileVersion,fingerprint:hash(resourcesTable)}).from(resourcesTable).innerJoin(subscriptionCommercialTerms,eq(subscriptionCommercialTerms.id,resourcesTable.termsId))
  .where(or(...selectors)).orderBy(resourcesTable.id).limit(5001);
 const ids=resources.map(row=>row.id);
 const operations=ids.length?await tx.select({id:operationsTable.id,resourceId:operationsTable.resourceId,kind:operationsTable.kind,fingerprint:hash(operationsTable)})
  .from(operationsTable).where(inArray(operationsTable.resourceId,ids)).orderBy(operationsTable.id).limit(5001):[];
 const operationIds=operations.map(row=>row.id);
 const calls=operationIds.length?await tx.select({id:callsTable.id,operationId:callsTable.operationId,fingerprint:hash(callsTable)}).from(callsTable)
  .where(inArray(callsTable.operationId,operationIds)).orderBy(callsTable.id).limit(5001):[];
 const callIds=calls.map(row=>row.id);
 const facts=callIds.length?await tx.select({id:factsTable.id,callId:factsTable.callId,fingerprint:hash(factsTable)}).from(factsTable).where(inArray(factsTable.callId,callIds)).orderBy(factsTable.id).limit(5001):[];
 const finishes=callIds.length?await tx.select({id:finishesTable.callId,fingerprint:hash(finishesTable)}).from(finishesTable).where(inArray(finishesTable.callId,callIds)).orderBy(finishesTable.callId).limit(5001):[];
 const stops=callIds.length?await tx.select({id:stopsTable.callId,fingerprint:hash(stopsTable)}).from(stopsTable).where(inArray(stopsTable.callId,callIds)).orderBy(stopsTable.callId).limit(5001):[];
 const verifications=operationIds.length?await tx.select({id:verificationsTable.operationId,callId:verificationsTable.callId,fingerprint:hash(verificationsTable)})
  .from(verificationsTable).where(inArray(verificationsTable.operationId,operationIds)).orderBy(verificationsTable.operationId).limit(5001):[];
 const chargeOrigins=ids.length?await tx.select({id:originsTable.receiptId,resourceId:originsTable.resourceId,operationId:originsTable.operationId,callId:originsTable.callId,factId:originsTable.factId,fingerprint:hash(originsTable)})
  .from(originsTable).where(inArray(originsTable.resourceId,ids)).orderBy(originsTable.receiptId).limit(5001):[];
 const closures=ids.length?await tx.select({id:closuresTable.resourceId,kind:closuresTable.kind,fingerprint:hash(closuresTable)}).from(closuresTable).where(inArray(closuresTable.resourceId,ids)).orderBy(closuresTable.resourceId).limit(5001):[];
 return{resources,operations,calls,facts,finishes,stops,verifications,chargeOrigins,closures,incomplete:resources.length+operations.length+calls.length+facts.length+finishes.length+stops.length+verifications.length+chargeOrigins.length+closures.length>5000};
}
export function exportControlledProviderHistory(history:Awaited<ReturnType<typeof controlledProviderWitnesses>>){
 return{resources:history.resources.map(({id,subscriptionId,termsId})=>({resourceId:id,subscriptionId,termsId})),
  operations:history.operations.map(({id,resourceId,kind})=>({operationId:id,resourceId,kind})),calls:history.calls.map(({id,operationId})=>({callId:id,operationId})),
  facts:history.facts.map(({id,callId})=>({factId:id,callId})),actualFinishes:history.finishes.map(({id})=>({callId:id})),independentStops:history.stops.map(({id})=>({callId:id})),
  verifications:history.verifications.map(({id,callId})=>({operationId:id,callId})),actualClosures:history.closures.map(({id,kind})=>({resourceId:id,kind})),originalChargeLinks:history.chargeOrigins.map(({id,resourceId,operationId,callId,factId})=>({receiptId:id,resourceId,operationId,callId,factId}))};
}
