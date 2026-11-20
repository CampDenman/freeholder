// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C12.38: explicit financial projection, never quote/address/caller bodies.
import { inArray,sql } from "drizzle-orm";
import { ServiceError,type Tx } from "@/core/service";
import { subscriptionControlledQuotes as quotes,subscriptionControlledCollections as collections,subscriptionControlledComponents as components } from "@/modules/subscriptions/controlled-provider-collection-schema";
import { exportControlledCollectionHistory } from "@/modules/subscriptions/controlled-provider-collection-witnesses";
import type { ControlledTargetReview } from "@/modules/subscriptions/controlled-provider-collection-contract";
import type { ControlledTargetHistory } from "./controlled-target-financial-witness";
const hash=(table:unknown)=>sql<string>`encode(sha256(convert_to(to_jsonb(${table})::text,'UTF8')),'hex')`;
/** Customer amounts are explicit. Merchant fee obligations are separately
 * selected only for an exact frozen merchant-profile subject export. */
export function controlledTargetEconomics(review:Pick<ControlledTargetReview,"debitNetMinor"|"debitTaxMinor"|"creditNetMinor"|"creditTaxMinor"|"creditAppliedMinor"|"cashDueMinor"|"residualCreditMinor"|"feeReview">,merchant=false){
 return{debitNetMinor:review.debitNetMinor,debitTaxMinor:review.debitTaxMinor,creditNetMinor:review.creditNetMinor,creditTaxMinor:review.creditTaxMinor,
  creditAppliedMinor:review.creditAppliedMinor,cashDueMinor:review.cashDueMinor,residualCreditMinor:review.residualCreditMinor,
  ...(merchant&&review.feeReview?{commission:{debitFeeObligationMinor:review.feeReview.debitFeeObligationMinor,creditFeeObligationMinor:review.feeReview.creditFeeObligationMinor,
   appliedFeeObligationMinor:review.feeReview.appliedFeeObligationMinor,appliedFeeProvenCollectedMinor:review.feeReview.appliedFeeProvenCollectedMinor,
   remainingNewCashFeeMinor:review.feeReview.remainingNewCashFeeMinor,separateMerchantReceivableMinor:review.feeReview.separateMerchantReceivableMinor}}:{})};
}
export async function exportControlledTargetFinancialHistory(tx:Tx,history:ControlledTargetHistory,merchant=false){
 const quoteRows=history.quotes.length?await tx.select({id:quotes.id,review:quotes.review,effectiveAt:quotes.effectiveAt,redactedAt:quotes.redactedAt,createdAt:quotes.createdAt,fingerprint:hash(quotes)})
  .from(quotes).where(inArray(quotes.id,history.quotes.map(row=>row.id))).orderBy(quotes.id).limit(5001):[];
 const collectionRows=history.collections.length?await tx.select({id:collections.id,acceptanceKind:collections.acceptanceKind,collectionPolicy:collections.collectionPolicy,createdAt:collections.createdAt,fingerprint:hash(collections)})
  .from(collections).where(inArray(collections.id,history.collections.map(row=>row.id))).orderBy(collections.id).limit(5001):[];
 const componentRows=history.components.length?await tx.select({id:components.id,collectionId:components.collectionId,kind:components.kind,position:components.position,amountMinor:components.amountMinor,currency:components.currency,
  periodStart:components.periodStart,periodEnd:components.periodEnd,createdAt:components.createdAt,fingerprint:hash(components)})
  .from(components).where(inArray(components.id,history.components.map(row=>row.id))).orderBy(components.id).limit(5001):[];
 const exact=(rows:readonly{id:string;fingerprint:string}[],expected:readonly{id:string;fingerprint:string}[])=>rows.length===expected.length&&new Set(rows.map(row=>row.id)).size===rows.length&&rows.every(row=>expected.some(original=>original.id===row.id&&original.fingerprint===row.fingerprint));
 if(history.incomplete||!exact(quoteRows,history.quotes)||!exact(collectionRows,history.collections)||!exact(componentRows,history.components))
  throw new ServiceError("conflict","Restore the complete unchanged exact target quote/component history before financial export.");
 const safe=exportControlledCollectionHistory(history);
 return{...safe,
  quotes:safe.quotes.map(row=>{const actual=quoteRows.find(value=>value.id===row.quoteId)!;return{...row,effectiveAt:actual.effectiveAt,createdAt:actual.createdAt,redactedAt:actual.redactedAt,
   economics:actual.review?{currency:actual.review.quote.snapshot.currency,...controlledTargetEconomics(actual.review,merchant)}:null};}),
  collections:safe.collections.map(row=>{const actual=collectionRows.find(value=>value.id===row.collectionId)!;return{...row,acceptanceKind:actual.acceptanceKind,collectionPolicy:actual.collectionPolicy,createdAt:actual.createdAt};}),
  components:componentRows.map(({id,collectionId,kind,position,amountMinor,currency,periodStart,periodEnd,createdAt})=>({componentId:id,collectionId,kind,position,amountMinor,currency,periodStart,periodEnd,createdAt})),
 };
}
