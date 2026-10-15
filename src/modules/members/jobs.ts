// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { defineJob } from "@/core/jobs";

export const releaseDuePayouts = defineJob({
  name: "members.releaseDuePayouts",
  summary: "Move sellers' held payouts to due once the site's holding window has passed.",
  schedule: "*/15 * * * *",
  concurrency: 1,
  handler: async () => {
    const { releaseDuePayouts: release } = await import("./payouts");
    return release.call({}, { kind: "system" });
  },
});

export default [releaseDuePayouts];
