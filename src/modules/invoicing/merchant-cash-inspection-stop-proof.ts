// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Pure signature/original admission checks. No service collector dependency.
import type { merchantCashReturnInspections } from "./merchant-refund-schema";
import type { merchantCashReturnInspectionStops } from "./merchant-cash-inspection-stop-schema";
import { signOriginalCashRecovery,verifyOriginalCashRecovery } from "./original-cash-recovery-proof";
import { merchantTaxDigest } from "./merchant-tax-store";
import type { MerchantPhysicalCaller } from "./merchant-physical-caller";
export const CASH_INSPECTION_STOP_CONFIRMATION="ORIGINAL CASH INSPECTION CALLER STOP VERIFIED";
export const CASH_INSPECTION_STOP_PURPOSE="cash_inspection_stop.v1";
type Inspection=typeof merchantCashReturnInspections.$inferSelect;
export type CashInspectionStop=typeof merchantCashReturnInspectionStops.$inferSelect;
export function observableCashInspectionBirth(caller:MerchantPhysicalCaller){return Number.isSafeInteger(caller.pid)&&caller.pid>0&&!!caller.host&&!!caller.bootId&&!!caller.pidNamespace&&!!caller.startTicks&&/^\d+$/.test(caller.startTicks)&&Number.isFinite(Date.parse(caller.startedAt));}
export function cashInspectionStopBody(row:Omit<CashInspectionStop,"digest"|"authentication"|"createdAt">){return{inspectionId:row.inspectionId,callerInstanceId:row.callerInstanceId,admissionDigest:row.admissionDigest,admissionFingerprint:row.admissionFingerprint,sourceRevision:row.sourceRevision,mechanicalCheck:row.mechanicalCheck,hostingEvidenceDigest:row.hostingEvidenceDigest,reviewedBy:row.reviewedBy};}
export function signCashInspectionStop(row:Omit<CashInspectionStop,"authentication">,key:string){return signOriginalCashRecovery(CASH_INSPECTION_STOP_PURPOSE,{id:row.inspectionId,digest:row.digest,createdAt:row.createdAt},key);}
export function verifiedCashInspectionStop(inspection:Inspection,row:CashInspectionStop,keys:readonly string[]){
 return row.inspectionId===inspection.id&&row.callerInstanceId===inspection.caller.id&&row.admissionDigest===merchantTaxDigest(inspection)
  &&observableCashInspectionBirth(inspection.caller)&&/^[a-f0-9]{64}$/.test(row.admissionFingerprint)&&/^[a-f0-9]{64}$/.test(row.sourceRevision)&&/^[a-f0-9]{64}$/.test(row.hostingEvidenceDigest)
  &&/^user:[a-f0-9-]{36}$/.test(row.reviewedBy)&&row.mechanicalCheck==="original_process_absent"
  &&verifyOriginalCashRecovery(CASH_INSPECTION_STOP_PURPOSE,{id:row.inspectionId,digest:row.digest,authentication:row.authentication,createdAt:row.createdAt},cashInspectionStopBody(row),keys);
}
export function cashInspectionStopVerdict(input:{expectedCallerId:string;actualCallerId:string;expectedAdmissionDigest:string;actualAdmissionDigest:string;expectedSourceRevision:string;actualSourceRevision:string;finished:boolean;originalBirthKnown:boolean;liveness:"live"|"absent"|"unobservable";runtimeEvidence:boolean}){
 if(input.expectedCallerId!==input.actualCallerId||input.expectedAdmissionDigest!==input.actualAdmissionDigest||input.expectedSourceRevision!==input.actualSourceRevision||input.finished)return"changed_or_finished" as const;
 if(!input.originalBirthKnown)return"original_birth_unknown" as const;
 if(input.liveness==="live")return"live" as const;
 if(input.liveness==="unobservable"&&!input.runtimeEvidence)return"missing_runtime_evidence" as const;
 return input.liveness==="absent"?"original_process_absent" as const:"unobservable" as const;
}
