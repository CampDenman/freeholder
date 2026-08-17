// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// CMS background work (C2.02).
import { defineJob } from "@/core/jobs";

export const applyDueSchedules = defineJob({
  name: "cms.applyDueSchedules",
  summary: "Publish and unpublish pages whose scheduled time has arrived.",
  schedule: "* * * * *",
  concurrency: 1,
  handler: async () => {
    const { applyDueSchedules: apply } = await import("./lifecycle");
    return apply.call({}, { kind: "system" });
  },
});

export default [applyDueSchedules];
