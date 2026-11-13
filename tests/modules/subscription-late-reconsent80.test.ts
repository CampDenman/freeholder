// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C9.38: actual original producers and retained task bodies; synthetic HTTP/clock.
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/core/db";
import { getJob, stopJobs } from "@/core/jobs";
import { ready } from "@/core/runtime";
import { AMENDMENT_JOB, acceptMerchantAmendment, quoteMerchantAmendment } from "@/modules/subscriptions/commercial-amendments";
import { activateMerchantAmendmentJob } from "@/modules/subscriptions/commercial-amendment-jobs";
import { subscriptionCommercialAmendments } from "@/modules/subscriptions/commercial-amendment-schema";
import { subscriptionCommercialResumptions } from "@/modules/subscriptions/commercial-resumption-schema";
import { subscriptionProviderGenerations } from "@/modules/subscriptions/provider-generation-schema";
import { prepareMerchantPhaseProductRead, recoverMerchantPhaseProduct } from "@/modules/subscriptions/provider-phase-product-recovery";
import { subscriptionProviderScheduleResources } from "@/modules/subscriptions/provider-schedule-schema";
import { subscriptionCommercialTerms, subscriptionProviderChargeReceipts, subscriptions } from "@/modules/subscriptions/schema";
import { invoices, payments } from "@/modules/invoicing/schema";
import { savePlan } from "@/modules/subscriptions/service";
import { seedActualProviderSubscription80 } from "../helpers/merchant-subscription80";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
describe.runIf(hasDatabase)("fresh explicit consent after a missed provider boundary", { timeout: 60000 }, () => {
  let source: Awaited<ReturnType<typeof seedActualProviderSubscription80>> | undefined;
  beforeAll(ready, 60000); beforeEach(truncateSpine);
  afterEach(() => { vi.useRealTimers(); source?.fixture.cleanup(); source = undefined; vi.restoreAllMocks(); });
  afterAll(async () => { await stopJobs(); await closeDb(); });
  async function accept(input: Parameters<typeof quoteMerchantAmendment.call>[0]) {
    const review = await quoteMerchantAmendment.call(input, OWNER);
    const accepted = await acceptMerchantAmendment.call({ ...input, previousTermsId: review.previousTermsId, acceptedQuoteDigest: review.quoteDigest, confirm: true }, OWNER);
    const [receipt] = await db().select().from(subscriptionCommercialAmendments).where(eq(subscriptionCommercialAmendments.termsId, accepted.termsId));
    if (!receipt?.originalJobId) throw new Error("The actual acceptance did not retain its original job");
    const job = await getJob(AMENDMENT_JOB, receipt.originalJobId); if (!job) throw new Error("The real original task has no retained payload");
    return { accepted, receipt, job };
  }
  it("preserves the missed consent/claim and starts only the freshly reviewed future calendar; stale jobs stay inert", async () => {
    const actualNow = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(actualNow - 8 * 86400000);
    source = await seedActualProviderSubscription80(); // Product exists; no phase POST has ever been admitted.
    const next = await savePlan.call({ productId: source.plan.productId, name: "Freshly reviewed late offer", interval: "month", intervalCount: 2,
      billingMode: "provider", proration: "none", status: "active" }, OWNER);
    const input = { id: source.accepted.subscription.id, planId: next.id, taxDestination: { country: "CA", region: "BC" }, locale: "en" as const };
    const missed = await accept(input);
    const [oldTerms] = await db().select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.id, missed.accepted.termsId));
    const oldPayloadHash = createHash("sha256").update(JSON.stringify(missed.job.data)).digest("hex");
    vi.setSystemTime(actualNow); // The missed boundary is also before the real PostgreSQL clock.
    await expect(quoteMerchantAmendment.call(input, OWNER)).rejects.toMatchObject({ code: "conflict" });
    const resumeAt = new Date(Date.now() + 3600000).toISOString();
    const fresh = await accept({ ...input, resumeAt });
    const [resumption] = await db().select().from(subscriptionCommercialResumptions).where(eq(subscriptionCommercialResumptions.termsId, fresh.accepted.termsId));
    expect(resumption).toMatchObject({ previousTermsId: oldTerms!.id, originalPeriodEnd: source.accepted.subscription.currentPeriodEnd, acceptedPeriodStart: new Date(resumeAt), generationId: null });
    await expect(db().update(subscriptionCommercialResumptions).set({ acceptedPeriodStart: new Date(Date.parse(resumeAt) + 1000) })
      .where(eq(subscriptionCommercialResumptions.termsId, fresh.accepted.termsId))).rejects.toThrow();
    expect(await activateMerchantAmendmentJob.handler(missed.job.data)).toMatchObject({ activated: false, superseded: true }); expect(source.remote.schedulePosts()).toBe(0);
    await activateMerchantAmendmentJob.handler(fresh.job.data); expect(source.remote.schedulePosts()).toBe(1);
    const [generation] = await db().select().from(subscriptionProviderGenerations); expect(generation?.termsId).toBe(fresh.accepted.termsId);
    expect(source.remote.schedule()).toHaveProperty("phases.0.start_date", Date.parse(resumeAt) / 1000);
    await activateMerchantAmendmentJob.handler(missed.job.data); expect(source.remote.schedulePosts()).toBe(1); expect(source.remote.cancelPosts()).toBe(0);
    expect((await db().select().from(subscriptionCommercialTerms).where(eq(subscriptionCommercialTerms.id, oldTerms!.id)))[0]).toEqual(oldTerms);
    const retained = await getJob(AMENDMENT_JOB, missed.job.id); expect(createHash("sha256").update(JSON.stringify(retained!.data)).digest("hex")).toBe(oldPayloadHash);
    const [parent] = await db().select().from(subscriptions).where(eq(subscriptions.id, input.id)); expect(parent?.planId).toBe(source.plan.id); expect(parent?.currentPeriodEnd).toEqual(source.accepted.subscription.currentPeriodEnd);
    expect(await db().select().from(subscriptionProviderChargeReceipts)).toHaveLength(0); expect(await db().select().from(invoices)).toHaveLength(0); expect(await db().select().from(payments)).toHaveLength(0);
  });
  it("refuses fresh calendar consent while an actual original creator remains unknown, preserving its positive ACK", async () => {
    const actualNow = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(actualNow - 8 * 86400000);
    source = await seedActualProviderSubscription80({ failFirstPrice: true }); await expect(source.create()).rejects.toThrow();
    const before = await source.operations(); expect(before.find(operation => operation.kind === "create")?.positiveObserved).toBe(true);
    vi.setSystemTime(actualNow);
    await expect(quoteMerchantAmendment.call({ id: source.accepted.subscription.id, planId: source.plan.id, taxDestination: { country: "CA", region: "BC" },
      resumeAt: new Date(Date.now() + 3600000).toISOString() }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    expect(await source.operations()).toEqual(before); expect(source.remote.schedulePosts()).toBe(1); expect(await db().select().from(subscriptionCommercialResumptions)).toHaveLength(0);
  });
  it("keeps an older admitted product reader as debt after a later actual GET returns", async () => {
    const actualNow = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(actualNow - 8 * 86400000);
    source = await seedActualProviderSubscription80();
    const product = (await source.operations()).find(operation => operation.kind === "create_product");
    if (!product) throw new Error("No actual original product operation");
    const pending = await prepareMerchantPhaseProductRead.call({ operationId: product.id }, { kind: "system" });
    await recoverMerchantPhaseProduct.call({ operationId: product.id }, { kind: "system" });
    const [resource] = await db().select().from(subscriptionProviderScheduleResources).where(eq(subscriptionProviderScheduleResources.subscriptionId, product.subscriptionId));
    expect(resource?.recoveryPending).toBe(true);
    const original = (await source.operations()).find(operation => operation.id === product.id)!;
    const history = original.providerObservation.history as Array<Record<string, unknown>>;
    expect(history.some(entry => entry.source === "phase_product_read_finished" && entry.readId === pending.readId)).toBe(false);
    expect(history.some(entry => entry.source === "phase_product_read_finished" && entry.readId !== pending.readId && entry.outcome === "returned")).toBe(true);
    vi.setSystemTime(actualNow);
    await expect(quoteMerchantAmendment.call({ id: product.subscriptionId, planId: source.plan.id, taxDestination: { country: "CA", region: "BC" },
      resumeAt: new Date(Date.now() + 3600000).toISOString() }, OWNER)).rejects.toMatchObject({ code: "conflict" });
    expect(source.remote.schedulePosts()).toBe(0); expect(await db().select().from(subscriptionCommercialResumptions)).toHaveLength(0);
  });
});
