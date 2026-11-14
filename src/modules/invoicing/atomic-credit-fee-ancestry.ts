// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: complete real FK graph; no equal-value or current-account source.
import {eq,inArray,sql} from "drizzle-orm";
import type {PgTable} from "drizzle-orm/pg-core";
import {ServiceError,type Tx} from "@/core/service";
import {creditNotes,creditNoteLines,invoiceLines,invoices,payments} from "./schema";
import {invoiceCreditFunding,invoiceCreditReservations,invoiceCreditApplications,invoiceCreditReleases} from "./credit-application-schema";
import {agreementFeeCreditAssignments,agreementFeeCashAssignments,agreementFeeDuties,agreementFeeRemittances} from "./agreement-fee-schema";
import {invoiceCreditFundingAtomicFeePartitions} from "./atomic-credit-fee-partition-schema";
import {verifiedAtomicCreditFeePartition} from "./atomic-credit-fee-partition-proof";
import {invoiceCreditReservationAtomicFeePartitions} from "./atomic-credit-reservation-schema";
import {verifiedAtomicCreditReservation} from "./atomic-credit-reservation-proof";
import {originalAtomicCreditFeeSegment,selectAtomicCreditFeeSegments} from "./atomic-credit-reservation-segments";
import {readAtomicCreditAcceptedQuoteSource} from "./atomic-credit-fee-declaration-reader";
import {readAtomicCreditLegacyApplication} from "./atomic-credit-legacy-application";
import {originalCashEvidenceKeys} from "./original-cash-evidence-keys";
import {merchantTaxDigest} from "./merchant-tax-store";
import type {AtomicCreditFeePhysicalEntry} from "./atomic-credit-fee-partition-contract";
function refuse():never{throw new ServiceError("conflict","Restore every actual credit source funding, issued note/line, reservation/application/release and fee assignment; incomplete or foreign ancestry cannot supply a new fee capacity.");}
async function readAncestry(tx:Tx,paymentId:string,requireUnreturned:boolean){
 const[payment]=await tx.select().from(payments).where(eq(payments.id,paymentId));if(!payment||payment.status!=="succeeded"||requireUnreturned&&payment.refundedMinor!==0)refuse();
 const funding=await tx.select().from(invoiceCreditFunding).where(eq(invoiceCreditFunding.sourcePaymentId,paymentId)).limit(5001),fundingIds=funding.map(row=>row.id);
 const reservations=fundingIds.length?await tx.select().from(invoiceCreditReservations).where(inArray(invoiceCreditReservations.fundingId,fundingIds)).limit(5001):[],reservationIds=reservations.map(row=>row.id);
 const applications=reservationIds.length?await tx.select().from(invoiceCreditApplications).where(inArray(invoiceCreditApplications.reservationId,reservationIds)).limit(5001):[];
 const releases=reservationIds.length?await tx.select().from(invoiceCreditReleases).where(inArray(invoiceCreditReleases.reservationId,reservationIds)).limit(5001):[];
 const assignments=reservationIds.length?await tx.select().from(agreementFeeCreditAssignments).where(inArray(agreementFeeCreditAssignments.applicationId,reservationIds)).limit(5001):[];
 const noteIds=[...new Set(funding.map(row=>row.creditNoteId))],lineIds=[...new Set(funding.map(row=>row.creditNoteLineId))];
 const notes=noteIds.length?await tx.select().from(creditNotes).where(inArray(creditNotes.id,noteIds)).limit(5001):[],lines=lineIds.length?await tx.select().from(creditNoteLines).where(inArray(creditNoteLines.id,lineIds)).limit(5001):[];
 const originalLineIds=[...new Set(lines.map(row=>row.invoiceLineId).filter((id):id is string=>id!==null))],originalLines=originalLineIds.length?await tx.select().from(invoiceLines).where(inArray(invoiceLines.id,originalLineIds)).limit(5001):[];
 if(noteIds.length){const[returned]=await tx.execute<{owned:boolean}>(sql`select exists(select 1 from return_requests where credit_note_id in(${sql.join(noteIds.map(id=>sql`${id}::uuid`),sql`, `)})) as owned`);if(returned?.owned!==false)refuse();}
 const sourceInvoiceIds=[...new Set([payment.invoiceId,...funding.map(row=>row.sourceInvoiceId)])],targetInvoiceIds=[...new Set(applications.map(row=>row.invoiceId))],invoiceIds=[...new Set([...sourceInvoiceIds,...targetInvoiceIds])];
 const invoiceRows=await tx.select().from(invoices).where(inArray(invoices.id,invoiceIds)).limit(5001);
 const cashAssignments=await tx.select().from(agreementFeeCashAssignments).where(eq(agreementFeeCashAssignments.paymentId,paymentId)).limit(5001);
 const duties=await tx.select().from(agreementFeeDuties).where(inArray(agreementFeeDuties.invoiceId,invoiceIds)).limit(5001),remittances=await tx.select().from(agreementFeeRemittances).where(inArray(agreementFeeRemittances.invoiceId,invoiceIds)).limit(5001);
 const partitions=fundingIds.length?await tx.select().from(invoiceCreditFundingAtomicFeePartitions).where(inArray(invoiceCreditFundingAtomicFeePartitions.fundingId,fundingIds)).limit(5001):[];
 const reservationPartitions=reservationIds.length?await tx.select().from(invoiceCreditReservationAtomicFeePartitions).where(inArray(invoiceCreditReservationAtomicFeePartitions.reservationId,reservationIds)).limit(5001):[];
 const groups=[funding,reservations,applications,releases,assignments,notes,lines,originalLines,invoiceRows,cashAssignments,duties,remittances,partitions,reservationPartitions];
 if(1+groups.reduce((sum,rows)=>sum+rows.length,0)>5000||notes.length!==noteIds.length||lines.length!==lineIds.length||originalLines.length!==originalLineIds.length||invoiceRows.length!==invoiceIds.length)refuse();
 const original=invoiceRows.find(row=>row.id===payment.invoiceId);if(!original)refuse();
 const quotedSources=new Map<string,Awaited<ReturnType<typeof readAtomicCreditAcceptedQuoteSource>>>();
 if(invoiceRows.some(row=>row.contactId!==original.contactId||row.currency!==payment.currency))refuse();
 for(const row of funding){
  if(!quotedSources.has(row.prorationId))quotedSources.set(row.prorationId,await readAtomicCreditAcceptedQuoteSource(tx,row.prorationId));
  const declared=quotedSources.get(row.prorationId),planned=declared?.declaration?.fundings.find(source=>source.fundingId===row.id||source.sourcePaymentId===row.sourcePaymentId&&source.sourceApplicationId===row.sourceApplicationId);
  if(planned){if(!declared||planned.fundingId!==row.id||planned.sourcePaymentId!==row.sourcePaymentId||planned.sourceApplicationId!==row.sourceApplicationId||planned.amountMinor!==row.amountMinor||planned.feeEvidenceDigest!==row.feeEvidenceDigest
   ||declared.note.id!==row.creditNoteId||declared.line.id!==row.creditNoteLineId||!partitions.some(child=>child.fundingId===row.id))refuse();}
  const note=notes.find(value=>value.id===row.creditNoteId),line=lines.find(value=>value.id===row.creditNoteLineId),parent=row.sourceApplicationId?applications.find(value=>value.reservationId===row.sourceApplicationId):null;
  if(!note||note.status!=="issued"||!line||line.creditNoteId!==note.id||!line.invoiceLineId||!originalLines.some(value=>value.id===line.invoiceLineId&&value.invoiceId===row.sourceInvoiceId)||note.currency!==payment.currency||note.invoiceId!==row.sourceInvoiceId||row.sourcePaymentId!==paymentId||!row.feeEvidenceDigest
   ||(row.sourceApplicationId? !parent||parent.invoiceId!==row.sourceInvoiceId:row.sourceInvoiceId!==payment.invoiceId))refuse();
 }
 for(const row of reservations){const source=funding.find(value=>value.id===row.fundingId);if(!source||!row.feeEvidenceDigest||row.feeObligationMinor>source.feeObligationMinor||row.feeProvenCollectedMinor>row.feeObligationMinor)refuse();}
 for(const row of applications){const reservation=reservations.find(value=>value.id===row.reservationId),target=invoiceRows.find(value=>value.id===row.invoiceId);if(!reservation||!target||reservation.targetSourceId!==target.sourceId||target.sourceType!=="subscription"||releases.some(value=>value.reservationId===row.reservationId)||row.feeObligationMinor!==reservation.feeObligationMinor||row.feeProvenCollectedMinor!==reservation.feeProvenCollectedMinor||row.feeCollectionState!==reservation.feeCollectionState||row.feeUnexpected!==reservation.feeUnexpected||!row.feeEvidenceDigest)refuse();}
 for(const row of assignments){const application=applications.find(value=>value.reservationId===row.applicationId),reservation=reservations.find(value=>value.id===row.applicationId);if(!application||!reservation||row.invoiceId!==application.invoiceId||row.amountMinor!==reservation.amountMinor||row.feeObligationMinor!==application.feeObligationMinor||row.provenCollectedMinor!==application.feeProvenCollectedMinor||row.originalEvidenceDigest!==merchantTaxDigest({application,reservation}))refuse();}
 const keys=originalCashEvidenceKeys();if(partitions.some(row=>!verifiedAtomicCreditFeePartition(row,keys))||reservationPartitions.some(row=>!verifiedAtomicCreditReservation(row,keys)))refuse();
 const physical:AtomicCreditFeePhysicalEntry[]=[];
 const capture=async(table:PgTable,name:string,primary:string,values:readonly string[])=>{if(!values.length)return;const rows=await tx.execute<{id:string;fingerprint:string}>(sql`select r.${sql.identifier(primary)}::text as id,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') as fingerprint from ${table} r where r.${sql.identifier(primary)} in(${sql.join(values.map(id=>sql`${id}::uuid`),sql`, `)}) order by r.${sql.identifier(primary)} limit 5001`);if(rows.length!==new Set(values).size||rows.some(row=>!/^[a-f0-9]{64}$/.test(row.fingerprint)))refuse();physical.push(...rows.map(row=>({table:name,id:row.id,fingerprint:row.fingerprint,hashDomain:"postgres_row" as const})));};
 await capture(payments,"payments","id",[payment.id]);await capture(invoiceCreditFunding,"invoice_credit_funding","id",fundingIds);await capture(invoiceCreditReservations,"invoice_credit_reservations","id",reservationIds);await capture(invoiceCreditApplications,"invoice_credit_applications","reservation_id",applications.map(row=>row.reservationId));await capture(invoiceCreditReleases,"invoice_credit_releases","reservation_id",releases.map(row=>row.reservationId));await capture(agreementFeeCreditAssignments,"agreement_fee_credit_assignments","application_id",assignments.map(row=>row.applicationId));await capture(creditNotes,"credit_notes","id",noteIds);await capture(creditNoteLines,"credit_note_lines","id",lineIds);await capture(invoiceLines,"invoice_lines","id",originalLineIds);await capture(invoices,"invoices","id",invoiceIds);await capture(agreementFeeCashAssignments,"agreement_fee_cash_assignments","payment_id",cashAssignments.map(row=>row.paymentId));await capture(agreementFeeDuties,"agreement_fee_duties","invoice_id",duties.map(row=>row.invoiceId));await capture(agreementFeeRemittances,"agreement_fee_remittances","id",remittances.map(row=>row.id));await capture(invoiceCreditFundingAtomicFeePartitions,"invoice_credit_funding_atomic_fee_partitions","funding_id",partitions.map(row=>row.fundingId));
 if(physical.length>5000)refuse();
 await capture(invoiceCreditReservationAtomicFeePartitions,"invoice_credit_reservation_atomic_fee_partitions","reservation_id",reservationPartitions.map(row=>row.reservationId));
 for(const declaration of quotedSources.values())if(declaration)physical.push({table:"subscription_controlled_quotes",id:declaration.quote.id,fingerprint:declaration.quoteFingerprint,hashDomain:"postgres_row"});
 if(new Set([...physical.map(row=>`${row.table}:${row.id}`),...[...quotedSources.values()].flatMap(source=>source?.physicalIdentities??[])]).size>5000)refuse();
 for(const child of partitions){const parent=funding.find(row=>row.id===child.fundingId),entry=physical.find(row=>row.table==="invoice_credit_funding"&&row.id===child.fundingId);if(!parent||!entry||child.parentFingerprint!==entry.fingerprint||child.sourcePaymentId!==parent.sourcePaymentId||child.sourceApplicationId!==parent.sourceApplicationId||child.sourceInvoiceId!==parent.sourceInvoiceId||child.creditNoteId!==parent.creditNoteId||child.creditNoteLineId!==parent.creditNoteLineId||child.economics.plan.takePrincipalMinor!==parent.amountMinor||child.economics.plan.takeAssignedFeeMinor!==parent.feeObligationMinor||child.economics.plan.takeProvenCollectedMinor!==parent.feeProvenCollectedMinor||child.economics.feeEvidenceDigest!==parent.feeEvidenceDigest)refuse();}
 for(const child of reservationPartitions){
  const parent=reservations.find(row=>row.id===child.reservationId),fundingChild=partitions.find(row=>row.fundingId===child.fundingId),rootChild=partitions.find(row=>row.fundingId===child.rootFundingId);
  const parentEntry=physical.find(row=>row.table==="invoice_credit_reservations"&&row.id===child.reservationId),fundingEntry=physical.find(row=>row.table==="invoice_credit_funding_atomic_fee_partitions"&&row.id===child.fundingId);
  if(!parent||!fundingChild||!rootChild||rootChild.economics.plan.rootFundingId!==null||!parentEntry||!fundingEntry||child.parentFingerprint!==parentEntry.fingerprint||child.fundingPartitionFingerprint!==fundingEntry.fingerprint
   ||parent.fundingId!==child.fundingId||child.sourcePaymentId!==payment.id||child.sourceApplicationId!==fundingChild.sourceApplicationId
   ||child.economics.fundingEconomicRevision!==fundingChild.economics.plan.economicRevision||child.economics.rootEconomicRevision!==rootChild.economics.plan.economicRevision
   ||parent.amountMinor!==child.economics.amountMinor||parent.feeObligationMinor!==child.economics.assignedFeeMinor||parent.feeProvenCollectedMinor!==child.economics.provenCollectedMinor)refuse();
  const root=rootChild.economics.plan,plan=fundingChild.economics.plan,economic=child.economics;
  if(economic.rootKind!==root.rootKind||economic.rootApplicationId!==root.rootApplicationId||economic.legacyApplicationRevision!==root.legacyApplicationRevision||economic.originalPrincipalMinor!==root.originalRootPrincipalMinor||economic.originalFeeMinor!==root.originalRootFeeMinor||economic.segments.some(segment=>segment.epochFundingId!==rootChild.fundingId
   ||segment.epochStartMinor!==root.allocatedPrincipalMinor||segment.epochEndMinor!==root.afterPrincipalMinor||segment.epochAssignedFeeMinor!==root.takeAssignedFeeMinor||segment.epochProvenCollectedMinor!==root.takeProvenCollectedMinor))refuse();
  const sourceSegments=plan.rootFundingId===null?[originalAtomicCreditFeeSegment({originalPrincipalMinor:root.originalRootPrincipalMinor,originalFeeMinor:root.originalRootFeeMinor},{epochFundingId:rootChild.fundingId,epochStartMinor:root.allocatedPrincipalMinor,epochEndMinor:root.afterPrincipalMinor,epochAssignedFeeMinor:root.takeAssignedFeeMinor,epochProvenCollectedMinor:root.takeProvenCollectedMinor},root.allocatedPrincipalMinor,root.afterPrincipalMinor)]:plan.takeSegments;
  if(plan.rootFundingId===null&&fundingChild.fundingId!==rootChild.fundingId||plan.rootFundingId!==null&&(plan.rootFundingId!==rootChild.fundingId||plan.rootEconomicRevision!==root.economicRevision))refuse();
  const checked=selectAtomicCreditFeeSegments({originalPrincipalMinor:economic.originalPrincipalMinor,originalFeeMinor:economic.originalFeeMinor,sourceSegments,occupied:[{reservationId:parent.id,segments:economic.segments}],takeMinor:0});
  if(checked.whole.nominalFeeMinor!==economic.fundingNominalFeeMinor||checked.whole.retiredFeeMinor!==economic.fundingRetiredFeeMinor||checked.whole.assignedFeeMinor!==economic.fundingAssignedFeeMinor||checked.whole.provenCollectedMinor!==economic.fundingProvenCollectedMinor||checked.whole.owedFeeMinor!==economic.fundingOwedFeeMinor)refuse();
 }
 for(const child of partitions)if(child.sourceApplicationId!==null){
  const parent=reservationPartitions.find(row=>row.reservationId===child.sourceApplicationId),plan=child.economics.plan;
  if(plan.rootKind==="legacy_application"&&plan.rootFundingId===null){
   const legacy=await readAtomicCreditLegacyApplication(tx,child.sourceApplicationId);
   if(plan.rootApplicationId!==child.sourceApplicationId||plan.legacyApplicationRevision!==legacy.revision||merchantTaxDigest(plan.legacyApplicationProof)!==merchantTaxDigest(legacy.body)||plan.originalRootPrincipalMinor!==legacy.reservation.amountMinor||plan.originalRootFeeMinor!==legacy.application.feeObligationMinor)refuse();
   continue;
  }
  if(!parent||plan.rootFundingId!==parent.rootFundingId||plan.rootEconomicRevision!==parent.economics.rootEconomicRevision||plan.originalRootPrincipalMinor!==parent.economics.originalPrincipalMinor||plan.originalRootFeeMinor!==parent.economics.originalFeeMinor
   ||plan.rootKind!==parent.economics.rootKind||plan.rootApplicationId!==parent.economics.rootApplicationId||plan.legacyApplicationRevision!==parent.economics.legacyApplicationRevision
   ||merchantTaxDigest(plan.sourceSegments)!==merchantTaxDigest(parent.economics.segments))refuse();
 }
 for(const parent of reservations)if(partitions.some(row=>row.fundingId===parent.fundingId)&&!reservationPartitions.some(row=>row.reservationId===parent.id))refuse();
 return{payment,originalInvoice:original,funding,reservations,applications,releases,assignments,notes,lines,originalLines,invoices:invoiceRows,cashAssignments,duties,remittances,partitions,reservationPartitions,quotedSources:[...quotedSources.values()].filter(value=>value!==null),physical,revision:merchantTaxDigest(physical)};
}
/** Actual new funding still requires its OWN unreturned source. */
export async function readAtomicCreditFeeAncestry(tx:Tx,paymentId:string){return readAncestry(tx,paymentId,true);}
/** Observation only: preserve returned siblings and all their old loans in
 * the whole-invoice context. This companion never supplies funding capacity. */
export async function readAtomicCreditFeeDispositionAncestry(tx:Tx,paymentId:string){return{...await readAncestry(tx,paymentId,false),suppliesFundingAuthority:false as const};}
