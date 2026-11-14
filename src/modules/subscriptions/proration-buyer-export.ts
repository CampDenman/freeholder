// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: explicit buyer-owned accepted terms, never raw retained JSON.
import { ServiceError } from "@/core/service";
import type { subscriptionProrations } from "./proration-schema";
type Proration=typeof subscriptionProrations.$inferSelect;
export type BuyerProrationSource=Pick<Proration,"id"|"subscriptionId"|"planId"|"previousTermsId"|"termsId"|"snapshot"|"taxDestination"|"noticeSnapshot"|"effectiveAt"|"originalPeriodStart"|"originalPeriodEnd"|"originalTrialEndsAt"|"proposedPeriodStart"|"proposedPeriodEnd"|"originalInvoiceId"|"originalInvoiceLineId"|"debitInvoiceId"|"creditNoteId"|"debitNetMinor"|"debitTaxMinor"|"creditNetMinor"|"creditTaxMinor"|"state"|"appliedAt"|"cancelledAt"|"createdAt">;
export type BuyerProrationInvoice={id:string;currency:string;totalMinor:number;paidMinor:number;creditedMinor:number;refundedMinor:number};
/** The source is already selected through the subject's actual subscription.
 * This projection never changes accepted snapshots or internal full-row SHA.
 * Extra JSON keys are not schema authority and cannot become archive fields. */
export function buyerAcceptedProration(row:BuyerProrationSource,invoice:BuyerProrationInvoice|null){
 if((invoice?.id??null)!==row.debitInvoiceId)throw new ServiceError("conflict","Restore the exact accepted proration invoice before exporting its actual consideration.");
 const s=row.snapshot,t=row.taxDestination,n=row.noticeSnapshot;
 return{id:row.id,subscriptionId:row.subscriptionId,planId:row.planId,previousTermsId:row.previousTermsId,termsId:row.termsId,
  snapshot:{version:s.version,name:s.name,description:s.description,productVariantId:s.productVariantId,taxCategoryCode:s.taxCategoryCode,requiresShipping:s.requiresShipping,
   currency:s.currency,periodAmountMinor:s.periodAmountMinor,setupFeeMinor:s.setupFeeMinor,interval:s.interval,intervalCount:s.intervalCount,trialDays:s.trialDays,
   trialRequiresCard:s.trialRequiresCard,cancelBehaviour:s.cancelBehaviour,proration:s.proration,billingMode:s.billingMode},
  taxDestination:t?{country:t.country,...(t.region===undefined?{}:{region:t.region}),...(t.postalCode===undefined?{}:{postalCode:t.postalCode}),...(t.city===undefined?{}:{city:t.city})}:null,
  noticeSnapshot:{locale:n.locale,text:n.text},effectiveAt:row.effectiveAt,originalPeriodStart:row.originalPeriodStart,originalPeriodEnd:row.originalPeriodEnd,
  originalTrialEndsAt:row.originalTrialEndsAt,proposedPeriodStart:row.proposedPeriodStart,proposedPeriodEnd:row.proposedPeriodEnd,
  originalInvoiceId:row.originalInvoiceId,originalInvoiceLineId:row.originalInvoiceLineId,debitInvoiceId:row.debitInvoiceId,creditNoteId:row.creditNoteId,
  debitNetMinor:row.debitNetMinor,debitTaxMinor:row.debitTaxMinor,creditNetMinor:row.creditNetMinor,creditTaxMinor:row.creditTaxMinor,
  state:row.state,appliedAt:row.appliedAt,cancelledAt:row.cancelledAt,createdAt:row.createdAt,
  invoiceConsideration:invoice?{invoiceId:invoice.id,currency:invoice.currency,totalMinor:invoice.totalMinor,paidMinor:invoice.paidMinor,creditedMinor:invoice.creditedMinor,refundedMinor:invoice.refundedMinor}:null};
}
