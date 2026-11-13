// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Transport9 is ZERO-only. Raw money cannot disappear before cash_observed exists.
import { ServiceError } from "@/core/service";
import type { controlledProviderJournal } from "./controlled-provider-proof";
import type { subscriptionControlledResources } from "./controlled-provider-schema";
type Journal=Awaited<ReturnType<typeof controlledProviderJournal>>;
type Resource=Pick<typeof subscriptionControlledResources.$inferSelect,"id"|"subscriptionId"|"termsId"|"generation"|"originalScope">;
export type ControlledRawFinancialReason="positive_intent"|"positive_invoice"|"positive_invoice_payment"|"unsettled_intent"|"nonzero_invoice"|"nonzero_invoice_line"|"pending_invoice_payment"|"nonzero_recurring_item"|"unproved_bank_document"|"discovery_ancestry";
export type ControlledRawFinancialFact={factId:string;operationId:string;callId:string;kind:string;reportedPositiveMoney:boolean;reasons:ControlledRawFinancialReason[];providerInvoiceRefs:string[];providerIntentRefs:string[]};
function record(value:unknown):Record<string,unknown>|null{return value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;}
const ref=(value:unknown)=>typeof value==="string"?value:typeof record(value)?.id==="string"?String(record(value)!.id):null;
const zero=(value:unknown)=>typeof value==="number"&&Number.isSafeInteger(value)&&value===0;
const positive=(value:unknown)=>typeof value==="number"&&Number.isSafeInteger(value)&&value>0;
/** Caller MUST first obtain the actual authenticated controlledProviderJournal.
 * This plain classifier does not invent a cash receipt, payment, settlement or
 * principal authority. A later zero/successful read never erases an old actual
 * positive/unsettled occurrence or releases an unfinished physical caller.
 * Future approved positive protocols must prove exact original target/namespace
 * and disposition themselves, rather than blanket-filtering these facts. */
export function controlledRawFinancialReview(resource:Resource,history:Journal){
 const facts:ControlledRawFinancialFact[]=[];
 const bootstrap=history.operations.find(operation=>operation.kind==="bootstrap");
 for(const fact of history.facts){
  const call=history.calls.find(row=>row.id===fact.callId),operation=call?history.operations.find(row=>row.id===call.operationId):null;
  if(!call||!operation||operation.resourceId!==resource.id)throw new ServiceError("conflict","Restore the authenticated actual original raw financial caller ancestry.");
  const reasons=new Set<ControlledRawFinancialReason>(),invoiceRefs=new Set<string>(),intentRefs=new Set<string>();let reportedPositiveMoney=false;
  function invoice(value:unknown){const row=record(value);if(!row){reasons.add("unproved_bank_document");return;}const id=ref(row.id);if(id)invoiceRefs.add(id);
   if(positive(row.amount_paid)){reportedPositiveMoney=true;reasons.add("positive_invoice");}
   if(![row.total,row.amount_paid,row.amount_remaining].every(zero)
    ||[row.subtotal,row.amount_due,row.starting_balance,row.ending_balance,row.pre_payment_credit_notes_amount,row.post_payment_credit_notes_amount].some(amount=>amount!==undefined&&!zero(amount)))reasons.add("nonzero_invoice");
  }
  function subscription(value:unknown){const row=record(value);if(!row){reasons.add("unproved_bank_document");return;}
   const latest=record(row.latest_invoice);if(latest)invoice(latest);
   const items=record(row.items);if(items&&Array.isArray(items.data))for(const value of items.data){const item=record(value),price=record(item?.price);
    if(price&&(!zero(price.unit_amount)||price.unit_amount_decimal!==undefined&&price.unit_amount_decimal!=="0"))reasons.add("nonzero_recurring_item");
   }
  }
  const raw=fact.actual.raw;
  // Forward-compatible observation names do not grant any positive protocol.
  // On a later schema these ACKs can commit before its next invoice/PI GET.
  // The nine-family classifier still reports their actual money as review.
  if(["controlled_draft_created","controlled_invoice_updated","controlled_invoice_finalized","controlled_invoice_paid"].includes(fact.actual.kind))invoice(raw);
  if(["controlled_item_created"].includes(fact.actual.kind)&&!zero(raw.amount)){reasons.add("nonzero_invoice_line");const id=ref(raw.invoice);if(id)invoiceRefs.add(id);}
  switch(fact.actual.kind){
   case"intent_read":{
    const id=ref(raw.id);if(id)intentRefs.add(id);
    const payload=record(operation.originalRequest.payload),invoiceRef=ref(payload?.providerInvoiceRef);if(invoiceRef)invoiceRefs.add(invoiceRef);
    if(positive(raw.amount_received)){reportedPositiveMoney=true;reasons.add("positive_intent");}
    if(!zero(raw.amount)||!zero(raw.amount_received)||raw.amount_capturable!==undefined&&!zero(raw.amount_capturable)
     ||!["canceled","succeeded"].includes(String(raw.status)))reasons.add("unsettled_intent");
    break;
   }
   case"invoice_read":invoice(raw);break;
   case"invoice_list_read":
    if(!Array.isArray(raw.data))reasons.add("unproved_bank_document");else for(const row of raw.data)invoice(row);
    break;
   case"invoice_payments_read":
    if(!Array.isArray(raw.data))reasons.add("unproved_bank_document");else for(const value of raw.data){const row=record(value),payment=record(row?.payment),id=ref(payment?.payment_intent),invoiceRef=ref(row?.invoice);
     if(id)intentRefs.add(id);if(invoiceRef)invoiceRefs.add(invoiceRef);
     if(positive(row?.amount_paid)){reportedPositiveMoney=true;reasons.add("positive_invoice_payment");}
     if(!row||!zero(row.amount_paid)||!zero(row.amount_requested)||!["canceled"].includes(String(row.status)))reasons.add("pending_invoice_payment");
    }
    break;
   case"invoice_lines_read":
    if(!Array.isArray(raw.data))reasons.add("unproved_bank_document");else if(raw.data.some(value=>!zero(record(value)?.amount)))reasons.add("nonzero_invoice_line");
    break;
   case"bootstrap_subscription":case"pause_subscription":case"subscription_read":case"calendar_updated":case"calendar_canceled":subscription(raw);break;
   case"subscription_list_read":{
    // This endpoint deliberately lists OTHER subscriptions of the original
    // customer. Only exact original bootstrap lineage (or a conflicting claim
    // to that same original nonce) belongs to this resource's recovery scope.
    const payload=record(operation.originalRequest.payload);
    if(!bootstrap||operation.kind!=="discover_bootstrap"||payload?.bootstrapOperationId!==bootstrap.id||payload.bootstrapRequestDigest!==bootstrap.requestDigest){reasons.add("discovery_ancestry");break;}
    if(!Array.isArray(raw.data)){reasons.add("unproved_bank_document");break;}
    for(const value of raw.data){const row=record(value),tag=record(row?.metadata);
     if(!row||!tag)continue;
     const claimsOriginal=tag.freeholder_bootstrap_operation_id===bootstrap.id;
     if(!claimsOriginal)continue;
     if(tag.freeholder_controlled_subscription_version!=="1"||tag.freeholder_bootstrap_request_digest!==bootstrap.requestDigest||tag.freeholder_subscription_id!==resource.subscriptionId||tag.freeholder_subscription_terms_id!==resource.termsId
      ||tag.freeholder_controlled_generation!==String(resource.generation)||tag.freeholder_platform_account_id!==resource.originalScope.providerPlatformAccountId
      ||ref(row.customer)!==resource.originalScope.providerCustomerRef)reasons.add("discovery_ancestry");
     subscription(row);
    }
    break;
   }
   case"cash_observed":{
    const cash=record(raw.cash);if(!cash||!positive(cash.amountMinor))reasons.add("unproved_bank_document");
    else{reportedPositiveMoney=true;reasons.add("positive_intent");const id=ref(cash.providerPaymentIntentRef),invoiceRef=ref(cash.providerInvoiceRef);if(id)intentRefs.add(id);if(invoiceRef)invoiceRefs.add(invoiceRef);}
    break;
   }
   // A proration_preview (even positive/negative/paid-looking) is NOT an
   // issued invoice or received cash. Static price/product reads are not money.
   default:break;
  }
  if(reasons.size)facts.push({factId:fact.id,operationId:operation.id,callId:call.id,kind:fact.actual.kind,reportedPositiveMoney,reasons:[...reasons].sort(),providerInvoiceRefs:[...invoiceRefs].sort(),providerIntentRefs:[...intentRefs].sort()});
 }
 return{facts,factIds:facts.map(row=>row.factId),rawPositiveFactIds:facts.filter(row=>row.reportedPositiveMoney).map(row=>row.factId),
  unsettledFactIds:facts.filter(row=>row.reasons.some(reason=>!["positive_intent","positive_invoice","positive_invoice_payment"].includes(reason))).map(row=>row.factId),unfinishedCallIds:[...history.unfinished]};
}
