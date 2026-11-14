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
function refuse():never{throw new ServiceError("conflict","Restore every exact original controlled credit source and its authentic applied receipt before choosing the complete resource/parent prefix; a missing bridge cannot fall through to a legacy source.");}
/** Pure read against a REAL Tx. No principal/debt-safe flag or lock is granted.
 * Callers discover this before any target resource/parent/canonical lock. */
export async function atomicCreditSourceResourceIds(tx:Tx,actualPaymentIds:readonly string[]){
 const ids=[...new Set(actualPaymentIds)].sort();if(ids.length>5000||ids.some(id=>!z.uuid().safeParse(id).success))refuse();
 const sources:Array<{paymentId:string;receiptId:string;resourceId:string;subscriptionId:string;collectionId:string;batchId:string;proofId:string}>=[];let count=0;const physical=new Set<string>(),resourceCounts=new Map<string,number>();
 const add=(table:string,id:string)=>{physical.add(`${table}:${id}`);count=physical.size+[...resourceCounts.values()].reduce((sum,value)=>sum+value,0);if(count>5000)refuse();};
 for(const paymentId of ids){
  const[payment]=await tx.select().from(payments).where(eq(payments.id,paymentId));if(!payment)refuse();add("payments",payment.id);
  const[route]=await tx.select().from(merchantAgreementPaymentRoutes).where(eq(merchantAgreementPaymentRoutes.paymentId,paymentId));if(!route?.originalChargeReceiptId)continue;add("merchant_agreement_payment_routes",route.paymentId);
  const namespace=await readControlledReceiptNamespace(tx,route.originalChargeReceiptId);if(!namespace.applies)continue;
  if(!namespace.verified||!namespace.resourceId)refuse();resourceCounts.set(namespace.resourceId,namespace.inventoryCount);add("subscription_provider_charge_receipts",route.originalChargeReceiptId);
  const[link]=await tx.select().from(controlledCashApplicationLinks).where(eq(controlledCashApplicationLinks.paymentId,paymentId));if(!link||link.receiptId!==route.originalChargeReceiptId)refuse();
  const[batch]=await tx.select().from(controlledCashApplicationBatches).where(eq(controlledCashApplicationBatches.id,link.batchId)),[proof]=await tx.select().from(controlledCashApplicationReceipts).where(eq(controlledCashApplicationReceipts.id,link.receiptProofId));add("controlled_cash_application_links",link.receiptId);
  if(!batch||!proof||!verifiedControlledCashBatch(batch)||!verifiedControlledCashReceipt(proof)||batch.resourceId!==namespace.resourceId||batch.invoiceId!==payment.invoiceId||batch.subscriptionId!==route.subscriptionId||proof.batchId!==batch.id||proof.receiptId!==link.receiptId||proof.amountMinor!==payment.amountMinor||proof.feeMinor!==route.applicationFeeMinor||proof.currency!==payment.currency||!batch.requestedReceiptIds.includes(link.receiptId))refuse();
  add("controlled_cash_application_batches",batch.id);add("controlled_cash_application_receipts",proof.id);
  sources.push({paymentId,receiptId:link.receiptId,resourceId:batch.resourceId,subscriptionId:batch.subscriptionId,collectionId:batch.collectionId,batchId:batch.id,proofId:proof.id});if(count>5000)refuse();
 }
 return{sources,resourceIds:[...new Set(sources.map(row=>row.resourceId))].sort(),subscriptionIds:[...new Set(sources.map(row=>row.subscriptionId))].sort(),revision:merchantTaxDigest(sources)};
}
/** No late resource acquisition. The real outer writer already holds sorted
 * contact/resources/parents; this is called BEFORE its canonical source locks.
 * It refuses a newly discovered source so the outer transaction can replan. */
export async function assertAtomicCreditSourcePrefix(ctx:ServiceContext,actualPaymentIds:readonly string[]){
 const before=await atomicCreditSourceResourceIds(ctx.tx,actualPaymentIds);
 for(const resourceId of before.resourceIds)await requireHeldControlledCashResource(ctx,resourceId);
 const after=await atomicCreditSourceResourceIds(ctx.tx,actualPaymentIds);if(after.revision!==before.revision)refuse();return after;
}
