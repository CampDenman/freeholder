// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: real source proof -> actual parent -> immutable sameTX child.
import {eq,sql} from "drizzle-orm";
import {z} from "zod";
import {ServiceError,type ServiceContext} from "@/core/service";
import {invoiceCreditFunding,invoiceCreditReservations} from "./credit-application-schema";
import {invoices,payments} from "./schema";
import {invoiceCreditReservationAtomicFeePartitions} from "./atomic-credit-reservation-schema";
import {ATOMIC_CREDIT_RESERVATION_PROTOCOL} from "./atomic-credit-fee-protocol";
import {atomicCreditReservationEconomics} from "./atomic-credit-reservation-contract";
import {originalAtomicCreditFeeSegment,selectAtomicCreditFeeSegments} from "./atomic-credit-reservation-segments";
import {controlledAtomicCreditFeePartition} from "./atomic-credit-fee-partition";
import {readAtomicCreditFeeAncestry} from "./atomic-credit-fee-ancestry";
import {signAtomicCreditReservation,verifiedAtomicCreditReservation} from "./atomic-credit-reservation-proof";
import {originalCashEvidenceKeys,originalCashSigningKey} from "./original-cash-recovery-store";
import {merchantTaxDigest} from "./merchant-tax-store";
import {captureAtomicCreditInvoiceProjections,captureAtomicCreditOwnerProjections} from "./atomic-credit-before-image";
function refuse():never{throw new ServiceError("conflict","Restore the exact current B funding, original interval/caps, every application/release and real same-transaction reservation birth before consuming its fee capacity.");}
/** Ordinary private reader. The real outer writer already holds the complete
 * discovered source/target prefix. No lock is acquired late and no provider I/O
 * occurs. A historical economic plan alone is never a money grant. */
export async function readAtomicCreditReservationPartition(ctx:ServiceContext,input:{fundingId:string;amountMinor:number}){
 if(!z.uuid().safeParse(input.fundingId).success||!Number.isSafeInteger(input.amountMinor)||input.amountMinor<=0)refuse();
 const[funding]=await ctx.tx.select().from(invoiceCreditFunding).where(eq(invoiceCreditFunding.id,input.fundingId)).limit(1);if(!funding)refuse();
 const[original]=await ctx.tx.select({refundedMinor:invoices.refundedMinor}).from(payments).innerJoin(invoices,eq(invoices.id,payments.invoiceId)).where(eq(payments.id,funding.sourcePaymentId)).limit(1);if(!original)refuse();
 // B is selected by its actual purpose FK or the actual original refunded
 // namespace. A missing mandatory child is checked by the current reader;
 // ordinary unreturned histories never acquire a new economic interpretation.
 const[installed]=await ctx.tx.execute<{present:boolean}>(sql`select to_regclass('invoice_credit_funding_atomic_fee_partitions') is not null as present`);
 const[known]=installed?.present===true?await ctx.tx.execute<{known:boolean}>(sql`select exists(select 1 from invoice_credit_funding_atomic_fee_partitions actual_purpose where actual_purpose.funding_id=${funding.id}::uuid) as known`):[];
 if(!known?.known&&original.refundedMinor===0)return null;
 const current=await controlledAtomicCreditFeePartition(ctx,{paymentId:funding.sourcePaymentId,sourceApplicationId:funding.sourceApplicationId,takeMinor:0});if(!current)return null;
 const ancestry=current.ancestry,child=ancestry.partitions.find(row=>row.fundingId===funding.id);
 if(!child){if(current.requiresChild)refuse();return null;}
 const plan=child.economics.plan,rootId=plan.rootFundingId??funding.id;
 const root=ancestry.partitions.find(row=>row.fundingId===rootId);if(!root)refuse();
 const rootPlan=root.economics.plan;if(rootPlan.rootFundingId!==null||rootPlan.rootKind==="payment"&&root.sourceApplicationId!==null||rootPlan.rootKind==="legacy_application"&&root.sourceApplicationId!==rootPlan.rootApplicationId)refuse();
 const sourceSegments=plan.rootFundingId===null?[originalAtomicCreditFeeSegment({originalPrincipalMinor:rootPlan.originalRootPrincipalMinor,originalFeeMinor:rootPlan.originalRootFeeMinor},
  {epochFundingId:root.fundingId,epochStartMinor:rootPlan.allocatedPrincipalMinor,epochEndMinor:rootPlan.afterPrincipalMinor,epochAssignedFeeMinor:rootPlan.takeAssignedFeeMinor,epochProvenCollectedMinor:rootPlan.takeProvenCollectedMinor},rootPlan.allocatedPrincipalMinor,rootPlan.afterPrincipalMinor)]:plan.takeSegments;
 const reservations=ancestry.reservations.filter(row=>row.fundingId===funding.id),released=ancestry.releases.filter(row=>reservations.some(parent=>parent.id===row.reservationId));
 const active=reservations.filter(row=>!released.some(release=>release.reservationId===row.id)||ancestry.applications.some(application=>application.reservationId===row.id));
 const occupied=active.map(row=>{const receipt=ancestry.reservationPartitions.find(value=>value.reservationId===row.id);if(!receipt)refuse();return{reservationId:row.id,segments:receipt.economics.segments};});
 const selected=selectAtomicCreditFeeSegments({originalPrincipalMinor:rootPlan.originalRootPrincipalMinor,originalFeeMinor:rootPlan.originalRootFeeMinor,sourceSegments,occupied,takeMinor:input.amountMinor});
 if(selected.whole.amountMinor!==funding.amountMinor||selected.whole.assignedFeeMinor!==funding.feeObligationMinor||selected.whole.provenCollectedMinor!==funding.feeProvenCollectedMinor)refuse();
 const beforeEntries=current.beforeEntries,currentSourceRevision=merchantTaxDigest({current:current.revision,ancestry:ancestry.revision,fundingId:funding.id,sourceSegments,activeReservationIds:active.map(row=>row.id).sort(),releasedReservationIds:released.map(row=>row.reservationId).sort()});
 const sqlRows=await ctx.tx.execute<{known:boolean;funding_id:string;root_funding_id:string;source_payment_id:string;source_application_id:string|null;principal_minor:number;nominal_fee_minor:number;retired_fee_minor:number;assigned_fee_minor:number;collected_fee_minor:number;owed_fee_minor:number;segments:unknown;active_reservation_ids:string[];released_reservation_ids:string[];funding_partition_fingerprint:string;evidence_fingerprint:string}>(sql`
  select candidate.known,candidate.funding_id::text,candidate.root_funding_id::text,candidate.source_payment_id::text,candidate.source_application_id::text,
   candidate.principal_minor::float8,candidate.nominal_fee_minor::float8,candidate.retired_fee_minor::float8,candidate.assigned_fee_minor::float8,candidate.collected_fee_minor::float8,candidate.owed_fee_minor::float8,
   candidate.segments,candidate.active_reservation_ids::text[],candidate.released_reservation_ids::text[],candidate.funding_partition_fingerprint,candidate.evidence_fingerprint
  from freeholder_atomic_credit_reservation_partition(${funding.id}::uuid,${input.amountMinor}::bigint) candidate`);
 const actual=sqlRows[0],beforeInvoiceProjections=await captureAtomicCreditInvoiceProjections(ctx.tx,beforeEntries);
 if(sqlRows.length!==1||!actual||actual.known!==true||actual.funding_id!==funding.id||actual.root_funding_id!==root.fundingId||actual.source_payment_id!==funding.sourcePaymentId||actual.source_application_id!==funding.sourceApplicationId
  ||actual.principal_minor!==selected.selected.amountMinor||actual.nominal_fee_minor!==selected.selected.nominalFeeMinor||actual.retired_fee_minor!==selected.selected.retiredFeeMinor||actual.assigned_fee_minor!==selected.selected.assignedFeeMinor||actual.collected_fee_minor!==selected.selected.provenCollectedMinor||actual.owed_fee_minor!==selected.selected.owedFeeMinor
  ||merchantTaxDigest(actual.segments)!==merchantTaxDigest(selected.segments)||merchantTaxDigest(actual.active_reservation_ids)!==merchantTaxDigest(active.map(row=>row.id).sort())||merchantTaxDigest(actual.released_reservation_ids)!==merchantTaxDigest(released.map(row=>row.reservationId).sort())||!/^[a-f0-9]{64}$/.test(actual.evidence_fingerprint))refuse();
 const ownerProjections=await captureAtomicCreditOwnerProjections(ctx.tx,beforeEntries);
 const body={protocol:ATOMIC_CREDIT_RESERVATION_PROTOCOL,rootKind:rootPlan.rootKind,rootApplicationId:rootPlan.rootApplicationId,legacyApplicationRevision:rootPlan.legacyApplicationRevision,rootFundingId:root.fundingId,sourcePaymentId:funding.sourcePaymentId,originalPrincipalMinor:rootPlan.originalRootPrincipalMinor,originalFeeMinor:rootPlan.originalRootFeeMinor,rootEconomicRevision:rootPlan.economicRevision,
  fundingId:funding.id,sourceApplicationId:funding.sourceApplicationId,fundingEconomicRevision:plan.economicRevision,fundingNominalFeeMinor:selected.whole.nominalFeeMinor,fundingRetiredFeeMinor:selected.whole.retiredFeeMinor,fundingAssignedFeeMinor:selected.whole.assignedFeeMinor,fundingProvenCollectedMinor:selected.whole.provenCollectedMinor,fundingOwedFeeMinor:selected.whole.owedFeeMinor,
  segments:selected.segments,...selected.selected,activeReservationIds:active.map(row=>row.id).sort(),releasedReservationIds:released.map(row=>row.reservationId).sort(),currentSourceRevision,postgresSourceRevision:actual.evidence_fingerprint,beforeInvoiceProjections,...ownerProjections};
 const economics=atomicCreditReservationEconomics.parse({...body,economicRevision:merchantTaxDigest(body)});
 const fingerprint=ancestry.physical.find(row=>row.table==="invoice_credit_funding_atomic_fee_partitions"&&row.id===funding.id)?.fingerprint;if(!fingerprint||actual.funding_partition_fingerprint!==fingerprint)refuse();
 const after=await readAtomicCreditFeeAncestry(ctx.tx,funding.sourcePaymentId);if(after.revision!==ancestry.revision)refuse();
 const feeEvidenceDigest=merchantTaxDigest({protocol:ATOMIC_CREDIT_RESERVATION_PROTOCOL,economics,sourceFeeDigest:funding.feeEvidenceDigest});
 return{funding,child,root,economics,beforeEntries,fundingPartitionFingerprint:fingerprint,feeEvidenceDigest,current,suppliesCurrentMoneyAuthority:false as const};
}
type Plan=NonNullable<Awaited<ReturnType<typeof readAtomicCreditReservationPartition>>>;
/** Called immediately after the real reservation INSERT, in its same TX. The
 * database child/deferred guards independently enforce the exact before/after
 * delta; this helper never rereads authority through an invented before state. */
export async function retainAtomicCreditReservationPartition(ctx:ServiceContext,input:{reservationId:string;plan:Plan}){
 if(!z.uuid().safeParse(input.reservationId).success)refuse();
 const[parent]=await ctx.tx.select({row:invoiceCreditReservations,fingerprint:sql<string>`encode(sha256(convert_to(to_jsonb(${invoiceCreditReservations})::text,'UTF8')),'hex')`}).from(invoiceCreditReservations).where(eq(invoiceCreditReservations.id,input.reservationId)).limit(1);
 const plan=input.plan,[transaction]=await ctx.tx.execute<{id:string;fingerprint:string}>(sql`select pg_current_xact_id()::text as id,encode(sha256(convert_to(to_jsonb(actual_child)::text,'UTF8')),'hex') as fingerprint from invoice_credit_funding_atomic_fee_partitions actual_child where actual_child.funding_id=${plan.funding.id}::uuid`);
 if(!parent||!transaction||transaction.fingerprint!==plan.fundingPartitionFingerprint||parent.row.fundingId!==plan.funding.id||parent.row.amountMinor!==plan.economics.amountMinor
  ||parent.row.feeObligationMinor!==plan.economics.assignedFeeMinor||parent.row.feeProvenCollectedMinor!==plan.economics.provenCollectedMinor||parent.row.feeEvidenceDigest!==plan.feeEvidenceDigest
  ||parent.row.feeCollectionState!==plan.funding.feeCollectionState||parent.row.feeUnexpected!==plan.funding.feeUnexpected
  ||plan.beforeEntries.some(entry=>entry.key===`invoice_credit_reservations:${parent.row.id}`||entry.key===`invoice_credit_reservation_atomic_fee_partitions:${parent.row.id}`))refuse();
 const keys=originalCashEvidenceKeys(),key=originalCashSigningKey();
 const row={reservationId:parent.row.id,fundingId:plan.funding.id,rootFundingId:plan.root.fundingId,sourcePaymentId:plan.funding.sourcePaymentId,sourceApplicationId:plan.funding.sourceApplicationId,
  protocol:ATOMIC_CREDIT_RESERVATION_PROTOCOL,parentFingerprint:parent.fingerprint,fundingPartitionFingerprint:transaction.fingerprint,economics:plan.economics,beforeEntries:plan.beforeEntries,admissionTransactionId:transaction.id,createdAt:new Date()};
 const signed={...row,...signAtomicCreditReservation(row,key)};if(!verifiedAtomicCreditReservation(signed,keys))refuse();
 await ctx.tx.insert(invoiceCreditReservationAtomicFeePartitions).values(signed);return signed;
}
