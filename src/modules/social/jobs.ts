// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Hourly health probe so token expiry surfaces before post time (C9.24).
import { defineJob } from "@/core/jobs";

export const socialHealth = defineJob({
  name: "social.health",
  summary: "Probe connected social profiles and warn before tokens expire.",
  schedule: "7 * * * *",
  concurrency: 1,
  handler: async () => {
    const { runHealthJob } = await import("./service");
    return runHealthJob();
  },
});

export const socialIngest = defineJob({
  name: "social.ingest",
  summary: "Pull owned posts and comments from every readable profile.",
  schedule: "37 * * * *",
  concurrency: 1,
  handler: async () => {
    const { runIngestJob } = await import("./ingest");
    return runIngestJob();
  },
});

export const socialPublish = defineJob({
  name: "social.publishDue",
  summary: "Publish scheduled social variants whose time has come.",
  schedule: "*/5 * * * *",
  concurrency: 1,
  handler: async () => {
    const { runPublishJob } = await import("./compose");
    return runPublishJob();
  },
});

export default [socialHealth, socialIngest, socialPublish];
