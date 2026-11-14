// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One canonical invoice/issued credit/dated tax/fee equation, never bank estimates.
import { eq,inArray } from "drizzle-orm";
import { ServiceError,type Tx } from "@/core/service";
import { invoices,invoiceLines,creditNotes,creditNoteLines,invoiceMarketPolicies } from "@/modules/invoicing/schema";
import { invoiceMerchantTaxQuotes,invoiceMerchantTaxQuoteLines } from "@/modules/invoicing/merchant-tax-schema";
import { invoiceCreditApplications,invoiceCreditReservations,invoiceCreditFunding,invoiceCreditReleases } from "@/modules/invoicing/credit-application-schema";
import { agreementFeeDuties,agreementFeeCreditAssignments } from "@/modules/invoicing/agreement-fee-schema";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
/** Caller already holds controlled resource then canonical payment/invoice/note
 * locks. Mutable cash/status projections are returned for CURRENT admission but
 * never rewrite the immutable accepted commercial target digest. Complete raw
 * money/caller/refund/dispute authority remains a separate parent requirement. */
export async function controlledCanonicalTarget(tx:Tx,invoiceId:string,originalCreditNoteId?:string|null){
 const[invoice]=await tx.select().from(invoices).where(eq(invoices.id,invoiceId)).limit(1);
 if(!invoice||invoice.sourceType!=="subscription"||!invoice.sourceId||!invoice.issuedAt)throw new ServiceError("conflict","Restore the actual issued canonical subscription target; a bank draft or estimate cannot stand in for it.");
 const lines=await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId,invoice.id)).orderBy(invoiceLines.position).limit(5001);
 const taxes=await tx.select().from(invoiceMerchantTaxQuotes).where(eq(invoiceMerchantTaxQuotes.invoiceId,invoice.id)).orderBy(invoiceMerchantTaxQuotes.id).limit(5001);
 const taxLines=lines.length?await tx.select().from(invoiceMerchantTaxQuoteLines).where(inArray(invoiceMerchantTaxQuoteLines.invoiceLineId,lines.map(row=>row.id))).orderBy(invoiceMerchantTaxQuoteLines.invoiceLineId).limit(5001):[];
 const applications=await tx.select().from(invoiceCreditApplications).where(eq(invoiceCreditApplications.invoiceId,invoice.id)).orderBy(invoiceCreditApplications.reservationId).limit(5001);
 const applicationIds=applications.map(row=>row.reservationId);
 const reservations=applicationIds.length?await tx.select().from(invoiceCreditReservations).where(inArray(invoiceCreditReservations.id,applicationIds)).orderBy(invoiceCreditReservations.id).limit(5001):[];
 const fundingIds=[...new Set(reservations.map(row=>row.fundingId))];
 const appliedFunding=fundingIds.length?await tx.select().from(invoiceCreditFunding).where(inArray(invoiceCreditFunding.id,fundingIds)).orderBy(invoiceCreditFunding.id).limit(5001):[];
 // The entire issued old-credit promise belongs to this target, even when
 // zero is applied. Future residual spends must not change its original issue.
 const originalFunding=originalCreditNoteId?await tx.select().from(invoiceCreditFunding).where(eq(invoiceCreditFunding.creditNoteId,originalCreditNoteId)).orderBy(invoiceCreditFunding.id).limit(5001):[];
 const funding=[...new Map([...appliedFunding,...originalFunding].map(row=>[row.id,row])).values()].sort((a,b)=>a.id.localeCompare(b.id));
 const noteIds=[...new Set([...funding.map(row=>row.creditNoteId),...(originalCreditNoteId?[originalCreditNoteId]:[])])];
 const notes=noteIds.length?await tx.select().from(creditNotes).where(inArray(creditNotes.id,noteIds)).orderBy(creditNotes.id).limit(5001):[];
 const noteLines=noteIds.length?await tx.select().from(creditNoteLines).where(inArray(creditNoteLines.creditNoteId,noteIds)).orderBy(creditNoteLines.id).limit(5001):[];
 const releases=applicationIds.length?await tx.select().from(invoiceCreditReleases).where(inArray(invoiceCreditReleases.reservationId,applicationIds)).limit(5001):[];
 const[marketPolicy]=await tx.select().from(invoiceMarketPolicies).where(eq(invoiceMarketPolicies.invoiceId,invoice.id)).limit(1);
 const[feeDuty]=await tx.select().from(agreementFeeDuties).where(eq(agreementFeeDuties.invoiceId,invoice.id)).limit(1);
 const feeCreditAssignments=await tx.select().from(agreementFeeCreditAssignments).where(eq(agreementFeeCreditAssignments.invoiceId,invoice.id)).orderBy(agreementFeeCreditAssignments.applicationId).limit(5001);
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
