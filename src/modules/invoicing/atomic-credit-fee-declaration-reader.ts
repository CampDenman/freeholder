// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: genuine quote -> accepted proration -> one actual issued note line.
import {and,eq,sql} from "drizzle-orm";
import {ServiceError,type Tx} from "@/core/service";
import {subscriptionProrations,subscriptionProrationPrincipal} from "@/modules/subscriptions/proration-schema";
import {subscriptionControlledQuotes} from "@/modules/subscriptions/controlled-provider-collection-schema";
import {subscriptionControlledResources} from "@/modules/subscriptions/controlled-provider-schema";
import {creditNotes,creditNoteLines} from "./schema";
function refuse():never{throw new ServiceError("conflict","Restore the actual authentic quoted B plan, accepted proration, unique source principal and exact issued note/line; a missing mandatory purpose child cannot become a historical legacy loan.");}
/** Private historical discriminator only. Fresh current bank/parent/caller
 * authority is independently mandatory before every monetary mutation. */
export async function readAtomicCreditAcceptedQuoteSource(tx:Tx,prorationId:string){
 const[accepted]=await tx.select().from(subscriptionProrations).where(eq(subscriptionProrations.id,prorationId)).limit(1);if(!accepted)refuse();
 const quotes=await tx.select({row:subscriptionControlledQuotes,fingerprint:sql<string>`encode(sha256(convert_to(to_jsonb(${subscriptionControlledQuotes})::text,'UTF8')),'hex')`}).from(subscriptionControlledQuotes)
  .where(and(eq(subscriptionControlledQuotes.plannedProrationId,accepted.id),eq(subscriptionControlledQuotes.quoteDigest,accepted.acceptedQuoteDigest))).limit(2);
 if(!quotes.length)return null;if(quotes.length!==1)refuse();const selected=quotes[0];if(!selected)refuse();
 const quote=selected.row,[resource]=await tx.select().from(subscriptionControlledResources).where(eq(subscriptionControlledResources.id,quote.resourceId)).limit(1);
 if(!resource||resource.subscriptionId!==accepted.subscriptionId||quote.previousTermsId!==accepted.previousTermsId||quote.profileId!==accepted.profileId||quote.profileVersion!==accepted.profileVersion)refuse();
 const{controlledProviderJournal}=await import("@/modules/subscriptions/controlled-provider-proof");
 const{authenticatedControlledQuote}=await import("@/modules/subscriptions/controlled-provider-quote-proof");
 const history=await controlledProviderJournal(tx,resource.id),review=authenticatedControlledQuote(quote,resource,history).review;
 if(review.kind!=="proration"||!accepted.creditNoteId||!accepted.originalInvoiceId||!accepted.originalInvoiceLineId)refuse();const declaration=review.atomicCreditFeeDeclaration??null;
 if(declaration&&(declaration.plannedProrationId!==accepted.id||declaration.originalInvoiceId!==accepted.originalInvoiceId||declaration.originalInvoiceLineId!==accepted.originalInvoiceLineId))refuse();
 const[note]=await tx.select().from(creditNotes).where(eq(creditNotes.id,accepted.creditNoteId)).limit(1);
 const lines=await tx.select().from(creditNoteLines).where(eq(creditNoteLines.creditNoteId,accepted.creditNoteId)).limit(2);
 const principal=await tx.select().from(subscriptionProrationPrincipal).where(eq(subscriptionProrationPrincipal.prorationId,accepted.id)).limit(1001);
 if(!note||note.invoiceId!==accepted.originalInvoiceId||note.idempotencyKey!==`subscription-proration:${accepted.id}:credit`||note.status!=="issued"||lines.length!==1||lines[0]?.invoiceLineId!==accepted.originalInvoiceLineId
  ||principal.length>1000||new Set(principal.map(row=>`${row.sourcePaymentId}:${row.sourceApplicationId??"direct"}`)).size!==principal.length)refuse();
 if(!review.feeReview||review.feeReview.sources.length!==principal.length)refuse();
 for(const source of review.feeReview.sources){const actual=principal.find(row=>row.sourcePaymentId===source.sourcePaymentId&&row.sourceApplicationId===source.sourceApplicationId);
  if(!actual||actual.originalEvidenceDigest!==accepted.sourceRevision||actual.amountMinor!==source.amountMinor||actual.feeEvidenceDigest!==source.feeEvidenceDigest||actual.feeObligationMinor!==source.feeObligationMinor||actual.feeProvenCollectedMinor!==source.feeProvenCollectedMinor||actual.feeCollectionState!==source.feeCollectionState||actual.feeUnexpected!==source.feeUnexpected)refuse();}
 for(const source of declaration?.fundings??[]){const actual=principal.find(row=>row.sourcePaymentId===source.sourcePaymentId&&row.sourceApplicationId===source.sourceApplicationId);
  if(!actual||actual.originalEvidenceDigest!==accepted.sourceRevision||actual.amountMinor!==source.amountMinor||actual.feeEvidenceDigest!==source.feeEvidenceDigest)refuse();}
 const line=lines[0];if(!line)refuse();
 const physicalIdentities=[`subscription_controlled_resources:${resource.id}`,`subscription_controlled_quotes:${quote.id}`,`subscription_prorations:${accepted.id}`,`credit_notes:${note.id}`,`credit_note_lines:${line.id}`,
  ...principal.map(row=>`subscription_proration_principal:${row.id}`),...history.operations.map(row=>`subscription_controlled_operations:${row.id}`),...history.calls.map(row=>`subscription_controlled_calls:${row.id}`),...history.facts.map(row=>`subscription_controlled_facts:${row.id}`),
  ...history.finishes.map(row=>`subscription_controlled_finishes:${row.callId}`),...history.stops.map(row=>`subscription_controlled_stops:${row.callId}`),...history.verifications.map(row=>`subscription_controlled_verifications:${row.operationId}`),...history.chargeOrigins.map(row=>`subscription_controlled_charge_origins:${row.receiptId}`),...history.closures.map(row=>`subscription_controlled_closures:${row.id}`)];
 if(new Set(physicalIdentities).size>5000)refuse();
 return{declaration,review,quote,quoteFingerprint:selected.fingerprint,accepted,note,line,principal,physicalIdentities,suppliesCurrentMoneyAuthority:false as const};
}
export async function readAtomicCreditFeeDeclarationForProration(tx:Tx,prorationId:string){const source=await readAtomicCreditAcceptedQuoteSource(tx,prorationId);if(!source?.declaration)return null;return{...source,declaration:source.declaration};}
