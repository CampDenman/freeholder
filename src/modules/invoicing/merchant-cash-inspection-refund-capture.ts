// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: causal callback ownership differs from authenticated external ingress.
import type { merchantCashReturnInspections,merchantRefundObservations } from "./merchant-refund-schema";
import type { merchantRefundObservationCaptures } from "./merchant-refund-current-schema";
import { merchantTaxDigest } from "./merchant-tax-store";
import { signOriginalCashRecovery,verifyOriginalCashRecovery } from "./original-cash-recovery-proof";
type Inspection=typeof merchantCashReturnInspections.$inferSelect;
type Observation=typeof merchantRefundObservations.$inferSelect;
type Capture=typeof merchantRefundObservationCaptures.$inferSelect;
const PURPOSE="cash_inspection_refund_capture.v1";
function body(inspection:Inspection,observation:Observation){return{inspectionId:inspection.id,callerInstanceId:inspection.caller.id,admissionDigest:merchantTaxDigest(inspection),observationId:observation.id,observationDigest:merchantTaxDigest(observation)};}
/** Called ONLY after real original holder/nonce validation in the callback's
 * shared transaction. No supplied captureKey or public input grants ownership. */
export function signCashInspectionRefundCapture(inspection:Inspection,observation:Observation,capture:{id:string;createdAt:Date},key:string){
 if(observation.inspectionId!==inspection.id)throw Error("The actual refund callback must belong to its exact original read.");
 return signOriginalCashRecovery(PURPOSE,{id:capture.id,createdAt:capture.createdAt,digest:merchantTaxDigest(body(inspection,observation))},key);
}
export function verifiedCashInspectionRefundCapture(inspection:Inspection,observation:Observation,capture:Capture,keys:readonly string[]){return observation.inspectionId===inspection.id&&capture.observationId===observation.id
 &&verifyOriginalCashRecovery(PURPOSE,{id:capture.id,createdAt:capture.createdAt,digest:merchantTaxDigest(body(inspection,observation)),authentication:capture.captureKey},body(inspection,observation),keys);}
