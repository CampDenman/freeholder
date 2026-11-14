// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: discover genuine source resources BEFORE the outer target prefix.
import {eq} from "drizzle-orm";
import {z} from "zod";
import {ServiceError,type ServiceContext,type Tx} from "@/core/service";
import {payments} from "./schema";
import {merchantAgreementPaymentRoutes} from "./merchant-agreement-schema";
import {controlledCashApplicationBatches,controlledCashApplicationLinks,controlledCashApplicationReceipts} from "./controlled-cash-application-protocol-schema";
import {verifiedControlledCashBatch,verifiedControlledCashReceipt} from "./controlled-cash-application-protocol-proof";
import {readControlledReceiptNamespace} from "@/modules/subscriptions/controlled-provider-cash-namespace";
import {requireHeldControlledCashResource} from "./controlled-cash-inspection-observation-context";
import {merchantTaxDigest} from "./merchant-tax-store";
import {atomicCreditFinancialScope} from "./atomic-credit-financial-scope";
import {controlledFinancialWitness} from "./controlled-provider-financial-witness";
function refuse():never{throw new ServiceError("conflict","Restore every exact original controlled credit source and its authentic applied receipt before choosing the complete resource/parent prefix; a missing bridge cannot fall through to a legacy source.");}
/** Pure read against a REAL Tx. No principal/debt-safe flag or lock is granted.
 * Callers discover this before any target resource/parent/canonical lock. */
export async function atomicCreditSourceResourceIds(tx:Tx,actualPaymentIds:readonly string[]){
 const requestedPaymentIds=[...new Set(actualPaymentIds)].sort();if(requestedPaymentIds.length>5000||requestedPaymentIds.some(id=>!z.uuid().safeParse(id).success))refuse();
 const scope=await atomicCreditFinancialScope(tx,requestedPaymentIds),ids=scope.paymentIds;
 const sources:Array<{paymentId:string;receiptId:string;resourceId:string;subscriptionId:string;collectionId:string;batchId:string;proofId:string}>=[];
 const witness=await controlledFinancialWitness(tx,{subscriptionIds:scope.subscriptionIds,paymentIds:scope.paymentIds,invoiceIds:scope.invoiceIds});if(witness.incomplete)refuse();
 const nodeTables={subscription:"subscriptions",resource:"subscription_controlled_resources",invoice:"invoices",payment:"payments",note:"credit_notes",receipt:"subscription_provider_charge_receipts",proration:"subscription_prorations",funding:"invoice_credit_funding",reservation:"invoice_credit_reservations",collection:"subscription_controlled_collections"} as const;
 const physical=new Set([...witness.entries.map(row=>`${row.table}:${row.id}`),...scope.nodes.map(row=>`${nodeTables[row.kind]}:${row.id}`),...scope.inspectionIds.map(id=>`merchant_cash_return_inspections:${id}`)]);
 const add=(table:string,id:string)=>{physical.add(`${table}:${id}`);if(physical.size>5000)refuse();};if(physical.size>5000)refuse();
 for(const paymentId of ids){
  const[payment]=await tx.select().from(payments).where(eq(payments.id,paymentId));if(!payment)refuse();add("payments",payment.id);
  const[knownLink]=await tx.select().from(controlledCashApplicationLinks).where(eq(controlledCashApplicationLinks.paymentId,paymentId));
  const[route]=await tx.select().from(merchantAgreementPaymentRoutes).where(eq(merchantAgreementPaymentRoutes.paymentId,paymentId));
  if(!route?.originalChargeReceiptId){if(knownLink||payment.idempotencyKey.startsWith("controlled-receipt:"))refuse();continue;}add("merchant_agreement_payment_routes",route.paymentId);
  const namespace=await readControlledReceiptNamespace(tx,route.originalChargeReceiptId);if(!namespace.applies){if(knownLink||payment.idempotencyKey.startsWith("controlled-receipt:"))refuse();continue;}
  if(!namespace.verified||!namespace.resourceId)refuse();add("subscription_provider_charge_receipts",route.originalChargeReceiptId);
  const link=knownLink;if(!link||link.receiptId!==route.originalChargeReceiptId)refuse();
  const[batch]=await tx.select().from(controlledCashApplicationBatches).where(eq(controlledCashApplicationBatches.id,link.batchId)),[proof]=await tx.select().from(controlledCashApplicationReceipts).where(eq(controlledCashApplicationReceipts.id,link.receiptProofId));add("controlled_cash_application_links",link.receiptId);
  if(!batch||!proof||!verifiedControlledCashBatch(batch)||!verifiedControlledCashReceipt(proof)||batch.resourceId!==namespace.resourceId||batch.invoiceId!==payment.invoiceId||batch.subscriptionId!==route.subscriptionId||proof.batchId!==batch.id||proof.receiptId!==link.receiptId||proof.amountMinor!==payment.amountMinor||proof.feeMinor!==route.applicationFeeMinor||proof.currency!==payment.currency||!batch.requestedReceiptIds.includes(link.receiptId))refuse();
  add("controlled_cash_application_batches",batch.id);add("controlled_cash_application_receipts",proof.id);
  sources.push({paymentId,receiptId:link.receiptId,resourceId:batch.resourceId,subscriptionId:batch.subscriptionId,collectionId:batch.collectionId,batchId:batch.id,proofId:proof.id});if(physical.size>5000)refuse();
 }
 return{sources,requestedPaymentIds,scope,resourceIds:scope.resourceIds,subscriptionIds:scope.subscriptionIds,physicalIdentities:[...physical].sort(),revision:merchantTaxDigest({sources,scopeRevision:scope.revision,physicalIdentities:[...physical].sort()})};
}
/** No late resource acquisition. The real outer writer already holds sorted
 * contact/resources/parents; this is called BEFORE its canonical source locks.
 * It refuses a newly discovered source so the outer transaction can replan. */
export async function assertAtomicCreditSourcePrefix(ctx:ServiceContext,actualPaymentIds:readonly string[]){
 const before=await atomicCreditSourceResourceIds(ctx.tx,actualPaymentIds);
 for(const resourceId of before.resourceIds)await requireHeldControlledCashResource(ctx,resourceId);
 const after=await atomicCreditSourceResourceIds(ctx.tx,actualPaymentIds);if(after.revision!==before.revision)refuse();return after;
}
