// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C9.38: accepted promises activate after real original quiescence.
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { defineJob, registerJob } from "@/core/jobs";
import { defineService, ServiceError } from "@/core/service";
import { subscriptionCommercialAmendments } from "./commercial-amendment-schema";
import { originalAmendmentScheduleTask, originalQuiescenceMembers, originalQuiescenceAction } from "./provider-quiescence-authority";
import { merchantAgreementScheduleState } from "./merchant-agreement-schedule-state";
import { currentProviderGeneration } from "./provider-generations";
import { quiesceOriginalScheduleTask } from "./merchant-tax-quiescence";
import { createMerchantPhaseProduct } from "./provider-phase-products";
import { providerPhaseInventory } from "./provider-phase-contract";
import { phaseOperationCallerFinished } from "./provider-phase-resources";
import { admitMerchantProviderPhases, flushMerchantProviderPhaseFinishes } from "./provider-phase-dispatch";
import { quoteMerchantProviderHorizon } from "./provider-phase-quote";
import { recoverMerchantSchedule } from "./provider-schedule-recovery";
import { subscriptionProviderScheduleOperations } from "./provider-schedule-schema";

export const merchantAmendmentTaskState = defineService({
  name: "subscriptions.merchantAmendmentTaskState", summary: "Read only the actual accepted amendment job's original generation and physical operation.",
  kind: "query", permission: "system", external: false, input: originalAmendmentScheduleTask,
  output: z.object({ activated: z.boolean(), currentOperationId: z.uuid().nullable(), verified: z.boolean() }),
  handler: async (input, ctx) => {
    const authority = await originalQuiescenceMembers(ctx, input);
    if (authority.kind !== "amendment") throw new ServiceError("permission", "This is not an original accepted-amendment task.");
    const generation = await currentProviderGeneration(ctx, input.subscriptionId);
    const own = generation?.termsId === authority.amendment.termsId ? generation : null;
    const [operation] = own ? await ctx.tx.select().from(subscriptionProviderScheduleOperations).where(eq(subscriptionProviderScheduleOperations.id, own.firstOperationId)).limit(1) : [];
    const inventory = providerPhaseInventory.safeParse(operation?.providerObservation.phaseInventory);
    return { activated: authority.amendment.state === "activated", currentOperationId: own?.firstOperationId ?? null,
      verified: !!operation && operation.state === "confirmed" && phaseOperationCallerFinished(operation) && inventory.success && inventory.data.operationId === operation.id && inventory.data.requestDigest === operation.requestDigest };
  },
});
export const activateAcceptedMerchantAmendment = defineService({
  name: "subscriptions.activateAcceptedAmendment", summary: "Activate an already accepted future amendment only after its original provider and financial work is safe.",
  kind: "mutation", permission: "system", external: false, auditInputFields: ["amendmentId", "subscriptionId"], input: originalAmendmentScheduleTask, output: z.object({ ready: z.boolean() }),
  handler: async (input, ctx) => {
    const authority = await originalQuiescenceAction(ctx, input, input.subscriptionId);
    if (!authority) return { ready: false };
    const [amendment] = await ctx.tx.select().from(subscriptionCommercialAmendments).where(eq(subscriptionCommercialAmendments.termsId, input.amendmentId)).limit(1).for("update");
    if (!amendment || authority.parent.cancelledAt || authority.parent.cancelAtPeriodEnd || !["active", "trialing"].includes(authority.parent.status)) throw new ServiceError("conflict", "The original agreement stopped before this future amendment could resume billing.");
    if (amendment.state === "activated") return { ready: true };
    const proof = await merchantAgreementScheduleState(ctx, { subscription: authority.parent, scope: authority.scope, resource: authority.resource });
    if (!proof.safe) return { ready: false };
    await ctx.tx.execute(sql`select set_config('freeholder.subscription_amendment_v1','1',true)`);
    await ctx.tx.update(subscriptionCommercialAmendments).set({ state: "activated", activatedAt: new Date() }).where(eq(subscriptionCommercialAmendments.termsId, amendment.termsId));
    ctx.setSubject("subscription", input.subscriptionId); return { ready: true };
  },
});
export const activateMerchantAmendmentJob = defineJob({
  name: "subscriptions.activateMerchantAmendment", summary: "Stop original provider work and resume only an explicitly accepted original amendment.", concurrency: 1, leaseSeconds: 120,
  handler: async (data, context) => {
    const input = originalAmendmentScheduleTask.strict().parse(data);
    if (context && context.id !== input.originalJobId) throw new ServiceError("permission", "The running worker is not the accepted amendment's original job.");
    await context?.throwIfCancelled();
    let state = await merchantAmendmentTaskState.call(input, { kind: "system" });
    if (!state.currentOperationId) {
      await quiesceOriginalScheduleTask(input, context);
      if (!(await activateAcceptedMerchantAmendment.call(input, { kind: "system" })).ready) throw new ServiceError("conflict", "Original provider resources, money or current holds still prevent this accepted amendment.");
      await createMerchantPhaseProduct.call({ subscriptionId: input.subscriptionId }, { kind: "system" });
      const horizon = await quoteMerchantProviderHorizon.call({ subscriptionId: input.subscriptionId, additionalPeriods: 3 }, { kind: "system" });
      if (horizon.termsId !== input.amendmentId) throw new ServiceError("conflict", "Review the actual accepted amendment before admitting a different future horizon.");
      const created = await admitMerchantProviderPhases.call({ subscriptionId: input.subscriptionId, additionalPeriods: 3, expectedHorizonDigest: horizon.horizonDigest }, { kind: "system" });
      if (!created.verified) throw new ServiceError("conflict", "The original new-generation caller remains recovery debt; another POST is not admitted.");
    } else {
      // Retrying a physical unknown recovers its original caller/GET; it never
      // stops that new generation merely to create another duplicate schedule.
      await flushMerchantProviderPhaseFinishes(input.subscriptionId);
      state = await merchantAmendmentTaskState.call(input, { kind: "system" });
      if (!state.verified && !(await recoverMerchantSchedule.call({ operationId: state.currentOperationId! }, { kind: "system" })).verified) throw new ServiceError("conflict", "Recover the original admitted generation before completing its accepted amendment.");
    }
    return { activated: true };
  },
});
registerJob(activateMerchantAmendmentJob);
export default [merchantAmendmentTaskState, activateAcceptedMerchantAmendment];
