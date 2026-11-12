// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: fact and repair admission commit together; receipt repair is separate.
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentity } from "@/core/contacts/identity-lock";
import { defineJob, enqueueJob, registerJob } from "@/core/jobs";
import { erasureArtifactIsIntact, reopenErasureJob } from "@/core/privacy/service";
import { dataRequestArtifacts } from "@/core/privacy/schema";
import { defineService, ServiceError, type Tx } from "@/core/service";
import { subscriptionMerchantScopes } from "./schema";
import { subscriptionProviderScheduleErasures } from "./provider-schedule-schema";

const REPAIR_JOB = "subscriptions.reconcileMerchantScheduleErasure";
const STOP_JOB = "subscriptions.quiesceMerchantSchedules";
const repair = z.object({ subscriptionId: z.uuid(), evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/) });

/** Called in the same short TX as the new original physical/cash witness.
 * There is no crash window waiting for a periodic scan to admit repair work. */
export async function enqueueMerchantScheduleErasureRepair(tx: Tx, input: z.infer<typeof repair>): Promise<void> {
  const [scope] = await tx.select({ profileId: subscriptionMerchantScopes.taxProfileId }).from(subscriptionMerchantScopes)
    .where(eq(subscriptionMerchantScopes.subscriptionId, input.subscriptionId)).limit(1);
  if (!scope) throw new ServiceError("conflict", "Restore the original agreement scope before retaining its erasure repair admission.");
  await tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
  const affected = await tx.update(subscriptionProviderScheduleErasures).set({ state: "pending" }).where(and(eq(subscriptionProviderScheduleErasures.profileId, scope.profileId),
    eq(subscriptionProviderScheduleErasures.privacyScope, "commerce.merchantTax"), sql`${subscriptionProviderScheduleErasures.subscriptionId} is null`)).returning({ id: subscriptionProviderScheduleErasures.id });
  if (!affected.length) return;
  await enqueueJob(tx, REPAIR_JOB, input, { idempotencyKey: `schedule-erasure-evidence:${input.subscriptionId}:${input.evidenceDigest}` });
}

export const reopenMerchantScheduleErasures = defineService({
  name: "subscriptions.reopenMerchantScheduleErasures", summary: "Reopen only retained original merchant erasure cohorts after new durable schedule evidence.",
  kind: "mutation", permission: "system", external: false, auditInputFields: ["subscriptionId"],
  input: repair, output: z.object({ reopened: z.number().int().nonnegative(), recoveryRequired: z.boolean() }),
  handler: async (input, ctx) => {
    await lockContactIdentity(ctx.tx);
    const [scope] = await ctx.tx.select({ profileId: subscriptionMerchantScopes.taxProfileId }).from(subscriptionMerchantScopes)
      .where(eq(subscriptionMerchantScopes.subscriptionId, input.subscriptionId)).limit(1);
    if (!scope) throw new ServiceError("conflict", "The original agreement scope needs restoration before repairing its erasure cohorts.");
    const cohorts = await ctx.tx.select().from(subscriptionProviderScheduleErasures).where(and(eq(subscriptionProviderScheduleErasures.profileId, scope.profileId),
      eq(subscriptionProviderScheduleErasures.privacyScope, "commerce.merchantTax"), sql`${subscriptionProviderScheduleErasures.subscriptionId} is null`))
      .orderBy(subscriptionProviderScheduleErasures.requestId, subscriptionProviderScheduleErasures.id).limit(5001);
    if (cohorts.length > 5000) throw new ServiceError("conflict", "The original erasure cohort inventory needs bounded operator recovery.");
    let reopened = 0, recoveryRequired = false;
    for (const cohort of cohorts) {
      await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`privacy:${cohort.requestId}`}))`);
      const [current] = await ctx.tx.select().from(subscriptionProviderScheduleErasures).where(eq(subscriptionProviderScheduleErasures.id, cohort.id)).limit(1).for("update");
      if (!current || current.profileId !== scope.profileId || current.requestId !== cohort.requestId) throw new ServiceError("conflict", "Restore the immutable original cohort linkage before receipt repair.");
      const [artifact] = await ctx.tx.select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, current.requestId)).limit(1).for("update");
      const parsed = z.object({ outcomes: z.array(z.object({ scope: z.string(), outcome: z.string(), pendingJobs: z.array(z.uuid()).optional() }).passthrough()) }).passthrough().safeParse(artifact?.body);
      const outcome = parsed.success ? parsed.data.outcomes.find(value => value.scope === current.privacyScope) : undefined;
      // Work already visible on its real original task needs no invented
      // replacement task. Failed tasks retain ordinary owner retry/review.
      if (erasureArtifactIsIntact(artifact) && outcome?.outcome === "pending" && outcome.pendingJobs?.includes(current.jobId)) continue;
      const result = await ctx.callAsSystem(reopenErasureJob, { requestId: current.requestId, scope: current.privacyScope, jobName: STOP_JOB,
        jobData: { profileId: current.profileId, cohortId: current.id }, idempotencyKey: `schedule:${input.subscriptionId}:${input.evidenceDigest}` });
      recoveryRequired ||= result.recoveryRequired;
      if (result.jobId) {
        await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
        await ctx.tx.update(subscriptionProviderScheduleErasures).set({ state: "pending", jobId: result.jobId,
          jobKey: `schedule:${input.subscriptionId}:${input.evidenceDigest}`, jobIds: [...new Set([...current.jobIds, result.jobId])] })
          .where(eq(subscriptionProviderScheduleErasures.id, current.id));
        reopened++;
      }
    }
    return { reopened, recoveryRequired };
  },
});

export const reconcileMerchantScheduleErasure = defineJob({
  name: REPAIR_JOB, summary: "Repair original erasure receipts after already-committed subscription evidence.", concurrency: 1, leaseSeconds: 60,
  handler: async data => {
    const result = await reopenMerchantScheduleErasures.call(repair.parse(data), { kind: "system" });
    // Preserve the committed recovery transition on a missing/corrupted artifact.
    if (result.recoveryRequired) throw new ServiceError("conflict", "Restore the exact original erasure receipt before this source repair can finish.");
    return result;
  },
});
registerJob(reconcileMerchantScheduleErasure);
export default [reopenMerchantScheduleErasures];
