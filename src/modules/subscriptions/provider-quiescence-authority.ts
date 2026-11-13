// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: actual privacy and accepted-amendment jobs own different receipts.
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentity } from "@/core/contacts/identity-lock";
import { jobIdempotencyKeys } from "@/core/jobs/schema";
import { dataRequestArtifacts, dataRequests, privacyRetentionExceptions } from "@/core/privacy/schema";
import { erasureArtifactIsIntact } from "@/core/privacy/service";
import { ServiceError, type ServiceContext } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { originalScheduleCohortAuthority } from "./provider-schedule-cohort-authority";
import { merchantScheduleCohortInventoryCovers } from "./provider-schedule-cohorts";
import { subscriptionCommercialAmendments } from "./commercial-amendment-schema";
import { subscriptionMerchantScopes, subscriptionMarketPolicies, subscriptions } from "./schema";
import { subscriptionProviderScheduleOperations, subscriptionProviderScheduleResources } from "./provider-schedule-schema";

export const originalPrivacyScheduleTask = z.object({ purpose: z.literal("privacy").default("privacy"), profileId: z.uuid(), requestId: z.uuid(), cohortId: z.uuid(), originalJobId: z.uuid() });
export const originalAmendmentScheduleTask = z.object({ purpose: z.literal("amendment"), profileId: z.uuid(), amendmentId: z.uuid(), subscriptionId: z.uuid(), originalJobId: z.uuid() });
export const originalScheduleTask = z.union([originalPrivacyScheduleTask, originalAmendmentScheduleTask]);
export type OriginalQuiescenceTask = z.infer<typeof originalScheduleTask>;
const receipt = z.object({ outcomes: z.array(z.object({ scope: z.string(), outcome: z.string(), pendingJobs: z.array(z.uuid()).optional() }).passthrough()) }).passthrough();
export async function originalQuiescenceMembers(ctx: ServiceContext, input: OriginalQuiescenceTask, lock = false) {
  if (input.purpose === "amendment") {
    const select = ctx.tx.select().from(subscriptionCommercialAmendments).where(eq(subscriptionCommercialAmendments.termsId, input.amendmentId)).limit(1);
    const [amendment] = await (lock ? select.for("update") : select);
    const [scope] = await ctx.tx.select().from(subscriptionMerchantScopes).where(eq(subscriptionMerchantScopes.subscriptionId, input.subscriptionId)).limit(1);
    const [claim] = await ctx.tx.select().from(jobIdempotencyKeys).where(and(eq(jobIdempotencyKeys.jobId, input.originalJobId), eq(jobIdempotencyKeys.jobName, "subscriptions.activateMerchantAmendment"))).limit(1);
    const [job] = await ctx.tx.execute<{ data: unknown }>(sql`select data from pgboss.job where id=${input.originalJobId}::uuid and name='subscriptions.activateMerchantAmendment' limit 1`);
    const payload = originalAmendmentScheduleTask.strict().safeParse(job?.data);
    if (!amendment || !scope || scope.taxProfileId !== input.profileId || amendment.subscriptionId !== input.subscriptionId || amendment.originalJobId !== input.originalJobId
      || !claim || amendment.jobClaimDigest !== claim.payloadHash || !payload.success || merchantTaxDigest(payload.data) !== claim.payloadHash
      || merchantTaxDigest(payload.data) !== merchantTaxDigest(originalAmendmentScheduleTask.parse(input))) throw new ServiceError("permission", "This stop task is not the retained original accepted-amendment job.");
    return { kind: "amendment" as const, amendment, scopes: [scope], taskReceipt: { purpose: "amendment", amendmentId: amendment.termsId, originalJobId: input.originalJobId } };
  }
  const { request: original, cohort } = await originalScheduleCohortAuthority(ctx.tx, input, lock);
  const scopes = await ctx.tx.select().from(subscriptionMerchantScopes).where(cohort.subscriptionId
    ? and(eq(subscriptionMerchantScopes.subscriptionId, cohort.subscriptionId), eq(subscriptionMerchantScopes.taxProfileId, input.profileId))
    : eq(subscriptionMerchantScopes.taxProfileId, input.profileId)).orderBy(subscriptionMerchantScopes.subscriptionId).limit(5001);
  if (scopes.length > 5000 || !await merchantScheduleCohortInventoryCovers(ctx.tx, cohort, new Set(scopes.map(scope => scope.subscriptionId)))) throw new ServiceError("conflict", "Restore every originally admitted agreement before stopping its schedules.");
  return { kind: "privacy" as const, original, cohort, scopes, taskReceipt: { purpose: "privacy", requestId: input.requestId, cohortId: input.cohortId, originalJobId: input.originalJobId } };
}
export async function originalQuiescenceAction(ctx: ServiceContext, input: OriginalQuiescenceTask, subscriptionId: string, factsOnly = false) {
  await lockContactIdentity(ctx.tx);
  await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.purpose === "privacy" ? `privacy:${input.requestId}` : `commercial-amendment:${input.amendmentId}`}))`);
  const authority = await originalQuiescenceMembers(ctx, input, true), scope = authority.scopes.find(row => row.subscriptionId === subscriptionId);
  if (!scope) throw new ServiceError("permission", "This actual original task does not own that agreement.");
  if (authority.kind === "privacy") {
    const [artifact] = await ctx.tx.select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, authority.original.id)).limit(1).for("update");
    const parsed = receipt.safeParse(artifact?.body), outcome = parsed.success ? parsed.data.outcomes.find(value => value.scope === authority.cohort.privacyScope) : undefined;
    if (!erasureArtifactIsIntact(artifact) || authority.original.status !== "in_progress" || outcome?.outcome !== "pending" || !outcome.pendingJobs?.includes(input.originalJobId)) return null;
  }
  const [parent] = await ctx.tx.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1).for("update");
  const [resource] = await ctx.tx.select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, subscriptionId)).limit(1).for("update");
  if (!parent || !resource || parent.merchantScopeVersion !== 1) throw new ServiceError("conflict", "Restore the original parent and resource before cancellation.");
  const [policy] = await ctx.tx.select({ contactId: subscriptionMarketPolicies.merchantContactId }).from(subscriptionMarketPolicies).where(eq(subscriptionMarketPolicies.subscriptionId, subscriptionId)).limit(1);
  const owners = [...new Set([parent.contactId, ...(policy?.contactId ? [policy.contactId] : []), ...(authority.kind === "privacy" ? [authority.original.contactId] : [])])];
  const [hold] = await ctx.tx.select({ id: privacyRetentionExceptions.id }).from(privacyRetentionExceptions).innerJoin(dataRequests, eq(dataRequests.id, privacyRetentionExceptions.dataRequestId)).where(and(
    inArray(dataRequests.contactId, owners), inArray(privacyRetentionExceptions.scope, ["commerce.money", "commerce.merchantTax", "subscriptions.agreements", "privacy.records"]),
    sql`(${privacyRetentionExceptions.expiresAt} is null or ${privacyRetentionExceptions.expiresAt}>clock_timestamp())`)).limit(1);
  if (hold && !factsOnly) return null;
  const operations = await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.subscriptionId, subscriptionId)).orderBy(subscriptionProviderScheduleOperations.operationRevision).limit(5001);
  return { parent, resource, scope, operations, taskReceipt: authority.taskReceipt, held: !!hold };
}
