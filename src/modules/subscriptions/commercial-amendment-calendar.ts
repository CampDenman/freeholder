// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C9.38: a replacement future calendar is explicit consent, never backdating.
import { desc, eq, sql } from "drizzle-orm";
import { ServiceError, type ServiceContext } from "@/core/service";
import { subscriptionCommercialAmendments } from "./commercial-amendment-schema";
import { subscriptionCommercialTerms, type subscriptions } from "./schema";
export function reviewedResumptionStart(value: string | undefined, originalEnd: Date, previousStart: Date, now: Date): Date {
  const missed = originalEnd.getTime() <= now.getTime();
  if (!missed) {
    if (value !== undefined) throw new ServiceError("conflict", "The original period has not ended; review its actual next-period boundary.");
    if (previousStart.getTime() >= originalEnd.getTime()) throw new ServiceError("conflict", "The already accepted future change must finish before another review.");
    return originalEnd;
  }
  if (!value) throw new ServiceError("conflict", "Review and explicitly accept a new future start after this missed billing boundary.");
  const start = new Date(value);
  if (!Number.isFinite(start.getTime()) || start.toISOString() !== value || start.getUTCMilliseconds() !== 0 || start.getTime() <= now.getTime()
    || start.getTime() <= originalEnd.getTime() || start.getTime() <= previousStart.getTime()) throw new ServiceError("conflict", "Choose an exact future billing date; earlier accepted periods cannot be rewritten or backdated.");
  return start;
}
export async function pendingCommercialAmendment(ctx: ServiceContext, parent: typeof subscriptions.$inferSelect) {
  if (parent.merchantScopeVersion !== 1 || !parent.pendingPlanId) return null;
  const [accepted] = await ctx.tx.select({ amendment: subscriptionCommercialAmendments, terms: subscriptionCommercialTerms }).from(subscriptionCommercialAmendments)
    .innerJoin(subscriptionCommercialTerms, eq(subscriptionCommercialTerms.id, subscriptionCommercialAmendments.termsId))
    .where(eq(subscriptionCommercialAmendments.subscriptionId, parent.id))
    .orderBy(desc(subscriptionCommercialTerms.revision)).limit(1);
  return accepted?.amendment.planId === parent.pendingPlanId ? accepted : null;
}
export async function commercialBillingStart(ctx: ServiceContext, parent: typeof subscriptions.$inferSelect) {
  const [gross] = await ctx.tx.execute<{ pending: boolean }>(sql`select exists(select 1 from subscription_prorations p where p.subscription_id=${parent.id}::uuid and p.state in('accepted','preparing','awaiting_invoice','awaiting_payment','awaiting_effective','review')) as pending`);
  if (gross?.pending) return { start: parent.currentPeriodEnd, pending: null, ready: false };
  const pending = await pendingCommercialAmendment(ctx, parent);
  if (parent.merchantScopeVersion === 1 && parent.pendingPlanId && (!pending || pending.terms.effectivePeriodStart < parent.currentPeriodEnd)) throw new ServiceError("conflict", "Restore the current accepted amendment and original billing boundary before renewal.");
  return { start: pending?.terms.effectivePeriodStart ?? parent.currentPeriodEnd, pending, ready: !pending || pending.amendment.state === "activated" };
}
/** Hash actual original database rows. SQL guards reproduce these exact stamps;
 * a later generation/observation never inherits an earlier review's authority. */
export async function originalResumptionStamps(ctx: ServiceContext, subscriptionId: string) {
  const [stamp] = await ctx.tx.execute<{ generationId: string | null; generationDigest: string; journalDigest: string; stoppedProofDigest: string }>(sql`
    select (select id::text from subscription_provider_generations where subscription_id=${subscriptionId}::uuid order by sequence desc limit 1) as "generationId",
      encode(sha256(convert_to(coalesce((select to_jsonb(g) from subscription_provider_generations g where g.subscription_id=${subscriptionId}::uuid order by sequence desc limit 1),'null'::jsonb)::text,'UTF8')),'hex') as "generationDigest",
      encode(sha256(convert_to(coalesce((select jsonb_agg(to_jsonb(o) order by o.operation_revision) from subscription_provider_schedule_operations o where o.subscription_id=${subscriptionId}::uuid),'[]'::jsonb)::text,'UTF8')),'hex') as "journalDigest",
      encode(sha256(convert_to(coalesce((select stopped_proof from subscription_provider_schedule_resources where subscription_id=${subscriptionId}::uuid),'null'::jsonb)::text,'UTF8')),'hex') as "stoppedProofDigest"`);
  if (!stamp) throw new ServiceError("conflict", "Restore the actual original generation and recovery history before re-consent.");
  return stamp;
}
