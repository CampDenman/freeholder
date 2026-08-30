// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Letting the refund window close (MASTER.md §4.13, C9.10).
//
// §4.13: "A `CommissionEvent` becomes payable only after the refund window
// closes." Nothing else in the module moves a commission from pending to
// approved, so this job is the whole of that promise.
//
// It returns a count rather than logging one, for the reason the loyalty
// expiry job gives: a job whose only output is a side effect is one nobody can
// tell has stopped working.
import { defineJob } from "@/core/jobs";
import { matureCommissions } from "./commission-service";

export const approveMaturedCommissions = defineJob({
  name: "referrals.approveMatured",
  summary: "Approve commission whose holdback has expired (§4.13).",
  // Daily. A holdback is stated in days, so a job running every minute would
  // do the same nothing 1,439 times and approve somebody a few hours early.
  schedule: "0 4 * * *",
  concurrency: 1,
  handler: async (): Promise<{ approved: number }> => {
    const { db } = await import("@/core/db");
    let approved = 0;
    await db().transaction(async (tx) => {
      approved = await matureCommissions(tx);
    });
    return { approved };
  },
});

export default [approveMaturedCommissions];
