// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: real same-TX staged evidence, NEVER application permission.
import { eq,inArray,sql } from "drizzle-orm";
import { z } from "zod";
import { ServiceError,type ServiceContext } from "@/core/service";
import { controlledProviderJournal } from "@/modules/subscriptions/controlled-provider-proof";
import { controlledCashInspectionLineageWitness,latestControlledCashInspectionLineage } from "@/modules/subscriptions/controlled-cash-inspection-lineage";
import { controlledCashApplicationBatches,controlledCashApplicationReceipts,controlledCashApplicationLinks } from "./controlled-cash-application-protocol-schema";
import { verifiedControlledCashBatch,verifiedControlledCashReceipt } from "./controlled-cash-application-protocol-proof";
import { requireHeldControlledCashResource } from "./controlled-cash-inspection-observation-context";
import { merchantTaxDigest } from "./merchant-tax-store";
import { payments } from "./schema";
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const physical=z.object({table:z.string().min(1).max(160),id:z.string().min(1).max(300),fingerprint:sha,hashDomain:z.literal("postgres_row")}).strict();
export const controlledCashStageEvidence=z.object({batchId:z.uuid(),collectionId:z.uuid(),receiptId:z.uuid().nullable(),paymentId:z.uuid().nullable(),normalizedParentRevision:sha,currentParentRevision:sha,currentEntries:z.array(physical).min(1).max(5000),physicalRowCount:z.number().int().min(1).max(5000),
 settledReceiptIds:z.array(z.uuid()).max(5000),bankRevisions:z.array(z.object({receiptId:z.uuid(),immutableBankRevision:sha,currentNamespaceRevision:sha}).strict()).min(1).max(5000),complete:z.boolean()}).strict().superRefine((value,ctx)=>{
 if(value.physicalRowCount!==value.currentEntries.length||new Set(value.currentEntries.map(row=>`${row.table}:${row.id}`)).size!==value.currentEntries.length)ctx.addIssue({code:"custom",message:"Retain one complete actual table/identity/PG-row set without duplicate count or SHA replacement."});
 if(new Set(value.settledReceiptIds).size!==value.settledReceiptIds.length||new Set(value.bankRevisions.map(row=>row.receiptId)).size!==value.bankRevisions.length)ctx.addIssue({code:"custom",message:"Every actual receipt has one exact stage/bank identity."});
 if(value.complete!==(value.receiptId===null)||value.receiptId===null&&value.paymentId!==null)ctx.addIssue({code:"custom",message:"A complete batch is explicit; it is never a fabricated current payment or invoice-paid/access flag."});
});
function refuse():never{throw new ServiceError("conflict","Restore the genuine immutable original bank/parent admissions, exact actual current payment prefix and complete returned inspection lineage. A marker or cached scalar cannot grant staged money authority.");}
/** Reads/authenticates ONLY. This ordinary helper takes a REAL shared context
 * whose contact/resource/parent/canonical/cash prefix is already held. It never
 * acquires a resource in reverse, registers a stub, creates a receipt/payment,
 * clears raw facts, calls a historical scalar bank gate, or confers authority.
 * The actual full before-parent money/privacy/debt evaluator remains REQUIRED
 * before signing any batch. No API DTO/session metadata can install a context.
 */
export async function readControlledCashApplicationStage(ctx:ServiceContext,input:{batchId:string;receiptId?:string;paymentId?:string}){
 const selected=z.object({batchId:z.uuid(),receiptId:z.uuid().optional(),paymentId:z.uuid().optional()}).strict().parse(input);
 if(ctx.actor.kind!=="system"||selected.paymentId&&!selected.receiptId)refuse();
 const[batch]=await ctx.tx.select().from(controlledCashApplicationBatches).where(eq(controlledCashApplicationBatches.id,selected.batchId)).limit(1);
 if(!batch||!verifiedControlledCashBatch(batch))refuse();
 await requireHeldControlledCashResource(ctx,batch.resourceId);
 const[transaction]=await ctx.tx.execute<{id:string}>(sql`select txid_current()::text as id`);if(transaction?.id!==batch.admissionTransactionId)refuse();
 const receipts=await ctx.tx.select().from(controlledCashApplicationReceipts).where(eq(controlledCashApplicationReceipts.batchId,batch.id)).limit(5001);
 const links=await ctx.tx.select().from(controlledCashApplicationLinks).where(eq(controlledCashApplicationLinks.batchId,batch.id)).limit(5001);
 if(!receipts.length||receipts.length>5000||links.length>5000||receipts.some(row=>!verifiedControlledCashReceipt(row)))refuse();
 const receiptIds=[...receipts].sort((a,b)=>a.ordinal-b.ordinal).map(row=>row.receiptId);
 if(JSON.stringify(receiptIds)!==JSON.stringify(batch.requestedReceiptIds)||selected.receiptId&&!receiptIds.includes(selected.receiptId))refuse();
 // The bank producer established the original signed journal/lineage. Recheck
 // it genuinely here; opaque PG hashes never substitute for HMAC authentication.
 const journal=await controlledProviderJournal(ctx.tx,batch.resourceId);if(journal.unfinished.length)refuse();
 for(const receipt of receipts){
  const latest=await latestControlledCashInspectionLineage(ctx.tx,receipt.receiptId);
  if(latest.inspection.id!==receipt.bankInspectionId||latest.inspection.caller.id!==receipt.bankFinishCallerId
   ||latest.lineage.resourceId!==batch.resourceId||latest.lineage.receiptId!==receipt.receiptId)refuse();
  const origin=journal.chargeOrigins.find(row=>row.receiptId===receipt.receiptId);
  if(!origin||origin.operationId!==receipt.originOperationId||origin.callId!==receipt.originCallId||origin.factId!==receipt.originFactId)refuse();
 }
 const[raw]=await ctx.tx.execute<{evidence:unknown}>(sql`select freeholder_controlled_cash_stage(${batch.id}::uuid,${selected.receiptId??null}::uuid,${selected.paymentId??null}::uuid) as evidence`);
 const evidence=controlledCashStageEvidence.parse(raw?.evidence);
 const lineageWitness=await controlledCashInspectionLineageWitness(ctx.tx,{receiptIds});
 if(evidence.batchId!==batch.id||evidence.collectionId!==batch.collectionId||evidence.receiptId!==(selected.receiptId??null)||evidence.paymentId!==(selected.paymentId??null)
  ||evidence.normalizedParentRevision!==batch.parentPgRevision||evidence.bankRevisions.length!==receipts.length
  ||lineageWitness.entries.some(row=>evidence.currentEntries.find(current=>current.table===row.table&&current.id===row.id)?.fingerprint!==row.fingerprint)
  ||receipts.some(row=>evidence.bankRevisions.find(bank=>bank.receiptId===row.receiptId)?.immutableBankRevision!==row.immutableBankRevision))refuse();
 const actualPayments=links.length?await ctx.tx.select().from(payments).where(inArray(payments.id,links.map(row=>row.paymentId))).limit(5001):[];
 if(actualPayments.length!==links.length||actualPayments.length>5000||links.some(link=>!receipts.some(row=>row.id===link.receiptProofId&&row.receiptId===link.receiptId)))refuse();
 const settled=links.filter(link=>actualPayments.some(row=>row.id===link.paymentId&&row.status==="succeeded")).map(row=>row.receiptId).sort();
 if(JSON.stringify([...evidence.settledReceiptIds].sort())!==JSON.stringify(settled))refuse();
 // Re-read the whole physical set after the authentication queries. Namespace/
 // canonical locks remain held; even an unexpected same-TX callback is debt.
 const[current]=await ctx.tx.execute<{snapshot:unknown}>(sql`select freeholder_controlled_cash_parent_snapshot(${batch.collectionId}::uuid) as snapshot`);
 const snapshot=z.object({entries:z.array(physical).min(1).max(5000),revision:sha,physicalRowCount:z.number().int().min(1).max(5000)}).strict().parse(current?.snapshot);
 if(snapshot.revision!==evidence.currentParentRevision||JSON.stringify(snapshot.entries)!==JSON.stringify(evidence.currentEntries)||snapshot.physicalRowCount!==evidence.physicalRowCount)refuse();
 return{batch,receipts,links,evidence,revision:merchantTaxDigest({batchId:batch.id,parentRevision:batch.parentRevision,preApplicationRevision:batch.preApplicationRevision,currentParentPgRevision:evidence.currentParentRevision,bankRevisions:evidence.bankRevisions,settledReceiptIds:evidence.settledReceiptIds}),
  suppliesApplicationAuthority:false as const,suppliesPrincipalAuthority:false as const,suppliesAccessAuthority:false as const};
}
