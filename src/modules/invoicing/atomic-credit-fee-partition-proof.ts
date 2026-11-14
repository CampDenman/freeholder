// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: child purpose binds a genuine existing funding row, never rewrites it.
import {z} from "zod";
import type {invoiceCreditFundingAtomicFeePartitions} from "./atomic-credit-fee-partition-schema";
import {ATOMIC_CREDIT_FEE_PROTOCOL} from "./atomic-credit-fee-protocol";
import {atomicCreditFeeCurrentEntry,atomicCreditFeeStoredEconomics} from "./atomic-credit-fee-partition-contract";
import {merchantTaxDigest} from "./merchant-tax-store";
import {signOriginalCashRecovery,verifyOriginalCashRecovery} from "./original-cash-recovery-proof";
type Partition=typeof invoiceCreditFundingAtomicFeePartitions.$inferSelect;
export function atomicCreditFeePartitionBody(row:Omit<Partition,"digest"|"authentication">){return{fundingId:row.fundingId,sourcePaymentId:row.sourcePaymentId,sourceApplicationId:row.sourceApplicationId,sourceInvoiceId:row.sourceInvoiceId,creditNoteId:row.creditNoteId,creditNoteLineId:row.creditNoteLineId,originalChargeReceiptId:row.originalChargeReceiptId,bankInspectionId:row.bankInspectionId,bankObservationId:row.bankObservationId,protocol:row.protocol,parentFingerprint:row.parentFingerprint,economics:row.economics,beforeEntries:row.beforeEntries,admissionTransactionId:row.admissionTransactionId};}
export function signAtomicCreditFeePartition(row:Omit<Partition,"digest"|"authentication">,key:string){const digest=merchantTaxDigest(atomicCreditFeePartitionBody(row));return{digest,authentication:signOriginalCashRecovery("atomic_credit_fee_partition.v1",{id:row.fundingId,createdAt:row.createdAt,digest},key)};}
export function verifiedAtomicCreditFeePartition(row:Partition,keys:readonly string[]){
 const economics=atomicCreditFeeStoredEconomics.safeParse(row.economics),entries=z.array(atomicCreditFeeCurrentEntry).min(1).max(5000).safeParse(row.beforeEntries);
 if(row.protocol!==ATOMIC_CREDIT_FEE_PROTOCOL||!economics.success||!entries.success||!/^[a-f0-9]{64}$/.test(row.parentFingerprint)||!/^[0-9]+$/.test(row.admissionTransactionId)
  ||![row.fundingId,row.sourcePaymentId,row.sourceInvoiceId,row.creditNoteId,row.creditNoteLineId,row.originalChargeReceiptId,row.bankInspectionId,row.bankObservationId].every(id=>z.uuid().safeParse(id).success)
  ||row.sourceApplicationId!==null&&!z.uuid().safeParse(row.sourceApplicationId).success||new Set(entries.data.map(entry=>entry.key)).size!==entries.data.length)return false;
 const plan=economics.data.plan;
 if(plan.sourcePaymentId!==row.sourcePaymentId||plan.sourceApplicationId!==row.sourceApplicationId||plan.takePrincipalMinor<=0||plan.originalFeeMinor>plan.originalPrincipalMinor||plan.takeNominalFeeMinor!==plan.takeRetiredFeeMinor+plan.takeAssignedFeeMinor||plan.takeAssignedFeeMinor!==plan.takeProvenCollectedMinor+plan.takeOwedFeeMinor
  ||plan.epochKind==="direct"&&(plan.sourceApplicationId!==null||plan.parentFundingId!==null)||plan.epochKind==="inherited"&&(plan.sourceApplicationId===null||plan.parentFundingId===null))return false;
 return verifyOriginalCashRecovery("atomic_credit_fee_partition.v1",{id:row.fundingId,digest:row.digest,authentication:row.authentication,createdAt:row.createdAt},atomicCreditFeePartitionBody(row),keys);
}
