// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: collector-free exact-parent purpose evidence; no money grant.
import {inArray,sql} from "drizzle-orm";
import {z} from "zod";
import {ServiceError,type Tx} from "@/core/service";
import {invoiceCreditFundingAtomicFeePartitions} from "./atomic-credit-fee-partition-schema";
import {invoiceCreditReservationAtomicFeePartitions} from "./atomic-credit-reservation-schema";
import {verifiedAtomicCreditFeePartition} from "./atomic-credit-fee-partition-proof";
import {verifiedAtomicCreditReservation} from "./atomic-credit-reservation-proof";
import {originalCashEvidenceKeys} from "./original-cash-evidence-keys";
import {verifiedAtomicCreditFeeDeclaration} from "./atomic-credit-fee-declaration-proof";
import {atomicCreditFundingArchive,atomicCreditReservationArchive} from "./atomic-credit-fee-archive";
import {merchantTaxDigest} from "./merchant-tax-store";
export const atomicCreditFeeTables={fundings:"invoice_credit_funding_atomic_fee_partitions",reservations:"invoice_credit_reservation_atomic_fee_partitions"} as const;
export type AtomicCreditFeeWitnessScope={fundingIds?:readonly string[];reservationIds?:readonly string[];profileId?:string};
type Parents={fundingId:string;reservationId:string|null;rootFundingId:string|null;sourcePaymentId:string;sourceApplicationId:string|null;sourceInvoiceId:string;creditNoteId:string;creditNoteLineId:string;prorationId:string;quoteId:string;profileId:string;profileVersion:number;subscriptionId:string;currency:string};
export type AtomicCreditFeeWitnessEntry={table:typeof atomicCreditFeeTables[keyof typeof atomicCreditFeeTables];id:string;fingerprint:string;parents:Parents};
const list=(ids:readonly string[])=>ids.length?sql.join(ids.map(id=>sql`${id}::uuid`),sql`, `):sql`null::uuid`;
function refuse():never{throw new ServiceError("conflict","Restore the complete exact credit purpose, actual parent fingerprints and original quote/profile ancestry before financial review or export.");}
/** Only actual existing parent IDs select rows. A profile can restrict those
 * parents; it cannot discover every seller sharing an invoice or platform.
 * Historical erased quote bodies are not reconstructed or used as authority.
 * Current source/bank/loan safety belongs to the independent money readers. */
export async function atomicCreditFeePartitionWitnesses(tx:Tx,input:AtomicCreditFeeWitnessScope){
 const fundingIds=[...new Set(input.fundingIds??[])].sort(),reservationIds=[...new Set(input.reservationIds??[])].sort();
 if(fundingIds.length+reservationIds.length>5000||[...fundingIds,...reservationIds,...(input.profileId?[input.profileId]:[])].some(id=>!z.uuid().safeParse(id).success))refuse();
 if(!fundingIds.length&&!reservationIds.length){if(input.profileId)refuse();return{entries:[] as AtomicCreditFeeWitnessEntry[],dependencies:[] as Array<{table:string;id:string;fingerprint:string}>,incomplete:false};}
 const[ownership]=await tx.execute<{complete:boolean}>(sql`select not exists(select 1 from invoice_credit_funding_atomic_fee_partitions actual_child
  left join invoice_credit_funding actual_parent on actual_parent.id=actual_child.funding_id left join subscription_prorations accepted on accepted.id=actual_parent.proration_id
  left join subscription_controlled_quotes actual_quote on actual_quote.planned_proration_id=accepted.id and actual_quote.quote_digest=accepted.accepted_quote_digest
  left join merchant_agreement_payment_routes original_route on original_route.payment_id=actual_child.source_payment_id
  left join merchant_cash_return_inspections actual_inspection on actual_inspection.id=actual_child.bank_inspection_id
  left join merchant_cash_return_observations actual_bank on actual_bank.id=actual_child.bank_observation_id
  where(actual_child.funding_id in(${list(fundingIds)}) or exists(select 1 from invoice_credit_reservations selected_reservation where selected_reservation.funding_id=actual_child.funding_id and selected_reservation.id in(${list(reservationIds)})))
   and(actual_parent.id is null or accepted.id is null or actual_quote.id is null or actual_quote.profile_id is distinct from accepted.profile_id or actual_quote.profile_version is distinct from accepted.profile_version
    or actual_parent.source_invoice_id is distinct from accepted.original_invoice_id or actual_parent.credit_note_id is distinct from accepted.credit_note_id
    or original_route.original_charge_receipt_id is distinct from actual_child.original_charge_receipt_id
    or actual_inspection.id is null or(actual_inspection.payment_id is distinct from actual_child.source_payment_id and actual_inspection.subscription_charge_receipt_id is distinct from actual_child.original_charge_receipt_id)
    or actual_bank.inspection_id is distinct from actual_child.bank_inspection_id)) as complete`);
 if(ownership?.complete!==true)refuse();
 const parents=await tx.execute<Parents&{fundingFingerprint:string;declaration:unknown;quoteCreatedAt:unknown}>(sql`select actual_funding.id::text as "fundingId",null::text as "reservationId",null::text as "rootFundingId",
  actual_funding.source_payment_id::text as "sourcePaymentId",actual_funding.source_application_id::text as "sourceApplicationId",actual_funding.source_invoice_id::text as "sourceInvoiceId",actual_funding.credit_note_id::text as "creditNoteId",actual_funding.credit_note_line_id::text as "creditNoteLineId",actual_funding.proration_id::text as "prorationId",
  actual_quote.id::text as "quoteId",actual_quote.profile_id::text as "profileId",actual_quote.profile_version as "profileVersion",accepted.subscription_id::text as "subscriptionId",source_invoice.currency,
  encode(sha256(convert_to(to_jsonb(actual_funding)::text,'UTF8')),'hex') as "fundingFingerprint",actual_quote.review->'atomicCreditFeeDeclaration' as declaration,actual_quote.created_at as "quoteCreatedAt"
  from invoice_credit_funding actual_funding join subscription_prorations accepted on accepted.id=actual_funding.proration_id
  join subscription_controlled_quotes actual_quote on actual_quote.planned_proration_id=accepted.id and actual_quote.quote_digest=accepted.accepted_quote_digest and actual_quote.previous_terms_id is not distinct from accepted.previous_terms_id
   and actual_quote.profile_id=accepted.profile_id and actual_quote.profile_version=accepted.profile_version
  join subscription_controlled_resources actual_resource on actual_resource.id=actual_quote.resource_id and actual_resource.subscription_id=accepted.subscription_id
  join invoices source_invoice on source_invoice.id=actual_funding.source_invoice_id
  where(actual_funding.id in(${list(fundingIds)}) or exists(select 1 from invoice_credit_reservations selected_reservation where selected_reservation.funding_id=actual_funding.id and selected_reservation.id in(${list(reservationIds)})))
   ${input.profileId?sql`and actual_quote.profile_id=${input.profileId}::uuid`:sql``} order by actual_funding.id limit 5001`);
 if(parents.length>5000||new Set(parents.map(row=>row.fundingId)).size!==parents.length)refuse();
 const parentIds=parents.map(row=>row.fundingId),fundings=parentIds.length?await tx.select().from(invoiceCreditFundingAtomicFeePartitions).where(inArray(invoiceCreditFundingAtomicFeePartitions.fundingId,parentIds)).limit(5001):[];
 const reservations=parentIds.length?await tx.select().from(invoiceCreditReservationAtomicFeePartitions).where(inArray(invoiceCreditReservationAtomicFeePartitions.fundingId,parentIds)).limit(5001):[];
 const keys=originalCashEvidenceKeys();
 for(const parent of parents){const child=fundings.find(row=>row.fundingId===parent.fundingId);
  if(parent.declaration!==null&&parent.declaration!==undefined){const birth=z.coerce.date().safeParse(parent.quoteCreatedAt);if(!birth.success||!verifiedAtomicCreditFeeDeclaration(parent.declaration,birth.data,keys))refuse();
   const{atomicCreditFeeDeclaration}=await import("./atomic-credit-fee-declaration-contract"),declared=atomicCreditFeeDeclaration.parse(parent.declaration);
   if(declared.quoteId!==parent.quoteId||declared.plannedProrationId!==parent.prorationId||declared.subscriptionId!==parent.subscriptionId)refuse();
   if(declared.fundings.some(row=>row.fundingId===parent.fundingId||row.sourcePaymentId===parent.sourcePaymentId&&row.sourceApplicationId===parent.sourceApplicationId)&&!child)refuse();}
  if(child&&(!verifiedAtomicCreditFeePartition(child,keys)||child.parentFingerprint!==parent.fundingFingerprint||child.sourcePaymentId!==parent.sourcePaymentId||child.sourceApplicationId!==parent.sourceApplicationId||child.sourceInvoiceId!==parent.sourceInvoiceId||child.creditNoteId!==parent.creditNoteId||child.creditNoteLineId!==parent.creditNoteLineId
   ||child.economics.birthDeclaration?.quoteId!==parent.quoteId||child.economics.birthDeclaration?.prorationId!==parent.prorationId))refuse();
 }
 if(!fundings.length&&!reservations.length)return{entries:[] as AtomicCreditFeeWitnessEntry[],dependencies:[] as Array<{table:string;id:string;fingerprint:string}>,incomplete:false};
 // Discover only actual original funding -> application -> reservation ->
 // funding FKs. Ancestors are internal dependencies, never new export owners.
 const ancestorRows=await tx.execute<{id:string;sourceApplicationId:string|null;parentFundingId:string|null}>(sql`with recursive actual_ancestors(id) as(
  select actual_funding.id from invoice_credit_funding actual_funding where actual_funding.id in(${list(parentIds)})
  union select original_reservation.funding_id from actual_ancestors owned join invoice_credit_funding actual_funding on actual_funding.id=owned.id
   join invoice_credit_applications original_application on original_application.reservation_id=actual_funding.source_application_id join invoice_credit_reservations original_reservation on original_reservation.id=original_application.reservation_id
 ) select actual_funding.id::text as id,actual_funding.source_application_id::text as "sourceApplicationId",original_reservation.funding_id::text as "parentFundingId"
  from actual_ancestors owned join invoice_credit_funding actual_funding on actual_funding.id=owned.id left join invoice_credit_applications original_application on original_application.reservation_id=actual_funding.source_application_id
   left join invoice_credit_reservations original_reservation on original_reservation.id=original_application.reservation_id limit 5001`);
 if(ancestorRows.length>5000)refuse();
 const byAncestor=new Map(ancestorRows.map(row=>[row.id,row]));
 for(const start of ancestorRows){const seen=new Set<string>();let cursor:typeof start|undefined=start;
  while(cursor){if(seen.has(cursor.id))refuse();seen.add(cursor.id);if(cursor.sourceApplicationId===null)break;if(!cursor.parentFundingId)refuse();cursor=byAncestor.get(cursor.parentFundingId);if(!cursor)refuse();}}
 const ancestorFundingIds=ancestorRows.map(row=>row.id),sourceApplicationIds=[...new Set(ancestorRows.flatMap(row=>row.sourceApplicationId?[row.sourceApplicationId]:[]))];
 const ancestorPurposes=ancestorFundingIds.length?await tx.select().from(invoiceCreditFundingAtomicFeePartitions).where(inArray(invoiceCreditFundingAtomicFeePartitions.fundingId,ancestorFundingIds)).limit(5001):[];
 const sourcePurposes=sourceApplicationIds.length?await tx.select().from(invoiceCreditReservationAtomicFeePartitions).where(inArray(invoiceCreditReservationAtomicFeePartitions.reservationId,sourceApplicationIds)).limit(5001):[];
 if(ancestorPurposes.some(row=>!verifiedAtomicCreditFeePartition(row,keys))||sourcePurposes.some(row=>!verifiedAtomicCreditReservation(row,keys)))refuse();
 for(const child of ancestorPurposes){const plan=child.economics.plan;if(child.sourceApplicationId===null)continue;const source=sourcePurposes.find(row=>row.reservationId===child.sourceApplicationId);
  if(plan.rootFundingId!==null&&(!source||source.rootFundingId!==plan.rootFundingId||source.economics.rootEconomicRevision!==plan.rootEconomicRevision))refuse();
  if(plan.rootFundingId===null&&(plan.rootKind!=="legacy_application"||source||plan.rootApplicationId!==child.sourceApplicationId))refuse();}
 const rootIds=[...new Set([...reservations.map(row=>row.rootFundingId),...sourcePurposes.map(row=>row.rootFundingId),...ancestorPurposes.flatMap(row=>row.economics.plan.rootFundingId?[row.economics.plan.rootFundingId]:[])])],roots=rootIds.length?await tx.select().from(invoiceCreditFundingAtomicFeePartitions).where(inArray(invoiceCreditFundingAtomicFeePartitions.fundingId,rootIds)).limit(5001):[];
 if(roots.length!==rootIds.length||roots.some(row=>!verifiedAtomicCreditFeePartition(row,keys)))refuse();
 const actualReservations=parentIds.length?await tx.execute<{id:string;fundingId:string;fingerprint:string}>(sql`select actual_reservation.id::text as id,actual_reservation.funding_id::text as "fundingId",encode(sha256(convert_to(to_jsonb(actual_reservation)::text,'UTF8')),'hex') as fingerprint
  from invoice_credit_reservations actual_reservation where actual_reservation.funding_id in(${list(parentIds)}) order by actual_reservation.id limit 5001`):[];
 if(actualReservations.length>5000)refuse();
 for(const actual of actualReservations)if(fundings.some(row=>row.fundingId===actual.fundingId)&&!reservations.some(row=>row.reservationId===actual.id))refuse();
 for(const row of reservations){const parent=actualReservations.find(value=>value.id===row.reservationId),funding=fundings.find(value=>value.fundingId===row.fundingId),root=roots.find(value=>value.fundingId===row.rootFundingId);
  if(!parent||!funding||!root||!verifiedAtomicCreditReservation(row,keys)||parent.fundingId!==row.fundingId||parent.fingerprint!==row.parentFingerprint||root.sourcePaymentId!==row.sourcePaymentId||funding.sourcePaymentId!==row.sourcePaymentId||funding.sourceApplicationId!==row.sourceApplicationId
   ||root.economics.plan.economicRevision!==row.economics.rootEconomicRevision||funding.economics.plan.economicRevision!==row.economics.fundingEconomicRevision)refuse();}
 const rows=await tx.execute<AtomicCreditFeeWitnessEntry>(sql`select 'invoice_credit_funding_atomic_fee_partitions'::text as table,actual_child.funding_id::text as id,encode(sha256(convert_to(to_jsonb(actual_child)::text,'UTF8')),'hex') as fingerprint,
  jsonb_build_object('fundingId',actual_child.funding_id,'reservationId',null,'rootFundingId',actual_child.economics->'plan'->>'rootFundingId','sourcePaymentId',actual_child.source_payment_id,'sourceApplicationId',actual_child.source_application_id,'sourceInvoiceId',actual_child.source_invoice_id,'creditNoteId',actual_child.credit_note_id,'creditNoteLineId',actual_child.credit_note_line_id,'prorationId',actual_parent.proration_id,'quoteId',actual_child.economics->'birthDeclaration'->>'quoteId','profileId',accepted.profile_id,'profileVersion',accepted.profile_version,'subscriptionId',accepted.subscription_id,'currency',source_invoice.currency) as parents
  from invoice_credit_funding_atomic_fee_partitions actual_child join invoice_credit_funding actual_parent on actual_parent.id=actual_child.funding_id join subscription_prorations accepted on accepted.id=actual_parent.proration_id join invoices source_invoice on source_invoice.id=actual_parent.source_invoice_id where actual_child.funding_id in(${list(parentIds)})
  union all select 'invoice_credit_reservation_atomic_fee_partitions',actual_child.reservation_id::text,encode(sha256(convert_to(to_jsonb(actual_child)::text,'UTF8')),'hex'),
  jsonb_build_object('fundingId',actual_child.funding_id,'reservationId',actual_child.reservation_id,'rootFundingId',actual_child.root_funding_id,'sourcePaymentId',actual_child.source_payment_id,'sourceApplicationId',actual_child.source_application_id,'sourceInvoiceId',actual_parent.source_invoice_id,'creditNoteId',actual_parent.credit_note_id,'creditNoteLineId',actual_parent.credit_note_line_id,'prorationId',actual_parent.proration_id,'quoteId',funding_child.economics->'birthDeclaration'->>'quoteId','profileId',accepted.profile_id,'profileVersion',accepted.profile_version,'subscriptionId',accepted.subscription_id,'currency',source_invoice.currency)
  from invoice_credit_reservation_atomic_fee_partitions actual_child join invoice_credit_funding actual_parent on actual_parent.id=actual_child.funding_id join invoice_credit_funding_atomic_fee_partitions funding_child on funding_child.funding_id=actual_child.funding_id join subscription_prorations accepted on accepted.id=actual_parent.proration_id join invoices source_invoice on source_invoice.id=actual_parent.source_invoice_id
  where actual_child.funding_id in(${list(parentIds)}) order by 1,2 limit 5001`);
 if(rows.length!==fundings.length+reservations.length||rows.length>5000)refuse();
 const dependencies=await tx.execute<{table:string;id:string;fingerprint:string}>(sql`select 'invoice_credit_funding'::text as table,actual_parent.id::text as id,encode(sha256(convert_to(to_jsonb(actual_parent)::text,'UTF8')),'hex') as fingerprint from invoice_credit_funding actual_parent where actual_parent.id in(${list([...ancestorFundingIds,...rootIds])})
  union select 'invoice_credit_reservations',actual_parent.id::text,encode(sha256(convert_to(to_jsonb(actual_parent)::text,'UTF8')),'hex') from invoice_credit_reservations actual_parent where actual_parent.id in(${list([...actualReservations.map(row=>row.id),...sourceApplicationIds])})
  union select 'invoice_credit_applications',actual_parent.reservation_id::text,encode(sha256(convert_to(to_jsonb(actual_parent)::text,'UTF8')),'hex') from invoice_credit_applications actual_parent where actual_parent.reservation_id in(${list(sourceApplicationIds)})
  union select 'invoice_credit_funding_atomic_fee_partitions',actual_root.funding_id::text,encode(sha256(convert_to(to_jsonb(actual_root)::text,'UTF8')),'hex') from invoice_credit_funding_atomic_fee_partitions actual_root where actual_root.funding_id in(${list([...rootIds,...ancestorFundingIds])})
  union select 'invoice_credit_reservation_atomic_fee_partitions',actual_root.reservation_id::text,encode(sha256(convert_to(to_jsonb(actual_root)::text,'UTF8')),'hex') from invoice_credit_reservation_atomic_fee_partitions actual_root where actual_root.reservation_id in(${list(sourceApplicationIds)}) order by 1,2 limit 5001`);
 const identities=new Map<string,string>();for(const row of [...rows,...dependencies]){const key=`${row.table}:${row.id}`,previous=identities.get(key);if(!z.uuid().safeParse(row.id).success||!/^[a-f0-9]{64}$/.test(row.fingerprint)||previous&&previous!==row.fingerprint)refuse();identities.set(key,row.fingerprint);}
 for(const root of roots)if(root.parentFingerprint!==identities.get(`invoice_credit_funding:${root.fundingId}`))refuse();
 for(const row of ancestorPurposes)if(row.parentFingerprint!==identities.get(`invoice_credit_funding:${row.fundingId}`))refuse();
 for(const row of ancestorPurposes)if(row.economics.plan.rootKind==="legacy_application"&&row.economics.plan.rootFundingId===null){const proof=row.economics.plan.legacyApplicationProof,source=byAncestor.get(row.fundingId);
  if(!proof||!source?.parentFundingId||proof.applicationFingerprint!==identities.get(`invoice_credit_applications:${row.sourceApplicationId}`)||proof.reservationFingerprint!==identities.get(`invoice_credit_reservations:${row.sourceApplicationId}`)||proof.fundingFingerprint!==identities.get(`invoice_credit_funding:${source.parentFundingId}`))refuse();}
 for(const row of sourcePurposes){const funding=ancestorPurposes.find(value=>value.fundingId===row.fundingId),root=roots.find(value=>value.fundingId===row.rootFundingId);
  if(!funding||!root||row.parentFingerprint!==identities.get(`invoice_credit_reservations:${row.reservationId}`)||row.fundingPartitionFingerprint!==identities.get(`invoice_credit_funding_atomic_fee_partitions:${row.fundingId}`)
   ||funding.sourcePaymentId!==row.sourcePaymentId||root.sourcePaymentId!==row.sourcePaymentId||funding.economics.plan.economicRevision!==row.economics.fundingEconomicRevision||root.economics.plan.economicRevision!==row.economics.rootEconomicRevision
   ||root.economics.plan.rootFundingId!==null||root.economics.plan.originalRootPrincipalMinor!==row.economics.originalPrincipalMinor||root.economics.plan.originalRootFeeMinor!==row.economics.originalFeeMinor)refuse();}
 for(const row of reservations)if(row.fundingPartitionFingerprint!==identities.get(`invoice_credit_funding_atomic_fee_partitions:${row.fundingId}`))refuse();
 if(identities.size>5000)refuse();return{entries:[...rows],dependencies:[...dependencies],incomplete:false};
}
/** Fee archive permission is an exact owned profile restriction supplied by the
 * real subject reader. This ordinary helper never derives subject authority.
 * Root unions dependencies by table+UUID with its existing physical families. */
export async function exportAtomicCreditFeePartitionHistory(tx:Tx,scope:AtomicCreditFeeWitnessScope,options:{merchant:boolean;existingIdentities?:readonly string[]}){
 if(options.merchant&&!scope.profileId)refuse();
 const selected=await atomicCreditFeePartitionWitnesses(tx,scope),identities=new Set(options.existingIdentities??[]);
 if(identities.size>5000)refuse();for(const row of [...selected.entries,...selected.dependencies])identities.add(`${row.table}:${row.id}`);if(identities.size>5000)refuse();
 const fundingIds=selected.entries.filter(row=>row.table===atomicCreditFeeTables.fundings).map(row=>row.id),reservationIds=selected.entries.filter(row=>row.table===atomicCreditFeeTables.reservations).map(row=>row.id);
 const fundings=fundingIds.length?await tx.select().from(invoiceCreditFundingAtomicFeePartitions).where(inArray(invoiceCreditFundingAtomicFeePartitions.fundingId,fundingIds)).limit(5001):[];
 const reservations=reservationIds.length?await tx.select().from(invoiceCreditReservationAtomicFeePartitions).where(inArray(invoiceCreditReservationAtomicFeePartitions.reservationId,reservationIds)).limit(5001):[];
 if(fundings.length!==fundingIds.length||reservations.length!==reservationIds.length)refuse();
 const currencyFor=(table:string,id:string)=>{const entry=selected.entries.find(row=>row.table===table&&row.id===id);if(!entry||!z.string().regex(/^[A-Z]{3}$/).safeParse(entry.parents.currency).success)refuse();return entry.parents.currency;};
 const exported={fundings:fundings.map(row=>atomicCreditFundingArchive(row,currencyFor(atomicCreditFeeTables.fundings,row.fundingId),options.merchant)),reservations:reservations.map(row=>atomicCreditReservationArchive(row,currencyFor(atomicCreditFeeTables.reservations,row.reservationId),options.merchant))};
 if(merchantTaxDigest(await atomicCreditFeePartitionWitnesses(tx,scope))!==merchantTaxDigest(selected))refuse();return{selected,exported};
}
