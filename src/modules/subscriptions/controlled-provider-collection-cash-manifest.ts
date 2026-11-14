// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: whole actual target inventory, including honest partial bank cash.
import { z } from "zod";
import { ServiceError } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import type { controlledCollectionState } from "./controlled-provider-collection-state";
import { controlledCashEvidence } from "./controlled-provider-cash-origin";
export const cashObject=(value:unknown)=>z.record(z.string(),z.unknown()).parse(value);
export const cashReference=(value:unknown)=>typeof value==="string"?value:value&&typeof value==="object"&&"id"in value&&typeof value.id==="string"?value.id:null;
const minor=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export function refuseControlledCash():never{throw new ServiceError("conflict","Preserve all actual captured, pending or over/under-target bank money and original caller/raw evidence. Restore the exact complete target/credit/fee/original namespace inventory before prospective application; never clip a receipt, invent payment or promote a partial bank payment to paid access.");}
/** Actual bank projection, not a local paid/access switch. */
export function controlledCashManifestBalance(value:{totalMinor:unknown;paidMinor:unknown;remainingMinor:unknown;status:unknown},expectedCashDueMinor:number){
 const total=minor.parse(value.totalMinor),paid=minor.parse(value.paidMinor),remaining=minor.parse(value.remainingMinor),status=z.enum(["open","paid"]).parse(value.status);
 if(paid<=0||total!==expectedCashDueMinor||BigInt(paid)+BigInt(remaining)!==BigInt(total)||status==="paid"&&remaining!==0||status==="open"&&remaining===0)refuseControlledCash();return{total,paid,remaining,status};
}
const readKinds=new Set(["read_product","discover_bootstrap","read_bootstrap","read_calendar","preview_proration","preview_update","read_manifest","read_invoice","read_customer_financials","list_invoices"]);
export function controlledCashManifest(source:Awaited<ReturnType<typeof controlledCollectionState>>){
 const{history,canonical,binding,manifest,resource}=source;if(!binding||manifest.cashDueMinor<=0)refuseControlledCash();
 const read=history.verifications.filter(row=>history.operations.some(op=>op.id===row.operationId&&op.kind==="read_manifest")).at(-1),operation=read?history.operations.find(row=>row.id===read.operationId):null;
 const proof=read?source.proofs.find(row=>row.operationId===read.operationId&&row.callId===read.callId):null;
 if(!read||!operation||!proof||read.actualResult.exactManifest!==true||read.actualResult.suppliesPaidAuthority!==false
  ||read.actualResult.manifestDigest!==merchantTaxDigest(manifest)||proof.canonicalTargetDigest!==canonical.digest||proof.resultDigest!==read.actualResultDigest
  ||history.operations.some(row=>row.ordinal>operation.ordinal&&history.calls.some(call=>call.operationId===row.id)&&!readKinds.has(row.kind)))refuseControlledCash();
 const inventory=cashObject(read.actualResult.inventory),invoice=cashObject(inventory.actualInvoice),{total,paid,remaining}=controlledCashManifestBalance({totalMinor:inventory.totalMinor,paidMinor:inventory.paidMinor,remainingMinor:inventory.remainingMinor,status:inventory.status},manifest.cashDueMinor);
 if(inventory.providerInvoiceRef!==binding.providerInvoiceRef||inventory.providerSubscriptionRef!==cashReference(invoice.subscription??cashObject(cashObject(invoice.parent??{}).subscription_details??{}).subscription)
  ||inventory.providerCustomerRef!==resource.originalScope.providerCustomerRef||inventory.currency!==manifest.currency||!['open','paid'].includes(String(inventory.status))||paid<=0
  ||total!==manifest.cashDueMinor||BigInt(paid)+BigInt(remaining)!==BigInt(total)||inventory.status==='paid'&&remaining!==0||inventory.status==='open'&&remaining===0
  ||inventory.completePayments!==true||inventory.completeLines!==true||inventory.autoAdvance!==false||invoice.auto_advance!==false
  ||invoice.id!==binding.providerInvoiceRef||cashReference(invoice.customer)!==resource.originalScope.providerCustomerRef||invoice.amount_paid!==paid||invoice.amount_remaining!==remaining
  ||invoice.starting_balance!==0||invoice.ending_balance!==0||invoice.pre_payment_credit_notes_amount!==0||invoice.post_payment_credit_notes_amount!==0)refuseControlledCash();
 const intents=z.array(z.record(z.string(),z.unknown())).max(5000).parse(inventory.actualIntents),bankPayments=z.array(z.record(z.string(),z.unknown())).max(5000).parse(inventory.actualPayments),cash=z.array(controlledCashEvidence).max(5000).parse(inventory.actualCash);
 if(intents.length+bankPayments.length+cash.length>5000||!cash.length||new Set(intents.map(row=>cashReference(row.id))).size!==intents.length||new Set(bankPayments.map(row=>cashReference(row.id))).size!==bankPayments.length
  ||new Set(cash.map(row=>row.providerPaymentIntentRef)).size!==cash.length||cash.reduce((sum,row)=>sum+BigInt(row.amountMinor),0n)!==BigInt(paid))refuseControlledCash();
 for(const intent of intents){
  const received=minor.parse(intent.amount_received);if(received>0){if(intent.status!=="succeeded"||!cash.some(row=>row.providerPaymentIntentRef===intent.id&&row.amountMinor===received))refuseControlledCash();}
  else if(intent.status!=="canceled"&&!(intent.status==="succeeded"&&intent.amount===0))refuseControlledCash();
 }
 for(const actual of cash){
  const intent=intents.find(row=>row.id===actual.providerPaymentIntentRef),payments=bankPayments.filter(row=>cashReference(cashObject(row.payment).payment_intent)===actual.providerPaymentIntentRef);
  if(!intent||cashReference(intent.customer)!==resource.originalScope.providerCustomerRef||actual.subscriptionId!==source.parent.id||actual.providerInvoiceRef!==binding.providerInvoiceRef
   ||actual.providerSubscriptionRef!==inventory.providerSubscriptionRef||actual.providerCustomerRef!==resource.originalScope.providerCustomerRef
   ||actual.providerPlatformAccountId!==resource.originalScope.providerPlatformAccountId||(actual.providerAccountId??null)!==(resource.originalScope.providerAccountId??null)
   ||actual.currency!==manifest.currency||!actual.customerChargeVerified||!actual.merchantRouteVerified||!actual.providerChargeRef||cashReference(intent.latest_charge)!==actual.providerChargeRef
   ||!payments.length||payments.some(row=>cashReference(row.invoice)!==binding.providerInvoiceRef||cashObject(row.payment).type!=="payment_intent"||String(row.currency).toUpperCase()!==manifest.currency||row.status!=="paid")
   ||payments.reduce((sum,row)=>sum+BigInt(minor.parse(row.amount_paid)),0n)!==BigInt(actual.amountMinor))refuseControlledCash();
 }
 for(const payment of bankPayments){const amount=minor.parse(payment.amount_paid),intentId=cashReference(cashObject(payment.payment).payment_intent);
  if(cashReference(payment.invoice)!==binding.providerInvoiceRef||cashObject(payment.payment).type!=="payment_intent"||!intents.some(row=>row.id===intentId)||amount>0&&!cash.some(row=>row.providerPaymentIntentRef===intentId))refuseControlledCash();
 }
 return{read,operation,proof,inventory,invoice,intents,bankPayments,cash,totalMinor:total,paidMinor:paid,remainingMinor:remaining,status:z.enum(["open","paid"]).parse(inventory.status),providerSubscriptionRef:z.string().parse(inventory.providerSubscriptionRef),providerInvoiceRef:binding.providerInvoiceRef,zeroWalletProofDigest:merchantTaxDigest({customerFinancialDigest:proof.customerFinancialDigest,startingBalance:invoice.starting_balance,endingBalance:invoice.ending_balance,prePaymentCreditNotes:invoice.pre_payment_credit_notes_amount,postPaymentCreditNotes:invoice.post_payment_credit_notes_amount})};
}
