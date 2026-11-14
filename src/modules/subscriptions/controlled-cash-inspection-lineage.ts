// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: actual namespace-serialized admission, never payment authority.
import { and,asc,eq,inArray,or,sql } from "drizzle-orm";
import { ServiceError,type ServiceContext,type Tx } from "@/core/service";
import { cashInspectionHolder } from "@/modules/invoicing/merchant-cash-inspection-holder";
import { cashInspectionEvidenceKeys,cashInspectionSigningKey,cashInspectionStops } from "@/modules/invoicing/merchant-cash-inspection-stops";
import { merchantAgreementPaymentRoutes } from "@/modules/invoicing/merchant-agreement-schema";
import { merchantCashReturnInspections,merchantCashReturnInspectionFinishes } from "@/modules/invoicing/merchant-refund-schema";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptionControlledChargeOrigins } from "./controlled-provider-schema";
import { subscriptionProviderChargeReceipts } from "./schema";
import { readControlledReceiptNamespace } from "./controlled-provider-cash-namespace";
import { subscriptionControlledCashInspectionLineages as lineages } from "./controlled-cash-inspection-lineage-schema";
import { controlledCashInspectionLineageBody,controlledCashInspectionNamespace,controlledCashLineageChain,controlledCashLineageCovers,signControlledCashInspectionLineage,verifiedControlledCashInspectionLineage } from "./controlled-cash-inspection-lineage-proof";
type Admission=typeof merchantCashReturnInspections.$inferSelect;
function refuse():never{throw new ServiceError("conflict","Restore the authentic complete controlled inspection lineage and actual original caller closure. No timestamp, later successful GET, backfill or namespace label can establish read order or payment authority.");}
/** Exact receipt FK/route ancestry only. This does not approve any cash, fee,
 * refund, balance or dispute. A known controlled namespace never falls through. */
async function controlledSource(tx:Tx,admission:Admission){
 const aliases=admission.paymentId?await tx.select({receiptId:merchantAgreementPaymentRoutes.originalChargeReceiptId}).from(merchantAgreementPaymentRoutes).where(eq(merchantAgreementPaymentRoutes.paymentId,admission.paymentId)).limit(2):[];
 if(aliases.length>1)refuse();
 const receiptId=admission.subscriptionChargeReceiptId??aliases[0]?.receiptId;
 if(!receiptId){
  const known=await tx.select({id:subscriptionControlledChargeOrigins.receiptId}).from(subscriptionControlledChargeOrigins).innerJoin(subscriptionProviderChargeReceipts,eq(subscriptionProviderChargeReceipts.id,subscriptionControlledChargeOrigins.receiptId))
   .where(and(eq(subscriptionProviderChargeReceipts.providerPlatformAccountId,admission.providerPlatformAccountId),sql`${subscriptionProviderChargeReceipts.chargeAccountId} is not distinct from ${admission.chargeAccountId}`,eq(subscriptionProviderChargeReceipts.providerPaymentIntentRef,admission.originalPaymentRef))).limit(1);
  if(known.length)refuse();return null;
 }
 const namespace=await readControlledReceiptNamespace(tx,receiptId);
 if(!namespace.applies)return null;
 if(!namespace.verified||!namespace.resourceId)refuse();
 const[receipt]=await tx.select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.id,receiptId));
 const[origin]=await tx.select().from(subscriptionControlledChargeOrigins).where(eq(subscriptionControlledChargeOrigins.receiptId,receiptId));
 if(!receipt||!origin||origin.resourceId!==namespace.resourceId||receipt.providerPlatformAccountId!==admission.providerPlatformAccountId||receipt.chargeAccountId!==admission.chargeAccountId
  ||receipt.providerPaymentIntentRef!==admission.originalPaymentRef||receipt.providerApiVersion!==admission.providerApiVersion||receipt.amountMinor!==admission.originalCashAmountMinor||receipt.currency!==admission.currency)refuse();
 return{receipt,origin};
}
async function inventory(tx:Tx,admission:Admission){
 const admissions=await tx.select().from(merchantCashReturnInspections).where(and(eq(merchantCashReturnInspections.providerPlatformAccountId,admission.providerPlatformAccountId),
  sql`${merchantCashReturnInspections.chargeAccountId} is not distinct from ${admission.chargeAccountId}`,eq(merchantCashReturnInspections.originalPaymentRef,admission.originalPaymentRef))).orderBy(asc(merchantCashReturnInspections.id)).limit(5001);
 if(admissions.length>5000)refuse();const ids=admissions.map(row=>row.id);
 const finishes=ids.length?await tx.select().from(merchantCashReturnInspectionFinishes).where(inArray(merchantCashReturnInspectionFinishes.inspectionId,ids)).limit(5001):[];
 const stops=await cashInspectionStops(tx,admissions),rows=await tx.select().from(lineages).where(eq(lineages.namespaceKey,controlledCashInspectionNamespace(admission))).orderBy(asc(lineages.admissionSequence)).limit(5001);
 if(admissions.length+finishes.length+stops.length+rows.length>5000)refuse();
 const fingerprints=ids.length?await tx.select({id:merchantCashReturnInspections.id,fingerprint:sql<string>`encode(sha256(convert_to(to_jsonb(${merchantCashReturnInspections})::text,'UTF8')),'hex')`}).from(merchantCashReturnInspections).where(inArray(merchantCashReturnInspections.id,ids)):[];
 const keys=cashInspectionEvidenceKeys();
 if(!controlledCashLineageChain(rows)||rows.some(row=>{const original=admissions.find(item=>item.id===row.inspectionId);return!original||!verifiedControlledCashInspectionLineage(original,row,keys)||fingerprints.find(item=>item.id===row.inspectionId)?.fingerprint!==row.admissionFingerprint;}))refuse();
 return{admissions,finishes,stops,rows,fingerprints};
}
async function history(tx:Tx,admission:Admission){
 const rows=await tx.execute<{inspection_ids:string[];fingerprint:string;row_count:number;closed:boolean}>(sql`select * from freeholder_controlled_cash_read_history(${admission.providerPlatformAccountId},${admission.chargeAccountId},${admission.originalPaymentRef},${admission.id}::uuid)`);
 const row=rows[0];if(rows.length!==1||!row||!row.closed||row.row_count>5000||!Array.isArray(row.inspection_ids)||!/^[a-f0-9]{64}$/.test(row.fingerprint))refuse();return row;
}
/** Called ONLY in the actual admission transaction before any physical GET.
 * SQL also requires the original admission's same-transaction xmin equality;
 * it is not a read-order clock and cannot annotate historical admissions. */
export async function retainControlledCashInspectionLineage(ctx:ServiceContext,input:{inspectionId:string;completionNonce:string}){
 const[initial]=await ctx.tx.select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id,input.inspectionId));if(!initial)refuse();
 const source=await controlledSource(ctx.tx,initial);if(!source)return null;
 await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`subscription-cash:${controlledCashInspectionNamespace(initial)}`}))`);
 const admission=await cashInspectionHolder(ctx,input.inspectionId,input.completionNonce),current=await inventory(ctx.tx,admission);
 if(current.rows.some(row=>row.inspectionId===admission.id))refuse();
 const prior=current.rows.at(-1),closed=await history(ctx.tx,admission);
 const sequence=await ctx.tx.execute<{sequence:string}>(sql`select nextval('controlled_cash_read_admission_seq'::regclass)::text as sequence`),admissionSequence=Number(sequence[0]?.sequence);
 if(sequence.length!==1||!Number.isSafeInteger(admissionSequence)||admissionSequence<=0)refuse();
 const fingerprint=current.fingerprints.find(row=>row.id===admission.id)?.fingerprint;if(!fingerprint)refuse();
 const body={inspectionId:admission.id,resourceId:source.origin.resourceId,receiptId:source.receipt.id,namespaceKey:controlledCashInspectionNamespace(admission),admissionSequence,
  predecessorInspectionId:prior?.inspectionId??null,predecessorDigest:prior?.digest??null,closedInspectionIds:closed.inspection_ids,closedHistoryDigest:closed.fingerprint,
  callerInstanceId:admission.caller.id,admissionDigest:merchantTaxDigest(admission),admissionFingerprint:fingerprint};
 const retained={...body,digest:merchantTaxDigest(controlledCashInspectionLineageBody(body)),createdAt:new Date()},authentication=signControlledCashInspectionLineage(retained,cashInspectionSigningKey());
 const[saved]=await ctx.tx.insert(lineages).values({...retained,authentication}).returning();if(!saved)refuse();
 // Literal existing private outbox ABI; importing its service collector here
 // would reintroduce financial bootstrap cycles. The repair validates HMAC/FKs.
 ctx.queueEvent("invoicing.originalRefundEvidenceRetained",{kind:"controlled_cash_lineage",id:saved.inspectionId});return saved;
}
/** Actual latest RETURNED caller only. Later unsequenced/unfinished/stopped or
 * thrown reads refuse older bank evidence. No parent digest/created_at ordering. */
export async function latestControlledCashInspectionLineage(tx:Tx,receiptId:string){
 const[receipt]=await tx.select().from(subscriptionProviderChargeReceipts).where(eq(subscriptionProviderChargeReceipts.id,receiptId));if(!receipt)refuse();
 const picked=await tx.execute<{inspection_id:string|null}>(sql`select freeholder_controlled_cash_read_latest(${receiptId}::uuid) as inspection_id`),inspectionId=picked[0]?.inspection_id;
 if(picked.length!==1||!inspectionId)refuse();
 const[admission]=await tx.select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id,inspectionId));if(!admission)refuse();
 const source=await controlledSource(tx,admission);if(!source||source.receipt.id!==receiptId)refuse();
 const current=await inventory(tx,admission),latest=current.rows.at(-1),closed=await history(tx,admission);
 if(!latest||latest.inspectionId!==inspectionId||latest.resourceId!==source.origin.resourceId||latest.receiptId!==receiptId
  ||current.rows.some(row=>row.resourceId!==source.origin.resourceId||row.receiptId!==receiptId)
  ||!controlledCashLineageCovers(latest,current.admissions.map(row=>row.id),closed.fingerprint))refuse();
 return{inspection:admission,lineage:latest,admissions:current.admissions,finishes:current.finishes,stops:current.stops,revision:merchantTaxDigest({lineage:latest,currentClosedHistoryDigest:closed.fingerprint}),suppliesBankEvidence:false as const,suppliesApplicationAuthority:false as const};
}
/** Exact FK selectors, full PostgreSQL row SHA, one aggregate bound shared by
 * parents with every other family. No collector, email or amount discovery. */
export async function controlledCashInspectionLineageWitness(tx:Tx,input:{paymentIds?:readonly string[];receiptIds?:readonly string[];resourceIds?:readonly string[]}){
 const payments=[...new Set(input.paymentIds??[])],receipts=[...new Set(input.receiptIds??[])],resources=[...new Set(input.resourceIds??[])];if(payments.length+receipts.length+resources.length>5000)refuse();
 const aliases=payments.length?await tx.select({receiptId:merchantAgreementPaymentRoutes.originalChargeReceiptId}).from(merchantAgreementPaymentRoutes).where(inArray(merchantAgreementPaymentRoutes.paymentId,payments)).limit(5001):[];
 const receiptIds=[...new Set([...receipts,...aliases.flatMap(row=>row.receiptId?[row.receiptId]:[])])];if(aliases.length+receiptIds.length+resources.length>5000)refuse();
 const conditions=[...(receiptIds.length?[inArray(lineages.receiptId,receiptIds)]:[]),...(resources.length?[inArray(lineages.resourceId,resources)]:[])];
 const rows=conditions.length?await tx.select().from(lineages).where(or(...conditions)).orderBy(asc(lineages.inspectionId)).limit(5001):[];
 const ids=rows.map(row=>row.inspectionId),admissions=ids.length?await tx.select().from(merchantCashReturnInspections).where(inArray(merchantCashReturnInspections.id,ids)).limit(5001):[];
 const keys=cashInspectionEvidenceKeys();if(rows.length+admissions.length>5000||rows.some(row=>!admissions.some(original=>verifiedControlledCashInspectionLineage(original,row,keys))))refuse();
 const entries=ids.length?await tx.select({table:sql<string>`'subscription_controlled_cash_inspection_lineages'`,id:lineages.inspectionId,inspectionId:lineages.inspectionId,receiptId:lineages.receiptId,resourceId:lineages.resourceId,
  fingerprint:sql<string>`encode(sha256(convert_to(to_jsonb(${lineages})::text,'UTF8')),'hex')`}).from(lineages).where(inArray(lineages.inspectionId,ids)).orderBy(asc(lineages.inspectionId)):[];
 return{lineages:rows,admissions,entries};
}
export { exportControlledCashInspectionLineages } from "./controlled-cash-inspection-lineage-proof";
