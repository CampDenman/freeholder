// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C9.38: exact activated commercial resumption, never an arbitrary date.
import { eq } from "drizzle-orm";
import { ServiceError,type ServiceContext } from "@/core/service";
import { commercialBillingStart } from "@/modules/subscriptions/commercial-amendment-calendar";
import { originalMerchantTerms } from "@/modules/subscriptions/merchant-terms-read";
import { subscriptionCommercialTerms } from "@/modules/subscriptions/schema";
import type { controlledCollectionState } from "@/modules/subscriptions/controlled-provider-collection-state";
import type { ControlledActivatedPeriodAmendment } from "./controlled-target-financial-policy";
import { merchantTaxDigest } from "./merchant-tax-store";
function refuse():never{throw new ServiceError("conflict","Restore the exact currently activated amendment, governing accepted terms and original parent boundary before collecting its explicitly reviewed later service period.");}
/** Caller already holds the real contact/resource/parent/canonical prefix.
 * Original parentStart/End paths retain their prior empty history shape. The
 * same existing calendar/terms readers used by the genuine factory determine
 * the later acceptance; no amount, current account or supplied date grants it. */
export async function readControlledPeriodAmendment(ctx:ServiceContext,source:Awaited<ReturnType<typeof controlledCollectionState>>){
 if(source.collection.kind!=="period")refuse();
 const{parent,terms,review}=source,start=review.calendar.proposedPeriodStart;
 if(start===parent.currentPeriodStart.toISOString()||start===parent.currentPeriodEnd.toISOString())return null;
 const calendar=await commercialBillingStart(ctx,parent),pending=calendar.pending;
 if(!calendar.ready||!pending||pending.amendment.state!=="activated"||!pending.amendment.activatedAt||pending.amendment.subscriptionId!==parent.id
  ||pending.amendment.planId!==parent.pendingPlanId||pending.amendment.termsId!==terms.id||pending.terms.id!==terms.id||pending.terms.subscriptionId!==parent.id
  ||pending.terms.acceptanceSource!=="amendment"||pending.terms.previousTermsId!==pending.amendment.previousTermsId||pending.amendment.acceptedQuoteDigest!==pending.terms.acceptedQuoteDigest
  ||pending.terms.acceptedQuoteDigest!==terms.acceptedQuoteDigest||pending.terms.redactedAt!==null||calendar.start.toISOString()!==start||pending.terms.effectivePeriodStart.toISOString()!==start
  ||calendar.start<=parent.currentPeriodEnd)refuse();
 const accepted=await originalMerchantTerms(ctx,parent,calendar.start);
 const[previous]=await ctx.tx.select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.id,pending.amendment.previousTermsId)).limit(1);
 if(!accepted||accepted.id!==terms.id||accepted.acceptedQuoteDigest!==terms.acceptedQuoteDigest||!previous||previous.subscriptionId!==parent.id||previous.id===terms.id||previous.revision+1!==pending.terms.revision)refuse();
 const evidence:ControlledActivatedPeriodAmendment={subscriptionId:parent.id,termsId:terms.id,previousTermsId:previous.id,planId:pending.amendment.planId,state:"activated",activatedAt:pending.amendment.activatedAt.toISOString(),effectivePeriodStart:start,acceptedQuoteDigest:terms.acceptedQuoteDigest};
 return{evidence,revision:merchantTaxDigest({parentId:parent.id,pendingPlanId:parent.pendingPlanId,originalStart:parent.currentPeriodStart,originalEnd:parent.currentPeriodEnd,governingTerms:accepted,previousTerms:previous,amendment:pending.amendment})};
}
