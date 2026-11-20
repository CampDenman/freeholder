// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: fact and repair admission commit together; receipt repair is separate.
import { and, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { lockContactIdentity } from "@/core/contacts/identity-lock";
import { defineJob, enqueueJob, registerJob } from "@/core/jobs";
import { erasureArtifactIsIntact, reopenErasureJob } from "@/core/privacy/service";
import { dataRequestArtifacts } from "@/core/privacy/schema";
import { defineService, getService, ServiceError, type ServiceContext, type Tx } from "@/core/service";
import { merchantTaxDigest } from "@/modules/invoicing/merchant-tax-store";
import { subscriptionMerchantScopes, subscriptions } from "./schema";
import { merchantAgreementScheduleState } from "./merchant-agreement-schedule-state";
import { subscriptionProviderScheduleErasures, subscriptionProviderScheduleResources } from "./provider-schedule-schema";

const REPAIR_JOB = "subscriptions.reconcileMerchantScheduleErasure";
const STOP_JOB = "subscriptions.quiesceMerchantSchedules";
const repair = z.object({ subscriptionId: z.uuid(), evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/) });
const profileRepair = z.object({ profileId: z.uuid(), sourceKey: z.string().trim().min(1).max(150), evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/) });
const result = z.object({ reopened: z.number().int().nonnegative(), recoveryRequired: z.boolean() });

/** Called in the same short TX as the new original physical/cash witness.
 * There is no crash window waiting for a periodic scan to admit repair work. */
export async function enqueueMerchantScheduleErasureRepair(tx: Tx, input: z.infer<typeof repair>): Promise<void> {
  const [scope] = await tx.select({ profileId: subscriptionMerchantScopes.taxProfileId }).from(subscriptionMerchantScopes)
    .where(eq(subscriptionMerchantScopes.subscriptionId, input.subscriptionId)).limit(1);
  if (!scope) throw new ServiceError("conflict", "Restore the original agreement scope before retaining its erasure repair admission.");
  await tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
  const affected = await tx.update(subscriptionProviderScheduleErasures).set({ state: "pending" }).where(and(eq(subscriptionProviderScheduleErasures.profileId, scope.profileId),
    or(and(eq(subscriptionProviderScheduleErasures.privacyScope, "commerce.merchantTax"), sql`${subscriptionProviderScheduleErasures.subscriptionId} is null`),
      and(eq(subscriptionProviderScheduleErasures.privacyScope, "subscriptions.agreements"), eq(subscriptionProviderScheduleErasures.subscriptionId, input.subscriptionId))))).returning({ id: subscriptionProviderScheduleErasures.id });
  if (!affected.length) return;
  await enqueueJob(tx, REPAIR_JOB, input, { idempotencyKey: `schedule-erasure-evidence:${input.subscriptionId}:${input.evidenceDigest}` });
}

export const reopenMerchantScheduleErasures = defineService({
  name: "subscriptions.reopenMerchantScheduleErasures", summary: "Reopen only retained original merchant erasure cohorts after new durable schedule evidence.",
  kind: "mutation", permission: "system", external: false, auditInputFields: ["subscriptionId"],
  input: repair, output: result,
  handler: async (input, ctx) => {
    await lockContactIdentity(ctx.tx);
    const [scope] = await ctx.tx.select({ profileId: subscriptionMerchantScopes.taxProfileId }).from(subscriptionMerchantScopes)
      .where(eq(subscriptionMerchantScopes.subscriptionId, input.subscriptionId)).limit(1);
    if (!scope) throw new ServiceError("conflict", "The original agreement scope needs restoration before repairing its erasure cohorts.");
    return reconcileOriginalProfile(ctx, { profileId: scope.profileId, sourceKey: `subscription:${input.subscriptionId}`, evidenceDigest: input.evidenceDigest });
  },
});

/** Called AFTER a financial fact commits. The financial owner supplies the
 * profile from its immutable original receipt, never a current account/email.
 * This phase cannot decide that money was returned or a provider call stopped. */
export const reconcileMerchantTaxErasureEvidence = defineService({
  name: "subscriptions.reconcileMerchantTaxErasureEvidence", summary: "Repair retained original merchant erasure cohorts after independently committed financial evidence.",
  kind: "mutation", permission: "system", external: false, auditInputFields: ["profileId"],
  input: profileRepair, output: result,
  handler: async (input, ctx) => {
    await lockContactIdentity(ctx.tx);
    ctx.setSubject("merchantTaxProfile", input.profileId);
    return reconcileOriginalProfile(ctx, input);
  },
});

async function reconcileOriginalProfile(ctx: ServiceContext, input: z.infer<typeof profileRepair>): Promise<z.infer<typeof result>> {
    const cohorts = await ctx.tx.select().from(subscriptionProviderScheduleErasures).where(eq(subscriptionProviderScheduleErasures.profileId, input.profileId))
      .orderBy(subscriptionProviderScheduleErasures.requestId, subscriptionProviderScheduleErasures.id).limit(5001);
    if (cohorts.length > 5000) throw new ServiceError("conflict", "The original erasure cohort inventory needs bounded operator recovery.");
    let reopened = 0, recoveryRequired = false, currentlySafe = false;
    if (!cohorts.length) return { reopened, recoveryRequired };
    const guard = getService("subscriptions.assertMerchantTaxRevisionSafe");
    if (guard) {
      try { currentlySafe = z.object({ safe: z.literal(true) }).parse(await ctx.callAsSystem(guard, { profileId: input.profileId })).safe; }
      catch (error) { if (!(error instanceof ServiceError) || error.code !== "conflict") throw error; }
    }
    for (const cohort of cohorts) {
      await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`privacy:${cohort.requestId}`}))`);
      const [current] = await ctx.tx.select().from(subscriptionProviderScheduleErasures).where(eq(subscriptionProviderScheduleErasures.id, cohort.id)).limit(1).for("update");
      if (!current || current.profileId !== input.profileId || current.requestId !== cohort.requestId) throw new ServiceError("conflict", "Restore the immutable original cohort linkage before receipt repair.");
      let cohortSafe = currentlySafe;
      if (current.privacyScope === "subscriptions.agreements") {
        const [original] = current.subscriptionId ? await ctx.tx.select({ subscription: subscriptions, scope: subscriptionMerchantScopes, resource: subscriptionProviderScheduleResources })
          .from(subscriptions).innerJoin(subscriptionMerchantScopes, eq(subscriptionMerchantScopes.subscriptionId, subscriptions.id))
          .leftJoin(subscriptionProviderScheduleResources, eq(subscriptionProviderScheduleResources.subscriptionId, subscriptions.id))
          .where(eq(subscriptions.id, current.subscriptionId)).limit(1) : [];
        cohortSafe = !!original && original.scope.taxProfileId === current.profileId && (await merchantAgreementScheduleState(ctx, original)).safe;
      }
      const [artifact] = await ctx.tx.select().from(dataRequestArtifacts).where(eq(dataRequestArtifacts.dataRequestId, current.requestId)).limit(1).for("update");
      const parsed = z.object({ outcomes: z.array(z.object({ scope: z.string(), outcome: z.string(), pendingJobs: z.array(z.uuid()).optional() }).passthrough()) }).passthrough().safeParse(artifact?.body);
      const outcome = parsed.success ? parsed.data.outcomes.find(value => value.scope === current.privacyScope) : undefined;
      const repairBuyerMoney = async () => {
        if (current.privacyScope !== "subscriptions.agreements") return;
        const money = getService("invoicing.reopenBuyerMoneyErasure");
        if (!money) throw new ServiceError("conflict", "Restore the original buyer money-finisher repair phase before completing this schedule repair.");
        const repaired = z.object({ recoveryRequired: z.boolean() }).passthrough().parse(await ctx.callAsSystem(money, {
          requestId: current.requestId, sourceKey: input.sourceKey, evidenceDigest: input.evidenceDigest,
        }));
        recoveryRequired ||= repaired.recoveryRequired;
      };
      // Another real cohort task may already have covered this delayed
      // notification. Current complete provider/financial proof, not a clock
      // or an old completed flag alone, permits that duplicate to converge.
      if (current.state === "completed" && cohortSafe && erasureArtifactIsIntact(artifact) && outcome?.outcome === "erased") continue;
      // Work already visible on its real original task needs no invented
      // replacement task. Failed tasks retain ordinary owner retry/review.
      if (erasureArtifactIsIntact(artifact) && outcome?.outcome === "pending" && outcome.pendingJobs?.includes(current.jobId)) { await repairBuyerMoney(); continue; }
      // The last actual job identity separates a genuinely reopened generation
      // from a completed idempotent task. A retry while pending reuses its real
      // task above; it never produces another physical provider mutation.
      const key = `merchant:${merchantTaxDigest({ profileId: input.profileId, sourceKey: input.sourceKey, evidenceDigest: input.evidenceDigest, previousJobId: current.jobId })}`;
      const reopenedJob = await ctx.callAsSystem(reopenErasureJob, { requestId: current.requestId, scope: current.privacyScope, jobName: STOP_JOB,
        jobData: { profileId: current.profileId, cohortId: current.id }, idempotencyKey: key });
      recoveryRequired ||= reopenedJob.recoveryRequired;
      if (reopenedJob.jobId) {
        await ctx.tx.execute(sql`select set_config('freeholder.subscription_schedule_v1','1',true)`);
        await ctx.tx.update(subscriptionProviderScheduleErasures).set({ state: "pending", jobId: reopenedJob.jobId,
          jobKey: key, jobIds: [...new Set([...current.jobIds, reopenedJob.jobId])] })
          .where(eq(subscriptionProviderScheduleErasures.id, current.id));
        reopened++;
      }
      await repairBuyerMoney();
    }
    return { reopened, recoveryRequired };
}

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
export default [reopenMerchantScheduleErasures, reconcileMerchantTaxErasureEvidence];
