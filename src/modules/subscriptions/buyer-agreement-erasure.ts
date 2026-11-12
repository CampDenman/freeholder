// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: original buyer tasks stop schedules before minimization.
import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentity } from "@/core/contacts/identity-lock";
import { enqueueJob } from "@/core/jobs";
import { dataRequestArtifacts, dataRequests, privacyRetentionExceptions } from "@/core/privacy/schema";
import { completeErasureJob, erasureArtifactIsIntact, reopenErasureJob } from "@/core/privacy/service";
import { defineService, ServiceError, type Tx } from "@/core/service";
import { merchantAgreementScheduleState } from "./merchant-agreement-schedule-state";
import { merchantScheduleCohortInventoryCovers } from "./provider-schedule-cohorts";
import { originalScheduleCohortAuthority } from "./provider-schedule-cohort-authority";
import { subscriptionProviderScheduleErasures, subscriptionProviderScheduleResources } from "./provider-schedule-schema";
import { subscriptionCommercialTerms, subscriptionMerchantScopes, subscriptions } from "./schema";

const SCOPE = "subscriptions.agreements";
const JOB = "subscriptions.quiesceMerchantSchedules";
const task = z.object({ profileId: z.uuid(), requestId: z.uuid(), cohortId: z.uuid(), originalJobId: z.uuid() });
const completion = z.object({ settled: z.boolean(), recoveryRequired: z.boolean() });
const artifactBody = z.object({ format: z.literal("freeholder.erasure-receipt"), outcomes: z.array(z.object({
  scope: z.string(), outcome: z.string(), pendingJobs: z.array(z.uuid()).optional(),
}).passthrough()) }).passthrough();

/** Source callers must defer money/customer erasure until these actual tasks
 * converge. This service does not claim their credentials are already erased. */
export const prepareBuyerAgreementErasure = defineService({
  name: "subscriptions.prepareBuyerAgreementErasure", summary: "Admit real original buyer schedule tasks before agreement erasure.",
  kind: "mutation", permission: "system", external: false, auditInputFields: ["requestId"],
  input: z.object({ requestId: z.uuid() }), output: z.object({ pendingJobs: z.array(z.uuid()).max(5000) }),
  handler: async ({ requestId }, ctx) => {
    await lockContactIdentity(ctx.tx);
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`privacy:${requestId}`}))`);
    const [request] = await ctx.tx.select().from(dataRequests).where(eq(dataRequests.id, requestId)).limit(1).for("update");
    if (!request || request.kind !== "erasure" || !request.verifiedAt) throw new ServiceError("permission", "Only the original verified buyer erasure can admit these tasks.");
    const originals = await ctx.tx.select({ subscription: subscriptions, scope: subscriptionMerchantScopes, resource: subscriptionProviderScheduleResources })
      .from(subscriptions).innerJoin(subscriptionMerchantScopes, eq(subscriptionMerchantScopes.subscriptionId, subscriptions.id))
      .leftJoin(subscriptionProviderScheduleResources, eq(subscriptionProviderScheduleResources.subscriptionId, subscriptions.id))
      .where(and(eq(subscriptions.contactId, request.contactId), eq(subscriptions.merchantScopeVersion, 1), eq(subscriptions.billingMode, "provider")))
      .orderBy(subscriptions.id).limit(5001);
    const cohorts = await ctx.tx.select().from(subscriptionProviderScheduleErasures).where(and(
      eq(subscriptionProviderScheduleErasures.requestId, requestId), eq(subscriptionProviderScheduleErasures.privacyScope, SCOPE))).limit(5001);
    if (originals.length > 5000 || cohorts.length > 5000) throw new ServiceError("conflict", "This original buyer inventory needs bounded recovery before erasure admission.");
    const ids = new Set(originals.map(value => value.subscription.id));
    for (const cohort of cohorts) {
      if (!cohort.subscriptionId || !ids.has(cohort.subscriptionId) || !await merchantScheduleCohortInventoryCovers(ctx.tx, cohort, ids)) {
        throw new ServiceError("conflict", "Restore every originally admitted buyer agreement before preparing its erasure.");
      }
    }
    const pendingJobs: string[] = [];
    for (const original of originals) {
      const existing = cohorts.find(cohort => cohort.subscriptionId === original.subscription.id);
      const state = await merchantAgreementScheduleState(ctx, original);
      if (existing) {
        if (!state.safe && existing.state === "completed") throw new ServiceError("conflict", "New original evidence needs its real reopened cohort task before this buyer erasure can converge.");
        if (!state.safe || existing.state !== "completed") pendingJobs.push(existing.jobId);
        continue;
      }
      // Only the retained never-admitted resource and empty actual histories
      // prove no task is needed. A cancelled local status never does.
      if (state.safe && !state.external) continue;
      const id = randomUUID(), originalJobId = randomUUID();
      const jobKey = `buyer-agreement-quiescence:${requestId}:${original.subscription.id}`;
      const job = await enqueueJob(ctx.tx, JOB, { profileId: original.scope.taxProfileId, requestId, cohortId: id, originalJobId,
        originalAgreementIds: [original.subscription.id] }, { id: originalJobId, idempotencyKey: jobKey });
      await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
      await ctx.tx.insert(subscriptionProviderScheduleErasures).values({ id, profileId: original.scope.taxProfileId, subscriptionId: original.subscription.id,
        privacyScope: SCOPE, requestId, originalJobId: job.id, jobId: job.id, jobKey, jobIds: [job.id] });
      pendingJobs.push(job.id);
    }
    ctx.setSubject("dataRequest", requestId);
    return { pendingJobs: [...new Set(pendingJobs)] };
  },
});

/** Retains all immutable money/route observations. Only minimizable original
 * destination and local access grants are cleared after exact stop proof. */
export async function minimizeBuyerAgreements(tx: Tx, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const affected = await tx.update(subscriptions).set({ grants: {}, cancelAtPeriodEnd: true })
    .where(inArray(subscriptions.id, ids)).returning({ id: subscriptions.id });
  await tx.execute(sql`select set_config('freeholder.subscription_scope_v1','1',true)`);
  await tx.update(subscriptionMerchantScopes).set({ taxDestination: null, redactedAt: new Date() })
    .where(and(inArray(subscriptionMerchantScopes.subscriptionId, ids), isNull(subscriptionMerchantScopes.redactedAt)));
  await tx.execute(sql`select set_config('freeholder.subscription_terms_v1','1',true),set_config('freeholder.subscription_terms_privacy_v1','1',true)`);
  await tx.update(subscriptionCommercialTerms).set({ taxDestination: null, redactedAt: new Date() })
    .where(and(inArray(subscriptionCommercialTerms.subscriptionId, ids), isNull(subscriptionCommercialTerms.redactedAt)));
  return affected.length;
}

export const completeBuyerAgreementErasure = defineService({
  name: "subscriptions.completeBuyerAgreementErasure", summary: "Atomically minimize one stopped original buyer agreement and acknowledge only its actual cohort tasks.",
  kind: "mutation", permission: "system", external: false, auditInputFields: ["requestId", "cohortId", "originalJobId"],
  input: task, output: completion,
  handler: async (input, ctx) => {
    await lockContactIdentity(ctx.tx);
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`privacy:${input.requestId}`}))`);
    const { cohort, request } = await originalScheduleCohortAuthority(ctx.tx, input, true);
    if (cohort.privacyScope !== SCOPE || !cohort.subscriptionId || !["in_progress", "completed", "partially_completed"].includes(request.status)) {
      throw new ServiceError("permission", "This task is not an applied original buyer-agreement erasure.");
    }
    const [artifact] = await ctx.tx.select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, request.id)).limit(1).for("update");
    const parsed = artifactBody.safeParse(artifact?.body);
    const outcome = parsed.success ? parsed.data.outcomes.find(value => value.scope === SCOPE) : undefined;
    if (!erasureArtifactIsIntact(artifact) || !outcome) {
      await ctx.callAsSystem(reopenErasureJob, { requestId: request.id, scope: SCOPE, jobName: JOB,
        jobData: { profileId: cohort.profileId, cohortId: cohort.id }, idempotencyKey: `buyer-artifact:${input.originalJobId}` });
      return { settled: false, recoveryRequired: true };
    }
    const [original] = await ctx.tx.select({ subscription: subscriptions, scope: subscriptionMerchantScopes, resource: subscriptionProviderScheduleResources })
      .from(subscriptions).innerJoin(subscriptionMerchantScopes, eq(subscriptionMerchantScopes.subscriptionId, subscriptions.id))
      .leftJoin(subscriptionProviderScheduleResources, eq(subscriptionProviderScheduleResources.subscriptionId, subscriptions.id))
      .where(eq(subscriptions.id, cohort.subscriptionId)).limit(1).for("update", { of: subscriptions });
    if (!original || !await merchantScheduleCohortInventoryCovers(ctx.tx, cohort, new Set([cohort.subscriptionId]))) {
      throw new ServiceError("conflict", "Restore the exact original buyer agreement and durable task inventory before completion.");
    }
    const state = await merchantAgreementScheduleState(ctx, original);
    if (!state.safe) return { settled: false, recoveryRequired: false };
    if (outcome.outcome === "erased" && cohort.state === "completed" && original.scope.redactedAt) return { settled: true, recoveryRequired: false };
    if (outcome.outcome !== "pending" || !outcome.pendingJobs?.includes(input.originalJobId)) return { settled: false, recoveryRequired: true };
    const [hold] = await ctx.tx.select({ id: privacyRetentionExceptions.id }).from(privacyRetentionExceptions)
      .innerJoin(dataRequests, eq(dataRequests.id, privacyRetentionExceptions.dataRequestId)).where(and(eq(dataRequests.contactId, request.contactId),
        inArray(privacyRetentionExceptions.scope, [SCOPE, "commerce.money", "privacy.records"]),
        or(isNull(privacyRetentionExceptions.expiresAt), gt(privacyRetentionExceptions.expiresAt, new Date())))).limit(1);
    if (hold) return { settled: false, recoveryRequired: false };
    await minimizeBuyerAgreements(ctx.tx, [cohort.subscriptionId]);
    // Siblings must be in this same original cohort; never acknowledge another
    // agreement or another source based on a shared request ID alone.
    for (const jobId of new Set(cohort.jobIds)) await ctx.callAsSystem(completeErasureJob, { requestId: request.id, scope: SCOPE, jobId });
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
    await ctx.tx.update(subscriptionProviderScheduleErasures).set({ state: "completed", completedAt: cohort.completedAt ?? new Date() })
      .where(eq(subscriptionProviderScheduleErasures.id, cohort.id));
    ctx.setSubject("subscription", cohort.subscriptionId);
    return { settled: true, recoveryRequired: false };
  },
});
export default [prepareBuyerAgreementErasure, completeBuyerAgreementErasure];
