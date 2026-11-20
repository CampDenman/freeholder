// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: positively proved OLD application epoch; no imagined payment offset.
import {eq,sql} from "drizzle-orm";
import {ServiceError,type Tx} from "@/core/service";
import {invoiceCreditApplications,invoiceCreditFunding,invoiceCreditReservations} from "./credit-application-schema";
import {readAtomicCreditAcceptedQuoteSource} from "./atomic-credit-fee-declaration-reader";
import {merchantTaxDigest} from "./merchant-tax-store";
import {atomicCreditLegacyEpochProof} from "./atomic-credit-fee-partition-contract";
function refuse():never{throw new ServiceError("conflict","Restore positive exact old quote, issued principal and actual legacy application epoch evidence; absence of a B child never proves a legacy source.");}
/** Structural epoch evidence only; caller independently proves original global
 * Fi/retirement/current bank/all loans/callers and OWN unreturned source. */
export async function readAtomicCreditLegacyApplication(tx:Tx,applicationId:string){
 const[actual]=await tx.select({application:invoiceCreditApplications,reservation:invoiceCreditReservations,funding:invoiceCreditFunding,
  applicationFingerprint:sql<string>`encode(sha256(convert_to(to_jsonb(${invoiceCreditApplications})::text,'UTF8')),'hex')`,reservationFingerprint:sql<string>`encode(sha256(convert_to(to_jsonb(${invoiceCreditReservations})::text,'UTF8')),'hex')`,fundingFingerprint:sql<string>`encode(sha256(convert_to(to_jsonb(${invoiceCreditFunding})::text,'UTF8')),'hex')`})
  .from(invoiceCreditApplications).innerJoin(invoiceCreditReservations,eq(invoiceCreditReservations.id,invoiceCreditApplications.reservationId)).innerJoin(invoiceCreditFunding,eq(invoiceCreditFunding.id,invoiceCreditReservations.fundingId)).where(eq(invoiceCreditApplications.reservationId,applicationId)).limit(1);
 if(!actual)refuse();
 const source=await readAtomicCreditAcceptedQuoteSource(tx,actual.funding.prorationId);if(!source)refuse();
 if(source.declaration?.fundings.some(row=>row.fundingId===actual.funding.id||row.sourcePaymentId===actual.funding.sourcePaymentId&&row.sourceApplicationId===actual.funding.sourceApplicationId))refuse();
 const[known]=await tx.execute<{known:boolean}>(sql`select exists(select 1 from invoice_credit_funding_atomic_fee_partitions purpose where purpose.funding_id=${actual.funding.id}::uuid)
  or exists(select 1 from invoice_credit_reservation_atomic_fee_partitions purpose where purpose.reservation_id=${applicationId}::uuid) as known`);if(known?.known!==false)refuse();
 const principal=source.principal.find(row=>row.sourcePaymentId===actual.funding.sourcePaymentId&&row.sourceApplicationId===actual.funding.sourceApplicationId);
 if(!principal||source.note.id!==actual.funding.creditNoteId||source.line.id!==actual.funding.creditNoteLineId||source.accepted.originalInvoiceId!==actual.funding.sourceInvoiceId
  ||actual.funding.originalEvidenceDigest!==source.accepted.sourceRevision||actual.funding.amountMinor!==principal.amountMinor||actual.funding.feeObligationMinor!==principal.feeObligationMinor||actual.funding.feeProvenCollectedMinor!==principal.feeProvenCollectedMinor||actual.funding.feeEvidenceDigest!==principal.feeEvidenceDigest
  ||actual.application.feeObligationMinor!==actual.reservation.feeObligationMinor||actual.application.feeProvenCollectedMinor!==actual.reservation.feeProvenCollectedMinor||actual.application.feeCollectionState!==actual.reservation.feeCollectionState||actual.application.feeUnexpected!==actual.reservation.feeUnexpected
  ||actual.application.feeUnexpected||actual.funding.feeUnexpected||!actual.application.feeEvidenceDigest||!actual.reservation.feeEvidenceDigest||actual.reservation.amountMinor>actual.funding.amountMinor||actual.application.feeObligationMinor>actual.funding.feeObligationMinor||actual.application.feeProvenCollectedMinor>actual.application.feeObligationMinor)refuse();
 const[budget]=await tx.execute<{principal:string;fee:string;proven:string;contrary:boolean}>(sql`select coalesce(sum(actual_reservation.amount_minor) filter(where actual_application.reservation_id is not null or actual_release.reservation_id is null),0)::text as principal,
  coalesce(sum(actual_reservation.fee_obligation_minor) filter(where actual_application.reservation_id is not null or actual_release.reservation_id is null),0)::text as fee,
  coalesce(sum(actual_reservation.fee_proven_collected_minor) filter(where actual_application.reservation_id is not null or actual_release.reservation_id is null),0)::text as proven,
  coalesce(bool_or(actual_application.reservation_id is not null and actual_release.reservation_id is not null),false) as contrary
  from invoice_credit_reservations actual_reservation left join invoice_credit_applications actual_application on actual_application.reservation_id=actual_reservation.id left join invoice_credit_releases actual_release on actual_release.reservation_id=actual_reservation.id where actual_reservation.funding_id=${actual.funding.id}::uuid`);
 if(!budget||budget.contrary||BigInt(budget.principal)>BigInt(actual.funding.amountMinor)||BigInt(budget.fee)>BigInt(actual.funding.feeObligationMinor)||BigInt(budget.proven)>BigInt(actual.funding.feeProvenCollectedMinor))refuse();
 const historyIds=await tx.execute<{key:string}>(sql`select 'invoice_credit_reservations:'||actual_reservation.id::text as key from invoice_credit_reservations actual_reservation where actual_reservation.funding_id=${actual.funding.id}::uuid
  union select 'invoice_credit_applications:'||actual_application.reservation_id::text from invoice_credit_applications actual_application join invoice_credit_reservations parent_reservation on parent_reservation.id=actual_application.reservation_id where parent_reservation.funding_id=${actual.funding.id}::uuid
  union select 'invoice_credit_releases:'||actual_release.reservation_id::text from invoice_credit_releases actual_release join invoice_credit_reservations parent_reservation on parent_reservation.id=actual_release.reservation_id where parent_reservation.funding_id=${actual.funding.id}::uuid limit 5001`);
 const physicalIdentities=[...new Set([...source.physicalIdentities,...historyIds.map(row=>row.key),`invoice_credit_funding:${actual.funding.id}`])];if(physicalIdentities.length>5000)refuse();
 const body=atomicCreditLegacyEpochProof.parse({protocol:"freeholder.atomic-credit-legacy-application-epoch.v1",applicationId,quoteId:source.quote.id,quoteFingerprint:source.quoteFingerprint,acceptedProrationId:source.accepted.id,sourcePrincipalId:principal.id,
  applicationFingerprint:actual.applicationFingerprint,reservationFingerprint:actual.reservationFingerprint,fundingFingerprint:actual.fundingFingerprint,principalMinor:actual.reservation.amountMinor,feeMinor:actual.application.feeObligationMinor,provenMinor:actual.application.feeProvenCollectedMinor});
 return{...actual,source,principal,body,physicalIdentities,revision:merchantTaxDigest(body),suppliesCurrentMoneyAuthority:false as const};
}
