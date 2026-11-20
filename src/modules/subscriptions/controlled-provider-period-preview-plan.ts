// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Actual native previews from original accepted normal terms, not a price change.
import { randomUUID } from "node:crypto";
import { eq,sql } from "drizzle-orm";
import { z } from "zod";
import { defineService } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptionCommercialTerms } from "./schema";
import { subscriptionControlledOperations } from "./controlled-provider-schema";
import { controlledPeriodInput } from "./controlled-provider-collection-contract";
import { controlledCalendarSource } from "./controlled-provider-calendar-source";
import { controlledPeriodSource,refuseControlledPeriod } from "./controlled-provider-period-source";
export const planControlledPeriodPreview=defineService({name:"subscriptions.planControlledPeriodPreview",summary:"Admit actual NET/native and no-proration previews for one exact original accepted trial-end or paid-period renewal; no credit, invoice or new consent is created.",kind:"mutation",permission:"system",external:false,writeClass:"money",auditInputFields:["id","resourceId","previewAt","kind"],
 input:controlledPeriodInput.extend({kind:z.enum(["preview_proration","preview_update"])}).strict(),output:z.object({operationId:z.uuid()}),handler:async(value,ctx)=>{
  const input=controlledPeriodInput.parse({id:value.id,resourceId:value.resourceId,previewAt:value.previewAt,locale:value.locale}),source=await controlledPeriodSource(ctx,input);if(source.history.count>=4995)refuseControlledPeriod();
  const calendar=controlledCalendarSource(source.history,source.resource.originalScope,source.terms,{providerProductRef:source.resource.originalScope.providerProductRef,principalMinor:source.terms.snapshot.periodAmountMinor,interval:source.terms.snapshot.interval,intervalCount:source.terms.snapshot.intervalCount},input.previewAt).payload;
  if(source.previewAt<new Date(calendar.originalPeriodStart)||source.previewAt>=new Date(calendar.originalPeriodEnd))refuseControlledPeriod();
  const[originalTerms]=await ctx.tx.select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.id,source.resource.termsId)).limit(1);if(!originalTerms)refuseControlledPeriod();
  const originalRequest=z.record(z.string(),z.unknown()).parse(JSON.parse(JSON.stringify({scopeDigest:merchantTaxDigest(source.resource.originalScope),payload:calendar,requiredProtocol:"controlled_net_gross.v1",parentFinancialRevision:source.currentParent.revision,
   targetInputDigest:merchantTaxDigest(input),economicQuoteDigest:source.terms.acceptedQuoteDigest,periodSourceId:source.sourceId,originalPeriodConsentDigest:source.terms.acceptedQuoteDigest})));
  const id=randomUUID();await ctx.tx.execute(sql`select set_config('freeholder.controlled_provider_v1','1',true)`);
  await ctx.tx.insert(subscriptionControlledOperations).values({id,resourceId:source.resource.id,kind:value.kind,ordinal:(source.history.operations.at(-1)?.ordinal??0)+1,originalRequest,requestDigest:merchantTaxDigest(originalRequest),idempotencyKey:`controlled:${source.resource.id}:${value.kind}:${id}`,previousEvidenceRevision:source.history.revision,acceptedQuoteDigest:originalTerms.acceptedQuoteDigest});
  ctx.setSubject("subscription",source.parent.id);return{operationId:id};
 }});
