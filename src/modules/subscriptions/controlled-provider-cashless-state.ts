// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A genuine uncharged trial has accepted terms and bank ancestry, no money object.
import { eq } from "drizzle-orm";
import { ServiceError,type Tx } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptions,subscriptionCommercialTerms } from "./schema";
import { subscriptionProrations,subscriptionProrationPrincipal,subscriptionProrationCreditUses } from "./proration-schema";
import { subscriptionControlledResources } from "./controlled-provider-schema";
import { subscriptionControlledQuotes,subscriptionControlledCollections,subscriptionControlledComponents,subscriptionControlledInvoiceBindings } from "./controlled-provider-collection-schema";
import { controlledProviderJournal } from "./controlled-provider-proof";
import { authenticatedControlledQuote } from "./controlled-provider-quote-proof";
function refuse():never{throw new ServiceError("conflict","Restore the genuine accepted uncharged trial, exact original end and zero paid principal/credit/debit with its complete actual original caller and preview ancestry; no invoice or payment can be invented.");}
export function controlledTrialTargetDigest(input:{subscriptionId:string;quoteId:string;prorationId:string;termsId:string;acceptedQuoteDigest:string;originalTrialEndsAt:Date|null}){
 return merchantTaxDigest({kind:"controlled_uncharged_trial",...input});
}
/** Pure authenticated coverage, never current admission or financial stop.
 * Parent current financial authority must separately check all raw debt and
 * callers before the actual update; no admitted reader is excluded here. */
export async function controlledCashlessCollectionState(tx:Tx,collectionId:string){
 const[collection]=await tx.select().from(subscriptionControlledCollections).where(eq(subscriptionControlledCollections.id,collectionId)).limit(1);
 const[quote]=collection?await tx.select().from(subscriptionControlledQuotes).where(eq(subscriptionControlledQuotes.id,collection.quoteId)).limit(1):[];
 const[resource]=quote?await tx.select().from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,quote.resourceId)).limit(1):[];
 const[parent]=resource?await tx.select().from(subscriptions).where(eq(subscriptions.id,resource.subscriptionId)).limit(1):[];
 const[proration]=collection?.prorationId?await tx.select().from(subscriptionProrations).where(eq(subscriptionProrations.id,collection.prorationId)).limit(1):[];
 const[terms]=collection?await tx.select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.id,collection.termsId)).limit(1):[];
 if(!collection||!quote||!resource||!parent||!proration||!terms||collection.kind!=="proration"||quote.kind!=="proration"||collection.invoiceId||collection.creditNoteId||!proration.originalTrialEndsAt)refuse();
 const history=await controlledProviderJournal(tx,resource.id),{review}=authenticatedControlledQuote(quote,resource,history);
 const[principal]=await tx.select({id:subscriptionProrationPrincipal.id}).from(subscriptionProrationPrincipal).where(eq(subscriptionProrationPrincipal.prorationId,proration.id)).limit(1);
 const[credit]=await tx.select({id:subscriptionProrationCreditUses.id}).from(subscriptionProrationCreditUses).where(eq(subscriptionProrationCreditUses.prorationId,proration.id)).limit(1);
 const[component]=await tx.select({id:subscriptionControlledComponents.id}).from(subscriptionControlledComponents).where(eq(subscriptionControlledComponents.collectionId,collection.id)).limit(1);
 const[binding]=await tx.select({collectionId:subscriptionControlledInvoiceBindings.collectionId}).from(subscriptionControlledInvoiceBindings).where(eq(subscriptionControlledInvoiceBindings.collectionId,collection.id)).limit(1);
 if(review.kind!=="proration"||collection.id!==quote.plannedCollectionId||collection.prorationId!==quote.plannedProrationId||proration.subscriptionId!==parent.id||proration.termsId!==terms.id
  ||terms.subscriptionId!==parent.id||proration.previousTermsId!==quote.previousTermsId||proration.acceptedQuoteDigest!==quote.quoteDigest||terms.acceptedQuoteDigest!==quote.quoteDigest
  ||collection.acceptedQuoteDigest!==quote.quoteDigest||collection.originalConsentDigest!==quote.quoteDigest||collection.acceptanceKind!=="explicit_change"||collection.acceptedBy!==proration.acceptedBy
  ||proration.debitInvoiceId||proration.creditNoteId||proration.originalInvoiceId||proration.originalInvoiceLineId||principal||credit||component||binding
  ||proration.debitNetMinor+proration.debitTaxMinor+proration.creditNetMinor+proration.creditTaxMinor!==0||proration.debitFeeObligationMinor+proration.creditFeeObligationMinor+proration.appliedFeeObligationMinor+proration.appliedFeeProvenCollectedMinor!==0
  ||review.debitNetMinor+review.debitTaxMinor+review.creditNetMinor+review.creditTaxMinor+review.creditAppliedMinor+review.cashDueMinor+review.residualCreditMinor!==0
  ||proration.originalTrialEndsAt.toISOString()!==review.originalTrialEndsAt||review.calendar.originalTrialEndsAt!==review.calendar.proposedTrialEndsAt
  ||resource.originalScope.acceptedTrialEnd!==review.originalTrialEndsAt||merchantTaxDigest(proration.snapshot)!==merchantTaxDigest(terms.snapshot)||merchantTaxDigest(terms.snapshot)!==merchantTaxDigest(review.quote.snapshot)
  ||merchantTaxDigest(proration.noticeSnapshot)!==merchantTaxDigest(review.noticeSnapshot)||proration.effectiveAt.toISOString()!==review.effectiveAt||proration.proposedPeriodEnd.toISOString()!==review.calendar.proposedPeriodEnd
  ||collection.canonicalTargetDigest!==controlledTrialTargetDigest({subscriptionId:parent.id,quoteId:quote.id,prorationId:proration.id,termsId:terms.id,acceptedQuoteDigest:quote.quoteDigest,originalTrialEndsAt:proration.originalTrialEndsAt}))refuse();
 return{collection,quote,resource,parent,proration,terms,review,history,revision:merchantTaxDigest({collection,quote,resource,parent,proration,terms,historyRevision:history.revision})};
}
