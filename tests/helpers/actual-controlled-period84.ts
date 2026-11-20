// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN. Every parent, invoice, receipt and grant uses actual services.
import { eq } from "drizzle-orm";
import { vi } from "vitest";
import * as paymentAdapters from "@/adapters/payments";
import { db } from "@/core/db";
import { saveEntitlement,syncSubscriptionAccess } from "@/core/entitlements/service";
import { entitlementGrants } from "@/core/entitlements/schema";
import { subscriptions } from "@/modules/subscriptions/schema";
import { prepareControlledProviderCalendar } from "@/modules/subscriptions/controlled-provider-execution";
import { quoteControlledPeriod } from "@/modules/subscriptions/controlled-provider-period-quote";
import { prepareControlledPeriodTarget } from "@/modules/subscriptions/controlled-provider-period-target";
import { seedActualProviderSubscription80 } from "./merchant-subscription80";
import { controlledCollectionEdge84 } from "./merchant-controlled-collection84";
import { OWNER } from "./spine";
export async function actualControlledPeriod84(options:Parameters<typeof controlledCollectionEdge84>[0]={}){
 // The accepted ordinary day really began earlier. Its next ORIGINAL period
 // has started but has not ended; never fake the database pay-before-start
 // clock or rewrite accepted dates to make finalization pass.
 vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(Math.floor(Date.now()/1000)*1000-129600000);
 let seeded:Awaited<ReturnType<typeof seedActualProviderSubscription80>>|undefined;
 try{seeded=await seedActualProviderSubscription80({paidProrationDay:true});}finally{vi.useRealTimers();}
 const original=seeded;if(!original)throw Error("The actual original producer did not return its agreement.");
 try{
  const remote=controlledCollectionEdge84(options);vi.spyOn(paymentAdapters,"paymentAdapter").mockReturnValue(remote.provider);
  const id=original.accepted.subscription.id,[parent]=await db().select().from(subscriptions).where(eq(subscriptions.id,id));if(!parent)throw Error("The actual paid original parent is required.");
  const previousGrants=await db().select().from(entitlementGrants).where(eq(entitlementGrants.sourceSubscriptionId,id));
  if(!previousGrants.length)throw Error("The genuine original paid subscription must already have its access catalogue.");
  const addedEntitlement=await saveEntitlement.call({grantorType:"plan",grantorId:parent.planId,name:"Actual original paid access",resource:{kind:"page",selector:"actual-controlled-original"}},OWNER);
  await syncSubscriptionAccess.call({subscriptionId:id,contactId:parent.contactId,planId:parent.planId,planName:original.plan.name,startsAt:parent.currentPeriodStart,endsAt:parent.currentPeriodEnd,status:"active"},{kind:"system"});
  const grants=await db().select().from(entitlementGrants).where(eq(entitlementGrants.sourceSubscriptionId,id));
  const addedGrants=grants.filter(row=>row.entitlementId===addedEntitlement.id),added=addedGrants[0];
  const originalCataloguePreserved=previousGrants.every(original=>grants.some(current=>current.id===original.id&&current.entitlementId===original.entitlementId&&current.contactId===original.contactId&&current.sourceSubscriptionId===original.sourceSubscriptionId
   &&current.startsAt.getTime()===original.startsAt.getTime()&&(current.endsAt?.getTime()??null)===(original.endsAt?.getTime()??null)&&current.used===original.used&&current.status===original.status));
  if(grants.length!==previousGrants.length+1||!originalCataloguePreserved||addedGrants.length!==1||!added||added.contactId!==parent.contactId||added.sourceSubscriptionId!==id||added.status!=="active"||added.used!==0
   ||added.startsAt.getTime()!==parent.currentPeriodStart.getTime()||added.endsAt?.getTime()!==parent.currentPeriodEnd.getTime())throw Error("Preserve the full actual original paid catalogue and its dates/used counters alongside the one genuine added page grant.");
  const prepared=await prepareControlledProviderCalendar.call({subscriptionId:id},OWNER);
  const review=await quoteControlledPeriod.call({id,resourceId:prepared.resourceId,previewAt:remote.previewAt().toISOString(),locale:"en"},OWNER);
  const target=await prepareControlledPeriodTarget.call({quoteId:review.controlled.quoteId,resourceId:prepared.resourceId},OWNER);
  return{original,remote,parent,grants,review,target,cleanup:()=>original.fixture.cleanup()};
 }catch(error){original.fixture.cleanup();throw error;}
}
