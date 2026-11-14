// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08: explicit subject fields, never a private preimage or row spread.
import type {invoiceCreditFundingAtomicFeePartitions} from "./atomic-credit-fee-partition-schema";
import type {invoiceCreditReservationAtomicFeePartitions} from "./atomic-credit-reservation-schema";
type Funding=typeof invoiceCreditFundingAtomicFeePartitions.$inferSelect;
type Reservation=typeof invoiceCreditReservationAtomicFeePartitions.$inferSelect;
type FundingArchiveInput=Pick<Funding,"fundingId"|"sourcePaymentId"|"sourceApplicationId"|"sourceInvoiceId"|"creditNoteId"|"creditNoteLineId"|"originalChargeReceiptId"|"createdAt">&{economics:{plan:Pick<Funding["economics"]["plan"],"takePrincipalMinor"|"takeNominalFeeMinor"|"takeRetiredFeeMinor"|"takeAssignedFeeMinor"|"takeProvenCollectedMinor"|"takeOwedFeeMinor">}};
type ReservationArchiveInput=Pick<Reservation,"reservationId"|"fundingId"|"rootFundingId"|"sourcePaymentId"|"sourceApplicationId"|"createdAt">&{economics:Pick<Reservation["economics"],"amountMinor"|"nominalFeeMinor"|"retiredFeeMinor"|"assignedFeeMinor"|"provenCollectedMinor"|"owedFeeMinor"|"segments">};
export function atomicCreditFundingArchive(row:FundingArchiveInput,currency:string,merchant:boolean){
 const plan=row.economics.plan;
 return{fundingId:row.fundingId,sourcePaymentId:row.sourcePaymentId,sourceApplicationId:row.sourceApplicationId,sourceInvoiceId:row.sourceInvoiceId,creditNoteId:row.creditNoteId,creditNoteLineId:row.creditNoteLineId,originalChargeReceiptId:row.originalChargeReceiptId,
  amountMinor:plan.takePrincipalMinor,currency,createdAt:row.createdAt.toISOString(),...(merchant?{nominalFeeMinor:plan.takeNominalFeeMinor,retiredFeeMinor:plan.takeRetiredFeeMinor,assignedFeeMinor:plan.takeAssignedFeeMinor,provenCollectedFeeMinor:plan.takeProvenCollectedMinor,owedFeeMinor:plan.takeOwedFeeMinor}: {})};
}
export function atomicCreditReservationArchive(row:ReservationArchiveInput,currency:string,merchant:boolean){
 const economics=row.economics;
 return{reservationId:row.reservationId,fundingId:row.fundingId,rootFundingId:row.rootFundingId,sourcePaymentId:row.sourcePaymentId,sourceApplicationId:row.sourceApplicationId,amountMinor:economics.amountMinor,currency,createdAt:row.createdAt.toISOString(),
  ...(merchant?{nominalFeeMinor:economics.nominalFeeMinor,retiredFeeMinor:economics.retiredFeeMinor,assignedFeeMinor:economics.assignedFeeMinor,provenCollectedFeeMinor:economics.provenCollectedMinor,owedFeeMinor:economics.owedFeeMinor,
   segments:economics.segments.map(segment=>({epochFundingId:segment.epochFundingId,epochStartMinor:segment.epochStartMinor,epochEndMinor:segment.epochEndMinor,epochAssignedFeeMinor:segment.epochAssignedFeeMinor,epochProvenCollectedFeeMinor:segment.epochProvenCollectedMinor,startMinor:segment.startMinor,endMinor:segment.endMinor,nominalFeeMinor:segment.nominalFeeMinor,retiredFeeMinor:segment.retiredFeeMinor,assignedFeeMinor:segment.assignedFeeMinor,provenCollectedFeeMinor:segment.provenCollectedMinor,owedFeeMinor:segment.owedFeeMinor}))}: {})};
}
