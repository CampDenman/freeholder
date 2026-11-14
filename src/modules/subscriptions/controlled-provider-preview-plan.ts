// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Real original provider preview intent is nonfinancial and reserves no principal.
import { randomUUID } from "node:crypto";
import { eq,sql } from "drizzle-orm";
import { z } from "zod";
import { defineService,ServiceError } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptionCommercialTerms } from "./schema";
import { subscriptionControlledOperations } from "./controlled-provider-schema";
import { controlledCalendarSource } from "./controlled-provider-calendar-source";
import { controlledProrationInput } from "./controlled-provider-collection-contract";
import { controlledProrationCandidate } from "./controlled-provider-proration-economics";
export const planControlledProrationPreview=defineService({name:"subscriptions.planControlledProrationPreview",summary:"Freeze a real original native or no-proration NET preview from the actual current paused calendar and current shared original merchant offer; no issued invoice, credit or access is created.",
 kind:"mutation",permission:"system",external:false,writeClass:"money",auditInputFields:["id","resourceId","planId","kind","effectiveAt"],input:controlledProrationInput.extend({kind:z.enum(["preview_proration","preview_update"])}).strict(),output:z.object({operationId:z.uuid()}),handler:async(input,ctx)=>{
  const originalInput=controlledProrationInput.parse({id:input.id,resourceId:input.resourceId,planId:input.planId,productVariantId:input.productVariantId,effectiveAt:input.effectiveAt,taxDestination:input.taxDestination,locale:input.locale});
  const{resource,parent,previous,history,economic,currentParent:parentReady}=await controlledProrationCandidate(ctx,originalInput);
  if(history.count>=4995)throw new ServiceError("conflict","Retain bounded capacity for the genuine original preview call, facts, finish and verification.");
  const[originalTerms]=await ctx.tx.select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.id,resource.termsId)).limit(1);
  if(!originalTerms)throw new ServiceError("conflict","Restore the immutable original resource acceptance before its actual preview.");
  const source=controlledCalendarSource(history,resource.originalScope,previous,{providerProductRef:resource.originalScope.providerProductRef,principalMinor:economic.snapshot.periodAmountMinor,
   interval:economic.snapshot.interval,intervalCount:economic.snapshot.intervalCount},input.effectiveAt);
  const id=randomUUID();
  // Actual bank requests carry opaque commercial digests, never an immutable
  // copy of the buyer's private tax destination. The erasable quote owns it.
  const originalRequest=z.record(z.string(),z.unknown()).parse(JSON.parse(JSON.stringify({scopeDigest:merchantTaxDigest(resource.originalScope),payload:source.payload,requiredProtocol:"controlled_net_gross.v1",
   parentFinancialRevision:parentReady.revision,targetInputDigest:merchantTaxDigest(originalInput),economicQuoteDigest:economic.quoteDigest})));
  await ctx.tx.execute(sql`select set_config('freeholder.controlled_provider_v1','1',true)`);
  await ctx.tx.insert(subscriptionControlledOperations).values({id,resourceId:resource.id,kind:input.kind,ordinal:(history.operations.at(-1)?.ordinal??0)+1,originalRequest,requestDigest:merchantTaxDigest(originalRequest),
   idempotencyKey:`controlled:${resource.id}:${input.kind}:${id}`,previousEvidenceRevision:history.revision,acceptedQuoteDigest:originalTerms.acceptedQuoteDigest});
  ctx.setSubject("subscription",parent.id);return{operationId:id};
 }});
