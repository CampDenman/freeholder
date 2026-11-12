// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: a buyer's changed exemption cannot leave original remote phases live.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { contacts } from "@/core/contacts/schema";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { lockMerchantExemptionPolicy } from "@/core/commerce/merchant-exemption-lock";
import { defineService, ServiceError } from "@/core/service";
import { merchantTaxProfiles } from "@/modules/invoicing/merchant-tax-schema";
import { merchantAgreementScheduleState } from "./merchant-tax-quiescence";
import { merchantScheduleCohortInventoryCovers } from "./provider-schedule-cohorts";
import { subscriptionProviderScheduleErasures, subscriptionProviderScheduleResources } from "./provider-schedule-schema";
import { subscriptionMerchantScopes, subscriptions } from "./schema";

export const assertMerchantTaxExemptionRevisionSafe=defineService({
  name:"subscriptions.assertMerchantTaxExemptionRevisionSafe",summary:"Require actual original profile-and-buyer schedule quiescence before changing effective exemption evidence.",
  kind:"query",permission:"system",external:false,input:z.object({profileId:z.uuid(),contactId:z.uuid()}),output:z.object({safe:z.literal(true)}),
  handler:async({profileId,contactId},ctx)=>{
    await lockContactIdentityForRead(ctx.tx);
    await lockMerchantExemptionPolicy(ctx.tx,profileId,contactId);
    const [profile]=await ctx.tx.select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id,profileId)).limit(1).for("share");
    const [person]=await ctx.tx.select({source:contacts.source}).from(contacts).where(eq(contacts.id,contactId)).limit(1).for("share");
    if(!profile||profile.state!=="active"||!person||person.source==="privacy-erasure")throw new ServiceError("conflict","Restore the actual business and buyer before changing their tax evidence.");
    const agreements=await ctx.tx.select({subscription:subscriptions,scope:subscriptionMerchantScopes,resource:subscriptionProviderScheduleResources})
      .from(subscriptionMerchantScopes).innerJoin(subscriptions,eq(subscriptions.id,subscriptionMerchantScopes.subscriptionId))
      .leftJoin(subscriptionProviderScheduleResources,eq(subscriptionProviderScheduleResources.subscriptionId,subscriptions.id))
      .where(eq(subscriptionMerchantScopes.taxProfileId,profileId)).orderBy(subscriptions.id).limit(5001);
    const cohorts=await ctx.tx.select().from(subscriptionProviderScheduleErasures).where(eq(subscriptionProviderScheduleErasures.profileId,profileId)).orderBy(subscriptionProviderScheduleErasures.id).limit(5001);
    if(agreements.length>5000||cohorts.length>5000)throw new ServiceError("conflict","The original tax dependency inventory requires bounded recovery before this decision.");
    const inventory=new Set(agreements.map(row=>row.subscription.id));
    for(const cohort of cohorts)if(!await merchantScheduleCohortInventoryCovers(ctx.tx,cohort,inventory))throw new ServiceError("conflict","Restore the retained original agreement inventory before changing buyer tax evidence.");
    for(const agreement of agreements.filter(row=>row.subscription.contactId===contactId)){
      if(agreement.resource?.recoveryPending||agreement.resource?.state==="uncreated"&&(agreement.resource.evidenceRevision!==0||agreement.resource.stoppedProof!==null)
        ||!(await merchantAgreementScheduleState(ctx,agreement)).safe)throw new ServiceError("conflict","Stop and reconcile this buyer's original external schedules before changing effective tax evidence.");
    }
    return {safe:true as const};
  },
});
