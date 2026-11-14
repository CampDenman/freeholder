// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: debt-observing GET coverage, never permission to move money.
import { eq,inArray,sql,type SQL } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { ServiceError,type ServiceContext } from "@/core/service";
import { subscriptions } from "@/modules/subscriptions/schema";
import { subscriptionControlledResources } from "@/modules/subscriptions/controlled-provider-schema";
import { subscriptionControlledCollections,subscriptionControlledQuotes } from "@/modules/subscriptions/controlled-provider-collection-schema";
import { CONTROLLED_COLLECTION_PROTOCOL } from "@/modules/subscriptions/controlled-provider-collection-contract";
import { controlledProviderCoverage } from "@/modules/subscriptions/controlled-provider-coverage";
import { controlledProviderJournal } from "@/modules/subscriptions/controlled-provider-proof";
import { authenticatedControlledQuote } from "@/modules/subscriptions/controlled-provider-quote-proof";
import { readControlledCashObservationSource } from "@/modules/subscriptions/controlled-provider-cash-observation-source";
import { readControlledCashInspectionAncestry } from "@/modules/subscriptions/controlled-provider-cash-inspection-ancestry";
import { controlledCashInspectionLineageWitness } from "@/modules/subscriptions/controlled-cash-inspection-lineage";
import { subscriptionProviderScheduleOperations } from "@/modules/subscriptions/provider-schedule-schema";
import { scheduleCallerHasStopped } from "@/modules/subscriptions/provider-schedule-proof";
import { originalProviderReadsFinished } from "@/modules/subscriptions/provider-schedule-read-proof";
import { originalProviderReadAdmission,stoppedProviderRead,verifiedProviderReadProof } from "@/modules/subscriptions/provider-read-signatures";
import { subscriptionProviderReadTickets,subscriptionProviderReadFinishes,subscriptionProviderReadStops } from "@/modules/subscriptions/provider-read-ownership-schema";
import { parentFinancialGraph,lockControlledParentMoney } from "./controlled-provider-financial-parent";
import { controlledFinancialWitness,controlledFinancialEntries } from "./controlled-provider-financial-witness";
import { requireControlledFinancialProtocol } from "./controlled-provider-financial-protocol";
import { controlledObservationEntries,type ObservationFingerprint } from "./controlled-cash-observation-revision";
import { merchantTaxDigest } from "./merchant-tax-store";
import { originalProrationCardReadRows } from "@/modules/subscriptions/proration-card-read-proof";
import { merchantPaymentDispatches,merchantPaymentDispatchFinishes,merchantPaymentDispatchStops } from "./merchant-payment-recovery-schema";
import { cashInspectionCallersClosed } from "./merchant-cash-inspection-evidence";
import { cashInspectionStops } from "./merchant-cash-inspection-stops";
import { originalCashCallersFinished,originalCashRecoveryFinancialWitness } from "./original-cash-recovery-store";
import { merchantFeeRefunds } from "./merchant-collection-schema";
import { merchantCashReturnInspections,merchantCashReturnInspectionFinishes,merchantRefundRequests,merchantRefundDispatches,merchantRefundDispatchFinishes,merchantRefundDispatchStops } from "./merchant-refund-schema";
import { merchantRefundStateReads,merchantRefundStateReadFinishes } from "./merchant-refund-current-schema";

type Graph=Awaited<ReturnType<typeof parentFinancialGraph>>;
type CallerGraph=Pick<Graph,"money"|"receipts">;
export type ControlledCashObservationInput={collectionId:string;receiptId:string;requiredProtocol:typeof CONTROLLED_COLLECTION_PROTOCOL;inspectionId?:string};
function refuse():never{throw new ServiceError("conflict","Restore complete authenticated original observation, parent ownership, privacy and actual caller coverage before another bank GET; retained money debt is not payment authority.");}
const ids=(values:readonly string[])=>values.length?sql.join(values.map(id=>sql`${id}::uuid`),sql`, `):sql`null::uuid`;
const record=z.record(z.string(),z.unknown());

/** All original namespaces are selected through actual receipt or payment
 * observation FKs. This also sees a bare admitted inspection before callbacks
 * and a namespace-bound callback whose canonical parent is still NULL. */
function namespaceMember(graph:CallerGraph,platform:SQL,account:SQL,ref:SQL){return sql`(
 exists(select 1 from subscription_provider_charge_receipts original where original.id in(${ids(graph.receipts.map(row=>row.id))})
  and original.provider_platform_account_id=${platform} and original.charge_account_id is not distinct from ${account} and original.provider_payment_intent_ref=${ref})
 or exists(select 1 from merchant_payment_observations original where original.payment_id in(${ids(graph.money.map(row=>row.id))})
  and original.provider_platform_account_id=${platform} and original.charge_account_id is not distinct from ${account} and original.provider_ref=${ref}))`;}

export async function readControlledOriginalCallers(ctx:ServiceContext,graph:CallerGraph,subscriptionIds:string[]){
 const unfinished:Array<{kind:"legacy_schedule"|"legacy_read"|"payment_dispatch"|"card_read"|"original_cash"|"historical_fee"|"cash_inspection"|"refund_dispatch"|"refund_read";id:string}>=[];
 const operations=await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(inArray(subscriptionProviderScheduleOperations.subscriptionId,subscriptionIds)).limit(5001);
 if(operations.length>5000||operations.some(row=>merchantTaxDigest(row.originalRequest)!==row.requestDigest))refuse();
 for(const row of operations)if(!scheduleCallerHasStopped(row)||!originalProviderReadsFinished(row))unfinished.push({kind:"legacy_schedule",id:row.id});
 // Normalized read tickets are independent admissions, including an admission
 // committed before its JSON journal callback. A later successful GET cannot
 // finish another ticket or replace its original cryptographic caller.
 const tickets=await ctx.tx.select().from(subscriptionProviderReadTickets).where(inArray(subscriptionProviderReadTickets.subscriptionId,subscriptionIds)).limit(5001);
 const finishes=tickets.length?await ctx.tx.select().from(subscriptionProviderReadFinishes).where(inArray(subscriptionProviderReadFinishes.readId,tickets.map(row=>row.readId))).limit(5001):[];
 const stops=await ctx.tx.select().from(subscriptionProviderReadStops).where(inArray(subscriptionProviderReadStops.subscriptionId,subscriptionIds)).limit(5001);
 if(tickets.length+finishes.length+stops.length>5000)refuse();
 for(const ticket of tickets){
  const operation=operations.find(row=>row.id===ticket.operationId),finish=finishes.find(row=>row.readId===ticket.readId),stop=stops.find(row=>row.readId===ticket.readId);
  if(!operation||ticket.subscriptionId!==operation.subscriptionId||ticket.admissionDigest!==merchantTaxDigest(ticket.admission)||ticket.admission.readId!==ticket.readId||ticket.admission.operationId!==operation.id
   ||ticket.admission.requestDigest!==operation.requestDigest||!originalProviderReadAdmission(ticket.admission)||finish&&stop)refuse();
  if(!finish&&!stop)unfinished.push({kind:"legacy_read",id:ticket.readId});
  if(stop){const history=operation.providerObservation.history;
   if(stop.operationId!==operation.id||stop.subscriptionId!==operation.subscriptionId||stop.proofDigest!==merchantTaxDigest(stop.proof)||!Array.isArray(history)
    ||!history.some(value=>{const entry=record.safeParse(value);return entry.success&&entry.data.source==="provider_read_stop_reviewed"&&record.safeParse(entry.data.proof).success&&merchantTaxDigest(entry.data.proof)===stop.proofDigest&&stoppedProviderRead(ticket.admission,entry.data,operation.subscriptionId);}))refuse();}
  if(finish){const original=verifiedProviderReadProof(ticket.admission.ownership,"admission"),actual=verifiedProviderReadProof(finish.proof,"finish");
   if(!original||!actual||finish.proofDigest!==merchantTaxDigest(finish.proof)||actual.publicKey!==original.publicKey||actual.payload.admissionDigest!==merchantTaxDigest(ticket.admission)
    ||actual.payload.readId!==ticket.readId||actual.payload.operationId!==operation.id||actual.payload.subscriptionId!==operation.subscriptionId||actual.payload.requestDigest!==operation.requestDigest
    ||actual.payload.callerId!==ticket.admission.callerId||actual.payload.completionDigest!==ticket.admission.completionDigest||!["returned","threw"].includes(String(actual.payload.outcome)))refuse();}
 }
 // Historical stop rows without normalized tickets still need their real
 // original JSON admission. Do not invent a normalized birth retrospectively.
 for(const stop of stops){if(tickets.some(row=>row.readId===stop.readId))continue;const operation=operations.find(row=>row.id===stop.operationId),history=operation?.providerObservation.history;
  if(!operation||stop.subscriptionId!==operation.subscriptionId||!Array.isArray(history)||stop.proofDigest!==merchantTaxDigest(stop.proof)||!history.some(value=>{const admission=record.safeParse(value);
   return admission.success&&admission.data.readId===stop.readId&&history.some(actual=>{const entry=record.safeParse(actual);return entry.success&&entry.data.source==="provider_read_stop_reviewed"&&record.safeParse(entry.data.proof).success&&merchantTaxDigest(entry.data.proof)===stop.proofDigest&&stoppedProviderRead(admission.data,entry.data,operation.subscriptionId);});}))refuse();}
 const paymentCalls=graph.money.length?await ctx.tx.select({call:merchantPaymentDispatches,finish:merchantPaymentDispatchFinishes,stop:merchantPaymentDispatchStops}).from(merchantPaymentDispatches)
  .leftJoin(merchantPaymentDispatchFinishes,eq(merchantPaymentDispatchFinishes.dispatchId,merchantPaymentDispatches.id)).leftJoin(merchantPaymentDispatchStops,eq(merchantPaymentDispatchStops.dispatchId,merchantPaymentDispatches.id))
  .where(inArray(merchantPaymentDispatches.paymentId,graph.money.map(row=>row.id))).limit(5001):[];
 if(paymentCalls.length+paymentCalls.filter(row=>row.finish).length+paymentCalls.filter(row=>row.stop).length>5000)refuse();
 for(const{call,finish,stop}of paymentCalls){if(finish&&stop||finish&&finish.callerInstanceId!==call.caller.id||stop&&(stop.callerInstanceId!==call.caller.id||stop.requestDigest!==call.requestDigest))refuse();
  if(!finish&&!stop)unfinished.push({kind:"payment_dispatch",id:call.id});}
 for(const row of await originalProrationCardReadRows(ctx.tx,graph.money.map(row=>row.id)))if(!row.finish&&!row.stop)unfinished.push({kind:"card_read",id:row.read.id});
 const recovery=await originalCashRecoveryFinancialWitness(ctx.tx,graph.money.map(row=>row.id),graph.receipts.map(row=>row.id));
 if(recovery.operations.some(operation=>recovery.facts.some(f=>f.operationId===operation.id&&f.kind==="finish")&&recovery.facts.some(f=>f.operationId===operation.id&&f.kind==="stop")))refuse();
 for(const operation of recovery.operations)if(!originalCashCallersFinished({operations:[operation],facts:recovery.facts}))unfinished.push({kind:"original_cash",id:operation.id});
 const feeOperations=graph.money.length||graph.receipts.length?await ctx.tx.select().from(merchantFeeRefunds).where(sql`(${merchantFeeRefunds.paymentId} in(${ids(graph.money.map(row=>row.id))}) or ${merchantFeeRefunds.originalChargeReceiptId} in(${ids(graph.receipts.map(row=>row.id))}))`).limit(5001):[];
 if(feeOperations.length>5000)refuse();for(const fee of feeOperations)if(!recovery.facts.some(f=>f.kind==="legacy_fee_stop"&&f.evidence.originalFeeOperationId===fee.id&&f.evidence.originalFeeDigest===merchantTaxDigest(fee)))unfinished.push({kind:"historical_fee",id:fee.id});
 const inspectionScope=namespaceMember(graph,sql`${merchantCashReturnInspections.providerPlatformAccountId}`,sql`${merchantCashReturnInspections.chargeAccountId}`,sql`${merchantCashReturnInspections.originalPaymentRef}`);
 const inspections=await ctx.tx.select().from(merchantCashReturnInspections).where(inspectionScope).limit(5001);
 const inspectionFinishes=inspections.length?await ctx.tx.select().from(merchantCashReturnInspectionFinishes).where(inArray(merchantCashReturnInspectionFinishes.inspectionId,inspections.map(row=>row.id))).limit(5001):[];
 const inspectionStops=await cashInspectionStops(ctx.tx,inspections);
 if(inspections.length+inspectionFinishes.length+inspectionStops.length>5000||inspectionStops.some(stop=>inspectionFinishes.some(f=>f.inspectionId===stop.inspectionId))
  ||!cashInspectionCallersClosed(inspections.filter(row=>inspectionFinishes.some(f=>f.inspectionId===row.id)),inspectionFinishes))refuse();
 const unfinishedInspectionIds=inspections.filter(row=>!inspectionFinishes.some(f=>f.inspectionId===row.id)&&!inspectionStops.some(stop=>stop.inspectionId===row.id)).map(row=>row.id).sort();
 unfinished.push(...unfinishedInspectionIds.map(id=>({kind:"cash_inspection" as const,id})));
 const requestScope=namespaceMember(graph,sql`${merchantRefundRequests.providerPlatformAccountId}`,sql`${merchantRefundRequests.chargeAccountId}`,sql`${merchantRefundRequests.originalPaymentRef}`);
 const requests=await ctx.tx.select().from(merchantRefundRequests).where(requestScope).limit(5001),requestIds=requests.map(row=>row.id);
 const calls=requestIds.length?await ctx.tx.select().from(merchantRefundDispatches).where(inArray(merchantRefundDispatches.requestId,requestIds)).limit(5001):[];
 const callFinishes=calls.length?await ctx.tx.select().from(merchantRefundDispatchFinishes).where(inArray(merchantRefundDispatchFinishes.dispatchId,calls.map(row=>row.id))).limit(5001):[];
 const callStops=calls.length?await ctx.tx.select().from(merchantRefundDispatchStops).where(inArray(merchantRefundDispatchStops.dispatchId,calls.map(row=>row.id))).limit(5001):[];
 const reads=requestIds.length?await ctx.tx.select().from(merchantRefundStateReads).where(inArray(merchantRefundStateReads.requestId,requestIds)).limit(5001):[];
 const readFinishes=reads.length?await ctx.tx.select().from(merchantRefundStateReadFinishes).where(inArray(merchantRefundStateReadFinishes.readId,reads.map(row=>row.id))).limit(5001):[];
 if([requests,calls,callFinishes,callStops,reads,readFinishes].some(rows=>rows.length>5000)||calls.some(call=>{
  const request=requests.find(row=>row.id===call.requestId),finish=callFinishes.find(row=>row.dispatchId===call.id),stop=callStops.find(row=>row.dispatchId===call.id);
  if(!finish&&!stop)unfinished.push({kind:"refund_dispatch",id:call.id});
  return !request||request.requestDigest!==merchantTaxDigest(request.originalRequest)||call.requestDigest!==request.requestDigest||finish&&stop
   ||finish&&finish.callerInstanceId!==call.caller.id||stop&&(stop.callerInstanceId!==call.caller.id||stop.requestDigest!==call.requestDigest);
 })||reads.some(read=>!requests.some(row=>row.id===read.requestId&&row.requestDigest===read.requestDigest))
  ||readFinishes.some(f=>!reads.some(read=>read.id===f.readId&&read.caller.id===f.callerInstanceId&&["returned","threw"].includes(f.outcome))))refuse();
 for(const read of reads)if(!readFinishes.some(f=>f.readId===read.id))unfinished.push({kind:"refund_read",id:read.id});
 return{inspectionIds:inspections.map(row=>row.id),requestIds,unfinishedInspectionIds,unfinished,inspectionAdmissions:inspections,inspectionFinishes,inspectionStops};
}

async function snapshot(ctx:ServiceContext,input:ControlledCashObservationInput,subscriptionId:string,resourceId:string){
 const graph=await parentFinancialGraph(ctx,subscriptionId);await lockControlledParentMoney(ctx,graph);
 const source=await readControlledCashObservationSource(ctx.tx,input),financial=await controlledFinancialWitness(ctx.tx,{subscriptionIds:[subscriptionId],paymentIds:graph.money.map(row=>row.id),receiptIds:graph.receipts.map(row=>row.id)});
 if(financial.incomplete)refuse();
 const sourceSubscriptionIds=[...new Set([subscriptionId,...financial.history.resources.map(row=>row.subscriptionId),...graph.receipts.map(row=>row.subscriptionId),...graph.aliases.flatMap(row=>row.subscriptionId?[row.subscriptionId]:[])])].sort();
 if(sourceSubscriptionIds.length>5000)refuse();
 const transports=[];for(const id of sourceSubscriptionIds)transports.push({subscriptionId:id,coverage:await controlledProviderCoverage(ctx.tx,{subscriptionId:id})});
 if(source.subscriptionId!==subscriptionId||source.resourceId!==resourceId||!graph.fullInvoices.some(row=>row.id===source.invoiceId))refuse();
 const[parent]=await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id,subscriptionId)).limit(1);if(!parent||graph.fullInvoices.some(row=>row.contactId!==parent.contactId))refuse();
 const resourceIds=[...new Set(transports.flatMap(row=>row.coverage.resourceIds))],quoteIds=financial.targets?.quotes.map(row=>row.id)??[];
 if(resourceIds.length>5000||quoteIds.length>5000)refuse();
 const resources=await ctx.tx.select().from(subscriptionControlledResources).where(inArray(subscriptionControlledResources.id,resourceIds)).orderBy(subscriptionControlledResources.id).limit(5001);
 const quotes=quoteIds.length?await ctx.tx.select().from(subscriptionControlledQuotes).where(inArray(subscriptionControlledQuotes.id,quoteIds)).orderBy(subscriptionControlledQuotes.id).limit(5001):[];
 const sourceParents=await ctx.tx.select().from(subscriptions).where(inArray(subscriptions.id,sourceSubscriptionIds)).limit(5001);
 if(resources.length!==resourceIds.length||quotes.length!==quoteIds.length||sourceParents.length!==sourceSubscriptionIds.length||sourceParents.some(row=>row.contactId!==parent.contactId))refuse();
 const quoteEvidence=[];
 for(const quote of quotes){const resource=resources.find(row=>row.id===quote.resourceId);if(!resource)refuse();const journal=await controlledProviderJournal(ctx.tx,resource.id);
  if(quote.redactedAt){if(quote.input!==null||quote.review!==null||graph.controlled.targets?.collections.some(row=>row.quoteId===quote.id)||journal.closures.length!==1||journal.closures[0]?.kind!=="zero_transport")refuse();
   quoteEvidence.push({id:quote.id,inputDigest:quote.inputDigest,reviewDigest:quote.reviewDigest,quoteDigest:quote.quoteDigest});
  }else{const authenticated=authenticatedControlledQuote(quote,resource,journal);quoteEvidence.push({id:quote.id,quoteDigest:quote.quoteDigest,calendar:authenticated.calendar.verification.actualResultDigest,customer:authenticated.customer.verification.actualResultDigest,native:authenticated.native.verification.actualResultDigest,update:authenticated.update.verification.actualResultDigest});}
 }
 const callers=await readControlledOriginalCallers(ctx,graph,sourceSubscriptionIds);
 // Ownership uses the actual current aliases independently of immutable quote
 // economics. A shared platform tax profile never adopts another seller.
 const[ownership]=await ctx.tx.execute<{valid:boolean}>(sql`select exists(select 1 from invoices i join subscription_market_policies s on s.subscription_id=${subscriptionId}::uuid
  join invoice_market_policies p on p.invoice_id=i.id where i.id=${source.invoiceId}::uuid and i.contact_id=${parent.contactId}::uuid
   and p.model=s.model and p.seller_user_id is not distinct from s.seller_user_id and p.merchant_contact_id is not distinct from s.merchant_contact_id
   and p.provider_account_id is not distinct from s.provider_account_id and p.site_fee_bps=s.site_fee_bps) as valid`);
 if(ownership?.valid!==true)refuse();
 const[profileCoverage]=await ctx.tx.execute<{complete:boolean}>(sql`with frozen as(
  select t.profile_id,t.profile_version from subscription_commercial_terms t where t.subscription_id in(${ids(sourceSubscriptionIds)})
  union select q.profile_id,q.profile_version from subscription_controlled_quotes q where q.id in(${ids(quoteIds)})
 ) select not exists(select 1 from frozen f left join merchant_tax_profiles p on p.id=f.profile_id
  left join merchant_tax_profile_versions v on v.profile_id=f.profile_id and v.version=f.profile_version where p.id is null or v.id is null) as complete`);
 if(profileCoverage?.complete!==true)refuse();
 // Include full actual privacy rows, including erased/held money debt. GET
 // coverage does not turn those records into a financial-safety assertion.
 const extra=await ctx.tx.execute<{table:string;id:string;fingerprint:string}>(sql`with profiles as(
  select t.profile_id,t.profile_version from subscription_commercial_terms t where t.subscription_id in(${ids(sourceSubscriptionIds)})
  union select q.profile_id,q.profile_version from subscription_controlled_quotes q where q.id in(${ids(quoteIds)})
 ), identities as(
  select ${parent.contactId}::uuid as id union select p.contact_id from merchant_tax_profiles p join profiles f on f.profile_id=p.id where p.contact_id is not null
  union select p.merchant_contact_id from subscription_market_policies p where p.subscription_id in(${ids(sourceSubscriptionIds)}) and p.merchant_contact_id is not null
 )
 select 'merchant_tax_profiles' as table,p.id::text as id,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') as fingerprint from merchant_tax_profiles p where p.id in(select profile_id from profiles)
 union all select 'merchant_tax_profile_versions',p.id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from merchant_tax_profile_versions p where exists(select 1 from profiles f where f.profile_id=p.profile_id and f.profile_version=p.version)
 union all select 'contacts',p.id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from contacts p where p.id in(select id from identities)
 union all select 'data_requests',p.id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from data_requests p where p.contact_id in(select id from identities)
 union all select 'privacy_retention_exceptions',p.id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from privacy_retention_exceptions p join data_requests r on r.id=p.data_request_id where r.contact_id in(select id from identities)
 union all select 'subscriptions',p.id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from subscriptions p where p.id in(${ids(sourceSubscriptionIds)})
 union all select 'subscription_commercial_terms',p.id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from subscription_commercial_terms p where p.subscription_id in(${ids(sourceSubscriptionIds)})
 union all select 'subscription_merchant_scopes',p.subscription_id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from subscription_merchant_scopes p where p.subscription_id in(${ids(sourceSubscriptionIds)})
 union all select 'subscription_market_policies',p.subscription_id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from subscription_market_policies p where p.subscription_id in(${ids(sourceSubscriptionIds)})
 union all select 'subscription_provider_schedule_resources',p.subscription_id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from subscription_provider_schedule_resources p where p.subscription_id in(${ids(sourceSubscriptionIds)})
 union all select 'subscription_provider_schedule_operations',p.id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from subscription_provider_schedule_operations p where p.subscription_id in(${ids(sourceSubscriptionIds)})
 union all select 'subscription_provider_read_tickets',p.read_id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from subscription_provider_read_tickets p where p.subscription_id in(${ids(sourceSubscriptionIds)})
 union all select 'subscription_provider_read_finishes',p.read_id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from subscription_provider_read_finishes p join subscription_provider_read_tickets r on r.read_id=p.read_id where r.subscription_id in(${ids(sourceSubscriptionIds)})
 union all select 'subscription_provider_read_stops',p.read_id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from subscription_provider_read_stops p where p.subscription_id in(${ids(sourceSubscriptionIds)})
 union all select 'merchant_cash_return_inspections',p.id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from merchant_cash_return_inspections p where p.id in(${ids(callers.inspectionIds)})
 union all select 'merchant_cash_return_inspection_finishes',p.inspection_id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from merchant_cash_return_inspection_finishes p where p.inspection_id in(${ids(callers.inspectionIds)})
 union all select 'merchant_cash_return_inspection_stops',p.inspection_id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from merchant_cash_return_inspection_stops p where p.inspection_id in(${ids(callers.inspectionIds)})
 union all select 'merchant_cash_return_primary_observations',p.id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from merchant_cash_return_primary_observations p where p.inspection_id in(${ids(callers.inspectionIds)})
 union all select 'merchant_cash_return_observations',p.id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from merchant_cash_return_observations p where p.inspection_id in(${ids(callers.inspectionIds)})
 union all select 'merchant_refund_observations',p.id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from merchant_refund_observations p where p.inspection_id in(${ids(callers.inspectionIds)}) or p.request_id in(${ids(callers.requestIds)}) or ${namespaceMember(graph,sql`p.provider_platform_account_id`,sql`p.charge_account_id`,sql`p.payment_provider_ref`)}
 union all select 'merchant_refund_observation_captures',p.id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from merchant_refund_observation_captures p join merchant_refund_observations r on r.id=p.observation_id where r.inspection_id in(${ids(callers.inspectionIds)}) or r.request_id in(${ids(callers.requestIds)}) or ${namespaceMember(graph,sql`r.provider_platform_account_id`,sql`r.charge_account_id`,sql`r.payment_provider_ref`)}
 union all select 'merchant_refund_requests',p.id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from merchant_refund_requests p where p.id in(${ids(callers.requestIds)})
 union all select 'merchant_refund_dispatches',p.id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from merchant_refund_dispatches p where p.request_id in(${ids(callers.requestIds)})
 union all select 'merchant_refund_dispatch_finishes',p.dispatch_id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from merchant_refund_dispatch_finishes p join merchant_refund_dispatches r on r.id=p.dispatch_id where r.request_id in(${ids(callers.requestIds)})
 union all select 'merchant_refund_dispatch_stops',p.dispatch_id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from merchant_refund_dispatch_stops p join merchant_refund_dispatches r on r.id=p.dispatch_id where r.request_id in(${ids(callers.requestIds)})
 union all select 'merchant_refund_state_reads',p.id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from merchant_refund_state_reads p where p.request_id in(${ids(callers.requestIds)})
 union all select 'merchant_refund_state_read_finishes',p.read_id::text,encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') from merchant_refund_state_read_finishes p join merchant_refund_state_reads r on r.id=p.read_id where r.request_id in(${ids(callers.requestIds)})
 order by 1,2 limit 5001`);
 if(extra.length>5000||!extra.some(row=>row.table==="contacts"&&row.id===parent.contactId))refuse();
 const own=input.inspectionId?await readControlledCashInspectionAncestry(ctx.tx,{...input,inspectionId:input.inspectionId}):undefined;
 const lineages=await controlledCashInspectionLineageWitness(ctx.tx,{paymentIds:graph.money.map(row=>row.id),receiptIds:graph.receipts.map(row=>row.id),resourceIds});
 const rows:ObservationFingerprint[]=[...graph.physical.map(row=>({...row,domain:row.table==="subscription_provider_schedule_resources"?"schedule_stable" as const:"postgres_row" as const})),
  ...graph.children.entries.map(row=>({...row,domain:row.table.startsWith("subscription_controlled_")||row.table==="merchant_cash_return_inspection_stops"?"postgres_row" as const:"dependency_canonical" as const})),
  ...[...graph.proration.entries,...graph.controlled.entries,...financial.entries,...transports.flatMap(row=>controlledFinancialEntries(row.coverage.witness)),...lineages.entries,...extra].map(row=>({...row,domain:"postgres_row" as const}))];
 const entries=controlledObservationEntries(rows,own),body={protocol:CONTROLLED_COLLECTION_PROTOCOL,collectionId:input.collectionId,receiptId:input.receiptId,source,transport:transports.map(row=>({subscriptionId:row.subscriptionId,revision:row.coverage.revision,rawFacts:row.coverage.rawFinancialFacts})),quoteEvidence};
 const revision=merchantTaxDigest({...body,entries:entries.full}),causalSourceRevision=merchantTaxDigest({...body,entries:entries.causal});
 if(own&&(own.sourceRevision!==source.sourceRevision||own.parentPreAdmissionRevision!==causalSourceRevision))refuse();
 return{revision,causalSourceRevision,source,entries:entries.full,unfinishedInspectionIds:callers.unfinishedInspectionIds,unfinishedCallers:[...callers.unfinished,...transports.flatMap(row=>row.coverage.unfinishedCalls.map(call=>({kind:"controlled" as const,id:call.callId})))],
  inspectionAdmissions:callers.inspectionAdmissions,inspectionFinishes:callers.inspectionFinishes,inspectionStops:callers.inspectionStops};
}

/** The real service transaction retains contact→resource→parent→canonical→cash
 * locks. No nested .call(), provider I/O, public override or payment mutation.
 * Optional own ancestry is verification of a returned read ONLY; every caller
 * remains in the full closure check, including that read's actual finish. */
async function lockedObservation(ctx:ServiceContext,input:ControlledCashObservationInput){
 if(input.requiredProtocol!==CONTROLLED_COLLECTION_PROTOCOL)refuse();await lockContactIdentityForRead(ctx.tx);await requireControlledFinancialProtocol(ctx.tx);
 const[reference]=await ctx.tx.select({resourceId:subscriptionControlledResources.id,subscriptionId:subscriptionControlledResources.subscriptionId}).from(subscriptionControlledCollections)
  .innerJoin(subscriptionControlledQuotes,eq(subscriptionControlledQuotes.id,subscriptionControlledCollections.quoteId)).innerJoin(subscriptionControlledResources,eq(subscriptionControlledResources.id,subscriptionControlledQuotes.resourceId))
  .where(eq(subscriptionControlledCollections.id,input.collectionId)).limit(1);if(!reference)refuse();
 await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`controlled-provider:${reference.resourceId}`}))`);
 await ctx.tx.select({id:subscriptionControlledResources.id}).from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,reference.resourceId)).limit(1).for("update");
 await ctx.tx.select({id:subscriptions.id}).from(subscriptions).where(eq(subscriptions.id,reference.subscriptionId)).limit(1).for("update");
 const before=await snapshot(ctx,input,reference.subscriptionId,reference.resourceId),after=await snapshot(ctx,input,reference.subscriptionId,reference.resourceId);
 if(before.revision!==after.revision||before.causalSourceRevision!==after.causalSourceRevision)refuse();return before;
}

/** Ordinary coverage for a distinct fresh-human actual-process stop producer.
 * It grants NOTHING and never removes any unfinished caller. The producer must
 * independently prove this ONE actual caller absent using fresh human review
 * before writing the SAME143 HMAC stop; other debt remains represented and can
 * receive its own independent review without a mutual-closure deadlock. */
export async function readControlledCashObservationCoverage(ctx:ServiceContext,input:Omit<ControlledCashObservationInput,"inspectionId">){
 const result=await lockedObservation(ctx,{collectionId:input.collectionId,receiptId:input.receiptId,requiredProtocol:input.requiredProtocol});
 return{...result,suppliesObservationAuthority:false as const,suppliesBankAuthority:false as const,suppliesApplicationAuthority:false as const,suppliesPrincipalAuthority:false as const,suppliesAccessAuthority:false as const};
}
export async function readControlledCashObservationParent(ctx:ServiceContext,input:ControlledCashObservationInput){
 const result=await lockedObservation(ctx,input);if(result.unfinishedCallers.length)refuse();ctx.setSubject("subscription",result.source.subscriptionId);
 return{revision:result.revision,causalSourceRevision:result.causalSourceRevision};
}
