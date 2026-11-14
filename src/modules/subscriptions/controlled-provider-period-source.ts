// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Actual original mandate, paid period or started trial; no fictitious proration.
import { and,desc,eq,sql } from "drizzle-orm";
import { ServiceError,type ServiceContext } from "@/core/service";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { moduleSettings } from "@/core/settings/schema";
import { invoices } from "@/modules/invoicing/schema";
import { invoiceSettled } from "@/modules/invoicing/invoice-balance";
import { previewMerchantTax,merchantTaxPreviewOutput } from "@/modules/invoicing/merchant-tax-preview";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptions,subscriptionMarketPolicies } from "./schema";
import { subscriptionProrations } from "./proration-schema";
import { subscriptionControlledResources } from "./controlled-provider-schema";
import { subscriptionControlledCollections,subscriptionControlledQuotes } from "./controlled-provider-collection-schema";
import { controlledPeriodInput } from "./controlled-provider-collection-contract";
import { controlledProviderJournal } from "./controlled-provider-proof";
import { controlledCollectionReadiness } from "./controlled-provider-readiness";
import { requireControlledCollectionSchema } from "./controlled-provider-collection-schema-guard";
import { originalMerchantTerms } from "./merchant-terms-read";
import { commercialBillingStart } from "./commercial-amendment-calendar";
import { reviewedControlledMethod } from "./controlled-provider-method";
import { periodEnd } from "./calendar";
import { originalProrationFeeReview } from "./proration-fee-review";
import type { z } from "zod";
export function refuseControlledPeriod():never{throw new ServiceError("conflict","Restore the actual started original trial or fully paid current period, unchanged accepted mandate/setup/tax/method and complete original bank/caller history before preparing its exact next paid period. No old trial principal, backdated replacement, fake phase or new consent can be inferred.");}
/** Contact→resource→parent prefix, then the genuine parent canonical graph.
 * The original initial-sale checkout is preserved: signupPending cannot create
 * a renewal resource or fabricate the paid period required by its admission. */
export async function controlledPeriodSource(ctx:ServiceContext,raw:z.input<typeof controlledPeriodInput>){
 const input=controlledPeriodInput.parse(raw);await lockContactIdentityForRead(ctx.tx);await requireControlledCollectionSchema(ctx);
 const[capability]=await ctx.tx.execute<{ready:boolean}>(sql`select to_regprocedure('freeholder_controlled_original_period_source(uuid)') is not null and exists(select 1 from pg_trigger where not tgisinternal and tgenabled in('O','A') and tgrelid=to_regclass('subscription_controlled_collections') and tgname='subscription_controlled_collections_period_birth') as ready`);
 if(!capability?.ready)throw new ServiceError("conflict","Install and qualify actual original-period mandate guards before any period preview or canonical promise.");
 await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`controlled-provider:${input.resourceId}`}))`);
 const[resource]=await ctx.tx.select().from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,input.resourceId)).limit(1).for("update");
 const[parent]=await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id,input.id)).limit(1).for("update");
 const[enabled]=await ctx.tx.select().from(moduleSettings).where(eq(moduleSettings.module,"subscriptions")).limit(1);
 const[policy]=await ctx.tx.select().from(subscriptionMarketPolicies).where(eq(subscriptionMarketPolicies.subscriptionId,input.id)).limit(1);
 if(!resource||!parent||resource.subscriptionId!==parent.id||parent.provider!=="stripe"||parent.billingMode!=="provider"||parent.merchantScopeVersion!==1||!enabled?.enabled
  ||parent.signupPending||parent.cancelledAt||parent.cancelAtPeriodEnd||!["active","trialing"].includes(parent.status)||policy?.model!=="seller_merchant"||!policy.sellerUserId||!policy.merchantContactId)refuseControlledPeriod();
 const calendar=await commercialBillingStart(ctx,parent);if(!calendar.ready)refuseControlledPeriod();
 const terms=await originalMerchantTerms(ctx,parent,calendar.start);if(!terms?.taxDestination||terms.snapshot.currency!==parent.currency||terms.snapshot.billingMode!=="provider")refuseControlledPeriod();
 const start=calendar.start,end=periodEnd(start,terms.snapshot.interval,terms.snapshot.intervalCount),previewAt=new Date(input.previewAt);
 if(!Number.isFinite(previewAt.getTime())||previewAt.getUTCMilliseconds()!==0||end<=start||end<=new Date()||previewAt>=end||start<parent.currentPeriodEnd)refuseControlledPeriod();
 const sourceId=`${parent.id}:${start.toISOString()}`;
 const[accepted]=await ctx.tx.select({collectionId:subscriptionControlledCollections.id}).from(subscriptionControlledCollections).innerJoin(subscriptionControlledQuotes,eq(subscriptionControlledQuotes.id,subscriptionControlledCollections.quoteId)).where(and(eq(subscriptionControlledQuotes.resourceId,resource.id),eq(subscriptionControlledQuotes.canonicalSourceId,sourceId))).limit(1);
 const[existingInvoice]=await ctx.tx.select().from(invoices).where(and(eq(invoices.sourceType,"subscription"),eq(invoices.sourceId,sourceId))).limit(1);
 if(accepted||existingInvoice)throw new ServiceError("conflict","This exact accepted period already owns its canonical target. Resume that original target rather than quote or issue it twice.");
 let originalInvoiceId:string|null=null;
 if(parent.status==="trialing"){
  if(!parent.trialEndsAt||parent.trialEndsAt.getTime()!==parent.currentPeriodEnd.getTime()||terms.snapshot.trialDays<=0||resource.originalScope.acceptedTrialEnd!==parent.trialEndsAt.toISOString())refuseControlledPeriod();
 }else{
  const[changed]=await ctx.tx.select().from(subscriptionProrations).where(and(eq(subscriptionProrations.subscriptionId,parent.id),eq(subscriptionProrations.state,"applied"),eq(subscriptionProrations.planId,parent.planId),eq(subscriptionProrations.proposedPeriodEnd,parent.currentPeriodEnd))).orderBy(desc(subscriptionProrations.effectiveAt)).limit(1);
  const[current]=changed?.debitInvoiceId?await ctx.tx.select().from(invoices).where(eq(invoices.id,changed.debitInvoiceId)).limit(1):await ctx.tx.select().from(invoices).where(and(eq(invoices.sourceType,"subscription"),eq(invoices.sourceId,`${parent.id}:${parent.currentPeriodStart.toISOString()}`))).limit(1);
  if(!current||current.status!=="paid"||!invoiceSettled(current)||current.refundedMinor!==0||current.contactId!==parent.contactId||current.currency!==parent.currency)refuseControlledPeriod();originalInvoiceId=current.id;
 }
 let setupMinor=parent.acceptedSetupFeeMinor??0;let originalSetupInvoice:typeof invoices.$inferSelect|null=null;
 if(parent.setupFeeInvoiceId){const[setup]=await ctx.tx.select().from(invoices).where(eq(invoices.id,parent.setupFeeInvoiceId)).limit(1);if(!setup||setup.status==="void"||setup.sourceType!=="subscription"||setup.sourceId?.split(":")[0]!==parent.id)refuseControlledPeriod();originalSetupInvoice=setup;setupMinor=0;}
 const method=await reviewedControlledMethod(ctx,parent,resource.originalScope),history=await controlledProviderJournal(ctx.tx,resource.id);if(history.unfinished.length||history.closures.length)refuseControlledPeriod();
 const tax=merchantTaxPreviewOutput.parse(await ctx.callAsSystem(previewMerchantTax,{profileId:terms.profileId,profileVersion:terms.profileVersion,contactId:parent.contactId,destination:terms.taxDestination,currency:parent.currency,
  items:[{id:"line:0",quantityMicros:1000000,unitAmountMinor:terms.snapshot.periodAmountMinor,discountMinor:0,category:terms.snapshot.taxCategoryCode,requiresShipping:terms.snapshot.requiresShipping},...(setupMinor>0?[{id:"line:1",quantityMicros:1000000,unitAmountMinor:setupMinor,discountMinor:0,category:terms.snapshot.taxCategoryCode,requiresShipping:terms.snapshot.requiresShipping}]:[])],shippingMinor:0,occurredAt:start}));
 const debitNetMinor=terms.snapshot.periodAmountMinor+setupMinor;if(!Number.isSafeInteger(debitNetMinor)||tax.amounts.subtotalMinor!==debitNetMinor||tax.amounts.totalMinor!==debitNetMinor+tax.amounts.taxMinor)refuseControlledPeriod();
 const feeReview=originalProrationFeeReview([],debitNetMinor,tax.amounts.totalMinor,0,policy.siteFeeBps),currentParent=await controlledCollectionReadiness(ctx,parent.id);
 return{input,resource,parent,policy,terms,planId:calendar.pending?.amendment.planId??parent.planId,start,end,previewAt,sourceId,originalInvoiceId,originalSetupInvoice,setupMinor,method,history,tax,feeReview,currentParent,debitNetMinor,
  economicsRevision:merchantTaxDigest({parentId:parent.id,planId:calendar.pending?.amendment.planId??parent.planId,originalPeriodStart:parent.currentPeriodStart,originalPeriodEnd:parent.currentPeriodEnd,originalTrialEnd:parent.trialEndsAt,originalInvoiceId,terms,policy,setupFeeInvoiceId:parent.setupFeeInvoiceId,originalSetupInvoice,setupMinor,start,end,methodDigest:method.methodDigest,taxQuoteDigest:tax.quoteDigest,tax:tax.amounts})};
}
