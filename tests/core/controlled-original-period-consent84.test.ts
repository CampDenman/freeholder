// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Distinct original mandate versus explicitly changed price.
import { describe,expect,it } from "vitest";
import { assertControlledOriginalConsent,type ControlledOriginalConsentReview } from "@/modules/subscriptions/controlled-provider-original-consent";
function fixture(){
 const terms={id:"00000000-0000-4000-8000-000000000001",acceptedQuoteDigest:"a".repeat(64)};
 const review:Extract<ControlledOriginalConsentReview,{kind:"period"}>={kind:"period",quoteDigest:"b".repeat(64),previousTermsId:terms.id,quote:{quoteDigest:terms.acceptedQuoteDigest},controlled:{originalPeriodConsentDigest:terms.acceptedQuoteDigest}};
 const collection={kind:"period" as "period"|"proration",termsId:terms.id,prorationId:null as string|null,creditNoteId:null as string|null,acceptanceKind:"original_period_mandate" as "original_period_mandate"|"explicit_change",originalConsentDigest:terms.acceptedQuoteDigest,acceptedBy:"user:actual-preparing-owner",acceptedQuoteDigest:review.quoteDigest};
 return{terms,review,collection};
}
describe("actual original period mandate identity",()=>{
 it("keeps original buyer consent separate from the new preview/dated-period digest",()=>{const f=fixture();expect(()=>assertControlledOriginalConsent(f.collection,f.review,f.terms)).not.toThrow();expect(f.collection.originalConsentDigest).not.toBe(f.collection.acceptedQuoteDigest);});
 it("refuses turning a preview into original buyer consent",()=>{const f=fixture();f.collection.originalConsentDigest=f.review.quoteDigest;expect(()=>assertControlledOriginalConsent(f.collection,f.review,f.terms)).toThrow();});
 it("does not pretend the preparing operator is an original buyer acceptance",()=>{const f=fixture();f.collection.acceptedBy="agent:actual-worker";expect(()=>assertControlledOriginalConsent(f.collection,f.review,f.terms)).not.toThrow();expect(f.collection.acceptanceKind).toBe("original_period_mandate");expect(f.collection.originalConsentDigest).toBe(f.terms.acceptedQuoteDigest);});
 it("refuses charging a normal period through an invented proration or old paid credit",()=>{for(const field of ["prorationId","creditNoteId"] as const){const f=fixture();f.collection[field]="00000000-0000-4000-8000-000000000002";expect(()=>assertControlledOriginalConsent(f.collection,f.review,f.terms)).toThrow();}});
 it("refuses a different accepted terms ancestor despite the same price",()=>{const f=fixture();f.review.previousTermsId="00000000-0000-4000-8000-000000000003";expect(()=>assertControlledOriginalConsent(f.collection,f.review,f.terms)).toThrow();});
 it("keeps the changed-price branch on its actual new explicit acceptance",()=>{const f=fixture();f.terms.acceptedQuoteDigest=f.review.quoteDigest;f.collection.kind="proration";f.collection.acceptanceKind="explicit_change";f.collection.originalConsentDigest=f.review.quoteDigest;expect(()=>assertControlledOriginalConsent(f.collection,{kind:"proration",quoteDigest:f.review.quoteDigest},f.terms)).not.toThrow();f.collection.originalConsentDigest="c".repeat(64);expect(()=>assertControlledOriginalConsent(f.collection,{kind:"proration",quoteDigest:f.review.quoteDigest},f.terms)).toThrow();});
});
