// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: authenticate economic ancestry; never supplies current bank authority.
import {z} from "zod";
import type {invoiceCreditReservationAtomicFeePartitions} from "./atomic-credit-reservation-schema";
import {ATOMIC_CREDIT_RESERVATION_PROTOCOL} from "./atomic-credit-fee-protocol";
import {atomicCreditReservationEconomics} from "./atomic-credit-reservation-contract";
import {atomicCreditFeeCurrentEntry} from "./atomic-credit-fee-partition-contract";
import {selectAtomicCreditFeeSegments} from "./atomic-credit-reservation-segments";
import {merchantTaxDigest} from "./merchant-tax-store";
import {signOriginalCashRecovery,verifyOriginalCashRecovery} from "./original-cash-recovery-proof";
type Partition=typeof invoiceCreditReservationAtomicFeePartitions.$inferSelect;
export function atomicCreditReservationBody(row:Omit<Partition,"digest"|"authentication">){return{reservationId:row.reservationId,fundingId:row.fundingId,rootFundingId:row.rootFundingId,sourcePaymentId:row.sourcePaymentId,sourceApplicationId:row.sourceApplicationId,protocol:row.protocol,parentFingerprint:row.parentFingerprint,fundingPartitionFingerprint:row.fundingPartitionFingerprint,economics:row.economics,beforeEntries:row.beforeEntries,admissionTransactionId:row.admissionTransactionId};}
export function signAtomicCreditReservation(row:Omit<Partition,"digest"|"authentication">,key:string){const digest=merchantTaxDigest(atomicCreditReservationBody(row));return{digest,authentication:signOriginalCashRecovery("atomic_credit_fee_reservation.v1",{id:row.reservationId,createdAt:row.createdAt,digest},key)};}
export function verifiedAtomicCreditReservation(row:Partition,keys:readonly string[]){
 const parsed=atomicCreditReservationEconomics.safeParse(row.economics),entries=z.array(atomicCreditFeeCurrentEntry).min(1).max(5000).safeParse(row.beforeEntries);
 if(row.protocol!==ATOMIC_CREDIT_RESERVATION_PROTOCOL||!parsed.success||!entries.success||!/^[0-9]+$/.test(row.admissionTransactionId)
  ||![row.parentFingerprint,row.fundingPartitionFingerprint].every(value=>/^[a-f0-9]{64}$/.test(value))
  ||![row.reservationId,row.fundingId,row.rootFundingId,row.sourcePaymentId].every(value=>z.uuid().safeParse(value).success)
  ||row.sourceApplicationId!==null&&!z.uuid().safeParse(row.sourceApplicationId).success||new Set(entries.data.map(value=>value.key)).size!==entries.data.length)return false;
 const economics=parsed.data;
 if(economics.fundingId!==row.fundingId||economics.rootFundingId!==row.rootFundingId||economics.sourcePaymentId!==row.sourcePaymentId||economics.sourceApplicationId!==row.sourceApplicationId
  ||economics.segments.some(segment=>segment.epochFundingId!==row.rootFundingId)
  ||new Set(economics.activeReservationIds).size!==economics.activeReservationIds.length||new Set(economics.releasedReservationIds).size!==economics.releasedReservationIds.length
  ||economics.activeReservationIds.some(id=>id===row.reservationId||economics.releasedReservationIds.includes(id))||economics.releasedReservationIds.includes(row.reservationId)
  ||entries.data.some(entry=>entry.key===`invoice_credit_reservations:${row.reservationId}`||entry.key===`invoice_credit_reservation_atomic_fee_partitions:${row.reservationId}`))return false;
 try{
  const checked=selectAtomicCreditFeeSegments({originalPrincipalMinor:economics.originalPrincipalMinor,originalFeeMinor:economics.originalFeeMinor,sourceSegments:economics.segments,occupied:[],takeMinor:economics.amountMinor});
  if(checked.remaining.amountMinor!==0||checked.selected.nominalFeeMinor!==economics.nominalFeeMinor||checked.selected.retiredFeeMinor!==economics.retiredFeeMinor||checked.selected.assignedFeeMinor!==economics.assignedFeeMinor
   ||checked.selected.provenCollectedMinor!==economics.provenCollectedMinor||checked.selected.owedFeeMinor!==economics.owedFeeMinor
   ||economics.fundingNominalFeeMinor!==economics.fundingRetiredFeeMinor+economics.fundingAssignedFeeMinor||economics.fundingAssignedFeeMinor!==economics.fundingProvenCollectedMinor+economics.fundingOwedFeeMinor)return false;
 }catch{return false;}
 const{economicRevision,...body}=economics;if(merchantTaxDigest(body)!==economicRevision)return false;
 return verifyOriginalCashRecovery("atomic_credit_fee_reservation.v1",{id:row.reservationId,createdAt:row.createdAt,digest:row.digest,authentication:row.authentication},atomicCreditReservationBody(row),keys);
}
