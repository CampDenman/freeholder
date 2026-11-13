// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Bounded immutable stop inventory: exact admission ancestry, never amount matching.
import { asc,eq,inArray,or,sql } from "drizzle-orm";
import { env } from "@/core/env";
import { ServiceError,type Tx } from "@/core/service";
import { merchantCashReturnInspections } from "./merchant-refund-schema";
import { merchantCashReturnInspectionStops } from "./merchant-cash-inspection-stop-schema";
import { verifiedCashInspectionStop } from "./merchant-cash-inspection-stop-proof";
export function cashInspectionEvidenceKeys(){const e=env();return[...new Set([e.CREDENTIAL_KEY,e.CREDENTIAL_KEY_PREVIOUS,e.SESSION_SECRET].filter((key):key is string=>Boolean(key)))];}
export function cashInspectionSigningKey(){const e=env(),key=e.CREDENTIAL_KEY??e.SESSION_SECRET;if(!key)throw new ServiceError("conflict","Restore the original financial evidence key before reviewing an inspection stop.");return key;}
export async function cashInspectionStops(tx:Tx,admissions:readonly (typeof merchantCashReturnInspections.$inferSelect)[]){
 if(admissions.length>5000)throw new ServiceError("conflict","Restore a complete bounded original inspection admission inventory.");
 const ids=admissions.map(row=>row.id),rows=ids.length?await tx.select().from(merchantCashReturnInspectionStops).where(inArray(merchantCashReturnInspectionStops.inspectionId,ids)).orderBy(asc(merchantCashReturnInspectionStops.inspectionId)).limit(5001):[];
 const keys=cashInspectionEvidenceKeys();
 if(admissions.length+rows.length>5000||rows.some(row=>!admissions.some(original=>verifiedCashInspectionStop(original,row,keys))))throw new ServiceError("conflict","Restore the authentic bounded stop receipts and their exact original admissions; never re-sign corrupt history.");
 return rows;
}
/** Full PostgreSQL row SHA stays internal. Parent callers compose these entries
 * with their entire financial inventory under ONE aggregate5000 bound. */
export async function cashInspectionStopFinancialWitness(tx:Tx,input:{paymentIds:readonly string[];receiptIds:readonly string[]}){
 const payments=[...new Set(input.paymentIds)],receipts=[...new Set(input.receiptIds)];if(payments.length+receipts.length>5000)throw new ServiceError("conflict","Restore a bounded exact inspection owner inventory.");
 const admissions=payments.length||receipts.length?await tx.select().from(merchantCashReturnInspections).where(or(...(payments.length?[inArray(merchantCashReturnInspections.paymentId,payments)]:[]),...(receipts.length?[inArray(merchantCashReturnInspections.subscriptionChargeReceiptId,receipts)]:[]))).limit(5001):[];
 const stops=await cashInspectionStops(tx,admissions),ids=stops.map(row=>row.inspectionId);
 const entries=ids.length?await tx.select({table:sql<string>`'merchant_cash_return_inspection_stops'`,id:merchantCashReturnInspectionStops.inspectionId,inspectionId:merchantCashReturnInspectionStops.inspectionId,
  fingerprint:sql<string>`encode(sha256(convert_to(to_jsonb(${merchantCashReturnInspectionStops})::text,'UTF8')),'hex')`}).from(merchantCashReturnInspectionStops).where(inArray(merchantCashReturnInspectionStops.inspectionId,ids)).orderBy(asc(merchantCashReturnInspectionStops.inspectionId)):[];
 return{admissions,stops,entries};
}
export async function cashInspectionAdmissionFingerprint(tx:Tx,id:string){const[row]=await tx.select({fingerprint:sql<string>`encode(sha256(convert_to(to_jsonb(${merchantCashReturnInspections})::text,'UTF8')),'hex')`}).from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id,id));if(!row)throw new ServiceError("conflict","Restore the exact original inspection admission.");return row.fingerprint;}
/** Safe private customer/merchant export; no process identity, nonce, original
 * admission hash, signature, hosting evidence or review actor is exposed. */
export function exportCashInspectionStops(rows:Awaited<ReturnType<typeof cashInspectionStops>>){return rows.map(row=>({inspectionId:row.inspectionId,reviewedAt:row.createdAt,callerStopped:true as const,suppliesBankEvidence:false as const}));}
