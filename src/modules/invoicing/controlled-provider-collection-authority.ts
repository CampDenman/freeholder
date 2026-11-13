// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: exact target current money safety is separate from authenticated coverage.
import { eq,sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { defineService,getService,ServiceError } from "@/core/service";
import { moduleSettings } from "@/core/settings/schema";
import { controlledCollectionState } from "@/modules/subscriptions/controlled-provider-collection-state";
import { controlledCollectionCoverage } from "@/modules/subscriptions/controlled-provider-collection-coverage";
import { controlledTargetOperationKind } from "@/modules/subscriptions/controlled-provider-target-authority";
import { subscriptionControlledCollections,subscriptionControlledQuotes } from "@/modules/subscriptions/controlled-provider-collection-schema";
import { subscriptionControlledResources } from "@/modules/subscriptions/controlled-provider-schema";
import { subscriptions } from "@/modules/subscriptions/schema";
import { controlledCalendarSource } from "@/modules/subscriptions/controlled-provider-calendar-source";
import { controlledSubscriptionFactsDigest } from "@/adapters/payments/controlled-subscription-digest";
import { paymentMethods } from "./schema";
import { merchantTaxProfiles } from "./merchant-tax-schema";
import { creditNoteDisposition } from "./credit-disposition";
import { originalCreditFeeAllocation } from "./credit-fee-origin";
import { assertNoUnappliedMerchantCharge } from "./merchant-payment-observations";
import { merchantTaxDigest } from "./merchant-tax-store";
import { parentFinancialGraph,lockControlledParentMoney } from "./controlled-provider-financial-parent";
import { CONTROLLED_FINANCIAL_PROTOCOL,requireControlledFinancialProtocol } from "./controlled-provider-financial-protocol";
import { controlledTargetRawClassification } from "./controlled-target-raw-classification";
import { controlledPeriodAdmission } from "./controlled-target-financial-policy";
function refuse():never{throw new ServiceError("conflict","Recover this exact accepted target's actual original principal, bank callers, tax/credit/fee disposition and current accepted calendar before another collection. Coverage or an equal amount cannot authorize its money.");}
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const record=z.record(z.string(),z.unknown());
const debt=z.object({pending:z.boolean(),reasons:z.array(z.string())}).passthrough();
const principal=z.object({principalSafe:z.boolean(),currentPrincipalMinor:z.number().int().nonnegative(),financialDebtPending:z.boolean(),witness:z.object({paymentId:z.uuid(),revision:sha}).passthrough()}).passthrough();
/** A GET can observe retained partial/unapplied/expired money without waiving
 * it. Writes require actual current safety. Neither outcome grants paid/access
 * authority, fabricates a PI or discharges a fee/refund/credit promise. */
export const controlledProviderCollectionAuthority=defineService({
 name:"invoicing.controlledProviderCollectionAuthority",summary:"Prove current original money and accepted period/credit/commission authority for one exact controlled target operation.",
 kind:"query",permission:"system",external:false,
 input:z.object({collectionId:z.uuid(),kind:controlledTargetOperationKind,requiredProtocol:z.literal(CONTROLLED_FINANCIAL_PROTOCOL),excludeUnadmittedOperationId:z.uuid().optional()}).strict(),
 output:z.object({allowed:z.literal(true),revision:sha}),handler:async(input,ctx)=>{
  await lockContactIdentityForRead(ctx.tx);await requireControlledFinancialProtocol(ctx.tx);
  const[reference]=await ctx.tx.select({resourceId:subscriptionControlledQuotes.resourceId,subscriptionId:subscriptionControlledResources.subscriptionId}).from(subscriptionControlledCollections)
   .innerJoin(subscriptionControlledQuotes,eq(subscriptionControlledQuotes.id,subscriptionControlledCollections.quoteId)).innerJoin(subscriptionControlledResources,eq(subscriptionControlledResources.id,subscriptionControlledQuotes.resourceId))
   .where(eq(subscriptionControlledCollections.id,input.collectionId)).limit(1);if(!reference)refuse();
  await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`controlled-provider:${reference.resourceId}`}))`);
  await ctx.tx.select({id:subscriptionControlledResources.id}).from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,reference.resourceId)).limit(1).for("update");
  await ctx.tx.select({id:subscriptions.id}).from(subscriptions).where(eq(subscriptions.id,reference.subscriptionId)).limit(1).for("update");
  const coverageInput={subscriptionId:reference.subscriptionId,...(input.excludeUnadmittedOperationId?{excludeUnadmittedOperationId:input.excludeUnadmittedOperationId}:{})};
  const coverage=await controlledCollectionCoverage(ctx.tx,coverageInput),graph=await parentFinancialGraph(ctx,reference.subscriptionId);
  await lockControlledParentMoney(ctx,graph);
  const source=await controlledCollectionState(ctx.tx,input.collectionId),{parent,resource,quote,collection,canonical,history,review}=source;
  if(resource.id!==reference.resourceId||parent.id!==reference.subscriptionId||history.unfinished.length||history.closures.length)refuse();
  if(input.excludeUnadmittedOperationId){
   const own=history.operations.find(row=>row.id===input.excludeUnadmittedOperationId),payload=record.safeParse(own?.originalRequest.payload);
   const manifest=payload.success?z.object({collectionId:z.uuid()}).safeParse(payload.data.manifest):null;
   if(!own||own.kind!==input.kind||!payload.success||(input.kind==="update_calendar"?payload.data.collectionId:manifest?.success?manifest.data.collectionId:null)!==collection.id)refuse();
  }
  const observing=input.kind==="read_manifest",currentProofs:unknown[]=[];
  if(!observing){
   const raw=await controlledTargetRawClassification(ctx.tx,parent.id,coverage,graph);if(raw.unresolvedFactIds.length)refuse();currentProofs.push({rawClassificationRevision:raw.revision});
   const[enabled]=await ctx.tx.select({enabled:moduleSettings.enabled}).from(moduleSettings).where(eq(moduleSettings.module,"subscriptions")).limit(1);
   const[method]=parent.paymentMethodId?await ctx.tx.select().from(paymentMethods).where(eq(paymentMethods.id,parent.paymentMethodId)).limit(1):[];
   const[profile]=await ctx.tx.select().from(merchantTaxProfiles).where(eq(merchantTaxProfiles.id,quote.profileId)).limit(1);
   if(!enabled?.enabled||parent.provider!=="stripe"||parent.billingMode!=="provider"||parent.merchantScopeVersion!==1||parent.signupPending||parent.cancelledAt||parent.cancelAtPeriodEnd||!["active","trialing"].includes(parent.status)
    ||!canonical.currentCollectible||canonical.invoice.paidMinor!==0||canonical.invoice.refundedMinor!==0||!method||method.status!=="active"||method.provider!=="stripe"||method.contactId!==parent.contactId
    ||method.providerCustomerRef!==resource.originalScope.providerCustomerRef||method.providerMethodRef!==resource.originalScope.providerMethodRef
    ||method.providerPlatformAccountId!==resource.originalScope.providerPlatformAccountId||method.providerAccountId!==(resource.originalScope.providerAccountId??"")
    ||!profile||profile.state!=="active"||profile.currentVersion!==quote.profileVersion||!profile.contactId)refuse();
   const[privateState]=await ctx.tx.execute<{ready:boolean}>(sql`select not exists(select 1 from contacts p where p.id in(${parent.contactId}::uuid,${profile.contactId}::uuid) and p.source='privacy-erasure')
    and not exists(select 1 from data_requests r where r.contact_id in(${parent.contactId}::uuid,${profile.contactId}::uuid) and r.kind='erasure' and r.verified_at is not null and r.status in('verified','in_progress','completed','partially_completed'))
    and not exists(select 1 from privacy_retention_exceptions h join data_requests r on r.id=h.data_request_id where r.contact_id in(${parent.contactId}::uuid,${profile.contactId}::uuid)
     and h.scope in('commerce.money','commerce.merchantTax','subscriptions.agreements','privacy.records') and(h.expires_at is null or h.expires_at>clock_timestamp())) as ready`);
   if(!privateState?.ready)refuse();
   const customer=history.verifications.filter(row=>history.operations.some(operation=>operation.id===row.operationId&&operation.kind==="read_customer_financials")).at(-1);
   if(!customer||customer.actualResult.providerCustomerRef!==resource.originalScope.providerCustomerRef||customer.actualResult.balanceState!=="known_zero"||customer.actualResult.completeCreditNotes!==true)refuse();
   currentProofs.push({customerOperationId:customer.operationId,customerResultDigest:customer.actualResultDigest});
   if(collection.kind==="period"){
    if(!controlledPeriodAdmission({subscriptionId:parent.id,sourceId:canonical.invoice.sourceId??"",now:new Date(),pay:["finalize_invoice","pay_invoice"].includes(input.kind),parentStart:parent.currentPeriodStart.toISOString(),parentEnd:parent.currentPeriodEnd.toISOString(),trialEnd:parent.trialEndsAt?.toISOString()??null,
     originalStart:review.calendar.originalApplicationPeriodStart,originalEnd:review.calendar.originalApplicationPeriodEnd,originalTrialEnd:review.calendar.originalTrialEndsAt,periodStart:review.calendar.proposedPeriodStart,periodEnd:review.calendar.proposedPeriodEnd,
     credits:[review.creditNetMinor,review.creditTaxMinor,review.creditAppliedMinor,review.residualCreditMinor]})
     ||canonical.lines.some(line=>line.sourceType!=="subscription"||line.sourceId!==parent.id||line.snapshot.subscriptionTermsId!==source.terms.id
      ||line.snapshot.subscriptionPeriodStart!==review.calendar.proposedPeriodStart||line.snapshot.subscriptionPeriodEnd!==review.calendar.proposedPeriodEnd))refuse();
   }else{
    const authority=getService("subscriptions.prorationCollectionAuthority");if(!authority)refuse();
    const actual=z.object({allowed:z.boolean(),revision:sha}).parse(await ctx.callAsSystem(authority,{invoiceId:canonical.invoice.id}));if(!actual.allowed)refuse();currentProofs.push(actual);
   }
   await assertNoUnappliedMerchantCharge(ctx,canonical.invoice.id);
   const principalReader=getService("invoicing.originalPrincipalAuthority"),debtReader=getService("invoicing.merchantPaymentRecoveryDebt");if(!principalReader||!debtReader)refuse();
   for(const payment of graph.money){
    const actualDebt=debt.parse(await ctx.callAsSystem(debtReader,{paymentId:payment.id}));currentProofs.push({paymentId:payment.id,debt:actualDebt});
    const creditSources=canonical.funding.filter(row=>row.sourcePaymentId===payment.id);
    if(actualDebt.pending&&(!creditSources.length||actualDebt.reasons.some(reason=>reason!=="commission")))refuse();
    if(payment.status==="succeeded"){
     const actual=principal.parse(await ctx.callAsSystem(principalReader,{paymentId:payment.id}));currentProofs.push(actual);
     if(!actual.principalSafe||actual.witness.paymentId!==payment.id||creditSources.length>0&&payment.refundedMinor!==0||actual.financialDebtPending&&!actualDebt.pending)refuse();
     for(const funding of creditSources){
      const fee=await originalCreditFeeAllocation(ctx,payment.id,funding.sourceApplicationId,0);currentProofs.push({fundingId:funding.id,fee});
      if(fee.collectionState==="review"||fee.unexpectedFee||!review.feeReview||review.feeReview.originalSourceDebt&&!review.requiresMerchantReview)refuse();
     }
    }
   }
   for(const receipt of graph.receipts){
    const aliases=graph.aliases.filter(alias=>alias.originalChargeReceiptId===receipt.id);
    if(aliases.length!==1||aliases[0]!.subscriptionId!==receipt.subscriptionId||!graph.money.some(payment=>payment.id===aliases[0]!.paymentId&&payment.status==="succeeded"
     &&payment.providerRef===receipt.providerPaymentIntentRef&&payment.amountMinor===receipt.amountMinor&&payment.currency===receipt.currency))refuse();
   }
   for(const note of canonical.notes){const disposition=await creditNoteDisposition(ctx.tx,note.id);currentProofs.push({creditNoteId:note.id,disposition});if(disposition.reservedForReturns||disposition.reviewRequired)refuse();}
   if(canonical.feeDuty&&(canonical.feeDuty.targetFeeMinor!==canonical.marketPolicy.feeMinor||canonical.feeDuty.cashFeeTargetMinor!==source.manifest.applicationFeeMinor))refuse();
   const calendar=controlledCalendarSource(history,resource.originalScope,source.terms,{providerProductRef:resource.originalScope.providerProductRef,principalMinor:review.quote.snapshot.periodAmountMinor,
    interval:review.quote.snapshot.interval,intervalCount:review.quote.snapshot.intervalCount},review.effectiveAt).payload;
   const beforeUpdate=input.kind==="update_calendar";
   if(calendar.originalPeriodStart!==(beforeUpdate?review.calendar.originalProviderPeriodStart:review.calendar.expectedProviderPeriodStart)
    ||calendar.originalPeriodEnd!==(beforeUpdate?review.calendar.originalProviderPeriodEnd:review.calendar.expectedProviderPeriodEnd)
    ||calendar.originalAnchor!==(beforeUpdate?review.calendar.originalBillingAnchor:review.calendar.expectedProviderBillingAnchor)
    ||calendar.originalProviderTrialEnd!==(beforeUpdate?review.calendar.originalProviderTrialEndsAt:review.calendar.expectedProviderTrialEndsAt))refuse();
   if(["finalize_invoice","pay_invoice"].includes(input.kind)){
    const proof=source.proofs.at(-1),verification=proof?history.verifications.find(row=>row.operationId===proof.operationId&&row.callId===proof.callId):null;
    const actual=verification?z.object({manifestDigest:sha,customerFinancialDigest:sha,exactManifest:z.literal(true),suppliesPaidAuthority:z.literal(false),inventory:z.object({status:z.enum(["draft","open"]),paidMinor:z.literal(0),remainingMinor:z.number().int().nonnegative(),completePayments:z.literal(true),completeLines:z.literal(true),autoAdvance:z.literal(false),actualCash:z.array(z.unknown()).length(0),actualIntents:z.array(record)})}).safeParse(verification.actualResult):null;
    const ownMutation=history.operations.filter(operation=>["update_calendar","create_draft","add_invoice_component","set_invoice_fee","finalize_invoice","pay_invoice"].includes(operation.kind))
     .filter(operation=>{const payload=record.safeParse(operation.originalRequest.payload);if(!payload.success)return false;const manifest=z.object({collectionId:z.uuid()}).safeParse(payload.data.manifest);return payload.data.collectionId===collection.id||manifest.success&&manifest.data.collectionId===collection.id;})
     .filter(operation=>operation.id!==input.excludeUnadmittedOperationId).at(-1);
    const read=proof?history.operations.find(row=>row.id===proof.operationId):null;
    if(!proof||!actual?.success||!read||ownMutation&&read.ordinal<=ownMutation.ordinal||actual.data.manifestDigest!==controlledSubscriptionFactsDigest(source.manifest)
     ||actual.data.customerFinancialDigest!==proof.customerFinancialDigest||actual.data.inventory.remainingMinor!==review.cashDueMinor
     ||actual.data.inventory.status!==(input.kind==="pay_invoice"?"open":"draft")||actual.data.inventory.actualIntents.some(intent=>!['requires_payment_method','canceled'].includes(String(intent.status))||intent.amount_received!==0||intent.amount_capturable!==0))refuse();
    currentProofs.push({manifestRead:proof.id,resultDigest:proof.resultDigest});
   }
  }
  const entries=new Map<string,string>();for(const row of [...graph.physical,...graph.children.entries,...graph.proration.entries,...graph.controlled.entries]){
   const key=`${row.table}:${row.id}`,prior=entries.get(key);if(prior&&prior!==row.fingerprint)refuse();entries.set(key,row.fingerprint);
  }
  if(input.excludeUnadmittedOperationId)entries.delete(`subscription_controlled_operations:${input.excludeUnadmittedOperationId}`);
  if(entries.size>5000)refuse();
  const after=await controlledCollectionCoverage(ctx.tx,coverageInput),current=await parentFinancialGraph(ctx,parent.id),currentTarget=await controlledCollectionState(ctx.tx,collection.id);
  if(after.revision!==coverage.revision||merchantTaxDigest(current)!==merchantTaxDigest(graph)||merchantTaxDigest(currentTarget)!==merchantTaxDigest(source))refuse();
  if(!observing){
   if(collection.kind==="period"){
    if(!controlledPeriodAdmission({subscriptionId:parent.id,sourceId:canonical.invoice.sourceId??"",now:new Date(),pay:["finalize_invoice","pay_invoice"].includes(input.kind),
     parentStart:parent.currentPeriodStart.toISOString(),parentEnd:parent.currentPeriodEnd.toISOString(),trialEnd:parent.trialEndsAt?.toISOString()??null,
     originalStart:review.calendar.originalApplicationPeriodStart,originalEnd:review.calendar.originalApplicationPeriodEnd,originalTrialEnd:review.calendar.originalTrialEndsAt,
     periodStart:review.calendar.proposedPeriodStart,periodEnd:review.calendar.proposedPeriodEnd,credits:[review.creditNetMinor,review.creditTaxMinor,review.creditAppliedMinor,review.residualCreditMinor]}))refuse();
   }else if(Date.now()>=Date.parse(review.effectiveAt))refuse();
  }
  ctx.setSubject("subscription",parent.id);
  return{allowed:true as const,revision:merchantTaxDigest({protocol:CONTROLLED_FINANCIAL_PROTOCOL,collectionId:collection.id,kind:input.kind,coverageRevision:coverage.revision,
   entries:[...entries].sort(([a],[b])=>a.localeCompare(b)),currentProofs,observing})};
 }
});
export default [controlledProviderCollectionAuthority];
