// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: derived disposition of exact raw facts; authenticated coverage is never edited.
import { z } from "zod";
import { merchantTaxDigest } from "./merchant-tax-store";
import { merchantIntentEvidence } from "@/adapters/payments/stripe-merchant-scope";
import { assertControlledInvoiceOrigin,assertControlledComponentLine } from "@/modules/subscriptions/controlled-provider-collection-origin";
import { controlledSubscriptionFactsDigest } from "@/adapters/payments/controlled-subscription-digest";
import { controlledCollectionPayload } from "@/modules/subscriptions/controlled-provider-adapter-contract";
import { controlledCashEvidence } from "@/modules/subscriptions/controlled-provider-cash-origin";
import { readControlledCollectionInventory,originalBootstrapZeroInvoice } from "@/modules/subscriptions/controlled-provider-collection-inventory";
import { controlledRawFinancialReview } from "@/modules/subscriptions/controlled-provider-raw-financial-review";
import { originalControlledCall,finishedControlledCall,stoppedControlledCall } from "@/modules/subscriptions/controlled-provider-proof";
import type { controlledProviderJournal } from "@/modules/subscriptions/controlled-provider-proof";
import type { controlledCollectionState } from "@/modules/subscriptions/controlled-provider-collection-state";
import type { ControlledCashProspectiveProjection,RetainedUnappliedControlledCash } from "./controlled-cash-prospective-context";
type State=Awaited<ReturnType<typeof controlledCollectionState>>;
type History=Awaited<ReturnType<typeof controlledProviderJournal>>;
const object=z.record(z.string(),z.unknown()),records=z.array(object).max(5000),minor=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const bank=z.object({providerInvoiceRef:z.string(),providerSubscriptionRef:z.string(),providerCustomerRef:z.string(),currency:z.string(),status:z.enum(["draft","open","paid","void","uncollectible"]),totalMinor:minor,paidMinor:minor,remainingMinor:minor,
 autoAdvance:z.literal(false),completePayments:z.literal(true),completeLines:z.literal(true),actualInvoice:object,actualPayments:records,actualIntents:records,actualCash:records,actualLines:records,actualPrices:records,suppliesPaidAuthority:z.literal(false),financiallyQuiesced:z.literal(false)});
const result=z.object({providerInvoiceRef:z.string(),manifestDigest:z.string(),customerFinancialDigest:z.string(),exactManifest:z.literal(true),suppliesPaidAuthority:z.literal(false),inventory:bank});
const ref=(value:unknown)=>typeof value==="string"?value:object.safeParse(value).success&&typeof object.parse(value).id==="string"?String(object.parse(value).id):null;
const safeMinor=(value:unknown):value is number=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0;
const empty=(value:unknown)=>value===undefined||value===null||Array.isArray(value)&&value.length===0;
export type ControlledResolvedCash={receiptId:string;paymentId:string;resourceId:string;canonicalInvoiceId:string;providerInvoiceRef:string;providerIntentRef:string;providerChargeRef:string|null;amountMinor:number;currency:string};
/** Only the ordinary reader constructs this projection from the authenticated
 * accepted state and actual canonical receipt/route/payment/observation FKs.
 * This pure policy supplies no signature, DB ownership or public admission. */
export type ControlledRawTarget={resource:State["resource"];history:History;manifest:State["manifest"];binding:State["binding"];proofs:State["proofs"];itemReceipts:State["itemReceipts"];components:State["components"];
 period:Pick<State["terms"]["snapshot"],"periodAmountMinor"|"interval"|"intervalCount">;
 canonicalCount?:number;canonicalPaidMinor:number;canonicalRefundedMinor:number;cash:ControlledResolvedCash[];prospective?:ControlledCashProspectiveProjection;
 calendarAuthority?:{periodStart:string;periodEnd:string;anchor:string;trialEnd:string|null;periodAmountMinor:number;interval:string;intervalCount:number;reviewedPeriodWindows?:readonly{periodStart:string;periodEnd:string}[]}};
/** Actual canonical owners stay in cash. A separately genuine private prewrite
 * context may ALSO represent exact retained bank receipts without a paymentId.
 * This union never changes canonicalPaidMinor or invents a principal counter. */
function cashOwners(target:ControlledRawTarget):readonly(ControlledResolvedCash|RetainedUnappliedControlledCash)[]{return target.prospective?[...target.cash,...target.prospective.receipts]:target.cash;}
function uniqueInvoiceTarget(targets:readonly ControlledRawTarget[],resourceId:string,invoiceRef:string|null){const owners=targets.filter(candidate=>candidate.resource.id===resourceId&&candidate.binding?.providerInvoiceRef===invoiceRef);return owners.length===1?owners[0]:null;}
function authentic(resource:State["resource"],history:History){
 return !history.unfinished.length&&history.count<=5000&&history.operations.every(op=>op.resourceId===resource.id&&merchantTaxDigest(op.originalRequest)===op.requestDigest&&op.originalRequest.scopeDigest===merchantTaxDigest(resource.originalScope))
  &&history.calls.every(call=>{const op=history.operations.find(row=>row.id===call.operationId),finish=history.finishes.find(row=>row.callId===call.id),stop=history.stops.find(row=>row.callId===call.id);
   return !!op&&!!originalControlledCall(op,call)&&!(finish&&stop)&&(finishedControlledCall(op,call,finish??null)||stoppedControlledCall(op,call,stop??null));})
  &&history.facts.every(fact=>history.calls.some(call=>call.id===fact.callId)&&merchantTaxDigest(fact.actual)===fact.actualDigest)
  &&history.verifications.every(verification=>{const call=history.calls.find(row=>row.id===verification.callId),finish=history.finishes.find(row=>row.callId===verification.callId);return call?.operationId===verification.operationId&&finish?.actualResult.outcome==="returned"&&merchantTaxDigest(finish.actualResult.result)===verification.actualResultDigest&&merchantTaxDigest(verification.actualResult)===verification.actualResultDigest;});
}
/** Old transport9 review remains unchanged. Full15 additionally retains actual
 * customer wallet/issued-note review, including a read that threw before any
 * known-zero projection. A later zero can never dispose of these facts. */
export function controlledCustomerRawReview(resource:Pick<State["resource"],"id"|"originalScope">,history:History){
 const zeroMap=(value:unknown)=>{const parsed=object.safeParse(value);return parsed.success&&Object.entries(parsed.data).every(([currency,amount])=>/^[a-z]{3}$/.test(currency)&&amount===0);};
 return history.facts.filter(fact=>{
  const raw=fact.actual.raw;if(fact.actual.kind==="customer_financial_read"){
   const cash=object.safeParse(raw.cash_balance);
   return raw.id!==resource.originalScope.providerCustomerRef||raw.deleted===true||raw.currency!==null&&raw.currency!==resource.originalScope.currency.toLowerCase()||raw.balance!==0||!zeroMap(raw.invoice_credit_balance)
    ||raw.cash_balance!==null&&(!cash.success||ref(cash.data.customer)!==resource.originalScope.providerCustomerRef||!zeroMap(cash.data.available));
  }
  if(fact.actual.kind==="customer_credit_notes_read"){
   const pages=history.facts.filter(row=>row.callId===fact.callId&&row.actual.kind==="customer_credit_notes_read").sort((a,b)=>a.ordinal-b.ordinal);
   return !pages.length||pages.length>50||pages.some((row,index)=>row.actual.raw.has_more!==(index<pages.length-1))||!Array.isArray(raw.data)||raw.data.some(value=>{const note=object.safeParse(value);
    return !note.success||!/^cn_[A-Za-z0-9_]{1,196}$/.test(String(note.data.id))||!/^in_[A-Za-z0-9_]{1,196}$/.test(String(ref(note.data.invoice)))
     ||ref(note.data.customer)!==resource.originalScope.providerCustomerRef||!safeMinor(note.data.amount)||!safeMinor(note.data.credit_amount)||!/^[a-z]{3}$/.test(String(note.data.currency))
     ||!["issued","void"].includes(String(note.data.status))||note.data.status==="issued"&&note.data.amount>0;});
  }
  return false;
 }).map(fact=>fact.id);
}
function sourceProjection(target:ControlledRawTarget){return{resource:target.resource,manifest:target.manifest,review:{quote:{snapshot:target.period}},history:target.history,binding:target.binding};}
function originalInvoice(target:ControlledRawTarget,raw:Record<string,unknown>,observerId:string){
 const binding=target.binding,creator=binding?target.history.operations.find(op=>op.id===binding.creatorOperationId):null,observer=target.history.operations.find(op=>op.id===observerId);
 if(!binding||!creator||!observer||ref(raw.id)!==binding.providerInvoiceRef)return false;
 try{assertControlledInvoiceOrigin(sourceProjection(target),binding.originKind,creator,observer,raw);return true;}catch{return false;}
}
function tagSubscription(target:ControlledRawTarget){
 const bootstrap=target.history.operations.find(op=>op.kind==="bootstrap");if(!bootstrap)return null;
 const values=target.history.facts.flatMap(fact=>{
  const call=target.history.calls.find(row=>row.id===fact.callId),op=call?target.history.operations.find(row=>row.id===call.operationId):null;
  if(op?.id===bootstrap.id&&fact.actual.kind==="bootstrap_subscription")return[ref(fact.actual.raw.id)];
  if(op?.kind!=="discover_bootstrap"||fact.actual.kind!=="subscription_list_read"||!Array.isArray(fact.actual.raw.data))return[];
  return fact.actual.raw.data.flatMap(value=>{const row=object.safeParse(value),tag=row.success?object.safeParse(row.data.metadata):null;
   return row.success&&tag?.success&&tag.data.freeholder_bootstrap_operation_id===bootstrap.id&&tag.data.freeholder_bootstrap_request_digest===bootstrap.requestDigest
    &&tag.data.freeholder_subscription_id===target.resource.subscriptionId&&ref(row.data.customer)===target.resource.originalScope.providerCustomerRef?[ref(row.data.id)]:[];});
 }).filter((value):value is string=>value!==null);
 const unique=[...new Set(values)];return unique.length===1?unique[0]:null;
}
function financialFields(raw:Record<string,unknown>){return [raw.starting_balance,raw.ending_balance,raw.pre_payment_credit_notes_amount,raw.post_payment_credit_notes_amount].every(value=>value===0)
 &&[raw.discounts,raw.default_tax_rates,raw.total_discount_amounts,raw.total_taxes,raw.total_tax_amounts,raw.total_tax_rates].every(empty)
 &&object.safeParse(raw.automatic_tax).success&&object.parse(raw.automatic_tax).enabled===false&&raw.paid_out_of_band!==true;}
export type ControlledBootstrapZeroProof={kind:"original_bootstrap_zero";resourceId:string;providerInvoiceRef:string;bootstrapOperationId:string;bootstrapReadOperationId:string;listOperationId:string;readOperationId:string;readCallId:string;readResultDigest:string;inventoryRevision:string};
/** The real original preparation is not a canonical target. A full later bank
 * inventory and its pre-update bootstrap read prove this separate zero object.
 * Each historical atom must itself remain zero: a later zero never clears cash. */
function bootstrapZeroProof(target:ControlledRawTarget){
 if(!safeMinor(target.canonicalCount)||target.canonicalCount>5000||!authentic(target.resource,target.history))return null;
 const source={resource:target.resource,history:target.history,canonical:{count:target.canonicalCount}},actual=target.history.operations.filter(op=>target.history.calls.some(call=>call.operationId===op.id));
 const boundary=Math.max(0,...actual.filter(op=>["update_calendar","create_draft","add_invoice_component","set_invoice_fee","finalize_invoice","pay_invoice","cancel_calendar","pause_drafts","void_invoice","delete_draft"].includes(op.kind)).map(op=>op.ordinal));
 try{
  const inventory=readControlledCollectionInventory(source,boundary),firstUpdate=actual.filter(op=>op.kind==="update_calendar").reduce((ordinal,op)=>Math.min(ordinal,op.ordinal),Number.MAX_SAFE_INTEGER);
  const rows=inventory.reads.filter(row=>originalBootstrapZeroInvoice(source,row,firstUpdate));if(rows.length!==1)return null;
  const row=rows[0];if(!row||row.actual.providerSubscriptionRef!==tagSubscription(target))return null;
  const bootstrap=target.history.operations.find(op=>op.kind==="bootstrap"),read=target.history.verifications.filter(v=>target.history.operations.some(op=>op.id===v.operationId&&op.kind==="read_bootstrap"&&op.ordinal<firstUpdate)
   &&v.actualResult.completeZeroRecurringItem===true&&v.actualResult.providerInvoiceRef===row.providerInvoiceRef&&v.actualResult.providerSubscriptionRef===row.actual.providerSubscriptionRef).at(-1);
  if(!bootstrap||!read)return null;
  const bootstrapRead=target.history.operations.find(op=>op.id===read.operationId),request=bootstrapRead?object.safeParse(bootstrapRead.originalRequest.payload):null;
  if(!request?.success||request.data.bootstrapOperationId!==bootstrap.id||request.data.bootstrapRequestDigest!==bootstrap.requestDigest||request.data.providerSubscriptionRef!==row.actual.providerSubscriptionRef
   ||read.actualResult.providerApiVersion!==target.resource.originalScope.providerApiVersion||read.actualResult.providerPlatformAccountId!==target.resource.originalScope.providerPlatformAccountId
   ||(read.actualResult.chargeAccountId??null)!==(target.resource.originalScope.providerAccountId??null))return null;
  const returned=target.history.verifications.find(v=>v.operationId===row.operation.id);if(!returned)return null;
  const evidence:ControlledBootstrapZeroProof={kind:"original_bootstrap_zero",resourceId:target.resource.id,providerInvoiceRef:row.providerInvoiceRef,bootstrapOperationId:bootstrap.id,bootstrapReadOperationId:read.operationId,
   listOperationId:inventory.list.id,readOperationId:row.operation.id,readCallId:returned.callId,readResultDigest:row.verification.actualResultDigest,inventoryRevision:inventory.revision};
  return{evidence,row};
 }catch{return null;}
}
function exactBootstrapZeroSnapshot(target:ControlledRawTarget,proof:NonNullable<ReturnType<typeof bootstrapZeroProof>>,raw:Record<string,unknown>){
 const actual=proof.row.actual.actualInvoice,parent=object.safeParse(raw.parent),subscription=parent.success?object.safeParse(parent.data.subscription_details):null;
 return ref(raw.id)===proof.evidence.providerInvoiceRef&&ref(raw.customer)===target.resource.originalScope.providerCustomerRef
  &&(ref(raw.subscription)??ref(subscription?.success?subscription.data.subscription:null))===proof.row.actual.providerSubscriptionRef
  &&raw.currency===target.resource.originalScope.currency.toLowerCase()&&raw.status==="paid"&&raw.auto_advance===false
  &&[raw.total,raw.subtotal,raw.amount_due,raw.amount_paid,raw.amount_remaining,raw.application_fee_amount??0].every(value=>value===0)
  &&financialFields(raw)&&merchantIntentEvidence(target.resource.originalScope,raw).merchantRouteVerified
  &&ref(raw.default_payment_method)===ref(actual.default_payment_method)&&raw.collection_method===actual.collection_method;
}
function completePages(history:History,callId:string,kind:string){
 const pages=history.facts.filter(fact=>fact.callId===callId&&fact.actual.kind===kind).sort((a,b)=>a.ordinal-b.ordinal);
 if(!pages.length||pages.length>20||pages.some((fact,index)=>!Array.isArray(fact.actual.raw.data)||typeof fact.actual.raw.has_more!=="boolean"||fact.actual.raw.has_more!==(index<pages.length-1)))return null;
 const parsed=records.safeParse(pages.flatMap(fact=>Array.isArray(fact.actual.raw.data)?fact.actual.raw.data:[]));return parsed.success?parsed.data:null;
}
function sameRows(left:Record<string,unknown>[],right:Record<string,unknown>[]){return left.length===right.length&&merchantTaxDigest(left)===merchantTaxDigest(right);}
/** Exact current independent proof, after every actual mutation of this invoice.
 * No original raw fact, live caller, own quote or admitted read is excluded. */
function currentProof(target:ControlledRawTarget){
 const{history,manifest,binding}=target;if(!binding||!authentic(target.resource,history)||!safeMinor(target.canonicalRefundedMinor)||target.canonicalRefundedMinor>target.canonicalPaidMinor)return null;
 const prospective=target.prospective;
 if(prospective&&(prospective.purpose!=="controlled_cash_prospective_read.v1"||prospective.resourceId!==target.resource.id||prospective.subscriptionId!==target.resource.subscriptionId
  ||prospective.collectionId!==manifest.collectionId||prospective.invoiceId!==manifest.canonicalInvoiceId||prospective.acceptedQuoteDigest!==manifest.acceptedQuoteDigest||prospective.canonicalTargetDigest!==manifest.canonicalTargetDigest
  ||prospective.actualCanonicalPaidMinor!==target.canonicalPaidMinor||prospective.manifestDigest!==merchantTaxDigest(manifest)||!prospective.receipts.length
  ||prospective.receipts.some(row=>row.kind!=="retained_unapplied"||row.resourceId!==target.resource.id||row.collectionId!==manifest.collectionId||row.canonicalInvoiceId!==manifest.canonicalInvoiceId||row.providerInvoiceRef!==binding.providerInvoiceRef)))return null;
 const full=target.proofs.map(p=>({p,ordinal:history.operations.find(op=>op.id===p.operationId)?.ordinal??0})).sort((a,b)=>a.ordinal-b.ordinal).at(-1)?.p;
 const observed=history.verifications.filter(row=>history.operations.some(op=>op.id===row.operationId&&op.kind==="read_invoice"&&object.safeParse(op.originalRequest.payload).success
  &&object.parse(op.originalRequest.payload).providerInvoiceRef===binding.providerInvoiceRef)).at(-1);
 const fullOrdinal=full?history.operations.find(op=>op.id===full.operationId)?.ordinal??0:0,observedOrdinal=observed?history.operations.find(op=>op.id===observed.operationId)?.ordinal??0:0;
 const completeManifest=fullOrdinal>=observedOrdinal&&!!full;
 const proof=completeManifest&&full?{operationId:full.operationId,callId:full.callId,resultDigest:full.resultDigest}:observed?{operationId:observed.operationId,callId:observed.callId,resultDigest:observed.actualResultDigest}:null;
 const operation=proof?history.operations.find(op=>op.id===proof.operationId):null,verification=proof?history.verifications.find(row=>row.operationId===proof.operationId&&row.callId===proof.callId):null;
 const parsed=verification&&completeManifest?result.safeParse(verification.actualResult):null,observedBank=verification&&!completeManifest?bank.safeParse(verification.actualResult):null;
 const payload=operation&&completeManifest?controlledCollectionPayload.safeParse(operation.originalRequest.payload):null;
 if(!proof||!operation||!verification||proof.resultDigest!==verification.actualResultDigest)return null;
 if(prospective&&(!completeManifest||proof.operationId!==prospective.manifestOperationId||proof.callId!==prospective.manifestCallId||proof.resultDigest!==prospective.manifestResultDigest))return null;
 if(completeManifest&&(!full||!parsed?.success||!payload?.success||operation.kind!=="read_manifest"||full.canonicalTargetDigest!==manifest.canonicalTargetDigest||full.customerFinancialDigest!==parsed.data.customerFinancialDigest
  ||parsed.data.manifestDigest!==controlledSubscriptionFactsDigest(manifest)||merchantTaxDigest(payload.data.manifest)!==merchantTaxDigest(manifest)
  ||payload.data.providerInvoiceRef!==binding.providerInvoiceRef||payload.data.invoiceOrigin.creatorOperationId!==binding.creatorOperationId
  ||payload.data.invoiceOrigin.creatorRequestDigest!==history.operations.find(op=>op.id===binding.creatorOperationId)?.requestDigest))return null;
 if(payload?.success&&binding.originKind!=="created_draft"){
  const creator=history.operations.find(op=>op.id===binding.creatorOperationId),epoch=creator?object.safeParse(creator.originalRequest.payload):null;
  const origin=payload.data.invoiceOrigin;
  if(!epoch?.success||origin.kind==="created_draft"||origin.priceEpochCollectionId!==epoch.data.collectionId||origin.priceEpochAcceptedQuoteDigest!==epoch.data.acceptedQuoteDigest)return null;
 }
 if(!completeManifest&&(!observedBank?.success||operation.kind!=="read_invoice"))return null;
 const inventory=parsed?.success?parsed.data.inventory:observedBank?.success?observedBank.data:null;if(!inventory)return null;

 if(inventory.providerInvoiceRef!==binding.providerInvoiceRef||inventory.providerSubscriptionRef!==tagSubscription(target)||inventory.providerCustomerRef!==target.resource.originalScope.providerCustomerRef
  ||inventory.currency!==manifest.currency||!originalInvoice(target,inventory.actualInvoice,operation.id)||!financialFields(inventory.actualInvoice)
  ||inventory.actualInvoice.status!==inventory.status||inventory.actualInvoice.total!==inventory.totalMinor||inventory.actualInvoice.subtotal!==inventory.totalMinor||inventory.actualInvoice.amount_due!==inventory.totalMinor
  ||inventory.status==="paid"&&(inventory.paidMinor!==inventory.totalMinor||inventory.remainingMinor!==0)
  ||(completeManifest||inventory.paidMinor>0)&&inventory.totalMinor!==manifest.cashDueMinor
  ||!completeManifest&&inventory.totalMinor!==Number(inventory.actualLines.reduce((sum,line)=>sum+BigInt(typeof line.amount==="number"&&Number.isSafeInteger(line.amount)?line.amount:0),0n))
  ||inventory.actualInvoice.amount_paid!==inventory.paidMinor||inventory.actualInvoice.amount_remaining!==inventory.remainingMinor
  ||inventory.remainingMinor!==inventory.totalMinor-inventory.paidMinor
  ||(prospective?inventory.paidMinor!==prospective.actualBankPaidMinor||inventory.remainingMinor!==prospective.actualBankRemainingMinor
   ||BigInt(inventory.paidMinor)!==BigInt(target.canonicalPaidMinor)+prospective.receipts.reduce((sum,row)=>sum+BigInt(row.amountMinor),0n):inventory.paidMinor!==target.canonicalPaidMinor)
  ||((completeManifest||inventory.paidMinor>0)&&(inventory.actualInvoice.application_fee_amount??0)!==manifest.applicationFeeMinor)||!["draft","open","paid"].includes(inventory.status))return null;
 const invoiceFacts=history.facts.filter(fact=>fact.callId===proof.callId&&fact.actual.kind==="invoice_read");
 if(invoiceFacts.length!==1||merchantTaxDigest(invoiceFacts[0]!.actual.raw)!==merchantTaxDigest(inventory.actualInvoice)
  ||!sameRows(completePages(history,proof.callId,"invoice_payments_read")??[],inventory.actualPayments)||completePages(history,proof.callId,"invoice_payments_read")===null
  ||!sameRows(completePages(history,proof.callId,"invoice_lines_read")??[],inventory.actualLines)||completePages(history,proof.callId,"invoice_lines_read")===null)return null;
 const intents=history.facts.filter(fact=>fact.callId===proof.callId&&fact.actual.kind==="intent_read").map(fact=>fact.actual.raw);
 const observedCash=history.facts.filter(fact=>fact.callId===proof.callId&&fact.actual.kind==="cash_observed").flatMap(fact=>{const parsed=object.safeParse(fact.actual.raw.cash);return parsed.success?[parsed.data]:[];});
 const prices=history.facts.filter(fact=>fact.callId===proof.callId&&fact.actual.kind==="price_read").map(fact=>fact.actual.raw);
 if(!sameRows(observedCash,inventory.actualCash)||!sameRows(prices,inventory.actualPrices)||new Set(inventory.actualPrices.map(price=>ref(price.id))).size!==inventory.actualPrices.length)return null;
 if(!sameRows(intents,inventory.actualIntents)||new Set(inventory.actualIntents.map(row=>ref(row.id))).size!==inventory.actualIntents.length
  ||inventory.actualCash.length!==inventory.actualIntents.filter(row=>safeMinor(row.amount_received)&&row.amount_received>0).length)return null;
 for(const price of inventory.actualPrices){const item=target.itemReceipts.find(row=>row.providerPriceRef===ref(price.id)),component=item?manifest.components.find(row=>row.id===item.componentId):null;
  if(!component||component.kind==="locked_canonical_credit"||price.currency!==manifest.currency.toLowerCase()||price.unit_amount!==component.amountMinor||ref(price.product)!==component.providerProductRef
   ||price.unit_amount_decimal!==undefined&&(typeof price.unit_amount_decimal!=="string"||!new RegExp(`^${component.amountMinor}(?:\\.0+)?$`).test(price.unit_amount_decimal)))return null;
 }
 const lines=new Set(inventory.actualLines.map(row=>ref(row.id))),payments=new Set<string>();let paid=0n;
 if(lines.size!==inventory.actualLines.length||lines.size!==target.itemReceipts.length||(completeManifest||inventory.paidMinor>0)&&lines.size!==manifest.components.length
  ||payload?.success&&payload.data.lineBindings.some(row=>!target.itemReceipts.some(item=>item.componentId===row.componentId&&item.providerInvoiceLineRef===row.providerInvoiceLineRef&&item.providerInvoiceItemRef===row.providerInvoiceItemRef&&item.providerPriceRef===row.providerPriceRef))
  ||inventory.actualLines.some(row=>!target.itemReceipts.some(item=>item.providerInvoiceLineRef===ref(row.id))))return null;
 for(const payment of inventory.actualPayments){const relation=object.safeParse(payment.payment),pi=relation.success?ref(relation.data.payment_intent):null;
  const intent=inventory.actualIntents.find(row=>ref(row.id)===pi);if(!pi||!relation.success||relation.data.type!=="payment_intent"||payments.has(pi)||ref(payment.invoice)!==binding.providerInvoiceRef||!intent||!safeMinor(intent.amount_received)
   ||!safeMinor(intent.amount)||!safeMinor(payment.amount_paid)||!safeMinor(payment.amount_requested)||payment.amount_requested!==intent.amount||payment.amount_paid!==intent.amount_received
   ||intent.amount_received>intent.amount||intent.amount>manifest.cashDueMinor||intent.amount_capturable!==0||ref(intent.customer)!==target.resource.originalScope.providerCustomerRef
   ||intent.currency!==manifest.currency.toLowerCase()||!merchantIntentEvidence(target.resource.originalScope,intent).merchantRouteVerified)return null;
  payments.add(pi);paid+=BigInt(intent.amount_received);
  if(intent.amount_received>0){const cash=cashOwners(target).filter(row=>row.providerIntentRef===pi&&row.resourceId===target.resource.id&&row.canonicalInvoiceId===manifest.canonicalInvoiceId&&row.providerInvoiceRef===binding.providerInvoiceRef);
   const original=cash.length===1?history.chargeOrigins.filter(row=>row.receiptId===cash[0]!.receiptId&&row.resourceId===target.resource.id):[];
   const origin=original.length===1?original[0]:null,originFact=origin?history.facts.find(row=>row.id===origin.factId&&row.callId===origin.callId&&row.actual.kind==="cash_observed"):null;
   const originCall=origin?history.calls.find(row=>row.id===origin.callId&&row.operationId===origin.operationId):null,originOperation=origin?history.operations.find(row=>row.id===origin.operationId):null;
   const originalCash=originFact?controlledCashEvidence.safeParse(originFact.actual.raw.cash):null;
   const firstCash=cash[0],retained=firstCash&&"kind"in firstCash?firstCash:null;
   if(!origin||!originFact||!originCall||!originOperation||!originalCash?.success||originalCash.data.providerPaymentIntentRef!==pi||originalCash.data.providerInvoiceRef!==binding.providerInvoiceRef
    ||originalCash.data.amountMinor!==intent.amount_received||originalCash.data.currency!==manifest.currency
    ||retained&&(retained.originOperationId!==originOperation.id||retained.originCallId!==originCall.id||retained.originFactId!==originFact.id)
    ||origin.originalEvidenceDigest!==merchantTaxDigest({resource:target.resource,operation:originOperation,call:originCall,fact:originFact,cash:originalCash.data}))return null;
   if(intent.status!=="succeeded"||payment.status!=="paid"||cash.length!==1||cash[0]!.amountMinor!==intent.amount_received||cash[0]!.currency!==manifest.currency
    ||cash[0]!.providerChargeRef!==ref(intent.latest_charge)||!inventory.actualCash.some(row=>row.providerPaymentIntentRef===pi&&row.amountMinor===intent.amount_received&&row.currency===manifest.currency))return null;
  }else if(!["canceled","requires_payment_method"].includes(String(intent.status))||!["canceled","open"].includes(String(payment.status)))return null;
 }
 if(payments.size!==inventory.actualIntents.length||paid!==BigInt(inventory.paidMinor)||cashOwners(target).filter(row=>row.canonicalInvoiceId===manifest.canonicalInvoiceId).length!==inventory.actualCash.length)return null;
 for(const mutation of history.operations){if(mutation.ordinal<=operation.ordinal||!history.calls.some(call=>call.operationId===mutation.id)||!["create_draft","add_invoice_component","set_invoice_fee","finalize_invoice","pay_invoice","void_invoice","delete_draft","update_calendar"].includes(mutation.kind))continue;
  const body=object.safeParse(mutation.originalRequest.payload),m=body.success?object.safeParse(body.data.manifest):null;
  if(body.success&&(body.data.providerInvoiceRef===binding.providerInvoiceRef||body.data.collectionId===manifest.collectionId||m?.success&&m.data.collectionId===manifest.collectionId))return null;
 }
 return{proof,operation,payload:payload?.success?payload.data:null,inventory,completeManifest};
}
function exactLine(target:ControlledRawTarget,line:Record<string,unknown>,observerId:string){
 const item=target.itemReceipts.find(row=>row.providerInvoiceLineRef===ref(line.id)),component=item?target.manifest.components.find(row=>row.id===item.componentId):null;
 const actualComponent=item?target.components.find(row=>row.id===item.componentId):null,creator=item?target.history.operations.find(op=>op.id===item.creatorOperationId):null,observer=target.history.operations.find(op=>op.id===observerId);
 if(!item||!actualComponent||!creator||!observer)return false;
 try{const actual=assertControlledComponentLine(sourceProjection(target),actualComponent,creator,observer,line);
  if(actual.originKind!==item.originKind||actual.providerInvoiceItemRef!==item.providerInvoiceItemRef||actual.providerPriceRef!==item.providerPriceRef)return false;
 }catch{return false;}

 const parent=object.safeParse(line.parent),ii=parent.success?object.safeParse(parent.data.invoice_item_details):null,si=parent.success?object.safeParse(parent.data.subscription_item_details):null;
 const pricing=object.safeParse(line.pricing),price=pricing.success?object.safeParse(pricing.data.price_details):null,period=object.safeParse(line.period),tag=object.safeParse(line.metadata);
 if(!item||!component||line.amount!==component.amountMinor||line.currency!==target.manifest.currency.toLowerCase()||line.quantity!==1
  ||line.quantity_decimal!==undefined&&(typeof line.quantity_decimal!=="string"||!/^1(?:\.0+)?$/.test(line.quantity_decimal))
  ||!period.success||period.data.start!==Date.parse(component.periodStart)/1000||period.data.end!==Date.parse(component.periodEnd)/1000
  ||!empty(line.discount_amounts)||!empty(line.taxes)||!empty(line.tax_amounts)||(price?.success?ref(price.data.price):null)!==item.providerPriceRef)return false;
 if(component.kind!=="locked_canonical_credit"&&(!price?.success||ref(price.data.product)!==component.providerProductRef))return false;
 if(item.providerInvoiceItemRef)return(ii?.success?ref(ii.data.invoice_item):si?.success?ref(si.data.invoice_item):null)===item.providerInvoiceItemRef
  &&tag.success&&tag.data.freeholder_controlled_collection_id===target.manifest.collectionId&&tag.data.freeholder_controlled_component_id===component.id
  &&tag.data.freeholder_controlled_component_digest===component.provenanceDigest&&tag.data.freeholder_canonical_target_digest===target.manifest.canonicalTargetDigest;
 return component.kind==="net"&&parent.success&&parent.data.type==="subscription_item_details"&&si?.success&&si.data.proration===false;
}
function exactInvoiceSnapshot(target:ControlledRawTarget,proof:NonNullable<ReturnType<typeof currentProof>>,raw:Record<string,unknown>,callId:string){
 if(!originalInvoice(target,raw,target.history.calls.find(call=>call.id===callId)?.operationId??"")||!financialFields(raw)||!safeMinor(raw.total)||raw.subtotal!==raw.total||raw.amount_due!==raw.total||!safeMinor(raw.amount_paid)||!safeMinor(raw.amount_remaining)
  ||raw.status==="paid"&&(raw.amount_paid!==raw.total||raw.amount_remaining!==0)
  ||raw.amount_paid>0&&raw.amount_paid!==proof.inventory.paidMinor||raw.amount_remaining!==raw.total-raw.amount_paid||!['draft','open','paid'].includes(String(raw.status)))return false;
 if(raw.amount_paid>0)return raw.total===proof.inventory.totalMinor&&(raw.application_fee_amount??0)===target.manifest.applicationFeeMinor;
 // A historical partial draft is identified through its REAL original invoice
 // and exact then-observed canonical component subset, never by its amount.
 if(raw.total===proof.inventory.totalMinor)return true;
 const lines=completePages(target.history,callId,"invoice_lines_read"),payments=completePages(target.history,callId,"invoice_payments_read");
 return lines!==null&&payments!==null&&!payments.length&&lines.every(line=>exactLine(target,line,target.history.calls.find(call=>call.id===callId)?.operationId??""))
  &&lines.reduce((sum,line)=>sum+BigInt(typeof line.amount==="number"&&Number.isSafeInteger(line.amount)?line.amount:0),0n)===BigInt(raw.total);
}
function exactIntentSnapshot(target:ControlledRawTarget,proof:NonNullable<ReturnType<typeof currentProof>>,raw:Record<string,unknown>){
 const actual=proof.inventory.actualIntents.find(row=>ref(row.id)===ref(raw.id));
 return !!actual&&ref(raw.customer)===target.resource.originalScope.providerCustomerRef&&raw.currency===target.manifest.currency.toLowerCase()
  &&raw.amount===actual.amount&&safeMinor(raw.amount_received)&&raw.amount_capturable===0
  &&(raw.amount_received===0||raw.amount_received===actual.amount_received&&cashOwners(target).some(row=>row.providerIntentRef===ref(raw.id)&&row.amountMinor===raw.amount_received))
  &&merchantIntentEvidence(target.resource.originalScope,raw).merchantRouteVerified;
}
function exactItemSnapshot(target:ControlledRawTarget,raw:Record<string,unknown>,operationId:string){
 const item=target.itemReceipts.find(row=>row.providerInvoiceItemRef===ref(raw.id)&&row.creatorOperationId===operationId),component=item?target.manifest.components.find(row=>row.id===item.componentId):null;
 const operation=target.history.operations.find(row=>row.id===operationId),payload=operation?controlledCollectionPayload.safeParse(operation.originalRequest.payload):null,metadata=object.safeParse(raw.metadata);
 return !!component&&!!item&&payload?.success===true&&operation?.kind==="add_invoice_component"&&payload.data.componentId===component.id
  &&merchantTaxDigest(payload.data.manifest)===merchantTaxDigest(target.manifest)&&raw.amount===component.amountMinor&&raw.currency===target.manifest.currency.toLowerCase()
  &&ref(raw.customer)===target.resource.originalScope.providerCustomerRef&&ref(raw.invoice)===target.binding?.providerInvoiceRef&&metadata.success
  &&metadata.data.freeholder_controlled_collection_id===target.manifest.collectionId&&metadata.data.freeholder_controlled_component_id===component.id
  &&metadata.data.freeholder_controlled_component_digest===component.provenanceDigest&&metadata.data.freeholder_canonical_target_digest===target.manifest.canonicalTargetDigest
  &&metadata.data.freeholder_controlled_item_operation_id===operation.id&&metadata.data.freeholder_controlled_item_request_digest===operation.requestDigest;
}
function calendarRead(target:ControlledRawTarget){
 if(!authentic(target.resource,target.history)||!target.calendarAuthority)return null;
 const verification=target.history.verifications.filter(row=>target.history.operations.some(op=>op.id===row.operationId&&op.kind==="read_calendar")).at(-1);
 const operation=verification?target.history.operations.find(op=>op.id===verification.operationId):null,raw=verification?object.safeParse(verification.actualResult.actualRaw):null;
 if(!verification||!operation||!raw?.success||verification.actualResult.currentReadDigest!==controlledSubscriptionFactsDigest(raw.data)
  ||verification.actualResult.providerSubscriptionRef!==tagSubscription(target)||verification.actualResult.providerCustomerRef!==target.resource.originalScope.providerCustomerRef
  ||verification.actualResult.collectionPausedAsDraft!==true||verification.actualResult.suppliesPaidAuthority!==false||verification.actualResult.financiallyQuiesced!==false
  ||target.history.operations.some(op=>op.ordinal>operation.ordinal&&["update_calendar","cancel_calendar"].includes(op.kind)&&target.history.calls.some(call=>call.operationId===op.id))
  ||!target.history.facts.some(fact=>fact.callId===verification.callId&&fact.actual.kind==="subscription_read"&&merchantTaxDigest(fact.actual.raw)===merchantTaxDigest(raw.data)))return null;
 return{verification,operation,raw:raw.data};
}
function exactCalendarSnapshot(target:ControlledRawTarget,raw:Record<string,unknown>,targets:readonly ControlledRawTarget[],proofFor:(target:ControlledRawTarget)=>ReturnType<typeof currentProof>,preparation:ReturnType<typeof bootstrapZeroProof>){
 const read=calendarRead(target),expected=target.calendarAuthority;if(!read||!expected)return false;
 const metadata=object.safeParse(raw.metadata),bootstrap=target.history.operations.find(op=>op.kind==="bootstrap");if(!metadata.success||!bootstrap)return false;
 const creator=target.history.operations.find(row=>row.id===metadata.data.freeholder_controlled_update_operation_id),payload=creator?object.safeParse(creator.originalRequest.payload):null;
 const destination=payload?.success?object.safeParse(payload.data.target):null,original=payload?.success?records.safeParse(payload.data.originalComponents):null;
 if(!creator||creator.kind!=="update_calendar"||!payload?.success||!destination?.success||!original?.success||original.data.length!==1
  ||creator.requestDigest!==metadata.data.freeholder_controlled_update_request_digest||payload.data.collectionId!==metadata.data.freeholder_controlled_price_epoch_id
  ||payload.data.acceptedQuoteDigest!==metadata.data.freeholder_controlled_accepted_quote_digest||metadata.data.freeholder_controlled_collection_policy!=="canonical_gross_target_locked_credit_no_wallet"
  ||!targets.some(epoch=>epoch.resource.id===target.resource.id&&epoch.manifest.collectionId===payload.data.collectionId&&epoch.manifest.acceptedQuoteDigest===payload.data.acceptedQuoteDigest&&epoch.manifest.termsId===target.manifest.termsId)
  ||destination.data.principalMinor!==expected.periodAmountMinor||destination.data.interval!==expected.interval||destination.data.intervalCount!==expected.intervalCount)return false;
 const scope=target.resource.originalScope,items=object.safeParse(raw.items),pause=object.safeParse(raw.pause_collection),tax=object.safeParse(raw.automatic_tax),billing=object.safeParse(raw.billing_mode);
 if(ref(raw.id)!==tagSubscription(target)||ref(raw.customer)!==scope.providerCustomerRef||raw.currency!==scope.currency.toLowerCase()||ref(raw.default_payment_method)!==scope.providerMethodRef
  ||metadata.data.freeholder_controlled_subscription_version!=="1"||metadata.data.freeholder_subscription_id!==scope.subscriptionId||metadata.data.freeholder_subscription_terms_id!==scope.termsId
  ||metadata.data.freeholder_controlled_generation!==String(scope.generation)||metadata.data.freeholder_platform_account_id!==scope.providerPlatformAccountId
  ||metadata.data.freeholder_bootstrap_operation_id!==bootstrap.id||metadata.data.freeholder_bootstrap_request_digest!==bootstrap.requestDigest
  ||raw.schedule!==null||raw.cancel_at!==null||raw.cancel_at_period_end!==false||raw.pending_update!==null||!["active","trialing"].includes(String(raw.status))
  ||raw.collection_method!=="charge_automatically"||!pause.success||pause.data.behavior!=="keep_as_draft"||pause.data.resumes_at!==null
  ||!tax.success||tax.data.enabled!==false||!billing.success||billing.data.type!=="flexible"||!empty(raw.discounts)||!empty(raw.default_tax_rates)
  ||raw.billing_cycle_anchor!==Date.parse(expected.anchor)/1000||raw.trial_end!==(expected.trialEnd===null?null:Date.parse(expected.trialEnd)/1000)
  ||!items.success||items.data.has_more!==false||!Array.isArray(items.data.data)||items.data.data.length!==1||!merchantIntentEvidence(scope,raw).merchantRouteVerified)return false;
 const item=object.safeParse(items.data.data[0]),price=item.success?object.safeParse(item.data.price):null;
 const recurring=price?.success?object.safeParse(price.data.recurring):null;
 if(!item.success||!price?.success||ref(item.data.id)!==original.data[0]?.subscriptionItemRef||item.data.quantity!==1
  ||item.data.quantity_decimal!==undefined&&(typeof item.data.quantity_decimal!=="string"||!/^1(?:\.0+)?$/.test(item.data.quantity_decimal))
  ||!(item.data.current_period_start===Date.parse(expected.periodStart)/1000&&item.data.current_period_end===Date.parse(expected.periodEnd)/1000
   ||expected.reviewedPeriodWindows?.some(window=>item.data.current_period_start===Date.parse(window.periodStart)/1000&&item.data.current_period_end===Date.parse(window.periodEnd)/1000))
  ||price.data.unit_amount!==expected.periodAmountMinor||price.data.currency!==scope.currency.toLowerCase()||ref(price.data.product)!==destination.data.providerProductRef
  ||!recurring?.success||recurring.data.interval!==expected.interval||recurring.data.interval_count!==expected.intervalCount
  ||price.data.unit_amount_decimal!==undefined&&(typeof price.data.unit_amount_decimal!=="string"||!new RegExp(`^${expected.periodAmountMinor}(?:\\.0+)?$`).test(price.data.unit_amount_decimal)))return false;
 const latest=ref(raw.latest_invoice);if(latest){const owner=uniqueInvoiceTarget(targets,target.resource.id,latest),proof=owner?proofFor(owner):null;
  if(!owner||!proof){if(targets.some(candidate=>candidate.resource.id===target.resource.id&&candidate.binding?.providerInvoiceRef===latest)||!preparation||preparation.evidence.providerInvoiceRef!==latest)return false;
   const invoice=object.safeParse(raw.latest_invoice);if(invoice.success&&!exactBootstrapZeroSnapshot(target,preparation,invoice.data))return false;
  }else{const invoice=object.safeParse(raw.latest_invoice);if(invoice.success&&!exactInvoiceSnapshot(owner,proof,invoice.data,read.verification.callId))return false;}
 }else if(raw.latest_invoice!==null)return false;
 return true;
}
type ControlledRawResolutionCommon={factId:string;disposition:"owned_nonautomatic_obligation"|"canonical_cash"|"retained_unapplied_cash";receiptIds:string[];preparationProofs?:ControlledBootstrapZeroProof[];bankProofs:Array<{collectionId:string;operationId:string;callId:string}>};
export type ControlledRawResolution=ControlledRawResolutionCommon&({collectionId:string;proofOperationId:string;proofCallId:string;canonicalRefundedMinor:number}
 |{collectionId:null;collectionIds:string[];proofOperationId:null;proofCallId:null;canonicalRefundedMinor:null;canonicalRefunds:Array<{collectionId:string;amountMinor:number}>});
/** Returns derived resolutions only; every original fact/reason/row SHA remains
 * in coverage. Positive amounts map to actual canonical cash or the distinct
 * genuine private retained-receipt context; canonical paid is never invented.
 * A nonpayable exact draft/component is merely a retained owned obligation.
 * Nothing here grants paid/access, remits fees or releases another bank caller. */
export function classifyControlledTargetRawFacts(targets:readonly ControlledRawTarget[]){
 const preparations=new Map(targets.map(target=>[target,bootstrapZeroProof(target)]));
 const proofs=new Map(targets.map(target=>[target,currentProof(target)]));const proofFor=(target:ControlledRawTarget)=>proofs.get(target)??null;
 const resolutions=new Map<string,ControlledRawResolution>(),unresolved=new Set<string>(),ambiguous=new Set<string>();
 for(const target of targets){const review=controlledRawFinancialReview(target.resource,target.history);for(const fact of review.facts)unresolved.add(fact.factId);for(const id of controlledCustomerRawReview(target.resource,target.history))unresolved.add(id);}
 for(const target of targets){const proof=proofFor(target),calendar=calendarRead(target);if(proof&&!proof.inventory.actualLines.every(line=>exactLine(target,line,proof.operation.id)))continue;
  if(!proof&&!calendar)continue;
  const review=controlledRawFinancialReview(target.resource,target.history);
  for(const financial of review.facts){const fact=target.history.facts.find(row=>row.id===financial.factId),operation=target.history.operations.find(row=>row.id===financial.operationId);if(!fact||!operation)continue;
   const raw=fact.actual.raw;let owned=false;const calendarFact=["subscription_read","calendar_updated","pause_subscription","bootstrap_subscription"].includes(fact.actual.kind);
   function bankFact(proof:NonNullable<ReturnType<typeof currentProof>>,fact:History["facts"][number],operation:History["operations"][number]):{owned:boolean;listOwners:ControlledRawTarget[]|null;preparationProofs:ControlledBootstrapZeroProof[]}{
    let owned=false;let listOwners:ControlledRawTarget[]|null=null;const preparationProofs:ControlledBootstrapZeroProof[]=[];
    switch(fact.actual.kind){
    case"invoice_list_read":{
     const pages=completePages(target.history,fact.callId,"invoice_list_read"),owners:ControlledRawTarget[]=[];
     owned=pages!==null&&new Set(pages.map(row=>ref(row.id))).size===pages.length&&Array.isArray(raw.data)&&raw.data.every(value=>{const invoice=object.safeParse(value);if(!invoice.success)return false;const data=invoice.data;
      const owner=uniqueInvoiceTarget(targets,target.resource.id,ref(data.id)),actual=owner?proofFor(owner):null;
      if(!owner){if(targets.some(candidate=>candidate.resource.id===target.resource.id&&candidate.binding?.providerInvoiceRef===ref(data.id)))return false;const preparation=preparations.get(target);if(!preparation||!exactBootstrapZeroSnapshot(target,preparation,data))return false;preparationProofs.push(preparation.evidence);return true;}
      if(!actual||!exactInvoiceSnapshot(owner,actual,data,fact.callId))return false;owners.push(owner);return true;});
     if(owned)listOwners=[...new Set(owners)].sort((a,b)=>a.manifest.collectionId.localeCompare(b.manifest.collectionId));break;
    }
    case"invoice_read":case"controlled_draft_created":case"controlled_invoice_updated":case"controlled_invoice_finalized":case"controlled_invoice_paid":
     owned=exactInvoiceSnapshot(target,proof,raw,fact.callId);break;
    case"intent_read":owned=exactIntentSnapshot(target,proof,raw);break;
    case"cash_observed":{
     const cash=object.safeParse(raw.cash),invoice=object.safeParse(raw.invoice),intent=object.safeParse(raw.intent),payment=object.safeParse(raw.invoicePayment);
     const relation=payment.success?object.safeParse(payment.data.payment):null;
     if(!cash.success||!invoice.success||!intent.success||!payment.success||!relation?.success)break;const data=cash.data;
     owned=data.providerPlatformAccountId===target.resource.originalScope.providerPlatformAccountId&&(data.providerAccountId??null)===(target.resource.originalScope.providerAccountId??null)
      &&data.subscriptionId===target.resource.subscriptionId&&data.providerCustomerRef===target.resource.originalScope.providerCustomerRef&&data.providerSubscriptionRef===tagSubscription(target)
      &&data.providerInvoiceRef===target.binding?.providerInvoiceRef&&data.providerPaymentIntentRef===ref(intent.data.id)&&data.amountMinor===intent.data.amount_received
      &&data.currency===target.manifest.currency&&data.merchantRouteVerified===true&&ref(payment.data.invoice)===target.binding?.providerInvoiceRef
      &&ref(relation.data.payment_intent)===ref(intent.data.id)&&exactIntentSnapshot(target,proof,intent.data)&&exactInvoiceSnapshot(target,proof,invoice.data,fact.callId)
      &&cashOwners(target).some(row=>row.providerIntentRef===data.providerPaymentIntentRef&&row.amountMinor===data.amountMinor&&row.currency===data.currency);
     break;
    }
    case"invoice_lines_read":owned=completePages(target.history,fact.callId,"invoice_lines_read")!==null&&Array.isArray(raw.data)&&raw.data.every(value=>{const line=object.safeParse(value);if(!line.success)return false;const data=line.data;
      return exactLine(target,data,operation.id)&&proof.inventory.actualLines.some(actual=>merchantTaxDigest(actual)===merchantTaxDigest(data));});break;
    case"controlled_item_created":owned=exactItemSnapshot(target,raw,operation.id);break;
    case"invoice_payments_read":owned=completePages(target.history,fact.callId,"invoice_payments_read")!==null&&Array.isArray(raw.data)&&raw.data.every(value=>{const payment=object.safeParse(value);if(!payment.success)return false;const data=payment.data;
      const actual=proof.inventory.actualPayments.find(row=>ref(row.id)===ref(data.id)),relation=object.safeParse(data.payment),currentRelation=actual?object.safeParse(actual.payment):null;
      return !!actual&&relation.success&&currentRelation?.success===true&&ref(data.invoice)===target.binding?.providerInvoiceRef
       &&relation.data.type==="payment_intent"&&currentRelation.data.type==="payment_intent"&&ref(relation.data.payment_intent)===ref(currentRelation.data.payment_intent)&&data.amount_requested===actual.amount_requested
       &&(data.amount_paid===0||data.amount_paid===actual.amount_paid);});break;
    default:break;
    }return{owned,listOwners,preparationProofs};
   }
   const bankResult=!calendarFact&&proof?bankFact(proof,fact,operation):null,listOwners=bankResult?.listOwners??null;
   owned=calendarFact?exactCalendarSnapshot(target,raw,targets,proofFor,preparations.get(target)??null):bankResult?.owned??false;
   const bankOwners=listOwners!==null?listOwners.flatMap(candidate=>{const current=proofFor(candidate);return current?[{candidate,current}]:[];}):targets.flatMap(candidate=>{if(candidate.resource.id!==target.resource.id||!candidate.binding)return[];
    const current=proofFor(candidate);return current&&(financial.providerInvoiceRefs.includes(candidate.binding.providerInvoiceRef)||current.inventory.actualIntents.some(intent=>financial.providerIntentRefs.includes(ref(intent.id)??"")))?[{candidate,current}]:[];});
   const positiveKnown=financial.reportedPositiveMoney?bankOwners.some(owner=>owner.current.inventory.paidMinor>0):true;
   const singleListOwner=listOwners?.length===1?listOwners[0]:null,singleListProof=singleListOwner?proofFor(singleListOwner):null;
   const resolutionTarget=singleListOwner??target;
   const proofIdentity=singleListProof?{operationId:singleListProof.operation.id,callId:singleListProof.proof.callId}:calendarFact&&calendar?{operationId:calendar.operation.id,callId:calendar.verification.callId}:proof?{operationId:proof.operation.id,callId:proof.proof.callId}:null;
   if(!owned||!proofIdentity||ambiguous.has(fact.id)||!positiveKnown)continue;
   const factCash=(listOwners??targets).flatMap(candidate=>cashOwners(candidate)).filter(row=>row.resourceId===target.resource.id&&(financial.providerIntentRefs.length?financial.providerIntentRefs.includes(row.providerIntentRef):financial.providerInvoiceRefs.includes(row.providerInvoiceRef)));
   const common:ControlledRawResolutionCommon={factId:fact.id,bankProofs:bankOwners.map(({candidate,current})=>({collectionId:candidate.manifest.collectionId,operationId:current.operation.id,callId:current.proof.callId})),
    ...(bankResult?.preparationProofs.length?{preparationProofs:bankResult.preparationProofs}:{}),
    disposition:financial.reportedPositiveMoney?factCash.some(row=>"kind"in row)?"retained_unapplied_cash":"canonical_cash":"owned_nonautomatic_obligation",receiptIds:financial.reportedPositiveMoney?[...new Set(factCash.map(row=>row.receiptId))].sort():[]};
   const next:ControlledRawResolution=listOwners&&listOwners.length!==1?{...common,collectionId:null,collectionIds:listOwners.map(owner=>owner.manifest.collectionId),proofOperationId:null,proofCallId:null,canonicalRefundedMinor:null,canonicalRefunds:listOwners.map(owner=>({collectionId:owner.manifest.collectionId,amountMinor:owner.canonicalRefundedMinor}))}
    :{factId:common.factId,collectionId:resolutionTarget.manifest.collectionId,proofOperationId:proofIdentity.operationId,proofCallId:proofIdentity.callId,canonicalRefundedMinor:resolutionTarget.canonicalRefundedMinor,bankProofs:common.bankProofs,disposition:common.disposition,receiptIds:common.receiptIds,...(common.preparationProofs?{preparationProofs:common.preparationProofs}:{})};
   const prior=resolutions.get(fact.id);if(prior&&(prior.collectionId!==next.collectionId||prior.collectionId===null&&merchantTaxDigest(prior)!==merchantTaxDigest(next))){resolutions.delete(fact.id);unresolved.add(fact.id);ambiguous.add(fact.id);continue;}
   resolutions.set(fact.id,next);
   unresolved.delete(fact.id);
  }
 }
 return{resolutions:[...resolutions.values()].sort((a,b)=>a.factId.localeCompare(b.factId)),unresolvedFactIds:[...unresolved].sort()};
}
