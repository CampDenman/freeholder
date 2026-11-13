// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C9.38: actual agreement/consent/task producers; synthetic provider HTTP.
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/core/db";
import { getJob, stopJobs } from "@/core/jobs";
import { ready } from "@/core/runtime";
import { acceptMerchantAmendment, quoteMerchantAmendment, quoteMyMerchantAmendment, AMENDMENT_JOB } from "@/modules/subscriptions/commercial-amendments";
import { activateMerchantAmendmentJob } from "@/modules/subscriptions/commercial-amendment-jobs";
import { subscriptionCommercialAmendments } from "@/modules/subscriptions/commercial-amendment-schema";
import { subscriptionProviderGenerations } from "@/modules/subscriptions/provider-generation-schema";
import { subscriptionProviderScheduleResources } from "@/modules/subscriptions/provider-schedule-schema";
import { subscriptionCommercialTerms, subscriptions } from "@/modules/subscriptions/schema";
import { savePlan } from "@/modules/subscriptions/service";
import { seedActualProviderSubscription80 } from "../helpers/merchant-subscription80";
import { closeDb, CUSTOMER, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("explicit original commercial amendment lifecycle", { timeout: 60000 }, () => {
  let source: Awaited<ReturnType<typeof seedActualProviderSubscription80>> | undefined;
  beforeAll(ready, 60000); beforeEach(truncateSpine);
  afterEach(() => { vi.useRealTimers(); source?.fixture.cleanup(); source = undefined; vi.restoreAllMocks(); });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  async function offered() {
    source = await seedActualProviderSubscription80(); expect((await source.create()).verified).toBe(true);
    const next = await savePlan.call({ productId: source.plan.productId, name: "Accepted future two-month plan", interval: "month", intervalCount: 2,
      trialDays: 0, setupFeeMinor: 0, billingMode: "provider", cancelBehaviour: "period_end", proration: "none", status: "active" }, OWNER);
    const input = { id: source.accepted.subscription.id, planId: next.id, taxDestination: { country: "CA", region: "BC" }, locale: "en" as const };
    return { next, input };
  }
  it("keeps old terms/resources immutable and resumes the accepted offer with a distinct actual generation", async () => {
    const { next, input } = await offered(); if (!source) throw new Error("Missing actual original fixture");
    const [originalTerms] = await db().select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.subscriptionId, input.id));
    const originalCreator = (await source.operations()).find(operation => operation.kind === "create");
    const [oldResource] = await db().select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, input.id));
    const review = await quoteMerchantAmendment.call(input, OWNER);
    const accepted = await acceptMerchantAmendment.call({ ...input, previousTermsId: review.previousTermsId, acceptedQuoteDigest: review.quoteDigest, confirm: true }, OWNER);
    expect(accepted.state).toBe("pending_stop");
    const [pending] = await db().select().from(subscriptions).where(eq(subscriptions.id, input.id));
    expect(pending?.planId).toBe(source.plan.id); expect(pending?.pendingPlanId).toBe(next.id); expect(pending?.currentPeriodEnd).toEqual(source.accepted.subscription.currentPeriodEnd);
    const [receipt] = await db().select().from(subscriptionCommercialAmendments).where(eq(subscriptionCommercialAmendments.termsId, accepted.termsId));
    if (!receipt?.originalJobId) throw new Error("The real consent service did not retain its actual original job");
    const job = await getJob(AMENDMENT_JOB, receipt.originalJobId); if (!job) throw new Error("The actual consent job has no retained payload");
    // The actual queued payload enters the registered body. This does not claim
    // a live lease, scheduler acceptance or a real external provider account.
    await activateMerchantAmendmentJob.handler(job.data);
    const generations = await db().select().from(subscriptionProviderGenerations).where(eq(subscriptionProviderGenerations.subscriptionId, input.id)).orderBy(subscriptionProviderGenerations.sequence);
    expect(generations).toHaveLength(2); expect(generations[0]?.providerScheduleRef).not.toBe(generations[1]?.providerScheduleRef);
    expect(generations[1]).toMatchObject({ termsId: accepted.termsId, previousGenerationId: generations[0]!.id, providerSubscriptionRef: null });
    expect(source.remote.productPosts()).toBe(1); expect(source.remote.schedulePosts()).toBe(2); expect(source.remote.cancelPosts()).toBe(1);
    await activateMerchantAmendmentJob.handler(job.data); expect(source.remote.schedulePosts()).toBe(2); expect(source.remote.cancelPosts()).toBe(1);
    const [first] = await db().select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.id, originalTerms!.id)); expect(first).toEqual(originalTerms);
    const creator = (await source.operations()).find(operation => operation.id === originalCreator!.id); expect(creator).toEqual(originalCreator);
    const [resource] = await db().select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, input.id));
    expect(resource?.providerSubscriptionRef).toBe(oldResource?.providerSubscriptionRef); expect(resource?.providerCustomerRef).toBe(oldResource?.providerCustomerRef);
    const [after] = await db().select().from(subscriptions).where(eq(subscriptions.id, input.id)); expect(after?.planId).toBe(source.plan.id); // No paid amended-period invoice yet.
  });
  it("refuses another customer's review and an altered opaque acceptance without another provider caller", async () => {
    const { input } = await offered(); if (!source) throw new Error("Missing actual original fixture");
    await expect(quoteMyMerchantAmendment.call(input, CUSTOMER)).rejects.toMatchObject({ code: "not_found" });
    const review = await quoteMerchantAmendment.call(input, OWNER);
    await expect(acceptMerchantAmendment.call({ ...input, previousTermsId: review.previousTermsId, acceptedQuoteDigest: "f".repeat(64), confirm: true }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    expect(await db().select().from(subscriptionCommercialAmendments)).toHaveLength(0); expect(source.remote.schedulePosts()).toBe(1);
  });
});
