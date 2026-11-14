// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Collector-free signed bank-read order. No receipt application or money waiver.
import type { merchantCashReturnInspections } from "@/modules/invoicing/merchant-refund-schema";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { signOriginalCashRecovery,verifyOriginalCashRecovery } from "@/modules/invoicing/original-cash-recovery-proof";
import type { subscriptionControlledCashInspectionLineages } from "./controlled-cash-inspection-lineage-schema";
export type ControlledCashInspectionLineage=typeof subscriptionControlledCashInspectionLineages.$inferSelect;
type Admission=typeof merchantCashReturnInspections.$inferSelect;
export const CONTROLLED_CASH_LINEAGE_PURPOSE="controlled_cash_inspection_lineage.v1";
export function controlledCashInspectionNamespace(row:Pick<Admission,"providerPlatformAccountId"|"chargeAccountId"|"originalPaymentRef">){return`${row.providerPlatformAccountId}:${row.chargeAccountId??""}:${row.originalPaymentRef}`;}
export function controlledCashInspectionLineageBody(row:Omit<ControlledCashInspectionLineage,"digest"|"authentication"|"createdAt">){return{
 inspectionId:row.inspectionId,resourceId:row.resourceId,receiptId:row.receiptId,namespaceKey:row.namespaceKey,admissionSequence:row.admissionSequence,
 predecessorInspectionId:row.predecessorInspectionId,predecessorDigest:row.predecessorDigest,closedInspectionIds:row.closedInspectionIds,closedHistoryDigest:row.closedHistoryDigest,
 callerInstanceId:row.callerInstanceId,admissionDigest:row.admissionDigest,admissionFingerprint:row.admissionFingerprint,
};}
export function signControlledCashInspectionLineage(row:Omit<ControlledCashInspectionLineage,"authentication">,key:string){return signOriginalCashRecovery(CONTROLLED_CASH_LINEAGE_PURPOSE,{id:row.inspectionId,digest:row.digest,createdAt:row.createdAt},key);}
export function verifiedControlledCashInspectionLineage(admission:Admission,row:ControlledCashInspectionLineage,keys:readonly string[]){
 return row.inspectionId===admission.id&&row.callerInstanceId===admission.caller.id&&row.namespaceKey===controlledCashInspectionNamespace(admission)
  &&row.admissionDigest===merchantTaxDigest(admission)&&Number.isSafeInteger(row.admissionSequence)&&row.admissionSequence>0
  &&row.closedInspectionIds.length<=5000&&new Set(row.closedInspectionIds).size===row.closedInspectionIds.length
  &&!row.closedInspectionIds.includes(row.inspectionId)&&row.closedInspectionIds.every((id,i,ids)=>i===0||ids[i-1]<id)
  &&/^[a-f0-9]{64}$/.test(row.admissionFingerprint)&&/^[a-f0-9]{64}$/.test(row.closedHistoryDigest)
  &&verifyOriginalCashRecovery(CONTROLLED_CASH_LINEAGE_PURPOSE,{id:row.inspectionId,digest:row.digest,authentication:row.authentication,createdAt:row.createdAt},controlledCashInspectionLineageBody(row),keys);
}
/** Order is the signed namespace sequence, never a timestamp or successful
 * bank status. Even a genuine newer read cannot close an older live caller. */
export function controlledCashLineageChain(rows:readonly ControlledCashInspectionLineage[]){
 const ordered=rows.toSorted((a,b)=>a.admissionSequence-b.admissionSequence);
 return ordered.every((row,i)=>{const previous=ordered[i-1];return previous?row.namespaceKey===previous.namespaceKey&&row.admissionSequence>previous.admissionSequence&&row.predecessorInspectionId===previous.inspectionId&&row.predecessorDigest===previous.digest:row.predecessorInspectionId===null&&row.predecessorDigest===null;});
}
export function controlledCashLineageCovers(row:ControlledCashInspectionLineage,actualAdmissionIds:readonly string[],actualClosedHistoryDigest:string){
 const prior=actualAdmissionIds.filter(id=>id!==row.inspectionId).toSorted();return new Set(actualAdmissionIds).size===actualAdmissionIds.length&&actualAdmissionIds.includes(row.inspectionId)
  &&JSON.stringify(row.closedInspectionIds)===JSON.stringify(prior)&&row.closedHistoryDigest===actualClosedHistoryDigest;
}
/** Private export omits global sequence, namespace, original process/nonce,
 * hashes/signatures and predecessor metadata. Ownership follows actual UUIDs. */
export function exportControlledCashInspectionLineages(rows:readonly ControlledCashInspectionLineage[]){return rows.map(row=>({inspectionId:row.inspectionId,receiptId:row.receiptId,recordedAt:row.createdAt,lineageRetained:true as const,suppliesPaymentAuthority:false as const}));}
