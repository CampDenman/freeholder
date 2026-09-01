// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Delivering a report on a schedule (MASTER.md §2535, §43 C9.32).
//
// The orchestration lives here rather than inside one service on purpose, and
// it is the single most important decision in this item.
//
// A service is one transaction (§2 principle 12). Building the file and
// emailing it in that one transaction would mean that a failed send rolls the
// run row back with it — so the evidence that a report did not arrive would be
// destroyed by the very failure that stopped it arriving, and the next sweep
// would find no trace and try again from nothing. A job handler is *outside*
// any transaction, so it can do the one thing a service cannot: commit "I am
// about to deliver this" before attempting the delivery, and commit the
// outcome afterwards.
//
// So one pass is three commits:
//
//   1. reclaim  — runs that started delivering and never came back are marked
//                 failed. Something that crashed cannot write its own
//                 epitaph; this is what does.
//   2. build    — the file for the completed period, committed as `pending`.
//   3. deliver  — the mail, then `delivered` or `failed`.
//
// Every step is idempotent on the period, so a worker that was down all
// weekend makes a report late rather than losing it, and a worker that runs
// twice does not send an accountant the same month twice.
import { defineJob } from "@/core/jobs";

const SYSTEM = { kind: "system" } as const;

/**
 * Hourly, not on the first of the month at nine.
 *
 * Due-ness is a question about the data ("is there a delivered run for the
 * period that has ended?"), never about the clock, so a sweep that misses its
 * window simply catches up on the next one. A cron that fired once a month
 * would give a single missed tick a month-long consequence.
 */
export const deliverScheduledExports = defineJob({
  name: "reports.deliverScheduledExports",
  summary: "Build and deliver every scheduled export whose period has closed.",
  schedule: "23 * * * *",
  // One sender. Two workers picking up the same definition would both build
  // the same period, and while the unique index on (definition, period) stops
  // the second copy going out, it would do so by failing a run rather than by
  // not starting one.
  concurrency: 1,
  handler: async () => {
    const {
      listExports,
      runExport,
      deliverExportRun,
      reclaimExportRuns,
    } = await import("./export-service");

    const { reclaimed } = await reclaimExportRuns.call({}, SYSTEM);

    const due = (await listExports.call({}, SYSTEM)).filter((each) => each.due);
    let built = 0;
    let delivered = 0;
    let failed = 0;

    for (const each of due) {
      const run = await runExport.call(
        { id: each.definition.id, trigger: "schedule" },
        SYSTEM,
      );
      if (run.status === "failed") {
        failed += 1;
        continue;
      }
      built += 1;
      if (run.status !== "pending") continue;

      // A second transaction, deliberately. See the note at the top: the run
      // row is already committed, so however this ends there is a row saying
      // what happened to it.
      const settled = await deliverExportRun.call({ runId: run.id }, SYSTEM);
      if (settled.status === "delivered") delivered += 1;
      else failed += 1;
    }

    // Counts rather than nothing, because a scheduled job whose only output is
    // a side effect is one nobody can tell has stopped working.
    return { reclaimed, built, delivered, failed };
  },
});

export default [deliverScheduledExports];
