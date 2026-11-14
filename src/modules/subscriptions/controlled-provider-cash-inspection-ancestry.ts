// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: exact returned-own causal entries; full financial coverage keeps ALL.
import { eq,inArray,sql } from "drizzle-orm";
import { z } from "zod";
import { ServiceError,type Tx } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { merchantCashReturnInspections,merchantCashReturnInspectionFinishes } from "@/modules/invoicing/merchant-refund-schema";
import { merchantRefundObservationCaptures } from "@/modules/invoicing/merchant-refund-current-schema";
import { cashInspectionEvidence } from "@/modules/invoicing/merchant-cash-inspection-evidence";
import { cashInspectionStops,cashInspectionEvidenceKeys } from "@/modules/invoicing/merchant-cash-inspection-stops";
import { verifiedCashInspectionRefundCapture } from "@/modules/invoicing/merchant-cash-inspection-refund-capture";
import { merchantReturnedCashEvidenceSchema } from "@/modules/invoicing/merchant-returned-cash-contract";
import { readControlledCashObservationSource } from "./controlled-provider-cash-observation-source";
import { subscriptionControlledCashInspectionLineages } from "./controlled-cash-inspection-lineage-schema";
import { verifiedControlledCashInspectionLineage } from "./controlled-cash-inspection-lineage-proof";
import { CONTROLLED_COLLECTION_PROTOCOL } from "./controlled-provider-collection-contract";
const sha=z.string().regex(/^[a-f0-9]{64}$/);
export const controlledCashInspectionCausalEntry=z.object({table:z.enum(["merchant_cash_return_inspections","merchant_cash_return_inspection_finishes","merchant_cash_return_primary_observations","merchant_cash_return_observations","merchant_refund_observations","merchant_refund_observation_captures","subscription_controlled_cash_inspection_lineages"]),id:z.uuid(),fingerprint:sha,dependencyFingerprint:sha}).strict();
export const controlledCashInspectionAncestry=z.object({protocol:z.literal(CONTROLLED_COLLECTION_PROTOCOL),collectionId:z.uuid(),receiptId:z.uuid(),inspectionId:z.uuid(),callerId:z.uuid(),admissionDigest:sha,admissionFingerprint:sha,parentPreAdmissionRevision:sha,sourceRevision:sha,ownEvidenceDigest:sha,
 entries:z.array(controlledCashInspectionCausalEntry).min(4).max(5000),revision:sha,suppliesBankAuthority:z.literal(false),suppliesApplicationAuthority:z.literal(false)}).strict().superRefine((value,ctx)=>{
 const keys=value.entries.map(row=>`${row.table}:${row.id}`),admission=value.entries.find(row=>row.table==="merchant_cash_return_inspections"),finish=value.entries.find(row=>row.table==="merchant_cash_return_inspection_finishes");
 if(new Set(keys).size!==keys.length||!admission||admission.id!==value.inspectionId||admission.fingerprint!==value.admissionFingerprint||!finish||finish.id!==value.inspectionId
  ||value.entries.some(row=>row.table==="subscription_controlled_cash_inspection_lineages"&&row.id!==value.inspectionId)
  ||!value.entries.some(row=>row.table==="merchant_cash_return_primary_observations")||!value.entries.some(row=>row.table==="merchant_cash_return_observations"))ctx.addIssue({code:"custom",message:"The exact own admission, genuine returned finish and original primary/state entries must remain unique and bound to this read."});
});
export type ControlledCashInspectionAncestry=z.infer<typeof controlledCashInspectionAncestry>;
function refuse():never{throw new ServiceError("conflict","Restore the exact genuine returned inspection, original caller and authenticated owned callbacks; a stopped/unfinished read, unrelated capture or later snapshot cannot be removed from the historical source comparison.");}
/** Caller holds resource→parent→canonical→cash locks. Returned exact ancestry
 * may reconstruct historical source comparison ONLY. Parent FULL coverage and
 * all caller predicates retain every entry, including this read's real finish.
 * In particular, this function never authorizes an admission or deletes rows. */
export async function readControlledCashInspectionAncestry(tx:Tx,input:{collectionId:string;receiptId:string;inspectionId:string}):Promise<ControlledCashInspectionAncestry>{
 const source=await readControlledCashObservationSource(tx,input);
 const[inspection]=await tx.select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id,input.inspectionId)).limit(1);
 if(!inspection||inspection.paymentId||inspection.originalObservationId||inspection.subscriptionChargeReceiptId!==source.receiptId||inspection.subscriptionChargeObservationId!==source.observationId
  ||inspection.providerPlatformAccountId!==source.providerPlatformAccountId||inspection.chargeAccountId!==source.chargeAccountId||inspection.providerApiVersion!==source.providerApiVersion||inspection.originalPaymentRef!==source.providerPaymentIntentRef||inspection.originalCashAmountMinor!==source.amountMinor||inspection.currency!==source.currency)refuse();
 const[finish]=await tx.select().from(merchantCashReturnInspectionFinishes).where(eq(merchantCashReturnInspectionFinishes.inspectionId,inspection.id)).limit(1);
 if(!finish||finish.callerInstanceId!==inspection.caller.id||finish.outcome!=="returned"||(await cashInspectionStops(tx,[inspection])).length)refuse();
 const own=await cashInspectionEvidence(tx,inspection.id),last=own.observations.at(-1),bank=merchantReturnedCashEvidenceSchema.safeParse(last?.evidence);
 if(!own.primary.length||own.primary.some(({evidence})=>evidence.providerRef!==source.providerPaymentIntentRef||evidence.providerPlatformAccountId!==source.providerPlatformAccountId||(evidence.providerAccountId??null)!==source.chargeAccountId||evidence.providerApiVersion!==source.providerApiVersion||evidence.amountMinor!==source.amountMinor||evidence.currency!==source.currency)||!last||!bank.success||!bank.data.refundsComplete||!bank.data.disputesComplete||bank.data.providerPlatformAccountId!==source.providerPlatformAccountId||bank.data.chargeAccountId!==source.chargeAccountId
  ||bank.data.providerApiVersion!==source.providerApiVersion||bank.data.paymentProviderRef!==source.providerPaymentIntentRef||bank.data.amountMinor!==source.amountMinor||bank.data.currency!==source.currency)refuse();
 const refundIds=own.refunds.map(row=>row.id),captures=refundIds.length?await tx.select().from(merchantRefundObservationCaptures).where(inArray(merchantRefundObservationCaptures.observationId,refundIds)).limit(5001):[],keys=cashInspectionEvidenceKeys();
 if(own.refunds.some(row=>!captures.some(capture=>capture.observationId===row.id)||!bank.data.refunds.some(refund=>refund.providerRef===row.providerRef&&refund.paymentProviderRef===row.paymentProviderRef&&refund.chargeRef===row.providerChargeRef&&refund.amountMinor===row.amountMinor&&refund.currency===row.currency&&refund.status===row.status))
  ||captures.some(capture=>!own.refunds.some(row=>verifiedCashInspectionRefundCapture(inspection,row,capture,keys))))refuse();
 const[lineage]=await tx.select().from(subscriptionControlledCashInspectionLineages).where(eq(subscriptionControlledCashInspectionLineages.inspectionId,inspection.id)).limit(1);
 if(lineage&&(lineage.resourceId!==source.resourceId||lineage.receiptId!==source.receiptId||!verifiedControlledCashInspectionLineage(inspection,lineage,keys)))refuse();
 const ownCount=2+(lineage?1:0)+own.primary.length+own.observations.length+own.refunds.length+captures.length;
 if(source.physicalRowCount+ownCount>5000)refuse();
 const rows=await tx.execute<{table:string;id:string;row:Record<string,unknown>;fingerprint:string}>(sql`
  select 'merchant_cash_return_inspections'::text as table,r.id::text as id,to_jsonb(r) as row,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') as fingerprint from merchant_cash_return_inspections r where r.id=${inspection.id}::uuid
  union all select 'merchant_cash_return_inspection_finishes',r.inspection_id::text,to_jsonb(r),encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') from merchant_cash_return_inspection_finishes r where r.inspection_id=${inspection.id}::uuid
  union all select 'merchant_cash_return_primary_observations',r.id::text,to_jsonb(r),encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') from merchant_cash_return_primary_observations r where r.inspection_id=${inspection.id}::uuid
  union all select 'merchant_cash_return_observations',r.id::text,to_jsonb(r),encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') from merchant_cash_return_observations r where r.inspection_id=${inspection.id}::uuid
  union all select 'merchant_refund_observations',r.id::text,to_jsonb(r),encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') from merchant_refund_observations r where r.inspection_id=${inspection.id}::uuid
  union all select 'merchant_refund_observation_captures',r.id::text,to_jsonb(r),encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') from merchant_refund_observation_captures r join merchant_refund_observations o on o.id=r.observation_id where o.inspection_id=${inspection.id}::uuid
  union all select 'subscription_controlled_cash_inspection_lineages',r.inspection_id::text,to_jsonb(r),encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') from subscription_controlled_cash_inspection_lineages r where r.inspection_id=${inspection.id}::uuid
  order by 1,2 limit 5001`);
 if(rows.length!==ownCount)refuse();
 const entries=rows.map(row=>controlledCashInspectionCausalEntry.parse({table:row.table,id:row.id,fingerprint:row.fingerprint,dependencyFingerprint:merchantTaxDigest(row.row)})),admission=entries.find(row=>row.table==="merchant_cash_return_inspections");if(!admission)refuse();
 const body={protocol:CONTROLLED_COLLECTION_PROTOCOL,collectionId:source.collectionId,receiptId:source.receiptId,inspectionId:inspection.id,callerId:inspection.caller.id,admissionDigest:merchantTaxDigest(inspection),admissionFingerprint:admission.fingerprint,parentPreAdmissionRevision:inspection.sourceHistoryDigest,sourceRevision:source.sourceRevision,ownEvidenceDigest:lineage?merchantTaxDigest({bankEvidence:own.digest,lineage:lineage.digest}):own.digest,entries};
 return controlledCashInspectionAncestry.parse({...body,revision:merchantTaxDigest(body),suppliesBankAuthority:false,suppliesApplicationAuthority:false});
}
