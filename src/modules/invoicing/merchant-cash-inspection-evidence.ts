// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Ordinary original read evidence; no service collector or return disposition.
import { eq } from "drizzle-orm";
import { ServiceError,type Tx } from "@/core/service";
import { merchantTaxDigest } from "./merchant-tax-store";
import type { merchantCashReturnInspections,merchantCashReturnInspectionFinishes } from "./merchant-refund-schema";
import { merchantCashReturnPrimaryObservations,merchantCashReturnObservations,merchantRefundObservations } from "./merchant-refund-schema";
import type { MerchantRefundSource } from "./merchant-refund-origin";
type Inspection=typeof merchantCashReturnInspections.$inferSelect;
type Finish=typeof merchantCashReturnInspectionFinishes.$inferSelect;
export function cashInspectionSource(row:Inspection):MerchantRefundSource{
 if(row.paymentId&&row.originalObservationId&&!row.subscriptionChargeReceiptId&&!row.subscriptionChargeObservationId)return{kind:"payment",paymentId:row.paymentId,observationId:row.originalObservationId};
 if(row.subscriptionChargeReceiptId&&row.subscriptionChargeObservationId&&!row.paymentId&&!row.originalObservationId)return{kind:"subscription",receiptId:row.subscriptionChargeReceiptId,observationId:row.subscriptionChargeObservationId};
 throw new ServiceError("conflict","Restore the exact original inspection source; a current account or equal amount cannot select its owner.");
}
/** A later successful read, elapsed time or foreign finish cannot supply the
 * original admitted caller's completion, even before its first callback. */
export function cashInspectionCallersClosed(inspections:Pick<Inspection,"id"|"caller">[],finishes:Pick<Finish,"inspectionId"|"callerInstanceId"|"outcome">[]){
 return new Set(inspections.map(row=>row.id)).size===inspections.length&&new Set(finishes.map(row=>row.inspectionId)).size===finishes.length
  &&finishes.every(finish=>inspections.some(row=>row.id===finish.inspectionId&&row.caller.id===finish.callerInstanceId&&["returned","threw"].includes(finish.outcome)))
  &&inspections.every(row=>finishes.some(finish=>finish.inspectionId===row.id&&finish.callerInstanceId===row.caller.id&&["returned","threw"].includes(finish.outcome)));
}
export async function cashInspectionEvidence(tx:Tx,inspectionId:string){
 const primary=await tx.select().from(merchantCashReturnPrimaryObservations).where(eq(merchantCashReturnPrimaryObservations.inspectionId,inspectionId)).limit(5001);
 const observations=await tx.select().from(merchantCashReturnObservations).where(eq(merchantCashReturnObservations.inspectionId,inspectionId)).orderBy(merchantCashReturnObservations.sequence).limit(5001);
 const refunds=await tx.select().from(merchantRefundObservations).where(eq(merchantRefundObservations.inspectionId,inspectionId)).limit(5001);
 if(primary.length+observations.length+refunds.length>5000||primary.some(row=>merchantTaxDigest(row.evidence)!==row.evidenceDigest)
  ||observations.some((row,index)=>row.sequence!==index+1||merchantTaxDigest(row.evidence)!==row.evidenceDigest))
  throw new ServiceError("conflict","Restore the complete bounded original inspection evidence and contiguous actual states; no partial or replaced snapshot supplies authority.");
 return{primary,observations,refunds,digest:merchantTaxDigest({primary:primary.map(row=>merchantTaxDigest(row)).toSorted(),observations:observations.map(row=>merchantTaxDigest(row)).toSorted(),refunds:refunds.map(row=>merchantTaxDigest(row)).toSorted()})};
}
