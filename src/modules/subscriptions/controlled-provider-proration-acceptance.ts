// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Fresh actual source safety and unchanged economics precede canonical promises.
import { randomUUID } from "node:crypto";
import { eq,sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { actorString,defineService,ServiceError,type ServiceContext } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptionProrations } from "./proration-schema";
import { subscriptions } from "./schema";
import { subscriptionControlledResources } from "./controlled-provider-schema";
import { subscriptionControlledQuotes,subscriptionControlledCollections,subscriptionControlledComponents } from "./controlled-provider-collection-schema";
import { controlledProrationAcceptance,controlledProrationInput,controlledComponentProvenance } from "./controlled-provider-collection-contract";
import { authenticatedControlledQuote } from "./controlled-provider-quote-proof";
import { controlledProviderJournal } from "./controlled-provider-proof";
import { prepareControlledProrationEconomics } from "./controlled-provider-proration-economics";
import { ownGrossProration } from "./proration-quote";
import { retainAcceptedGrossProration } from "./proration-service";
import { controlledCanonicalTarget } from "./controlled-provider-canonical-target";
import { controlledCashlessCollectionState,controlledTrialTargetDigest } from "./controlled-provider-cashless-state";
import { controlledCollectionState } from "./controlled-provider-collection-state";
const result=z.object({collectionId:z.uuid(),prorationId:z.uuid(),invoiceId:z.uuid().nullable(),creditNoteId:z.uuid().nullable(),effectiveAt:z.iso.datetime()});
function refuse():never{throw new ServiceError("conflict","The reviewed original provider terms, actual source principal, tax, fee, method or calendar changed or expired. Review fresh explicit consent; preserve old access, issued credit and all actual partial money.");}
async function original(ctx:ServiceContext,input:z.infer<typeof controlledProrationAcceptance>){
 await lockContactIdentityForRead(ctx.tx);
 await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`controlled-provider:${input.resourceId}`}))`);
 const[resource]=await ctx.tx.select().from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,input.resourceId)).limit(1).for("update");
 const[quote]=await ctx.tx.select().from(subscriptionControlledQuotes).where(eq(subscriptionControlledQuotes.id,input.quoteId)).limit(1);
 if(!resource||!quote||quote.resourceId!==resource.id||quote.kind!=="proration"||quote.previousTermsId!==input.previousTermsId||quote.quoteDigest!==input.acceptedQuoteDigest||!quote.plannedProrationId)refuse();
 await ctx.tx.select({id:subscriptions.id}).from(subscriptions).where(eq(subscriptions.id,resource.subscriptionId)).limit(1).for("update");
 const review=authenticatedControlledQuote(quote,resource,await controlledProviderJournal(ctx.tx,resource.id)).review;
 if(review.kind!=="proration"||!review.controlled.methodDigest||!review.collectionMethod||review.requiresMerchantReview)refuse();
 return{resource,quote,review};
}
async function accept(ctx:ServiceContext,input:z.infer<typeof controlledProrationAcceptance>){
 const{quote,review}=await original(ctx,input);
 const[installed]=await ctx.tx.execute<{ready:boolean}>(sql`select to_regprocedure('freeholder_controlled_proration_source(uuid)') is not null as ready`);
 if(!installed?.ready)throw new ServiceError("conflict","Install and qualify the genuine controlled canonical quote, original principal and provider-calendar guards before accepting new money promises.");
 const[prior]=await ctx.tx.select().from(subscriptionControlledCollections).where(eq(subscriptionControlledCollections.quoteId,quote.id)).limit(1);
 if(prior){if(!prior.prorationId||prior.id!==quote.plannedCollectionId||prior.acceptedQuoteDigest!==input.acceptedQuoteDigest)refuse();return{collectionId:prior.id,prorationId:prior.prorationId,invoiceId:prior.invoiceId,creditNoteId:prior.creditNoteId,effectiveAt:review.effectiveAt};}
 const economicInput=controlledProrationInput.parse(quote.input),evidence={nativeOperationId:quote.nativePreviewOperationId,updateOperationId:quote.updatePreviewOperationId,customerOperationId:quote.customerFinancialOperationId,calendarOperationId:quote.calendarReadOperationId};
 let source=await prepareControlledProrationEconomics(ctx,economicInput,evidence);
 for(const id of [...new Set(source.basis.principal.map(row=>row.sourcePaymentId))].sort())await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payment:${id}`}))`);
 if(source.basis.invoice)await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice:${source.basis.invoice.id}`}))`);
 source=await prepareControlledProrationEconomics(ctx,economicInput,evidence);
 if(source.sourceRevision!==quote.sourceRevision||source.previous.id!==quote.previousTermsId||source.method.methodDigest!==review.controlled.methodDigest
  ||source.actual.debitNetMinor!==review.debitNetMinor||source.debitTaxQuote.taxMinor!==review.debitTaxMinor||source.basis.creditNetMinor!==review.creditNetMinor||source.basis.creditTaxMinor!==review.creditTaxMinor
  ||source.creditAppliedMinor!==review.creditAppliedMinor||source.cashDueMinor!==review.cashDueMinor||source.residualCreditMinor!==review.residualCreditMinor||merchantTaxDigest(source.feeReview)!==merchantTaxDigest(review.feeReview)
  ||merchantTaxDigest(source.economic.snapshot)!==merchantTaxDigest(review.quote.snapshot))refuse();
 const accepted=await retainAcceptedGrossProration(ctx,{...economicInput,previousTermsId:quote.previousTermsId,acceptedQuoteDigest:quote.quoteDigest,confirm:true},{
  parent:source.parent,previous:source.previous,economic:source.economic,basis:source.basis,effectiveAt:source.effectiveAt,debitTaxQuote:source.debitTaxQuote,
  noticeSnapshot:review.noticeSnapshot,noticeDigest:merchantTaxDigest({version:1,kind:"controlled_provider_proration_notice",quoteDigest:quote.quoteDigest,noticeSnapshot:review.noticeSnapshot,calendar:review.calendar}),
  feeReview:source.feeReview,card:null,review:{quoteDigest:quote.quoteDigest,debitNetMinor:review.debitNetMinor,debitTaxMinor:review.debitTaxMinor,creditNetMinor:review.creditNetMinor,creditTaxMinor:review.creditTaxMinor,
   creditAppliedMinor:review.creditAppliedMinor,requiresMerchantReview:false}}, {quoteId:quote.id});
 const[proration]=await ctx.tx.select().from(subscriptionProrations).where(eq(subscriptionProrations.id,accepted.prorationId)).limit(1);
 if(!proration||proration.id!==quote.plannedProrationId||!proration.termsId)refuse();
 const canonical=accepted.invoiceId?await controlledCanonicalTarget(ctx.tx,accepted.invoiceId,accepted.creditNoteId):null;
 const canonicalTargetDigest=canonical?.digest??controlledTrialTargetDigest({subscriptionId:source.parent.id,quoteId:quote.id,prorationId:proration.id,termsId:proration.termsId,acceptedQuoteDigest:quote.quoteDigest,originalTrialEndsAt:proration.originalTrialEndsAt});
 await ctx.tx.execute(sql`select set_config('freeholder.controlled_collection_v1','1',true)`);
 await ctx.tx.insert(subscriptionControlledCollections).values({id:quote.plannedCollectionId,kind:"proration",quoteId:quote.id,prorationId:proration.id,invoiceId:accepted.invoiceId,termsId:proration.termsId,creditNoteId:accepted.creditNoteId,
  canonicalTargetDigest,acceptedCurrentParentRevision:source.currentParentRevision,acceptanceKind:"explicit_change",originalConsentDigest:quote.quoteDigest,acceptedBy:actorString(ctx.actor),acceptedQuoteDigest:quote.quoteDigest,collectionPolicy:"canonical_gross_target_locked_credit_no_wallet"});
 if(canonical){
  const periodStart=new Date(review.calendar.proposedPeriodStart),periodEnd=new Date(review.calendar.proposedPeriodEnd),item=source.request.originalComponents[0]!;
  const previewLine=source.actualNative.actualLines.find(row=>row.component==="principal"&&row.amountMinor>0&&Date.parse(row.periodStart)<=source.effectiveAt.getTime()&&Date.parse(row.periodEnd)>source.effectiveAt.getTime())??source.actualNative.actualLines.find(row=>row.component==="principal"&&row.amountMinor>=0);
  if(!previewLine)refuse();
  const provenance=controlledComponentProvenance.parse({kind:"net",providerProductRef:source.resource.originalScope.providerProductRef,providerPreviewLineRef:previewLine.providerLineRef,originalProviderItemRef:item.subscriptionItemRef,originalProviderPriceRef:item.providerPriceRef,
   canonicalCalculationDigest:merchantTaxDigest({invoiceId:canonical.invoice.id,lineIds:canonical.lines.map(row=>row.id),canonicalTargetDigest,sourceRevision:source.sourceRevision,reviewDigest:quote.reviewDigest})});
  const components:Array<typeof subscriptionControlledComponents.$inferInsert>=[{id:randomUUID(),collectionId:quote.plannedCollectionId,position:0,kind:"net",amountMinor:review.debitNetMinor,currency:source.parent.currency,periodStart,periodEnd,provenance,provenanceDigest:merchantTaxDigest(provenance)}];
  if(review.debitTaxMinor>0){
   const tax=source.history.verifications.filter(row=>source.history.operations.some(op=>op.id===row.operationId&&op.kind==="read_product")).at(-1);
   const product=z.object({createdProductRef:z.string().regex(/^prod_[A-Za-z0-9_]+$/),component:z.literal("merchant_declared_tax_collection"),taxAuthority:z.literal("canonical_merchant_tax_ledger")}).parse(tax?.actualResult);
   const taxProvenance=controlledComponentProvenance.parse({kind:"merchant_declared_tax_collection",providerProductRef:product.createdProductRef,taxQuoteDigest:source.debitTaxQuote.quoteDigest,profileId:quote.profileId,profileVersion:quote.profileVersion});
   components.push({id:randomUUID(),collectionId:quote.plannedCollectionId,position:components.length,kind:"merchant_declared_tax_collection",amountMinor:review.debitTaxMinor,currency:source.parent.currency,periodStart,periodEnd,provenance:taxProvenance,provenanceDigest:merchantTaxDigest(taxProvenance)});
  }
  if(review.creditAppliedMinor>0){
   if(!accepted.creditNoteId)refuse();const creditProvenance=controlledComponentProvenance.parse({kind:"locked_canonical_credit",creditNoteId:accepted.creditNoteId,applicationIds:canonical.applications.map(row=>row.reservationId),canonicalDispositionDigest:merchantTaxDigest({canonicalTargetDigest,reservations:canonical.reservations,applications:canonical.applications,funding:canonical.funding})});
   components.push({id:randomUUID(),collectionId:quote.plannedCollectionId,position:components.length,kind:"locked_canonical_credit",amountMinor:-review.creditAppliedMinor,currency:source.parent.currency,periodStart,periodEnd,provenance:creditProvenance,provenanceDigest:merchantTaxDigest(creditProvenance)});
  }
  await ctx.tx.insert(subscriptionControlledComponents).values(components);await controlledCollectionState(ctx.tx,quote.plannedCollectionId);
 }else await controlledCashlessCollectionState(ctx.tx,quote.plannedCollectionId);
 ctx.setSubject("subscription",source.parent.id);return{collectionId:quote.plannedCollectionId,prorationId:proration.id,invoiceId:accepted.invoiceId,creditNoteId:accepted.creditNoteId,effectiveAt:review.effectiveAt};
}
export const acceptControlledProration=defineService({name:"subscriptions.acceptControlledProration",summary:"Accept unchanged actual provider calendar/price consent and atomically create the real canonical gross debit and exclusive original paid credit, retaining the complete current parent revision separately from its historical quote.",
 kind:"mutation",permission:"scoped",writeClass:"money",auditInputFields:["quoteId","resourceId","previousTermsId","acceptedQuoteDigest"],input:controlledProrationAcceptance,output:result,handler:(input,ctx)=>accept(ctx,input)});
export const acceptMyControlledProration=defineService({name:"subscriptions.acceptMyControlledProration",summary:"Accept only your own genuine original provider quote through the same canonical money writer, without new access or an automatic bank charge.",
 kind:"mutation",permission:"authenticated",writeClass:"money",auditInputFields:["quoteId","resourceId","previousTermsId","acceptedQuoteDigest"],input:controlledProrationAcceptance,output:result,handler:async(input,ctx)=>{
  // Establish the buyer/contact prefix BEFORE any resource/parent money lock.
  // The immutable quote selects identity; acceptance rechecks it under locks.
  const[quote]=await ctx.tx.select().from(subscriptionControlledQuotes).where(eq(subscriptionControlledQuotes.id,input.quoteId)).limit(1);
  if(!quote||quote.resourceId!==input.resourceId)refuse();const economicInput=controlledProrationInput.parse(quote.input);
  await ownGrossProration(ctx,economicInput.id,economicInput.planId);return accept(ctx,input);
 }});
