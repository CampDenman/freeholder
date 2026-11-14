// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// No invoice/PI/credit object represents an uncharged original trial.
import { randomUUID } from "node:crypto";
import { eq,sql } from "drizzle-orm";
import { z } from "zod";
import { ServiceError,type ServiceContext } from "@/core/service";
import { moduleSettings } from "@/core/settings/schema";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptionCommercialTerms } from "./schema";
import { subscriptionControlledOperations } from "./controlled-provider-schema";
import { controlledCashlessCollectionState } from "./controlled-provider-cashless-state";
import { controlledCalendarSource } from "./controlled-provider-calendar-source";
import { controlledCalendarPayload } from "./controlled-provider-adapter-contract";
import { controlledTargetFinancialAuthority } from "./controlled-provider-target-authority";
import { controlledCollectionReadiness } from "./controlled-provider-readiness";
/** Resource and actual parent were locked by the shared collection planner.
 * Parent current target authority must explicitly implement this cashless ABI;
 * its missing/refused branch remains a mechanical refusal, never a fallback. */
export async function planControlledCashlessUpdate(ctx:ServiceContext,collectionId:string){
 const source=await controlledCashlessCollectionState(ctx.tx,collectionId),{parent,collection,quote,review,resource,history}=source;
 const[enabled]=await ctx.tx.select().from(moduleSettings).where(eq(moduleSettings.module,"subscriptions")).limit(1);
 if(!enabled?.enabled||parent.status!=="trialing"||parent.trialEndsAt?.toISOString()!==review.originalTrialEndsAt||parent.currentPeriodStart.getTime()!==source.proration.originalPeriodStart.getTime()
  ||parent.currentPeriodEnd.getTime()!==source.proration.originalPeriodEnd.getTime()||parent.pendingPlanId!==source.proration.planId||parent.cancelledAt||parent.cancelAtPeriodEnd||new Date()>=quote.effectiveAt
  ||history.unfinished.length||history.closures.length||history.count>=4995||history.operations.some(op=>op.kind==="update_calendar"&&op.originalRequest.payload&&typeof op.originalRequest.payload==="object"&&Reflect.get(op.originalRequest.payload,"collectionId")===collection.id))
  throw new ServiceError("conflict","Preserve this actual uncharged trial end and recover its original price update/callers before any successor request; never bill the trial window or replay its POST.");
 const money=await controlledTargetFinancialAuthority(ctx,collection.id,"update_calendar"),parentReadiness=await controlledCollectionReadiness(ctx,parent.id);
 const target={providerProductRef:resource.originalScope.providerProductRef,principalMinor:review.quote.snapshot.periodAmountMinor,interval:review.quote.snapshot.interval,intervalCount:review.quote.snapshot.intervalCount};
 const calendar=controlledCalendarSource(history,resource.originalScope,source.terms,target,review.effectiveAt).payload;
 const payload=controlledCalendarPayload.extend({acceptedQuoteDigest:z.string(),collectionId:z.uuid()}).parse({...calendar,acceptedQuoteDigest:collection.acceptedQuoteDigest,collectionId:collection.id});
 const[originalTerms]=await ctx.tx.select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.id,resource.termsId)).limit(1);
 if(!originalTerms)throw new ServiceError("conflict","Retain the immutable original resource acceptance before its genuine future trial-price update.");
 const id=randomUUID(),originalRequest=z.record(z.string(),z.unknown()).parse(JSON.parse(JSON.stringify({scopeDigest:merchantTaxDigest(resource.originalScope),payload,requiredProtocol:"controlled_net_gross.v1",parentFinancialRevision:parentReadiness.revision,targetFinancialRevision:money.revision})));
 await ctx.tx.execute(sql`select set_config('freeholder.controlled_provider_v1','1',true)`);
 await ctx.tx.insert(subscriptionControlledOperations).values({id,resourceId:resource.id,kind:"update_calendar",ordinal:(history.operations.at(-1)?.ordinal??0)+1,originalRequest,requestDigest:merchantTaxDigest(originalRequest),
  idempotencyKey:`controlled:${resource.id}:update_calendar:${id}`,previousEvidenceRevision:history.revision,acceptedQuoteDigest:originalTerms.acceptedQuoteDigest});
 ctx.setSubject("subscription",parent.id);return{operationId:id};
}
