// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Exact structured positive occurrence associations; NEVER a fact-ID exemption.
import type { controlledCashManifest } from "./controlled-provider-collection-cash-manifest";
import { cashReference } from "./controlled-provider-collection-cash-manifest";
import { cashObservationSourceMatches } from "./controlled-provider-cash-observation-source";
import { controlledCashEvidence } from "./controlled-provider-cash-origin";
import { z } from "zod";
import type { subscriptionProviderChargeReceipts } from "./schema";
import type { subscriptionControlledFacts } from "./controlled-provider-schema";
const object=(value:unknown)=>z.record(z.string(),z.unknown()).safeParse(value);
type Receipt=Pick<typeof subscriptionProviderChargeReceipts.$inferSelect,"id"|"subscriptionId"|"providerPlatformAccountId"|"chargeAccountId"|"providerSubscriptionRef"|"providerInvoiceRef"|"providerPaymentIntentRef"|"providerChargeRef"|"amountMinor"|"currency">;
export type ControlledProspectiveRawSource={resource:{originalScope:{providerCustomerRef:string}};manifest:{currency:string};history:{operations:readonly {id:string}[];calls:readonly {id:string;operationId:string}[];facts:readonly Pick<typeof subscriptionControlledFacts.$inferSelect,"id"|"callId"|"actual"|"actualDigest">[]}};
/** Every atom of a mixed invoice/list fact remains the parent's responsibility.
 * Returning receipt IDs here never clears a different namespace, amount, raw
 * dispute/refund or unfinished caller from the complete current parent proof. */
export function controlledProspectiveRawBindings(source:ControlledProspectiveRawSource,bank:Pick<ReturnType<typeof controlledCashManifest>,"providerInvoiceRef"|"providerSubscriptionRef"|"paidMinor"|"intents">,receipts:readonly Receipt[]){
 const bindings=[];
 function invoiceIds(value:unknown){const parsed=object(value);if(!parsed.success)return[];const raw=parsed.data;
  if(raw.id!==bank.providerInvoiceRef||cashReference(raw.customer)!==source.resource.originalScope.providerCustomerRef)return[];
  const parent=object(raw.parent),details=parent.success?object(parent.data.subscription_details):null;
  if((cashReference(raw.subscription)??(details?.success?cashReference(details.data.subscription):null))!==bank.providerSubscriptionRef)return[];
  if(typeof raw.amount_paid!=="number"||raw.amount_paid<0||raw.amount_paid>bank.paidMinor||typeof raw.currency!=="string"||raw.currency.toUpperCase()!==source.manifest.currency)return[];
  return receipts.map(row=>row.id);
 }
 function intentIds(value:unknown){const parsed=object(value);if(!parsed.success)return[];const raw=parsed.data,receipt=receipts.find(row=>row.providerPaymentIntentRef===raw.id),current=bank.intents.find(row=>row.id===raw.id);
  if(!receipt||!current||cashReference(raw.customer)!==source.resource.originalScope.providerCustomerRef||String(raw.currency).toUpperCase()!==receipt.currency||raw.amount!==current.amount
   ||typeof raw.amount_received!=="number"||raw.amount_received<0||raw.amount_received>receipt.amountMinor||raw.amount_received>0&&raw.amount_received!==receipt.amountMinor
   ||cashReference(raw.latest_charge)&&cashReference(raw.latest_charge)!==receipt.providerChargeRef)return[];return[receipt.id];
 }
 for(const fact of source.history.facts){const call=source.history.calls.find(row=>row.id===fact.callId),operation=call?source.history.operations.find(row=>row.id===call.operationId):null;if(!call||!operation)continue;
  let ids:string[]=[];const raw=fact.actual.raw;
  if(fact.actual.kind==="cash_observed"){const cash=controlledCashEvidence.safeParse(raw.cash);if(cash.success)ids=receipts.filter(row=>cashObservationSourceMatches(row,cash.data)).map(row=>row.id);}
  else if(fact.actual.kind==="intent_read")ids=intentIds(raw);
  else if(["invoice_read","controlled_draft_created"].includes(fact.actual.kind))ids=invoiceIds(raw);
  else if(fact.actual.kind==="invoice_list_read"&&Array.isArray(raw.data))ids=raw.data.flatMap(invoiceIds);
  else if(fact.actual.kind==="invoice_payments_read"&&Array.isArray(raw.data))ids=raw.data.flatMap(value=>{const payment=object(value),body=payment.success?object(payment.data.payment):null;if(!payment.success||!body?.success||body.data.type!=="payment_intent"||cashReference(payment.data.invoice)!==bank.providerInvoiceRef)return[];return receipts.filter(row=>row.providerPaymentIntentRef===cashReference(body.data.payment_intent)).map(row=>row.id);});
  else if(["subscription_read","bootstrap_subscription","subscription_list_read"].includes(fact.actual.kind)){
   const rows=fact.actual.kind==="subscription_list_read"&&Array.isArray(raw.data)?raw.data:[raw];ids=rows.flatMap(value=>{const parsed=object(value);if(!parsed.success||parsed.data.id!==bank.providerSubscriptionRef||cashReference(parsed.data.customer)!==source.resource.originalScope.providerCustomerRef||cashReference(parsed.data.latest_invoice)!==bank.providerInvoiceRef)return[];return receipts.map(row=>row.id);});
  }
  if(ids.length)bindings.push({factId:fact.id,operationId:operation.id,callId:call.id,actualDigest:fact.actualDigest,receiptIds:[...new Set(ids)].sort()});
 }
 return bindings.sort((a,b)=>a.factId.localeCompare(b.factId));
}
