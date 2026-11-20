// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: exact canonical receipt identities, never amount-selected ownership.
import { z } from "zod";
import { ServiceError } from "@/core/service";
import { controlledCashApplicationBatchCapacity } from "./controlled-provider-cash-application-parent";
import type { invoices,payments } from "./schema";
import type { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import type { subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import type { subscriptionControlledChargeOrigins } from "@/modules/subscriptions/controlled-provider-schema";
type Receipt=typeof subscriptionProviderChargeReceipts.$inferSelect;
type Origin=typeof subscriptionControlledChargeOrigins.$inferSelect;
type Payment=typeof payments.$inferSelect;
type Route=typeof merchantAgreementPaymentRoutes.$inferSelect;
export type ControlledReceiptCandidate={receipt:Pick<Receipt,"id"|"subscriptionId"|"providerApiVersion"|"providerPlatformAccountId"|"chargeAccountId"|"providerSubscriptionRef"|"providerInvoiceRef"|"providerPaymentIntentRef"|"providerChargeRef"|"amountMinor"|"currency"|"customerChargeVerified"|"merchantRouteVerified">;
 origin:Pick<Origin,"receiptId"|"resourceId"|"operationId"|"callId"|"factId">|null;
 payment:Pick<Payment,"id"|"invoiceId"|"provider"|"method"|"providerRef"|"status"|"amountMinor"|"currency">|null;
 route:Pick<Route,"paymentId"|"subscriptionId"|"originalChargeReceiptId"|"originKind"|"providerPlatformAccountId"|"chargeAccountId"|"providerInvoiceRef"|"providerPaymentIntentRef"|"providerChargeRef"|"providerApiVersion">|null};
function refuse():never{throw new ServiceError("conflict","Retain the complete exact controlled receipt/origin/payment batch and unpaid remainder. Duplicate, foreign, unknown, over-captured or reserved cash needs genuine recovery, never amount adoption.");}
/** Pure structural/capacity check only. Authentic original caller/fact/current
 * bank/financial/privacy proof is separately REQUIRED before any mutation. */
export function planControlledReceiptBatch(input:{collectionId:string;resourceId:string;subscriptionId:string;providerInvoiceRef:string;providerSubscriptionRef:string;platform:string;account:string|null;
 invoice:Pick<typeof invoices.$inferSelect,"id"|"status"|"currency"|"totalMinor"|"paidMinor"|"creditedMinor"|"refundedMinor">;receiptIds:readonly string[];candidates:readonly ControlledReceiptCandidate[]}){
 const ids=[...input.receiptIds].sort();
 if(!ids.length||ids.length>5000||new Set(ids).size!==ids.length||ids.some(id=>!z.uuid().safeParse(id).success)||input.candidates.length!==ids.length
  ||new Set(input.candidates.map(row=>row.receipt.id)).size!==ids.length||new Set(input.candidates.map(row=>row.receipt.providerPaymentIntentRef)).size!==ids.length
  ||new Set(input.candidates.map(row=>row.receipt.providerChargeRef)).size!==ids.length)refuse();
 const ordered=ids.map(id=>{const row=input.candidates.find(candidate=>candidate.receipt.id===id);if(!row)refuse();return row;});
 const pending=[],applied=[];
 for(const row of ordered){const{receipt,origin,payment,route}=row;
  if(!origin||origin.receiptId!==receipt.id||origin.resourceId!==input.resourceId||receipt.subscriptionId!==input.subscriptionId||receipt.providerInvoiceRef!==input.providerInvoiceRef
   ||receipt.providerSubscriptionRef!==input.providerSubscriptionRef||receipt.providerApiVersion!=="2026-10-28.endive"||receipt.providerPlatformAccountId!==input.platform||receipt.chargeAccountId!==input.account
   ||receipt.currency!==input.invoice.currency||!receipt.customerChargeVerified||!receipt.merchantRouteVerified||!receipt.providerChargeRef
   ||!Number.isSafeInteger(receipt.amountMinor)||receipt.amountMinor<=0)refuse();
  if(payment||route){
   if(!payment||!route||route.paymentId!==payment.id||route.originalChargeReceiptId!==receipt.id||route.subscriptionId!==input.subscriptionId||route.originKind!=="provider_schedule"
    ||route.providerApiVersion!==receipt.providerApiVersion||route.providerPlatformAccountId!==receipt.providerPlatformAccountId||route.chargeAccountId!==receipt.chargeAccountId
    ||route.providerInvoiceRef!==receipt.providerInvoiceRef||route.providerPaymentIntentRef!==receipt.providerPaymentIntentRef||route.providerChargeRef!==receipt.providerChargeRef
    ||payment.invoiceId!==input.invoice.id||payment.provider!=="stripe"||payment.method!=="provider_schedule"||payment.status!=="succeeded"||payment.providerRef!==receipt.providerPaymentIntentRef
    ||payment.amountMinor!==receipt.amountMinor||payment.currency!==receipt.currency)refuse();
   applied.push({receiptId:receipt.id,paymentId:payment.id});
  }else pending.push({receiptId:receipt.id,amountMinor:receipt.amountMinor,currency:receipt.currency,idempotencyKey:`controlled-receipt:${input.collectionId}:${receipt.id}`});
 }
 const capacity=pending.length?controlledCashApplicationBatchCapacity(input.invoice,pending):null;
 return{pending,applied,capacity};
}
