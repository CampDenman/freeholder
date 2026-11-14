// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// An unaccepted review is evidence, never a principal reservation or mandate.
import { z } from "zod";
import { ServiceError } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { controlledTargetReview } from "./controlled-provider-collection-contract";
import type { subscriptionControlledQuotes } from "./controlled-provider-collection-schema";
import type { subscriptionControlledResources } from "./controlled-provider-schema";
import type { controlledProviderJournal } from "./controlled-provider-proof";
type Quote=typeof subscriptionControlledQuotes.$inferSelect;
type Resource=typeof subscriptionControlledResources.$inferSelect;
type History=Awaited<ReturnType<typeof controlledProviderJournal>>;
const record=z.record(z.string(),z.unknown());
/** Digest deliberately excludes only its own digest field. Full quoted parent
 * revision, own immutable IDs, actual read identities and unchanged economics
 * remain bound. Parent current financial coverage never filters this quote. */
export function controlledTargetQuoteDigest(input:NonNullable<Quote["input"]>,review:z.infer<typeof controlledTargetReview>,profileId:string,profileVersion:number){
 const economic=Object.fromEntries(Object.entries(review).filter(([key])=>key!=="quoteDigest"));
 return merchantTaxDigest({version:1,kind:"controlled_target_review",input,review:economic,profileId,profileVersion});
}
function refuse():never{throw new ServiceError("conflict","Restore the exact complete original native/update previews, dated canonical economics and independently retained original calendar/customer reads before using this quote.");}
export function authenticatedControlledQuote(quote:Quote,resource:Resource,history:History){
 if(!quote.input||!quote.review||quote.redactedAt||quote.inputDigest!==merchantTaxDigest(quote.input)||quote.reviewDigest!==merchantTaxDigest(quote.review))refuse();
 const review=controlledTargetReview.parse(quote.review),c=review.controlled;
 if(quote.resourceId!==resource.id||quote.kind!==review.kind||quote.previousTermsId!==review.previousTermsId||quote.plannedProrationId!==c.plannedProrationId||quote.plannedCollectionId!==c.plannedCollectionId
  ||quote.id!==c.quoteId||c.resourceId!==resource.id||review.subscriptionId!==resource.subscriptionId||quote.canonicalSourceId!==review.canonicalSourceId
  ||quote.quoteDigest!==review.quoteDigest||quote.sourceRevision!==review.sourceRevision||quote.quotedParentRevision!==c.quotedParentRevision||quote.effectiveAt.toISOString()!==review.effectiveAt
  ||controlledTargetQuoteDigest(quote.input,review,quote.profileId,quote.profileVersion)!==quote.quoteDigest
  ||quote.calendarReadOperationId!==c.calendarReadOperationId||quote.customerFinancialOperationId!==c.customerFinancialOperationId||quote.nativePreviewOperationId!==c.nativePreviewOperationId||quote.updatePreviewOperationId!==c.updatePreviewOperationId)refuse();
 function returned(id:string,kind:string){const op=history.operations.find(row=>row.id===id),verified=history.verifications.find(row=>row.operationId===id);
  if(!op||op.resourceId!==resource.id||op.kind!==kind||!verified)refuse();return{operation:op,verification:verified};}
 if(review.kind==="period"&&(review.controlled.originalPeriodConsentDigest!==review.quote.quoteDigest||quote.canonicalSourceId!==`${resource.subscriptionId}:${review.calendar.proposedPeriodStart}`
  ||review.effectiveAt!==review.calendar.proposedPeriodStart||record.parse(quote.input).previewAt!==review.calendar.prorationAt))refuse();
 const previewAt=review.kind==="period"?review.calendar.prorationAt:review.effectiveAt;
 const calendar=returned(quote.calendarReadOperationId,"read_calendar"),customer=returned(quote.customerFinancialOperationId,"read_customer_financials"),native=returned(quote.nativePreviewOperationId,"preview_proration"),update=returned(quote.updatePreviewOperationId,"preview_update");
 const source=record.parse(calendar.verification.actualResult.actualRaw),actualCalendar=calendar.verification.actualResult;
 if(actualCalendar.collectionPausedAsDraft!==true||actualCalendar.calendarCanceled!==false||actualCalendar.currentReadDigest!==merchantTaxDigest(source)
  ||actualCalendar.providerSubscriptionRef!==native.verification.actualResult.providerSubscriptionRef||actualCalendar.providerSubscriptionRef!==update.verification.actualResult.providerSubscriptionRef
  ||customer.verification.actualResult.providerCustomerRef!==resource.originalScope.providerCustomerRef||customer.verification.actualResult.balanceState!=="known_zero"||customer.verification.actualResult.completeCreditNotes!==true
  ||customer.verification.actualResult.inventoryDigest!==c.customerFinancialDigest||native.verification.actualResultDigest!==c.nativeActualEvidenceDigest||update.verification.actualResultDigest!==c.controlledUpdateActualEvidenceDigest)refuse();
 for(const[key,pair]of [["create_prorations",native],["none",update]] as const){const actual=pair.verification.actualResult,payload=record.parse(pair.operation.originalRequest.payload);
  if(actual.requestedProrationBehavior!==key||actual.prorationAt!==previewAt||actual.currency!==resource.originalScope.currency||actual.providerCustomerRef!==resource.originalScope.providerCustomerRef
   ||actual.suppliesPaidAuthority!==false||payload.currentReadDigest!==actualCalendar.currentReadDigest||payload.originalAnchor!==review.calendar.originalBillingAnchor
   ||payload.originalPeriodStart!==review.calendar.originalProviderPeriodStart||payload.originalPeriodEnd!==review.calendar.originalProviderPeriodEnd
   ||payload.prorationAt!==previewAt||!Array.isArray(actual.actualLines)||actual.actualLines.length>1000||!record.safeParse(actual.actualRaw).success
   ||!history.facts.some(f=>history.calls.some(call=>call.id===f.callId&&call.operationId===pair.operation.id)&&f.actual.kind==="proration_preview"&&merchantTaxDigest(f.actual.raw)===merchantTaxDigest(actual.actualRaw)))refuse();
 }
 return{review,calendar,customer,native,update};
}
