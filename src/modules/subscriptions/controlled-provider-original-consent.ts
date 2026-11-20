// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A normal period executes the original mandate; a changed price needs new consent.
import { ServiceError } from "@/core/service";
import type { subscriptionControlledCollections } from "./controlled-provider-collection-schema";
import type { subscriptionCommercialTerms } from "./schema";
export type ControlledOriginalConsentReview={kind:"period";quoteDigest:string;previousTermsId:string;quote:{quoteDigest:string};controlled:{originalPeriodConsentDigest:string}}|{kind:"proration";quoteDigest:string};
export function assertControlledOriginalConsent(
 collection:Pick<typeof subscriptionControlledCollections.$inferSelect,"kind"|"termsId"|"prorationId"|"creditNoteId"|"acceptanceKind"|"originalConsentDigest"|"acceptedBy"|"acceptedQuoteDigest">,
 review:ControlledOriginalConsentReview,
 terms:Pick<typeof subscriptionCommercialTerms.$inferSelect,"id"|"acceptedQuoteDigest">,
){
 const period=review.kind==="period";
 if(collection.kind!==review.kind||collection.termsId!==terms.id||collection.acceptedQuoteDigest!==review.quoteDigest
  ||(period?(collection.prorationId!==null||collection.creditNoteId!==null||collection.acceptanceKind!=="original_period_mandate"
   ||review.previousTermsId!==terms.id||collection.originalConsentDigest!==terms.acceptedQuoteDigest
   ||review.controlled.originalPeriodConsentDigest!==terms.acceptedQuoteDigest||review.quote.quoteDigest!==terms.acceptedQuoteDigest)
   :(collection.acceptanceKind!=="explicit_change"||collection.originalConsentDigest!==review.quoteDigest||terms.acceptedQuoteDigest!==review.quoteDigest)))
  throw new ServiceError("conflict","Restore the actual original period mandate or explicit changed-price consent; a preview or current operator cannot manufacture the buyer's acceptance.");
}
