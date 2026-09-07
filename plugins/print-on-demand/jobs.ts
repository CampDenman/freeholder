// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { defineJob } from "@/core/jobs";
import { listPodJobs, submitPodJob } from "./service";

export const submitQueuedPodJobs = defineJob({
  name: "printOnDemand.submitQueued",
  summary: "Submit queued and retry failed print-on-demand jobs.",
  schedule: "7,37 * * * *",
  handler: async () => {
    const actor = { kind: "system" as const };
    const jobs = await listPodJobs.call({}, actor);
    for (const job of jobs) {
      if (job.status === "queued" || job.status === "failed") {
        await submitPodJob.call({ jobId: job.id }, actor);
      }
    }
  },
});

export default [submitQueuedPodJobs];
