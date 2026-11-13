// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Explicit canonical target and actual provider collection are different proofs.
import { z } from "zod";
import { grossProrationInput,grossProrationReview } from "./proration-review-contract";
export const CONTROLLED_COLLECTION_PROTOCOL="controlled_net_gross.v1";
export const CONTROLLED_COLLECTION_POLICY="canonical_gross_target_locked_credit_no_wallet";
const sha=z.string().regex(/^[a-f0-9]{64}$/),reference=z.string().min(1).max(200),minor=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const controlledProrationInput=grossProrationInput.extend({resourceId:z.uuid()}).strict();
export const controlledProrationCalendar=z.object({kind:z.literal("controlled_provider"),prorationAt:z.iso.datetime(),
 originalApplicationPeriodStart:z.iso.datetime(),originalApplicationPeriodEnd:z.iso.datetime(),originalProviderPeriodStart:z.iso.datetime(),originalProviderPeriodEnd:z.iso.datetime(),
 proposedPeriodStart:z.iso.datetime(),proposedPeriodEnd:z.iso.datetime(),expectedProviderPeriodStart:z.iso.datetime(),expectedProviderPeriodEnd:z.iso.datetime(),
 originalBillingAnchor:z.iso.datetime(),expectedProviderBillingAnchor:z.iso.datetime(),originalProviderTrialEndsAt:z.iso.datetime().nullable(),expectedProviderTrialEndsAt:z.iso.datetime().nullable(),requestedAnchor:z.literal("unchanged"),
 originalTrialEndsAt:z.iso.datetime().nullable(),proposedTrialEndsAt:z.iso.datetime().nullable(),nativePreviewRef:reference,controlledUpdatePreviewRef:reference,
 nativeCurrentDebitMinor:minor,nativeUnusedCreditMinor:minor,nativeRenewalForecastMinor:minor,
 nativeForecasts:z.array(z.object({providerLineRef:reference,amountMinor:minor,periodStart:z.iso.datetime(),periodEnd:z.iso.datetime(),proration:z.boolean()})).max(1000),
 nativeEstimateIsCollection:z.literal(false),merchantTaxAuthority:z.literal("canonical_merchant_tax_ledger"),fixedTaxRequiredBeforeCollection:z.literal(true),
 collectionPolicy:z.literal(CONTROLLED_COLLECTION_POLICY)}).strict().superRefine((value,ctx)=>{
 if(value.originalTrialEndsAt!==value.proposedTrialEndsAt)ctx.addIssue({code:"custom",message:"Preserve the actually accepted original trial end; a price change cannot silently end or extend it."});
 if(Date.parse(value.proposedPeriodEnd)<=Date.parse(value.proposedPeriodStart))ctx.addIssue({code:"custom",message:"The actual proposed provider service period must be complete and positive."});
});
export const controlledProrationReview=grossProrationReview.omit({calendar:true,payment:true}).extend({calendar:controlledProrationCalendar,payment:z.null(),
 controlled:z.object({quoteId:z.uuid(),resourceId:z.uuid(),plannedProrationId:z.uuid(),plannedCollectionId:z.uuid(),protocol:z.literal(CONTROLLED_COLLECTION_PROTOCOL),
  quotedParentRevision:sha,calendarReadOperationId:z.uuid(),customerFinancialOperationId:z.uuid(),nativePreviewOperationId:z.uuid(),updatePreviewOperationId:z.uuid(),
  nativeActualEvidenceDigest:sha,controlledUpdateActualEvidenceDigest:sha,customerFinancialDigest:sha,economicTargetDigest:sha})}).strict();
export const controlledPeriodInput=z.object({id:z.uuid(),resourceId:z.uuid(),previewAt:z.iso.datetime(),locale:z.enum(["en","fr","es","ar"]).default("en")}).strict();
export const controlledPeriodReview=controlledProrationReview.omit({controlled:true}).extend({kind:z.literal("period"),canonicalSourceId:z.string().min(1).max(300),
 creditNetMinor:z.literal(0),creditTaxMinor:z.literal(0),creditAppliedMinor:z.literal(0),residualCreditMinor:z.literal(0),
 controlled:controlledProrationReview.shape.controlled.extend({plannedProrationId:z.null()})}).strict();
export const controlledChangedPriceReview=controlledProrationReview.extend({kind:z.literal("proration"),canonicalSourceId:z.string().min(1).max(300)}).strict();
export const controlledTargetReview=z.discriminatedUnion("kind",[controlledChangedPriceReview,controlledPeriodReview]);
export type ControlledTargetReview=z.infer<typeof controlledTargetReview>;
export type ControlledTargetInput=z.infer<typeof controlledPeriodInput>|z.infer<typeof controlledProrationInput>;
export type ControlledProrationInput=z.infer<typeof controlledProrationInput>;
export type ControlledProrationReview=z.infer<typeof controlledProrationReview>;
export const controlledProrationAcceptance=z.object({quoteId:z.uuid(),resourceId:z.uuid(),previousTermsId:z.uuid(),acceptedQuoteDigest:sha,confirm:z.literal(true)}).strict();
export const controlledComponentProvenance=z.discriminatedUnion("kind",[
 z.object({kind:z.literal("net"),providerProductRef:reference,providerPreviewLineRef:reference,originalProviderItemRef:reference,originalProviderPriceRef:reference,canonicalCalculationDigest:sha}),
 z.object({kind:z.literal("merchant_declared_tax_collection"),providerProductRef:reference,taxQuoteDigest:sha,profileId:z.uuid(),profileVersion:z.number().int().positive()}),
 z.object({kind:z.literal("locked_canonical_credit"),creditNoteId:z.uuid(),applicationIds:z.array(z.uuid()).min(1).max(1000),canonicalDispositionDigest:sha}),
]);
export type ControlledComponentProvenance=z.infer<typeof controlledComponentProvenance>;
