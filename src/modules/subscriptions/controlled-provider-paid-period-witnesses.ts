// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: actual immutable effect ancestry, full private PG SHA, safe export.
import { eq, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { ServiceError, type Tx } from "@/core/service";
import { subscriptionCommercialTerms } from "./schema";
import { subscriptionControlledCollections, subscriptionControlledQuotes } from "./controlled-provider-collection-schema";
import { subscriptionControlledResources } from "./controlled-provider-schema";
import { subscriptionControlledPaidPeriodReceipts } from "./controlled-provider-paid-period-schema";
import { verifiedControlledPaidPeriod } from "./controlled-provider-paid-period-proof";
export type ControlledPaidPeriodWitnessScope = { subscriptionIds?: readonly string[]; invoiceIds?: readonly string[]; profileId?: string };
function refuse(): never { throw new ServiceError("conflict", "Restore the complete exact original paid-period receipt, accepted profile/parent and immutable event ancestry before financial/privacy export."); }
export async function controlledPaidPeriodWitnesses(tx: Tx, input: ControlledPaidPeriodWitnessScope) {
  const scope = z.object({ subscriptionIds: z.array(z.uuid()).max(5000), invoiceIds: z.array(z.uuid()).max(5000), profileId: z.uuid().optional() }).strict()
    .parse({ subscriptionIds: [...new Set(input.subscriptionIds ?? [])].sort(), invoiceIds: [...new Set(input.invoiceIds ?? [])].sort(), profileId: input.profileId });
  if (scope.subscriptionIds.length + scope.invoiceIds.length + (scope.profileId ? 1 : 0) > 5000) refuse();
  if (!scope.subscriptionIds.length && !scope.invoiceIds.length && !scope.profileId) return { entries: [], rows: [], incomplete: false as const };
  const previous = alias(subscriptionCommercialTerms, "controlled_paid_previous_terms");
  const rows = await tx.select({ receipt: subscriptionControlledPaidPeriodReceipts, collection: subscriptionControlledCollections, quote: subscriptionControlledQuotes,
    resource: subscriptionControlledResources, terms: subscriptionCommercialTerms,
    fingerprint: sql<string>`encode(sha256(convert_to(to_jsonb(${subscriptionControlledPaidPeriodReceipts})::text,'UTF8')),'hex')` })
    .from(subscriptionControlledPaidPeriodReceipts)
    .innerJoin(subscriptionControlledCollections, eq(subscriptionControlledCollections.id, subscriptionControlledPaidPeriodReceipts.collectionId))
    .innerJoin(subscriptionControlledQuotes, eq(subscriptionControlledQuotes.id, subscriptionControlledCollections.quoteId))
    .innerJoin(subscriptionControlledResources, eq(subscriptionControlledResources.id, subscriptionControlledQuotes.resourceId))
    .innerJoin(subscriptionCommercialTerms, eq(subscriptionCommercialTerms.id, subscriptionControlledPaidPeriodReceipts.termsId))
    .leftJoin(previous, eq(previous.id, subscriptionControlledQuotes.previousTermsId))
    .where(or(...(scope.subscriptionIds.length ? [inArray(subscriptionControlledPaidPeriodReceipts.subscriptionId, scope.subscriptionIds)] : []),
      ...(scope.invoiceIds.length ? [inArray(subscriptionControlledPaidPeriodReceipts.invoiceId, scope.invoiceIds)] : []),
      ...(scope.profileId ? [or(eq(subscriptionControlledQuotes.profileId, scope.profileId), eq(subscriptionCommercialTerms.profileId, scope.profileId), eq(previous.profileId, scope.profileId))] : [])))
    .orderBy(subscriptionControlledPaidPeriodReceipts.id).limit(5001);
  // Inner joins cannot conceal an orphan or adopted mixed-owner receipt.
  const candidates = await tx.select({ id: subscriptionControlledPaidPeriodReceipts.id }).from(subscriptionControlledPaidPeriodReceipts)
    .where(or(...(scope.subscriptionIds.length ? [inArray(subscriptionControlledPaidPeriodReceipts.subscriptionId, scope.subscriptionIds)] : []),
      ...(scope.invoiceIds.length ? [inArray(subscriptionControlledPaidPeriodReceipts.invoiceId, scope.invoiceIds)] : []),
      ...(scope.profileId ? [sql`exists(select 1 from subscription_controlled_collections c join subscription_controlled_quotes q on q.id=c.quote_id
        join subscription_commercial_terms t on t.id=${subscriptionControlledPaidPeriodReceipts.termsId}
        left join subscription_commercial_terms p on p.id=q.previous_terms_id where c.id=${subscriptionControlledPaidPeriodReceipts.collectionId}
        and(q.profile_id=${scope.profileId}::uuid or t.profile_id=${scope.profileId}::uuid or p.profile_id=${scope.profileId}::uuid))`] : []))).limit(5001);
  if (rows.length > 5000 || candidates.length > 5000 || rows.length !== candidates.length) refuse();
  for (const row of rows) {
    const r = row.receipt;
    if (!verifiedControlledPaidPeriod(r) || row.collection.kind !== "period" || row.collection.invoiceId !== r.invoiceId || row.collection.termsId !== r.termsId
      || row.quote.resourceId !== r.resourceId || row.resource.subscriptionId !== r.subscriptionId || row.terms.subscriptionId !== r.subscriptionId
      || row.collection.acceptedQuoteDigest !== r.acceptedQuoteDigest || row.collection.canonicalTargetDigest !== r.canonicalTargetDigest) refuse();
    const events = await tx.execute<{ count: number }>(sql`select count(*)::integer as count from subscription_events e where e.subscription_id=${r.subscriptionId}::uuid
      and e.invoice_id=${r.invoiceId}::uuid and((e.id=${r.renewalEventId}::uuid and e.kind='renewed') or(e.id=${r.planEventId}::uuid and e.kind='plan_changed'))`);
    if (events[0]?.count !== (r.planEventId ? 2 : 1)) refuse();
  }
  return { entries: rows.map(({ receipt, quote, fingerprint }) => ({ table: "subscription_controlled_paid_period_receipts" as const, id: receipt.id, fingerprint, hashDomain: "postgres_row" as const,
    parents: { collectionId: receipt.collectionId, resourceId: receipt.resourceId, subscriptionId: receipt.subscriptionId, invoiceId: receipt.invoiceId, termsId: receipt.termsId,
      renewalEventId: receipt.renewalEventId, planEventId: receipt.planEventId, profileId: quote.profileId } })), rows: rows.map(row => row.receipt), incomplete: false as const };
}
export async function exportControlledPaidPeriodHistory(tx: Tx, scope: ControlledPaidPeriodWitnessScope, options: { merchant: boolean; existingRows?: number }) {
  const selected = await controlledPaidPeriodWitnesses(tx, scope), existing = options.existingRows ?? 0;
  if (!Number.isSafeInteger(existing) || existing < 0 || selected.entries.length + existing > 5000) refuse();
  return { selected, receipts: selected.rows.map(row => ({ id: row.id, collectionId: row.collectionId, subscriptionId: row.subscriptionId, invoiceId: row.invoiceId,
    termsId: row.termsId, renewalEventId: row.renewalEventId, planEventId: row.planEventId, planId: row.planId,
    periodStart: row.periodStart.toISOString(), periodEnd: row.periodEnd.toISOString(), activatedAt: row.effectAt.toISOString(), createdAt: row.createdAt.toISOString(),
    ...(options.merchant ? { financialReviewPendingAtActivation: row.financialReviewPending } : {}) })) };
}
