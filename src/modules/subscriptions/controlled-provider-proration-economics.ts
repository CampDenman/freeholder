// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Real original provider preview + unchanged canonical principal/tax/fee engines.
import { and,desc,eq,inArray,sql } from "drizzle-orm";
import { ServiceError,type ServiceContext } from "@/core/service";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { dataRequests,privacyRetentionExceptions } from "@/core/privacy/schema";
import { moduleSettings } from "@/core/settings/schema";
import { previewMerchantTax,merchantTaxPreviewOutput } from "@/modules/invoicing/merchant-tax-preview";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptions,subscriptionCommercialTerms,subscriptionMarketPolicies } from "./schema";
import { subscriptionProrations } from "./proration-schema";
import { subscriptionProviderScheduleResources,subscriptionProviderScheduleOperations } from "./provider-schedule-schema";
import { verifiedPreparatoryPhaseProducts } from "./provider-phase-product-proof";
import { subscriptionControlledResources } from "./controlled-provider-schema";
import { controlledProviderJournal } from "./controlled-provider-proof";
import { controlledCalendarPayload } from "./controlled-provider-adapter-contract";
import { controlledActualPreview } from "./controlled-provider-preview-contract";
import { controlledNativeAmounts } from "./controlled-provider-native-amounts";
import { controlledCollectionReadiness } from "./controlled-provider-readiness";
import { controlledProrationInput,type ControlledProrationInput } from "./controlled-provider-collection-contract";
import { merchantTermsQuoteOutput,quoteOriginalMerchantTerms } from "./merchant-terms-quote";
import { subscriptionInitialTaxQuote } from "./merchant-terms-contract";
import { reviewedControlledMethod } from "./controlled-provider-method";
import { paidProrationBasis } from "./proration-basis";
import { originalProrationFeeReview } from "./proration-fee-review";
import { requireAgreementFeeSchema } from "@/modules/invoicing/agreement-fee-store";
import { requireProrationBoundarySchema } from "./proration-boundary";
import { requireGrossProrationSchema } from "./proration-quote";
import { requireControlledCollectionSchema } from "./controlled-provider-collection-schema-guard";
function refuse():never{throw new ServiceError("conflict","Restore current complete original principal, accepted merchant terms, actual native/update evidence and dated canonical tax before another controlled quote or acceptance.");}
/** No SDK or separate transaction. Called once to quote, then again under
 * original payment/invoice/note locks at acceptance. The latter checks actual
 * current safety and identical economics; its full parent revision is new
 * evidence and never silently replaces historical quotedParentRevision. */
export async function controlledProrationCandidate(ctx:ServiceContext,rawInput:ControlledProrationInput){
 const input=controlledProrationInput.parse(rawInput);await lockContactIdentityForRead(ctx.tx);await requireGrossProrationSchema(ctx);await requireAgreementFeeSchema(ctx);await requireProrationBoundarySchema(ctx);await requireControlledCollectionSchema(ctx);
 await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`controlled-provider:${input.resourceId}`}))`);
 const[resource]=await ctx.tx.select().from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,input.resourceId)).limit(1).for("update");
 const[parent]=await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id,input.id)).limit(1).for("update");
 const[enabled]=await ctx.tx.select().from(moduleSettings).where(eq(moduleSettings.module,"subscriptions")).limit(1);
 const[previous]=await ctx.tx.select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.subscriptionId,input.id)).orderBy(desc(subscriptionCommercialTerms.revision)).limit(1);
 const[policy]=await ctx.tx.select().from(subscriptionMarketPolicies).where(eq(subscriptionMarketPolicies.subscriptionId,input.id)).limit(1);
 if(!resource||!parent||!previous||!policy?.merchantContactId||!policy.sellerUserId||policy.model!=="seller_merchant"||resource.subscriptionId!==parent.id||parent.billingMode!=="provider"
  ||!enabled?.enabled||parent.signupPending||parent.pendingPlanId||parent.cancelledAt||parent.cancelAtPeriodEnd||!["active","trialing"].includes(parent.status)||previous.snapshot.proration!=="create_prorations")refuse();
 const[pending]=await ctx.tx.select({id:subscriptionProrations.id}).from(subscriptionProrations).where(and(eq(subscriptionProrations.subscriptionId,parent.id),
  inArray(subscriptionProrations.state,["accepted","preparing","awaiting_invoice","awaiting_payment","awaiting_effective","review"]))).limit(1);
 if(pending)refuse();
 const[legacy]=await ctx.tx.select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId,parent.id)).limit(1);
 const legacyOperations=await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.subscriptionId,parent.id)).orderBy(subscriptionProviderScheduleOperations.operationRevision).limit(5001);
 if(!legacy||legacyOperations.length>5000||!verifiedPreparatoryPhaseProducts(legacy,legacyOperations))refuse();
 const people=[parent.contactId,policy.merchantContactId];
 const[erasure]=await ctx.tx.select({id:dataRequests.id}).from(dataRequests).where(and(inArray(dataRequests.contactId,people),eq(dataRequests.kind,"erasure"),sql`${dataRequests.verifiedAt} is not null`,
  inArray(dataRequests.status,["verified","in_progress","completed","partially_completed"]))).limit(1);
 const[hold]=await ctx.tx.select({id:privacyRetentionExceptions.id}).from(privacyRetentionExceptions).innerJoin(dataRequests,eq(dataRequests.id,privacyRetentionExceptions.dataRequestId)).where(and(
  inArray(dataRequests.contactId,people),inArray(privacyRetentionExceptions.scope,["commerce.money","commerce.merchantTax","subscriptions.agreements","privacy.records"]),
  sql`(${privacyRetentionExceptions.expiresAt} is null or ${privacyRetentionExceptions.expiresAt}>clock_timestamp())`)).limit(1);
 if(erasure||hold)refuse();
 const effectiveAt=new Date(input.effectiveAt);if(!Number.isSafeInteger(effectiveAt.getTime())||effectiveAt.getTime()%1000!==0)refuse();
 const basis=await paidProrationBasis(ctx,parent,effectiveAt),history=await controlledProviderJournal(ctx.tx,resource.id);
 if(history.unfinished.length||history.closures.length)refuse();
 const economic=merchantTermsQuoteOutput.unwrap().parse(await ctx.callAsSystem(quoteOriginalMerchantTerms,{planId:input.planId,productVariantId:input.productVariantId,taxDestination:input.taxDestination,
  contactId:parent.contactId,currency:parent.currency,locale:input.locale,paymentMethodId:parent.paymentMethodId??undefined,amendmentFor:parent.id,calendarStart:parent.currentPeriodEnd}));
 if(economic.snapshot.billingMode!=="provider"||economic.profile.profileId!==previous.profileId)refuse();
 const[appliedPrevious]=await ctx.tx.select({id:subscriptionProrations.id}).from(subscriptionProrations).where(and(eq(subscriptionProrations.termsId,previous.id),eq(subscriptionProrations.state,"applied"))).limit(1);
 if(previous.effectivePeriodStart>=parent.currentPeriodEnd&&!appliedPrevious)refuse();
 const method=await reviewedControlledMethod(ctx,parent,resource.originalScope),currentParent=await controlledCollectionReadiness(ctx,parent.id);
 return{input,resource,parent,previous,policy,economic,basis,effectiveAt,history,method,currentParent};
}
export async function prepareControlledProrationEconomics(ctx:ServiceContext,rawInput:ControlledProrationInput,evidence:{nativeOperationId:string;updateOperationId:string;customerOperationId:string;calendarOperationId:string}){
 const{input,resource,parent,previous,policy,economic,basis,effectiveAt,history,method,currentParent}=await controlledProrationCandidate(ctx,rawInput);
 function original(id:string,kind:string){const operation=history.operations.find(row=>row.id===id),verified=history.verifications.find(row=>row.operationId===id);
  if(!operation||operation.kind!==kind||!verified)refuse();return{operation,verified};}
 const native=original(evidence.nativeOperationId,"preview_proration"),update=original(evidence.updateOperationId,"preview_update"),customer=original(evidence.customerOperationId,"read_customer_financials"),calendar=original(evidence.calendarOperationId,"read_calendar");
 for(const source of [native,update])if(source.operation.originalRequest.targetInputDigest!==merchantTaxDigest(input)||source.operation.originalRequest.economicQuoteDigest!==economic.quoteDigest)refuse();
 const request=controlledCalendarPayload.parse(native.operation.originalRequest.payload),updateRequest=controlledCalendarPayload.parse(update.operation.originalRequest.payload);
 if(merchantTaxDigest(request)!==merchantTaxDigest(updateRequest)||request.currentReadDigest!==calendar.verified.actualResult.currentReadDigest
  ||request.target.principalMinor!==economic.snapshot.periodAmountMinor||request.target.interval!==economic.snapshot.interval||request.target.intervalCount!==economic.snapshot.intervalCount
  ||request.providerSubscriptionRef!==calendar.verified.actualResult.providerSubscriptionRef||calendar.verified.actualResult.collectionPausedAsDraft!==true
  ||customer.verified.actualResult.providerCustomerRef!==resource.originalScope.providerCustomerRef||customer.verified.actualResult.balanceState!=="known_zero"||customer.verified.actualResult.completeCreditNotes!==true)refuse();
 const actualNative=controlledActualPreview.parse(native.verified.actualResult),actualUpdate=controlledActualPreview.parse(update.verified.actualResult);
 const actual=controlledNativeAmounts({...resource.originalScope,...request,operationId:native.operation.id,requestDigest:native.operation.requestDigest,idempotencyKey:native.operation.idempotencyKey},actualNative,actualUpdate);
 if(actual.trial!==(parent.status==="trialing"))refuse();
 const actualTax=merchantTaxPreviewOutput.parse(await ctx.callAsSystem(previewMerchantTax,{profileId:economic.profile.profileId,profileVersion:economic.profile.profileVersion,contactId:parent.contactId,destination:economic.taxDestination,currency:parent.currency,
  items:[{id:"line:0",quantityMicros:1000000,unitAmountMinor:actual.debitNetMinor,discountMinor:0,category:economic.snapshot.taxCategoryCode,requiresShipping:economic.snapshot.requiresShipping}],shippingMinor:0,occurredAt:effectiveAt}));
 const debitTaxQuote=subscriptionInitialTaxQuote.parse({quoteDigest:actualTax.quoteDigest,subtotalMinor:actualTax.amounts.subtotalMinor,taxMinor:actualTax.amounts.taxMinor,totalMinor:actualTax.amounts.totalMinor});
 if(debitTaxQuote.subtotalMinor!==actual.debitNetMinor||actual.trial&&debitTaxQuote.totalMinor!==0)refuse();
 const totalCredit=BigInt(basis.creditNetMinor)+BigInt(basis.creditTaxMinor),totalDebit=BigInt(debitTaxQuote.totalMinor),applied=totalCredit<totalDebit?totalCredit:totalDebit;
 const feeReview=originalProrationFeeReview(basis.principal,actual.debitNetMinor,debitTaxQuote.totalMinor,Number(applied),policy.siteFeeBps);
 // Exact economic identities/proofs are distinct from the FULL current
 // physical parent revision. An own unaccepted quote reserves nothing and is
 // not filtered; any actual changed source/capacity/fee still changes this.
 const sourceEconomics={subscriptionId:parent.id,previousTermsId:previous.id,input,originalApplicationPeriodStart:parent.currentPeriodStart,originalApplicationPeriodEnd:parent.currentPeriodEnd,
  originalTrialEndsAt:parent.trialEndsAt,originalInvoiceId:basis.invoice?.id??null,originalInvoiceLineId:basis.line?.id??null,basisPeriodStart:basis.periodStart,basisPeriodEnd:basis.periodEnd,
  creditNetMinor:basis.creditNetMinor,creditTaxMinor:basis.creditTaxMinor,principal:basis.principal,economicQuoteDigest:economic.quoteDigest,profileId:economic.profile.profileId,profileVersion:economic.profile.profileVersion,
  datedTaxQuote:debitTaxQuote,route:economic.route,sourceScope:resource.originalScope,actualCalendar:request,actualNativeDigest:native.verified.actualResultDigest,actualUpdateDigest:update.verified.actualResultDigest,
  customerFinancialDigest:customer.verified.actualResult.inventoryDigest,methodDigest:method.methodDigest,feeReview};
 return{input,resource,parent,previous,policy,economic,basis,effectiveAt,history,request,method,actual,actualNative,actualUpdate,native,update,customer,calendar,debitTaxQuote,feeReview,
  creditAppliedMinor:Number(applied),cashDueMinor:Number(totalDebit-applied),residualCreditMinor:Number(totalCredit-applied),sourceRevision:merchantTaxDigest(sourceEconomics),currentParentRevision:currentParent.revision};
}
