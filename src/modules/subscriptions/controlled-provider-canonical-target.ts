// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One canonical invoice/issued credit/dated tax/fee equation, never bank estimates.
import { eq,getTableColumns,sql,type InferSelectModel } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import { ServiceError,type Tx } from "@/core/service";
import { invoices,invoiceLines,creditNotes,creditNoteLines,invoiceMarketPolicies } from "@/modules/invoicing/schema";
import { invoiceMerchantTaxQuotes,invoiceMerchantTaxQuoteLines } from "@/modules/invoicing/merchant-tax-schema";
import { invoiceCreditApplications,invoiceCreditReservations,invoiceCreditFunding,invoiceCreditReleases } from "@/modules/invoicing/credit-application-schema";
import { agreementFeeDuties,agreementFeeCreditAssignments } from "@/modules/invoicing/agreement-fee-schema";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
function decodeRows<T extends PgTable>(table:T,wire:unknown):Array<InferSelectModel<T>>{
 const columns=getTableColumns(table),rows=z.array(z.record(z.string(),z.unknown())).max(5001).parse(wire);
 return rows.map(row=>{
  if(Object.keys(row).length!==Object.keys(columns).length||Object.values(columns).some(column=>!Object.hasOwn(row,column.name)))throw new ServiceError("conflict","Restore the complete typed canonical target snapshot.");
  return Object.fromEntries(Object.entries(columns).map(([key,column])=>{const value=row[column.name];if(value===null&&column.notNull)throw new ServiceError("conflict","Restore every required canonical target column.");return[key,column.mapFromDriverValue(value)];})) as InferSelectModel<T>;
 });
}
/** Caller already holds controlled resource then canonical payment/invoice/note
 * locks. Mutable cash/status projections are returned for CURRENT admission but
 * never rewrite the immutable accepted commercial target digest. Complete raw
 * money/caller/refund/dispute authority remains a separate parent requirement. */
export async function controlledCanonicalTarget(tx:Tx,invoiceId:string,originalCreditNoteId?:string|null){
 const[invoice]=await tx.select().from(invoices).where(eq(invoices.id,invoiceId)).limit(1);
 if(!invoice||invoice.sourceType!=="subscription"||!invoice.sourceId||!invoice.issuedAt)throw new ServiceError("conflict","Restore the actual issued canonical subscription target; a bank draft or estimate cannot stand in for it.");
 const[snapshot]=await tx.execute(sql`WITH actual_lines AS MATERIALIZED(SELECT * FROM ${invoiceLines} WHERE invoice_id=${invoice.id}::uuid ORDER BY position LIMIT 5001),
  actual_taxes AS MATERIALIZED(SELECT * FROM ${invoiceMerchantTaxQuotes} WHERE invoice_id=${invoice.id}::uuid ORDER BY id LIMIT 5001),
  actual_applications AS MATERIALIZED(SELECT * FROM ${invoiceCreditApplications} WHERE invoice_id=${invoice.id}::uuid ORDER BY reservation_id LIMIT 5001),
  actual_reservations AS MATERIALIZED(SELECT * FROM ${invoiceCreditReservations} WHERE id IN(SELECT reservation_id FROM actual_applications) ORDER BY id LIMIT 5001),
  applied_funding AS MATERIALIZED(SELECT * FROM ${invoiceCreditFunding} WHERE id IN(SELECT funding_id FROM actual_reservations) ORDER BY id LIMIT 5001),
  original_funding AS MATERIALIZED(SELECT * FROM ${invoiceCreditFunding} WHERE credit_note_id=${originalCreditNoteId??null}::uuid ORDER BY id LIMIT 5001),
  actual_funding AS MATERIALIZED(SELECT * FROM applied_funding UNION SELECT * FROM original_funding),
  actual_note_ids AS MATERIALIZED(SELECT credit_note_id AS id FROM actual_funding UNION SELECT ${originalCreditNoteId??null}::uuid WHERE ${originalCreditNoteId??null}::uuid IS NOT NULL),
  actual_notes AS MATERIALIZED(SELECT * FROM ${creditNotes} WHERE id IN(SELECT id FROM actual_note_ids) ORDER BY id LIMIT 5001),
  actual_note_lines AS MATERIALIZED(SELECT * FROM ${creditNoteLines} WHERE credit_note_id IN(SELECT id FROM actual_note_ids) ORDER BY id LIMIT 5001),
  actual_market AS MATERIALIZED(SELECT * FROM ${invoiceMarketPolicies} WHERE invoice_id=${invoice.id}::uuid LIMIT 1),
  actual_fee AS MATERIALIZED(SELECT * FROM ${agreementFeeDuties} WHERE invoice_id=${invoice.id}::uuid LIMIT 1)
  SELECT
   coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.position) FROM actual_lines l),'[]'::jsonb) AS lines,
   coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM actual_taxes t),'[]'::jsonb) AS taxes,
   coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.invoice_line_id) FROM (SELECT * FROM ${invoiceMerchantTaxQuoteLines} WHERE invoice_line_id IN(SELECT id FROM actual_lines) ORDER BY invoice_line_id LIMIT 5001) t),'[]'::jsonb) AS "taxLines",
   coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.reservation_id) FROM actual_applications a),'[]'::jsonb) AS applications,
   coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM actual_reservations r),'[]'::jsonb) AS reservations,
   coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM applied_funding f),'[]'::jsonb) AS "appliedFunding",
   coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM original_funding f),'[]'::jsonb) AS "originalFunding",
   coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM actual_funding f),'[]'::jsonb) AS funding,
   coalesce((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.id) FROM actual_notes n),'[]'::jsonb) AS notes,
   coalesce((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.id) FROM actual_note_lines n),'[]'::jsonb) AS "noteLines",
   coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT * FROM ${invoiceCreditReleases} WHERE reservation_id IN(SELECT reservation_id FROM actual_applications) LIMIT 5001) r),'[]'::jsonb) AS releases,
   coalesce((SELECT jsonb_agg(to_jsonb(m)) FROM actual_market m),'[]'::jsonb) AS "marketPolicies",
   coalesce((SELECT jsonb_agg(to_jsonb(f)) FROM actual_fee f),'[]'::jsonb) AS "feeDuties",
   coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.application_id) FROM (SELECT * FROM ${agreementFeeCreditAssignments} WHERE invoice_id=${invoice.id}::uuid ORDER BY application_id LIMIT 5001) a),'[]'::jsonb) AS "feeCreditAssignments"`);
 const wire=z.record(z.string(),z.unknown()).parse(snapshot),lines=decodeRows(invoiceLines,wire.lines),taxes=decodeRows(invoiceMerchantTaxQuotes,wire.taxes),taxLines=decodeRows(invoiceMerchantTaxQuoteLines,wire.taxLines),
  applications=decodeRows(invoiceCreditApplications,wire.applications),reservations=decodeRows(invoiceCreditReservations,wire.reservations),appliedFunding=decodeRows(invoiceCreditFunding,wire.appliedFunding),
  originalFunding=decodeRows(invoiceCreditFunding,wire.originalFunding),funding=decodeRows(invoiceCreditFunding,wire.funding),notes=decodeRows(creditNotes,wire.notes),noteLines=decodeRows(creditNoteLines,wire.noteLines),
  releases=decodeRows(invoiceCreditReleases,wire.releases),feeCreditAssignments=decodeRows(agreementFeeCreditAssignments,wire.feeCreditAssignments),marketPolicies=decodeRows(invoiceMarketPolicies,wire.marketPolicies),feeDuties=decodeRows(agreementFeeDuties,wire.feeDuties);
 const fundingIds=[...new Set(reservations.map(row=>row.fundingId))],noteIds=[...new Set([...funding.map(row=>row.creditNoteId),...(originalCreditNoteId?[originalCreditNoteId]:[])])];
 const[marketPolicy]=marketPolicies,[feeDuty]=feeDuties;
 const count=2+lines.length+taxes.length+taxLines.length+applications.length+reservations.length+funding.length+notes.length+noteLines.length+releases.length+(feeDuty?1:0)+feeCreditAssignments.length;
 if(count>5000||!marketPolicy||marketPolicy.model!=="seller_merchant"||!lines.length||taxLines.length!==lines.length||taxes.length!==1||lines.some(line=>!taxLines.some(link=>link.invoiceLineId===line.id&&link.quoteId===taxes[0]!.id))
  ||applications.length!==reservations.length||appliedFunding.length!==fundingIds.length||notes.length!==noteIds.length
  ||originalCreditNoteId&&(!originalFunding.length||originalFunding.some(row=>row.creditNoteId!==originalCreditNoteId)||originalFunding.reduce((sum,row)=>sum+BigInt(row.amountMinor),0n)!==BigInt(notes.find(row=>row.id===originalCreditNoteId)?.totalMinor??-1))
  ||funding.some(row=>!noteLines.some(line=>line.id===row.creditNoteLineId&&line.creditNoteId===row.creditNoteId))
  ||notes.some(note=>noteLines.filter(line=>line.creditNoteId===note.id).reduce((sum,line)=>sum+BigInt(line.totalMinor),0n)!==BigInt(note.totalMinor))
  ||reservations.some(row=>row.targetSourceId!==invoice.sourceId)||notes.some(row=>row.status!=="issued"||row.currency!==invoice.currency)
  ||reservations.reduce((n,row)=>n+BigInt(row.amountMinor),0n)!==BigInt(invoice.creditedMinor))throw new ServiceError("conflict","Retain the entire exact target-owned issued credit/application, line and dated-tax lineage; no released promise or truncated inventory can fund collection.");
 const immutableInvoice={id:invoice.id,ownerSubscriptionId:invoice.sourceId.split(":")[0],sourceType:invoice.sourceType,sourceId:invoice.sourceId,currency:invoice.currency,requestHash:invoice.requestHash,
  subtotalMinor:invoice.subtotalMinor,discountMinor:invoice.discountMinor,shippingMinor:invoice.shippingMinor,taxMinor:invoice.taxMinor,totalMinor:invoice.totalMinor,issuedAt:invoice.issuedAt};
 // Contact aliases/current status/timestamps remain in full current physical
 // coverage, but are not accepted commercial identity. contacts.merge may
 // repoint both actual owners without rewriting the original source promise.
 const immutablePolicy={invoiceId:marketPolicy.invoiceId,allocationVersion:marketPolicy.allocationVersion,collectionVersion:marketPolicy.collectionVersion,model:marketPolicy.model,
  adapter:marketPolicy.adapter,siteFeeBps:marketPolicy.siteFeeBps,holdDays:marketPolicy.holdDays,feeMinor:marketPolicy.feeMinor,sellerUserId:marketPolicy.sellerUserId,
  merchantName:marketPolicy.merchantName,merchantSupport:marketPolicy.merchantSupport,providerAccountId:marketPolicy.providerAccountId};
 const immutableNotes=notes.map(note=>({id:note.id,invoiceId:note.invoiceId,number:note.number,sequenceKey:note.sequenceKey,idempotencyKey:note.idempotencyKey,requestHash:note.requestHash,
  currency:note.currency,reason:note.reason,subtotalMinor:note.subtotalMinor,taxMinor:note.taxMinor,totalMinor:note.totalMinor,issuedAt:note.issuedAt}));
 const digest=merchantTaxDigest({invoice:immutableInvoice,lines,taxes,taxLines,applications,reservations,funding,notes:immutableNotes,noteLines,originalCreditNoteId:originalCreditNoteId??null,marketPolicy:immutablePolicy,feeDuty:feeDuty??null,feeCreditAssignments});
 return{invoice,lines,taxes,taxLines,applications,reservations,funding,notes,noteLines,releases,currentCollectible:!["draft","void","refunded"].includes(invoice.status)&&releases.length===0,marketPolicy,feeDuty:feeDuty??null,feeCreditAssignments,count,digest};
}
