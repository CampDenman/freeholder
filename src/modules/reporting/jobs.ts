// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Crash-safe accounting export preparation and mail-ledger reconciliation.
//
// No job holds a service transaction open across provider I/O. Building the
// file commits first; preparing a delivery writes only export, encrypted-mail
// outbox and queue rows; core.deliverMail contacts the provider; settlement
// then reads the durable mail ledger in another short transaction.
import { defineJob } from "@/core/jobs";

const SYSTEM = { kind: "system" } as const;

export const prepareExportRun = defineJob({
  name: "reports.prepareExportRun",
  summary: "Stage one built accounting export in the encrypted mail outbox.",
  retry: { limit: 8, delaySeconds: 15, backoff: true, maxDelaySeconds: 3_600 },
  concurrency: 2,
  leaseSeconds: 2 * 60,
  handler: async (data) => {
    if (typeof data.runId !== "string") {
      throw new Error("reports.prepareExportRun requires a run id");
    }
    const { queueExportRunDelivery } = await import("./export-service");
    return queueExportRunDelivery.call({ runId: data.runId }, SYSTEM);
  },
});

export const settleExportRunDelivery = defineJob({
  name: "reports.settleExportRun",
  summary: "Settle one accounting export from durable mail-provider evidence.",
  retry: { limit: 12, delaySeconds: 30, backoff: true, maxDelaySeconds: 3_600 },
  concurrency: 4,
  leaseSeconds: 2 * 60,
  handler: async (data) => {
    if (typeof data.runId !== "string" || !Number.isInteger(data.attempt)) {
      throw new Error("reports.settleExportRun requires a run id and attempt");
    }
    const { settleExportRun } = await import("./export-service");
    const result = await settleExportRun.call(
      { runId: data.runId, attempt: Number(data.attempt) },
      SYSTEM,
    );
    // Mail owns its retry policy. This job waits and rechecks; it never calls
    // the provider itself. The scheduled reconciler remains the durable
    // backstop if this targeted job exhausts its own retries first.
    if (result.state === "pending") throw new Error("Mail delivery is still pending.");
    return result;
  },
});

export const reconcileExportDeliveries = defineJob({
  name: "reports.reconcileExportDeliveries",
  summary: "Reconcile in-flight exports and late mail-provider failures.",
  schedule: "*/5 * * * *",
  concurrency: 1,
  handler: async () => {
    const { reconcileExportRuns } = await import("./export-service");
    return reconcileExportRuns();
  },
});

/**
 * Hourly, not only on the first of the month.
 *
 * Due-ness is a data question: whether the completed period has a run accepted
 * by the configured mail provider. A missed worker tick therefore makes a file
 * late, never lost. A terminally failed period waits for an explicit retry so
 * a bad address does not generate an email and notification every hour.
 */
export const deliverScheduledExports = defineJob({
  name: "reports.deliverScheduledExports",
  summary: "Build and queue scheduled exports whose closed period has no sent run.",
  schedule: "23 * * * *",
  concurrency: 1,
  handler: async () => {
    const { listExports, runExport, queueExportRunDelivery } = await import(
      "./export-service"
    );
    const due = (await listExports.call({}, SYSTEM)).filter((each) => each.due);
    let built = 0;
    let queued = 0;
    let failed = 0;

    for (const each of due) {
      const failedThisPeriod =
        each.lastRun?.status === "failed" &&
        each.lastRun.periodFrom.getTime() === each.periodFrom.getTime() &&
        each.lastRun.periodTo.getTime() === each.periodTo.getTime();
      if (failedThisPeriod) {
        failed += 1;
        continue;
      }
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
      const prepared = await queueExportRunDelivery.call({ runId: run.id }, SYSTEM);
      if (prepared.status === "failed") failed += 1;
      else queued += 1;
    }

    return { built, queued, failed };
  },
});

export default [
  prepareExportRun,
  settleExportRunDelivery,
  reconcileExportDeliveries,
  deliverScheduledExports,
];
