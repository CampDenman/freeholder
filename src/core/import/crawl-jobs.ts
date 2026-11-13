// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: bounded durable cleanup/reconciliation; source-only, unregistered.
import { defineJob } from "@/core/jobs";
import { CRAWL_ERASURE_JOB, CRAWL_RECONCILIATION_JOB, eraseCrawlOriginals, reconcileCrawlOriginalObservation } from "./crawl-privacy";
import { retireExpiredCrawls } from "./crawl-retirement";

export const eraseOriginalCrawlJob = defineJob({
  name: CRAWL_ERASURE_JOB,
  summary: "Confirm exact original HTTP response removal before acknowledging reader erasure.",
  retry: { limit: 40, delaySeconds: 60, backoff: true, maxDelaySeconds: 3600 }, concurrency: 1,
  handler: async (data, context) => {
    if (!context) throw new Error("Original HTTP erasure requires a durable worker identity.");
    await context.throwIfCancelled();
    return eraseCrawlOriginals(data);
  },
});

export const reconcileOriginalCrawlJob = defineJob({
  name: CRAWL_RECONCILIATION_JOB,
  summary: "Retry original-scope HTTP erasure evidence after a missed callback or older-image observation.",
  schedule: "*/5 * * * *", concurrency: 1,
  handler: async (data, context) => {
    if (!context) throw new Error("Original HTTP reconciliation requires a durable worker identity.");
    await context.throwIfCancelled();
    // The SYSTEM service admits any bounded continuation durably, in its
    // own transaction. This process is not the fairness cursor's authority.
    return reconcileCrawlOriginalObservation.call(data, { kind: "system" });
  },
});

export const retireOriginalCrawlJob = defineJob({
  name: "core.retireExpiredCrawls",
  summary: "Retire expired original HTTP windows and retry safe cleanup with holds and unknown outcomes preserved.",
  schedule: "*/15 * * * *", concurrency: 1,
  handler: async (_data, context) => {
    if (!context) throw new Error("Original HTTP retirement requires a durable worker identity.");
    await context.throwIfCancelled();
    return retireExpiredCrawls.call({ limit: 25 }, { kind: "system" });
  },
});

export const crawlJobs = [eraseOriginalCrawlJob, reconcileOriginalCrawlJob, retireOriginalCrawlJob];
