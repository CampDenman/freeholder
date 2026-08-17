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

export const expireStalePresence = defineJob({
  name: "cms.expireStalePresence",
  summary: "Forget editors who have not heartbeated recently.",
  schedule: "* * * * *",
  concurrency: 1,
  handler: async () => {
    const { expireStalePresence: expire } = await import("./collaboration");
    return expire.call({}, { kind: "system" });
  },
});

export default [applyDueSchedules, expireStalePresence];
