// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.11: measure committed queue rows claimed by the real application worker.
import { randomUUID } from "node:crypto";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { defineJob, enqueueJob, getJob, registerJob, startJobs, stopJobs } from "@/core/jobs";
import { percentile } from "./performance";

export async function measureQueueLatency(): Promise<{
  surface: string; value: number; samples: number[]; completed: number;
}> {
  const prior = process.env.FREEHOLDER_JOBS;
  const name = `test.performanceQueue${randomUUID().replaceAll("-", "")}`;
  const handled = new Set<string>();
  const samples: number[] = [];
  process.env.FREEHOLDER_JOBS = "on";
  resetEnvForTests();
  try {
    registerJob(defineJob({
      name, summary: "Measure enqueue-to-claim latency through the application worker.",
      concurrency: 1, retry: { limit: 0 },
      handler: async (_data, context) => {
        if (!context) throw new Error("Queue measurement did not receive a real execution context.");
        if (handled.has(context.id)) throw new Error("Queue measurement ran a probe twice.");
        handled.add(context.id);
      },
    }));
    const worker = await startJobs();
    if (!worker) throw new Error("Queue performance requires a running database-backed worker.");
    // Sequential, idle-queue probes establish baseline dispatch latency. No
    // direct handler calls or manually fetched jobs can satisfy this clock.
    for (let index = 0; index < 20; index += 1) {
      const receipt = await db().transaction(tx => enqueueJob(tx, name, { index }));
      const deadline = Date.now() + 35_000;
      let complete = false;
      while (Date.now() < deadline) {
        const job = await getJob(name, receipt.id);
        if (job?.state === "failed" || job?.state === "cancelled") {
          throw new Error(`Queue performance probe ended ${job.state}.`);
        }
        if (job?.state === "completed") {
          if (!handled.has(receipt.id)) throw new Error("Queue probe completed without its application handler.");
          const elapsed = job.startedOn.getTime() - job.createdOn.getTime();
          if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error("Queue probe has invalid database timestamps.");
          samples.push(elapsed);
          complete = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (!complete) throw new Error("Queue performance probe did not complete within 35 seconds.");
    }
    return { surface: "Job queue latency", value: percentile(samples, 95), samples, completed: handled.size };
  } finally {
    try { await stopJobs(); } finally {
      if (prior === undefined) delete process.env.FREEHOLDER_JOBS;
      else process.env.FREEHOLDER_JOBS = prior;
      resetEnvForTests();
    }
  }
}
