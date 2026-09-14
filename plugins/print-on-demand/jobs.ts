// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { defineJob } from "@/core/jobs";
import { podWorkBatch, refreshPodJob, submitPodJob } from "./service";

export const submitQueuedPodJobs = defineJob({
  name: "printOnDemand.submitQueued",
  summary: "Submit queued and retry failed print-on-demand jobs.",
  schedule: "7,37 * * * *",
  handler: async () => {
    const actor = { kind: "system" as const };
    const jobs = await podWorkBatch.call({ kind: "submit" }, actor);
    for (const job of jobs) {
      await submitPodJob.call({ jobId: job.id }, actor);
    }
  },
});

export const refreshSubmittedPodJobs = defineJob({
  name: "printOnDemand.refreshSubmitted", summary: "Refresh submitted print jobs from provider shipment evidence.",
  schedule: "17,47 * * * *",
  handler: async () => {
    const actor = { kind: "system" as const };
    const jobs = await podWorkBatch.call({ kind: "refresh" }, actor);
    for (const job of jobs) await refreshPodJob.call({ jobId: job.id }, actor);
  },
});

export default [submitQueuedPodJobs, refreshSubmittedPodJobs];
