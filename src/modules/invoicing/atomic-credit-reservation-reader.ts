// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: actual PK/FK/HMAC/fullPG ancestry, no inferred economic interval.
import {eq} from "drizzle-orm";
import {ServiceError,type Tx} from "@/core/service";
import {invoiceCreditFunding,invoiceCreditReservations} from "./credit-application-schema";
import {readAtomicCreditFeeAncestry} from "./atomic-credit-fee-ancestry";
/** Structural historical evidence only. A real writer independently verifies
 * current bank/caller/source proof under its whole held resource prefix. */
export async function readAtomicCreditReservationProof(tx:Tx,reservationId:string){
 const[parent]=await tx.select({reservation:invoiceCreditReservations,funding:invoiceCreditFunding}).from(invoiceCreditReservations)
  .innerJoin(invoiceCreditFunding,eq(invoiceCreditFunding.id,invoiceCreditReservations.fundingId)).where(eq(invoiceCreditReservations.id,reservationId)).limit(1);
 if(!parent)return null;
 const ancestry=await readAtomicCreditFeeAncestry(tx,parent.funding.sourcePaymentId),child=ancestry.reservationPartitions.find(row=>row.reservationId===reservationId);
 if(!child){if(ancestry.partitions.some(row=>row.fundingId===parent.funding.id))throw new ServiceError("conflict","Restore this exact B reservation's mandatory same-transaction fee segment receipt.");return null;}
 return{child,parent,physical:ancestry.physical,revision:ancestry.revision,suppliesCurrentMoneyAuthority:false as const};
}
