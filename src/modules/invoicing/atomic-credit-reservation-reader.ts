// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: actual PK/FK/HMAC/fullPG ancestry, no inferred economic interval.
import {eq,sql} from "drizzle-orm";
import {ServiceError,type Tx} from "@/core/service";
import {invoiceCreditFunding,invoiceCreditReservations} from "./credit-application-schema";
import {readAtomicCreditFeeAncestry} from "./atomic-credit-fee-ancestry";
import {invoiceCreditFundingAtomicFeePartitions} from "./atomic-credit-fee-partition-schema";
import {invoiceCreditReservationAtomicFeePartitions} from "./atomic-credit-reservation-schema";
/** Structural historical evidence only. A real writer independently verifies
 * current bank/caller/source proof under its whole held resource prefix. */
export async function readAtomicCreditReservationProof(tx:Tx,reservationId:string){
 const[parent]=await tx.select({reservation:invoiceCreditReservations,funding:invoiceCreditFunding}).from(invoiceCreditReservations)
  .innerJoin(invoiceCreditFunding,eq(invoiceCreditFunding.id,invoiceCreditReservations.fundingId)).where(eq(invoiceCreditReservations.id,reservationId)).limit(1);
 if(!parent)return null;
 const[installed]=await tx.execute<{present:boolean}>(sql`select to_regclass('invoice_credit_funding_atomic_fee_partitions') is not null and to_regclass('invoice_credit_reservation_atomic_fee_partitions') is not null as present`);if(installed?.present!==true)return null;
 const[knownFunding]=await tx.select({id:invoiceCreditFundingAtomicFeePartitions.fundingId}).from(invoiceCreditFundingAtomicFeePartitions).where(eq(invoiceCreditFundingAtomicFeePartitions.fundingId,parent.funding.id)).limit(1);
 const[knownChild]=await tx.select({id:invoiceCreditReservationAtomicFeePartitions.reservationId}).from(invoiceCreditReservationAtomicFeePartitions).where(eq(invoiceCreditReservationAtomicFeePartitions.reservationId,reservationId)).limit(1);
 if(!knownFunding&&!knownChild)return null;
 const ancestry=await readAtomicCreditFeeAncestry(tx,parent.funding.sourcePaymentId),child=ancestry.reservationPartitions.find(row=>row.reservationId===reservationId);
 if(!child){if(ancestry.partitions.some(row=>row.fundingId===parent.funding.id))throw new ServiceError("conflict","Restore this exact B reservation's mandatory same-transaction fee segment receipt.");return null;}
 return{child,parent,physical:ancestry.physical,revision:ancestry.revision,suppliesCurrentMoneyAuthority:false as const};
}
