// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Daily ad rollup (MASTER.md §4.16, C9.19).
import { defineJob } from "@/core/jobs";

export const rollUpAdStats = defineJob({
  name: "ads.rollUpStats",
  summary: "Rebuild yesterday's and today's ad delivery from first-party events.",
  schedule: "12 * * * *",
  concurrency: 1,
  handler: async () => {
    const { rollUpStats } = await import("./service");
    return rollUpStats.call({}, { kind: "system" });
  },
});

export default [rollUpAdStats];
