// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The real original mandate creates one shared canonical next-period invoice.
import { randomUUID } from "node:crypto";
import { eq,sql } from "drizzle-orm";
import { z } from "zod";
import { actorString,defineService,ServiceError,type ServiceContext } from "@/core/service";
import { lockContactIdentityForRead } from "@/core/contacts/identity-lock";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptionControlledResources } from "./controlled-provider-schema";
import { subscriptions } from "./schema";
import { subscriptionControlledQuotes,subscriptionControlledCollections,subscriptionControlledComponents } from "./controlled-provider-collection-schema";
import { controlledPeriodInput,controlledComponentProvenance } from "./controlled-provider-collection-contract";
import { controlledProviderJournal } from "./controlled-provider-proof";
import { authenticatedControlledQuote } from "./controlled-provider-quote-proof";
import { controlledPeriodEconomics } from "./controlled-provider-period-economics";
import { refuseControlledPeriod } from "./controlled-provider-period-source";
import { controlledCanonicalTarget } from "./controlled-provider-canonical-target";
import { controlledCollectionState } from "./controlled-provider-collection-state";
import { raiseInvoice } from "./period-invoice";
import { ownGrossProration } from "./proration-quote";
const input=z.object({quoteId:z.uuid(),resourceId:z.uuid()}).strict();
const output=z.object({collectionId:z.uuid(),invoiceId:z.uuid(),periodStart:z.iso.datetime(),periodEnd:z.iso.datetime()}).strict();
async function retain(ctx:ServiceContext,value:z.infer<typeof input>){
 await lockContactIdentityForRead(ctx.tx);
 await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`controlled-provider:${value.resourceId}`}))`);
 const[resource]=await ctx.tx.select().from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,value.resourceId)).limit(1).for("update");
 const[quote]=await ctx.tx.select().from(subscriptionControlledQuotes).where(eq(subscriptionControlledQuotes.id,value.quoteId)).limit(1);
 if(!resource||!quote||quote.resourceId!==resource.id||quote.kind!=="period")refuseControlledPeriod();
 await ctx.tx.select({id:subscriptions.id}).from(subscriptions).where(eq(subscriptions.id,resource.subscriptionId)).limit(1).for("update");
 const review=authenticatedControlledQuote(quote,resource,await controlledProviderJournal(ctx.tx,resource.id)).review;
 if(review.kind!=="period"||!review.controlled.methodDigest||!review.collectionMethod)refuseControlledPeriod();
 const[installed]=await ctx.tx.execute<{ready:boolean}>(sql`select to_regprocedure('freeholder_controlled_original_period_source(uuid)') is not null as ready`);
 if(!installed?.ready)throw new ServiceError("conflict","Install and qualify the original-mandate period guards before issuing its canonical target.");
 const[prior]=await ctx.tx.select().from(subscriptionControlledCollections).where(eq(subscriptionControlledCollections.quoteId,quote.id)).limit(1);
 if(prior){const state=await controlledCollectionState(ctx.tx,prior.id);if(prior.id!==quote.plannedCollectionId||state.review.kind!=="period")refuseControlledPeriod();return{collectionId:prior.id,invoiceId:state.canonical.invoice.id,periodStart:review.calendar.proposedPeriodStart,periodEnd:review.calendar.proposedPeriodEnd};}
 const source=await controlledPeriodEconomics(ctx,controlledPeriodInput.parse(quote.input),{calendarOperationId:quote.calendarReadOperationId,customerOperationId:quote.customerFinancialOperationId,nativeOperationId:quote.nativePreviewOperationId,updateOperationId:quote.updatePreviewOperationId});
 if(source.terms.id!==quote.previousTermsId||source.terms.acceptedQuoteDigest!==review.controlled.originalPeriodConsentDigest||source.sourceRevision!==quote.sourceRevision
  ||source.method.methodDigest!==review.controlled.methodDigest||source.start.toISOString()!==review.calendar.proposedPeriodStart||source.end.toISOString()!==review.calendar.proposedPeriodEnd
  ||source.debitNetMinor!==review.debitNetMinor||source.tax.amounts.taxMinor!==review.debitTaxMinor||source.tax.amounts.totalMinor!==review.cashDueMinor
  ||merchantTaxDigest(source.feeReview)!==merchantTaxDigest(review.feeReview))refuseControlledPeriod();
 // This is the existing shared writer, with its actual original-tax resolver,
 // setup pointer, market fee policy, idempotency, invoice events and audit.
 const invoiceId=await raiseInvoice(ctx,source.parent,{amountMinor:source.terms.snapshot.periodAmountMinor,setupFeeMinor:source.setupMinor,periodStart:source.start,periodEnd:source.end});
 const canonical=await controlledCanonicalTarget(ctx.tx,invoiceId);
 if(canonical.invoice.totalMinor!==review.cashDueMinor||canonical.invoice.paidMinor!==0||canonical.invoice.refundedMinor!==0||canonical.invoice.creditedMinor!==0
  ||canonical.taxes[0]?.evidenceDigest!==merchantTaxDigest({version:1,zoneId:source.tax.quote.zone?.id??null,quoteDigest:source.tax.quoteDigest,invoiceId:canonical.invoice.id,contactId:canonical.invoice.contactId,sourceType:canonical.invoice.sourceType,sourceId:canonical.invoice.sourceId,sellerUserId:source.policy.sellerUserId,lines:canonical.lines.map(line=>({id:line.id,position:line.position,sourceType:line.sourceType,sourceId:line.sourceId,quantityMicros:line.quantityMicros,unitAmountMinor:line.unitAmountMinor,subtotalMinor:line.subtotalMinor,discountMinor:line.discountMinor,taxMinor:line.taxMinor,totalMinor:line.totalMinor})),amounts:source.tax.amounts})||canonical.taxes[0]?.occurredAt.toISOString()!==source.start.toISOString()
  ||canonical.lines.length!==(source.setupMinor>0?2:1)||canonical.feeDuty!==null||canonical.marketPolicy.feeMinor!==source.feeReview.debitFeeObligationMinor)refuseControlledPeriod();
 await ctx.tx.execute(sql`select set_config('freeholder.controlled_collection_v1','1',true)`);
 await ctx.tx.insert(subscriptionControlledCollections).values({id:quote.plannedCollectionId,kind:"period",quoteId:quote.id,prorationId:null,invoiceId,termsId:source.terms.id,creditNoteId:null,canonicalTargetDigest:canonical.digest,
  acceptedCurrentParentRevision:source.currentParent.revision,acceptanceKind:"original_period_mandate",originalConsentDigest:source.terms.acceptedQuoteDigest,acceptedBy:actorString(ctx.actor),acceptedQuoteDigest:quote.quoteDigest,collectionPolicy:"canonical_gross_target_locked_credit_no_wallet"});
 const item=source.request.originalComponents[0]!;
 const components:Array<typeof subscriptionControlledComponents.$inferInsert>=canonical.lines.map((line,position)=>{
  const snapshot=z.object({subscriptionTermsId:z.uuid(),subscriptionComponent:z.enum(["period","setup"]),subscriptionPeriodStart:z.iso.datetime(),subscriptionPeriodEnd:z.iso.datetime()}).passthrough().parse(line.snapshot);
  const expected=snapshot.subscriptionComponent==="period"?source.terms.snapshot.periodAmountMinor:source.setupMinor;
  if(snapshot.subscriptionTermsId!==source.terms.id||snapshot.subscriptionPeriodStart!==source.start.toISOString()||snapshot.subscriptionPeriodEnd!==source.end.toISOString()
   ||line.quantityMicros!==1000000||line.discountMinor!==0||line.unitAmountMinor!==expected||position===0&&snapshot.subscriptionComponent!=="period"||position===1&&snapshot.subscriptionComponent!=="setup")refuseControlledPeriod();
  const provenance=controlledComponentProvenance.parse({kind:"net",providerProductRef:resource.originalScope.providerProductRef,providerPreviewLineRef:source.fullForecast.providerLineRef,originalProviderItemRef:item.subscriptionItemRef,originalProviderPriceRef:item.providerPriceRef,
   canonicalCalculationDigest:merchantTaxDigest({invoiceId,lineId:line.id,canonicalTargetDigest:canonical.digest,sourceRevision:source.sourceRevision,reviewDigest:quote.reviewDigest}),canonicalInvoiceLineId:line.id,canonicalComponent:snapshot.subscriptionComponent});
  return{id:randomUUID(),collectionId:quote.plannedCollectionId,position,kind:"net",amountMinor:expected,currency:source.parent.currency,periodStart:source.start,periodEnd:source.end,provenance,provenanceDigest:merchantTaxDigest(provenance)};
 });
 if(review.debitTaxMinor>0){
  const tax=source.history.verifications.filter(row=>source.history.operations.some(op=>op.id===row.operationId&&op.kind==="read_product")).at(-1);
  const product=z.object({createdProductRef:z.string().regex(/^prod_[A-Za-z0-9_]+$/),component:z.literal("merchant_declared_tax_collection"),taxAuthority:z.literal("canonical_merchant_tax_ledger")}).parse(tax?.actualResult);
  const provenance=controlledComponentProvenance.parse({kind:"merchant_declared_tax_collection",providerProductRef:product.createdProductRef,taxQuoteDigest:source.tax.quoteDigest,profileId:quote.profileId,profileVersion:quote.profileVersion});
  components.push({id:randomUUID(),collectionId:quote.plannedCollectionId,position:components.length,kind:"merchant_declared_tax_collection",amountMinor:review.debitTaxMinor,currency:source.parent.currency,periodStart:source.start,periodEnd:source.end,provenance,provenanceDigest:merchantTaxDigest(provenance)});
 }
 await ctx.tx.insert(subscriptionControlledComponents).values(components);await controlledCollectionState(ctx.tx,quote.plannedCollectionId);
 ctx.setSubject("subscription",source.parent.id);return{collectionId:quote.plannedCollectionId,invoiceId,periodStart:source.start.toISOString(),periodEnd:source.end.toISOString()};
}
export const retainControlledPeriodTarget=defineService({name:"subscriptions.retainControlledPeriodTarget",summary:"Materialize the actual original mandate's next period through the shared canonical invoice writer, without a new price acceptance, bank charge or access advance.",kind:"mutation",permission:"system",external:false,writeClass:"money",auditInputFields:["quoteId","resourceId"],input,output,handler:(value,ctx)=>retain(ctx,value)});
export const prepareControlledPeriodTarget=defineService({name:"subscriptions.prepareControlledPeriodTarget",summary:"Prepare the reviewed original next-period invoice and exact fixed NET/setup/tax components under the existing mandate; bank collection and paid effects remain separately proved.",kind:"mutation",permission:"scoped",writeClass:"money",auditInputFields:["quoteId","resourceId"],input,output,handler:(value,ctx)=>retain(ctx,value)});
export const prepareMyControlledPeriodTarget=defineService({name:"subscriptions.prepareMyControlledPeriodTarget",summary:"Prepare only your own unchanged original next paid period through the same canonical writer and mandate.",kind:"mutation",permission:"authenticated",writeClass:"money",auditInputFields:["quoteId","resourceId"],input,output,handler:async(value,ctx)=>{
 const[quote]=await ctx.tx.select().from(subscriptionControlledQuotes).where(eq(subscriptionControlledQuotes.id,value.quoteId)).limit(1);if(!quote||quote.resourceId!==value.resourceId||quote.kind!=="period")refuseControlledPeriod();
 const original=controlledPeriodInput.parse(quote.input);await ownGrossProration(ctx,original.id);return retain(ctx,value);
}});
