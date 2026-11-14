// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Actual provider reads/preview happen outside the canonical quote transaction.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { translator } from "@/core/i18n";
import { defineService,defineOrchestratedService,type Actor } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { publicMerchantTermsQuote } from "./merchant-terms-quote-contract";
import { controlledProrationInput,controlledChangedPriceReview,controlledProrationCalendar } from "./controlled-provider-collection-contract";
import { subscriptionControlledQuotes } from "./controlled-provider-collection-schema";
import { controlledTargetQuoteDigest,authenticatedControlledQuote } from "./controlled-provider-quote-proof";
import { controlledProrationCandidate,prepareControlledProrationEconomics } from "./controlled-provider-proration-economics";
import { planControlledProrationPreview } from "./controlled-provider-preview-plan";
import { planControlledProviderOperation } from "./controlled-provider-plan";
import { executeControlledOperation } from "./controlled-provider-execution";
import { ownGrossProration } from "./proration-quote";
const evidence=z.object({nativeOperationId:z.uuid(),updateOperationId:z.uuid(),customerOperationId:z.uuid(),calendarOperationId:z.uuid()}).strict();
/** Current complete financial revision is historical quote evidence, never a
 * reservation. Acceptance must recompute safety and unchanged source economics. */
export const retainControlledProrationQuote=defineService({name:"subscriptions.retainControlledProrationQuote",summary:"Retain actual original NET previews, dated shared canonical tax, original paid credit and explicit provider calendar/method/fee disposition without creating an invoice, credit reservation or payment mandate.",
 kind:"mutation",permission:"system",external:false,writeClass:"money",auditInputFields:["evidence"],input:z.object({input:controlledProrationInput,evidence}).strict(),output:controlledChangedPriceReview,handler:async({input,evidence},ctx)=>{
  const source=await prepareControlledProrationEconomics(ctx,input,evidence),{parent,previous,resource,basis,economic,actual,request,feeReview}=source;
  const quoteId=randomUUID(),plannedProrationId=randomUUID(),plannedCollectionId=randomUUID();
  const calendar=controlledProrationCalendar.parse({kind:"controlled_provider",prorationAt:input.effectiveAt,originalApplicationPeriodStart:parent.currentPeriodStart.toISOString(),originalApplicationPeriodEnd:parent.currentPeriodEnd.toISOString(),
   originalProviderPeriodStart:request.originalPeriodStart,originalProviderPeriodEnd:request.originalPeriodEnd,proposedPeriodStart:actual.proposedPeriodStart,proposedPeriodEnd:actual.proposedPeriodEnd,
   expectedProviderPeriodStart:actual.expectedProviderPeriodStart,expectedProviderPeriodEnd:actual.expectedProviderPeriodEnd,originalBillingAnchor:request.originalAnchor,expectedProviderBillingAnchor:actual.expectedProviderBillingAnchor,
   originalProviderTrialEndsAt:request.originalProviderTrialEnd,expectedProviderTrialEndsAt:actual.expectedProviderTrialEndsAt,requestedAnchor:"unchanged",originalTrialEndsAt:parent.trialEndsAt?.toISOString()??null,proposedTrialEndsAt:parent.trialEndsAt?.toISOString()??null,
   nativePreviewRef:source.actualNative.providerPreviewRef,controlledUpdatePreviewRef:source.actualUpdate.providerPreviewRef,nativeCurrentDebitMinor:actual.nativeCurrentDebitMinor,nativeUnusedCreditMinor:actual.nativeUnusedCreditMinor,nativeRenewalForecastMinor:actual.nativeRenewalForecastMinor,
   nativeForecasts:actual.forecasts.map(row=>({providerLineRef:row.providerLineRef,amountMinor:row.amountMinor,periodStart:row.periodStart,periodEnd:row.periodEnd,proration:row.proration})),nativeEstimateIsCollection:false,
   merchantTaxAuthority:"canonical_merchant_tax_ledger",fixedTaxRequiredBeforeCollection:true,collectionPolicy:"canonical_gross_target_locked_credit_no_wallet"});
  const t=translator(input.locale),noticeSnapshot={locale:input.locale,text:`${economic.noticeSnapshot.text}\n${t("subscriptions.proration.controlledNotice")}\n${t("subscriptions.proration.feeReceivableNotice")}\n${t("subscriptions.proration.boundaryNotice")}\n${t("subscriptions.proration.cardNotice",{method:source.method.summary.label})}`};
  const debitNetMinor=actual.debitNetMinor,debitTaxMinor=source.debitTaxQuote.taxMinor,creditAppliedMinor=source.creditAppliedMinor,cashDueMinor=source.cashDueMinor;
  const review=controlledChangedPriceReview.parse({kind:"proration",canonicalSourceId:`${parent.id}:proration:${plannedProrationId}`,subscriptionId:parent.id,previousTermsId:previous.id,quoteDigest:"0".repeat(64),sourceRevision:source.sourceRevision,effectiveAt:input.effectiveAt,
   originalPeriodStart:parent.currentPeriodStart.toISOString(),originalPeriodEnd:parent.currentPeriodEnd.toISOString(),originalTrialEndsAt:parent.trialEndsAt?.toISOString()??null,calendar,
   debitNetMinor,debitTaxMinor,creditNetMinor:basis.creditNetMinor,creditTaxMinor:basis.creditTaxMinor,creditAppliedMinor,cashDueMinor,residualCreditMinor:source.residualCreditMinor,
   creditDisposition:"exclusive_until_paid_access_switch_no_automatic_cash_refund",requiresMerchantReview:feeReview.originalOverTargetMinor>0||feeReview.sources.some(row=>row.feeUnexpected||row.feeCollectionState==="review"),feeReview,payment:null,
   collectionMethod:{kind:"original_saved_method",summary:source.method.summary},quote:publicMerchantTermsQuote.unwrap().parse(economic),noticeSnapshot,
   controlled:{quoteId,resourceId:resource.id,plannedProrationId,plannedCollectionId,protocol:"controlled_net_gross.v1",methodDigest:source.method.methodDigest,quotedParentRevision:source.currentParentRevision,
    calendarReadOperationId:evidence.calendarOperationId,customerFinancialOperationId:evidence.customerOperationId,nativePreviewOperationId:evidence.nativeOperationId,updatePreviewOperationId:evidence.updateOperationId,
    nativeActualEvidenceDigest:source.native.verified.actualResultDigest,controlledUpdateActualEvidenceDigest:source.update.verified.actualResultDigest,customerFinancialDigest:z.string().regex(/^[a-f0-9]{64}$/).parse(source.customer.verified.actualResult.inventoryDigest),
    economicTargetDigest:merchantTaxDigest({debitNetMinor,debitTaxMinor,creditAppliedMinor,cashDueMinor,calendar,feeReview})}});
  review.quoteDigest=controlledTargetQuoteDigest(input,review,economic.profile.profileId,economic.profile.profileVersion);
  const row={id:quoteId,kind:"proration" as const,canonicalSourceId:review.canonicalSourceId,resourceId:resource.id,previousTermsId:previous.id,plannedProrationId,plannedCollectionId,
   profileId:economic.profile.profileId,profileVersion:economic.profile.profileVersion,calendarReadOperationId:evidence.calendarOperationId,customerFinancialOperationId:evidence.customerOperationId,nativePreviewOperationId:evidence.nativeOperationId,updatePreviewOperationId:evidence.updateOperationId,
   input,review,inputDigest:merchantTaxDigest(input),reviewDigest:merchantTaxDigest(review),redactedAt:null,quotedParentRevision:source.currentParentRevision,sourceRevision:source.sourceRevision,quoteDigest:review.quoteDigest,effectiveAt:source.effectiveAt,createdAt:new Date()};
  authenticatedControlledQuote(row,resource,source.history);
  await ctx.tx.execute(sql`select set_config('freeholder.controlled_collection_v1','1',true)`);await ctx.tx.insert(subscriptionControlledQuotes).values(row);
  ctx.setSubject("subscription",parent.id);return review;
 }});
export const assertMyControlledProrationQuoteAccess=defineService({name:"subscriptions.assertMyControlledProrationQuoteAccess",summary:"Verify the actual signed-in buyer and public original merchant plan before any controlled preview I/O.",
 kind:"query",permission:"authenticated",external:false,input:z.object({id:z.uuid(),planId:z.uuid()}).strict(),output:z.literal(true),handler:async(input,ctx)=>{await ownGrossProration(ctx,input.id,input.planId);return true as const;}});
export const assertControlledProrationPreviewSource=defineService({name:"subscriptions.assertControlledProrationPreviewSource",summary:"Prove exact original resource/subscription ownership and a fresh real unused-period instant before any provider preview read.",
 kind:"query",permission:"system",external:false,auditInputFields:["id","resourceId","planId","effectiveAt"],input:controlledProrationInput,output:z.literal(true),handler:async(input,ctx)=>{
  await controlledProrationCandidate(ctx,input);return true as const;
 }});
async function quote(input:z.infer<typeof controlledProrationInput>,actor:Actor){
 const system={kind:"system",request:actor.request} as const;
 await assertControlledProrationPreviewSource.call(input,system);
 // The planner returns the same original creation operation on retry. A lost
 // admitted POST is never repeated; execute requires genuine result/recovery.
 const taxProduct=await planControlledProviderOperation.call({resourceId:input.resourceId,kind:"create_product"},system);await executeControlledOperation(taxProduct.operationId,actor);
 const taxRead=await planControlledProviderOperation.call({resourceId:input.resourceId,kind:"read_product"},system);await executeControlledOperation(taxRead.operationId,actor);
 const calendar=await planControlledProviderOperation.call({resourceId:input.resourceId,kind:"read_calendar"},system);await executeControlledOperation(calendar.operationId,actor);
 const customer=await planControlledProviderOperation.call({resourceId:input.resourceId,kind:"read_customer_financials"},system);await executeControlledOperation(customer.operationId,actor);
 const native=await planControlledProrationPreview.call({...input,kind:"preview_proration"},system);await executeControlledOperation(native.operationId,actor);
 const update=await planControlledProrationPreview.call({...input,kind:"preview_update"},system);await executeControlledOperation(update.operationId,actor);
 return retainControlledProrationQuote.call({input,evidence:{calendarOperationId:calendar.operationId,customerOperationId:customer.operationId,nativeOperationId:native.operationId,updateOperationId:update.operationId}},system);
}
export const quoteControlledProration=defineOrchestratedService({name:"subscriptions.quoteControlledProration",summary:"Review a genuine current provider NET preview and exact canonical gross proration before changed-price consent, preserving all actual caller/financial recovery debt.",
 kind:"mutation",permission:"scoped",writeClass:"money",input:controlledProrationInput,output:controlledChangedPriceReview,auditInputFields:["id","resourceId","planId","effectiveAt"],handler:quote});
export const quoteMyControlledProration=defineOrchestratedService({name:"subscriptions.quoteMyControlledProration",summary:"Review only your own original provider agreement's actual proration, dated tax, saved method and explicit calendar/credit disposition.",
 kind:"mutation",permission:"authenticated",writeClass:"money",input:controlledProrationInput,output:controlledChangedPriceReview,auditInputFields:["id","resourceId","planId","effectiveAt"],handler:async(input,actor)=>{
  await assertMyControlledProrationQuoteAccess.call({id:input.id,planId:input.planId},actor);return{...await quote(input,actor),feeReview:null};
 }});
